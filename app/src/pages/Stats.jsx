import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { formatMoney } from '../lib/currency'

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'sales', label: 'Sales' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'purchases', label: 'Purchases' },
  { key: 'profit', label: 'Profit' },
]

const SLOW_MOVING_DAYS = 30

function startOfMonth() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function monthKey(iso) {
  const d = new Date(iso)
  return { key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleDateString(undefined, { year: 'numeric', month: 'long' }) }
}

export default function Stats() {
  const [activeTab, setActiveTab] = useState('overview')
  const [products, setProducts] = useState([])
  const [invoices, setInvoices] = useState([])
  const [invoiceItems, setInvoiceItems] = useState([])
  const [purchases, setPurchases] = useState([])
  const [status, setStatus] = useState('loading')

  useEffect(() => {
    Promise.all([
      api.listProducts({ all: true }),
      api.listInvoices({ all: true }),
      api.listInvoiceItems(),
      api.listPurchases({ all: true }),
    ])
      .then(([productsRes, invoicesRes, itemRows, purchasesRes]) => {
        setProducts(productsRes.rows)
        setInvoices(invoicesRes.rows)
        setInvoiceItems(itemRows)
        setPurchases(purchasesRes.rows)
        setStatus('ready')
      })
      .catch(() => setStatus('error'))
  }, [])

  // variant_id -> { productName, category, purchasePrice } — lets sales/profit
  // stats join back to a variant's current category and cost, since
  // invoice_items only snapshots the name/label/price at sale time.
  const variantMeta = useMemo(() => {
    const map = new Map()
    for (const p of products) {
      for (const v of p.product_variants || []) {
        map.set(v.id, { productName: p.name, category: p.category || 'Uncategorized', purchasePrice: Number(v.purchase_price) || 0 })
      }
    }
    return map
  }, [products])

  const activeInvoiceItems = useMemo(() => invoiceItems.filter((it) => it.invoices?.status !== 'void'), [invoiceItems])

  // ── Inventory ──────────────────────────────────────────────────────
  const stockByVariant = useMemo(() => {
    const rows = products.flatMap((p) =>
      (p.product_variants || []).map((v) => ({ ...v, productName: p.name, category: p.category || 'Uncategorized' })),
    )
    return rows.sort((a, b) => Number(b.stock_qty) * Number(b.unit_price) - Number(a.stock_qty) * Number(a.unit_price))
  }, [products])

  const outOfStock = useMemo(() => stockByVariant.filter((v) => Number(v.stock_qty) <= 0), [stockByVariant])
  const lowStock = useMemo(
    () => stockByVariant.filter((v) => Number(v.stock_qty) > 0 && Number(v.stock_qty) <= Number(v.low_stock_threshold)),
    [stockByVariant],
  )

  const inventoryStats = useMemo(() => {
    const stockValue = stockByVariant.reduce((sum, v) => sum + Number(v.stock_qty) * Number(v.unit_price), 0)
    return {
      productCount: products.length,
      variantCount: stockByVariant.length,
      stockValue,
      lowStockCount: lowStock.length,
      outOfStockCount: outOfStock.length,
    }
  }, [products, stockByVariant, lowStock, outOfStock])

  const stockValueByCategory = useMemo(() => {
    const map = new Map()
    for (const v of stockByVariant) {
      const entry = map.get(v.category) || { category: v.category, stockValue: 0, variantCount: 0 }
      entry.stockValue += Number(v.stock_qty) * Number(v.unit_price)
      entry.variantCount += 1
      map.set(v.category, entry)
    }
    return [...map.values()].sort((a, b) => b.stockValue - a.stockValue)
  }, [stockByVariant])

  const lastSoldByVariant = useMemo(() => {
    const map = new Map()
    for (const it of activeInvoiceItems) {
      if (!it.variant_id) continue
      const d = it.invoices?.created_at
      if (!d) continue
      const prev = map.get(it.variant_id)
      if (!prev || new Date(d) > new Date(prev)) map.set(it.variant_id, d)
    }
    return map
  }, [activeInvoiceItems])

  const slowMoving = useMemo(() => {
    const cutoff = Date.now() - SLOW_MOVING_DAYS * 24 * 60 * 60 * 1000
    return stockByVariant
      .filter((v) => Number(v.stock_qty) > 0)
      .map((v) => ({ ...v, lastSold: lastSoldByVariant.get(v.id) || null }))
      .filter((v) => !v.lastSold || new Date(v.lastSold).getTime() < cutoff)
      .sort((a, b) => new Date(a.lastSold || 0) - new Date(b.lastSold || 0))
  }, [stockByVariant, lastSoldByVariant])

  // ── Sales ──────────────────────────────────────────────────────────
  const salesStats = useMemo(() => {
    const monthStart = startOfMonth()
    const active = invoices.filter((inv) => inv.status !== 'void')
    const paid = invoices.filter((inv) => inv.status === 'paid')
    const unpaid = invoices.filter((inv) => inv.status === 'unpaid')
    const thisMonth = active.filter((inv) => new Date(inv.created_at) >= monthStart)
    const totalRevenue = active.reduce((sum, inv) => sum + Number(inv.total), 0)
    const outstanding = unpaid.reduce((sum, inv) => sum + Number(inv.total), 0)
    const monthRevenue = thisMonth.reduce((sum, inv) => sum + Number(inv.total), 0)
    return {
      invoiceCount: invoices.length,
      paid,
      unpaid,
      voidCount: invoices.length - active.length,
      totalRevenue,
      outstanding,
      monthRevenue,
      avgInvoice: active.length ? totalRevenue / active.length : 0,
    }
  }, [invoices])

  const salesByMonth = useMemo(() => {
    const map = new Map()
    for (const inv of invoices) {
      if (inv.status === 'void') continue
      const { key, label } = monthKey(inv.created_at)
      const entry = map.get(key) || { key, label, invoiceCount: 0, revenue: 0 }
      entry.invoiceCount += 1
      entry.revenue += Number(inv.total)
      map.set(key, entry)
    }
    return [...map.values()].sort((a, b) => b.key.localeCompare(a.key))
  }, [invoices])

  const salesByProduct = useMemo(() => {
    const map = new Map()
    for (const it of activeInvoiceItems) {
      const key = `${it.product_name} — ${it.variant_label}`
      const entry = map.get(key) || { productName: it.product_name, variantLabel: it.variant_label, unit: it.unit, qty: 0, revenue: 0 }
      entry.qty += Number(it.qty)
      entry.revenue += Number(it.line_total)
      map.set(key, entry)
    }
    return [...map.values()].sort((a, b) => b.revenue - a.revenue)
  }, [activeInvoiceItems])

  const salesByCategory = useMemo(() => {
    const map = new Map()
    for (const it of activeInvoiceItems) {
      const category = (it.variant_id && variantMeta.get(it.variant_id)?.category) || 'Uncategorized'
      const entry = map.get(category) || { category, qty: 0, revenue: 0 }
      entry.revenue += Number(it.line_total)
      entry.qty += Number(it.qty)
      map.set(category, entry)
    }
    return [...map.values()].sort((a, b) => b.revenue - a.revenue)
  }, [activeInvoiceItems, variantMeta])

  const topCustomers = useMemo(() => {
    const map = new Map()
    for (const inv of invoices) {
      if (inv.status === 'void') continue
      const key = inv.customer_phone || inv.customer_name || 'Walk-in customer'
      const entry = map.get(key) || { key, name: inv.customer_name || 'Walk-in customer', phone: inv.customer_phone || '', revenue: 0, orders: 0 }
      entry.revenue += Number(inv.total)
      entry.orders += 1
      map.set(key, entry)
    }
    return [...map.values()].sort((a, b) => b.revenue - a.revenue)
  }, [invoices])

  const discountStats = useMemo(() => {
    const active = invoices.filter((inv) => inv.status !== 'void')
    const discounted = active.filter((inv) => Number(inv.discount_amount) > 0)
    const totalDiscount = discounted.reduce((sum, inv) => sum + Number(inv.discount_amount), 0)
    return {
      discountedCount: discounted.length,
      totalDiscount,
      avgDiscount: discounted.length ? totalDiscount / discounted.length : 0,
      pctOfInvoices: active.length ? (discounted.length / active.length) * 100 : 0,
    }
  }, [invoices])

  // ── Purchases ──────────────────────────────────────────────────────
  const purchaseStats = useMemo(() => {
    const monthStart = startOfMonth()
    const totalSpent = purchases.reduce((sum, p) => sum + Number(p.total_cost), 0)
    const monthSpent = purchases.filter((p) => new Date(p.created_at) >= monthStart).reduce((sum, p) => sum + Number(p.total_cost), 0)
    return { count: purchases.length, totalSpent, monthSpent }
  }, [purchases])

  const purchasesBySupplier = useMemo(() => {
    const map = new Map()
    for (const p of purchases) {
      const supplier = p.supplier || 'Unknown supplier'
      const entry = map.get(supplier) || { supplier, spent: 0, count: 0 }
      entry.spent += Number(p.total_cost)
      entry.count += 1
      map.set(supplier, entry)
    }
    return [...map.values()].sort((a, b) => b.spent - a.spent)
  }, [purchases])

  const purchasesByProduct = useMemo(() => {
    const map = new Map()
    for (const p of purchases) {
      const key = `${p.product_name} — ${p.variant_label}`
      const entry = map.get(key) || { productName: p.product_name, variantLabel: p.variant_label, qty: 0, spent: 0 }
      entry.qty += Number(p.qty)
      entry.spent += Number(p.total_cost)
      map.set(key, entry)
    }
    return [...map.values()].sort((a, b) => b.spent - a.spent)
  }, [purchases])

  const purchasesByMonth = useMemo(() => {
    const map = new Map()
    for (const p of purchases) {
      const { key, label } = monthKey(p.created_at)
      const entry = map.get(key) || { key, label, count: 0, spent: 0 }
      entry.count += 1
      entry.spent += Number(p.total_cost)
      map.set(key, entry)
    }
    return [...map.values()].sort((a, b) => b.key.localeCompare(a.key))
  }, [purchases])

  // ── Profit ─────────────────────────────────────────────────────────
  // Uses each variant's CURRENT purchase price, not what it actually cost at
  // the time of that sale (which isn't tracked) — accurate for recent sales,
  // approximate for anything sold before the last price change.
  const profitStats = useMemo(() => {
    let revenueKnown = 0
    let cost = 0
    let revenueUnknown = 0
    const byProduct = new Map()
    for (const it of activeInvoiceItems) {
      const meta = it.variant_id ? variantMeta.get(it.variant_id) : null
      const revenue = Number(it.line_total)
      if (!meta) {
        revenueUnknown += revenue
        continue
      }
      const itemCost = meta.purchasePrice * Number(it.qty)
      revenueKnown += revenue
      cost += itemCost
      const key = `${it.product_name} — ${it.variant_label}`
      const entry = byProduct.get(key) || { productName: it.product_name, variantLabel: it.variant_label, unit: it.unit, revenue: 0, cost: 0, qty: 0 }
      entry.revenue += revenue
      entry.cost += itemCost
      entry.qty += Number(it.qty)
      byProduct.set(key, entry)
    }
    const profit = revenueKnown - cost
    const rows = [...byProduct.values()]
      .map((r) => ({ ...r, profit: r.revenue - r.cost, margin: r.revenue ? ((r.revenue - r.cost) / r.revenue) * 100 : 0 }))
      .sort((a, b) => b.profit - a.profit)
    return {
      revenueKnown,
      revenueUnknown,
      cost,
      profit,
      margin: revenueKnown ? (profit / revenueKnown) * 100 : 0,
      rows,
    }
  }, [activeInvoiceItems, variantMeta])

  if (status === 'loading') return <p className="empty-state">loading…</p>
  if (status === 'error') return <p className="empty-state">couldn't load stats — try refreshing</p>

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Stats</h1>
          <p className="page-subtitle">Inventory value and sales at a glance.</p>
        </div>
      </div>

      <div className="subtabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={activeTab === t.key ? 'active' : ''}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <>
          <div className="stat-grid">
            <div className="stat-tile">
              <span className="stat-label">Revenue (all-time)</span>
              <span className="stat-value">{formatMoney(salesStats.totalRevenue)}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">This month</span>
              <span className="stat-value">{formatMoney(salesStats.monthRevenue)}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">Gross profit (est.)</span>
              <span className="stat-value">{formatMoney(profitStats.profit)}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">Outstanding</span>
              <span className={`stat-value${salesStats.outstanding ? ' stat-warn' : ''}`}>{formatMoney(salesStats.outstanding)}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">Stock value</span>
              <span className="stat-value">{formatMoney(inventoryStats.stockValue)}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">Purchases (all-time)</span>
              <span className="stat-value">{formatMoney(purchaseStats.totalSpent)}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">Out of stock</span>
              <span className={`stat-value${inventoryStats.outOfStockCount ? ' stat-warn' : ''}`}>{inventoryStats.outOfStockCount}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">Low stock</span>
              <span className={`stat-value${inventoryStats.lowStockCount ? ' stat-warn' : ''}`}>{inventoryStats.lowStockCount}</span>
            </div>
          </div>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 14 }}>
            Gross profit uses each item's current purchase price, not necessarily what it cost when sold — see the Profit tab for details.
          </p>
        </>
      )}

      {activeTab === 'sales' && (
        <>
          <div className="stat-grid">
            <div className="stat-tile">
              <span className="stat-label">Total invoices</span>
              <span className="stat-value">{salesStats.invoiceCount}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">Revenue (all-time)</span>
              <span className="stat-value">{formatMoney(salesStats.totalRevenue)}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">This month</span>
              <span className="stat-value">{formatMoney(salesStats.monthRevenue)}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">Outstanding (unpaid)</span>
              <span className={`stat-value${salesStats.outstanding ? ' stat-warn' : ''}`}>{formatMoney(salesStats.outstanding)}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">Paid</span>
              <span className="stat-value">{salesStats.paid.length}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">Unpaid</span>
              <span className="stat-value">{salesStats.unpaid.length}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">Void</span>
              <span className="stat-value">{salesStats.voidCount}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">Avg. invoice</span>
              <span className="stat-value">{formatMoney(salesStats.avgInvoice)}</span>
            </div>
          </div>

          <h3 className="stats-subhead">Discount usage</h3>
          <div className="stat-grid">
            <div className="stat-tile">
              <span className="stat-label">Invoices discounted</span>
              <span className="stat-value">{discountStats.discountedCount} <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--muted)' }}>({discountStats.pctOfInvoices.toFixed(0)}%)</span></span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">Total discount given</span>
              <span className="stat-value">{formatMoney(discountStats.totalDiscount)}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">Avg. discount</span>
              <span className="stat-value">{formatMoney(discountStats.avgDiscount)}</span>
            </div>
          </div>

          {topCustomers.length > 0 && (
            <>
              <h3 className="stats-subhead">Top customers</h3>
              <div className="card" style={{ padding: 0 }}>
                <table>
                  <thead><tr><th>Customer</th><th>Phone</th><th>Orders</th><th>Revenue</th></tr></thead>
                  <tbody>
                    {topCustomers.slice(0, 20).map((c) => (
                      <tr key={c.key}>
                        <td>{c.name}</td>
                        <td>{c.phone || '—'}</td>
                        <td>{c.orders}</td>
                        <td>{formatMoney(c.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {salesStats.unpaid.length > 0 && (
            <>
              <h3 className="stats-subhead">Unpaid invoices</h3>
              <div className="card" style={{ padding: 0 }}>
                <table>
                  <thead><tr><th>Invoice</th><th>Customer</th><th>Date</th><th>Total</th></tr></thead>
                  <tbody>
                    {salesStats.unpaid.map((inv) => (
                      <tr key={inv.id}>
                        <td><Link to={`/invoices/${inv.id}`} className="btn-link">{inv.invoice_number}</Link></td>
                        <td>{inv.customer_name || 'Walk-in customer'}</td>
                        <td>{formatDate(inv.created_at)}</td>
                        <td className="stock-low">{formatMoney(inv.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {salesStats.paid.length > 0 && (
            <>
              <h3 className="stats-subhead">Paid invoices</h3>
              <div className="card" style={{ padding: 0 }}>
                <table>
                  <thead><tr><th>Invoice</th><th>Customer</th><th>Date</th><th>Total</th></tr></thead>
                  <tbody>
                    {salesStats.paid.map((inv) => (
                      <tr key={inv.id}>
                        <td><Link to={`/invoices/${inv.id}`} className="btn-link">{inv.invoice_number}</Link></td>
                        <td>{inv.customer_name || 'Walk-in customer'}</td>
                        <td>{formatDate(inv.created_at)}</td>
                        <td>{formatMoney(inv.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <h3 className="stats-subhead">Sales by month</h3>
          {salesByMonth.length === 0 && <p className="empty-state">No sales yet.</p>}
          {salesByMonth.length > 0 && (
            <div className="card" style={{ padding: 0 }}>
              <table>
                <thead><tr><th>Month</th><th>Invoices</th><th>Revenue</th><th>Avg. invoice</th></tr></thead>
                <tbody>
                  {salesByMonth.map((row) => (
                    <tr key={row.key}>
                      <td>{row.label}</td>
                      <td>{row.invoiceCount}</td>
                      <td>{formatMoney(row.revenue)}</td>
                      <td>{formatMoney(row.revenue / row.invoiceCount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3 className="stats-subhead">Sales by category</h3>
          {salesByCategory.length === 0 && <p className="empty-state">No sales yet.</p>}
          {salesByCategory.length > 0 && (
            <div className="card" style={{ padding: 0 }}>
              <table>
                <thead><tr><th>Category</th><th>Units sold</th><th>Revenue</th></tr></thead>
                <tbody>
                  {salesByCategory.map((row) => (
                    <tr key={row.category}>
                      <td>{row.category}</td>
                      <td>{row.qty}</td>
                      <td>{formatMoney(row.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3 className="stats-subhead">Sales by product</h3>
          {salesByProduct.length === 0 && <p className="empty-state">No sales yet.</p>}
          {salesByProduct.length > 0 && (
            <div className="card" style={{ padding: 0 }}>
              <table>
                <thead><tr><th>Product</th><th>Variant</th><th>Units sold</th><th>Revenue</th></tr></thead>
                <tbody>
                  {salesByProduct.map((row) => (
                    <tr key={`${row.productName}-${row.variantLabel}`}>
                      <td>{row.productName}</td>
                      <td>{row.variantLabel}</td>
                      <td>{row.qty} {row.unit}</td>
                      <td>{formatMoney(row.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {activeTab === 'inventory' && (
        <>
          <div className="stat-grid">
            <div className="stat-tile">
              <span className="stat-label">Products</span>
              <span className="stat-value">{inventoryStats.productCount}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">Variants</span>
              <span className="stat-value">{inventoryStats.variantCount}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">Stock value</span>
              <span className="stat-value">{formatMoney(inventoryStats.stockValue)}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">Out of stock</span>
              <span className={`stat-value${inventoryStats.outOfStockCount ? ' stat-warn' : ''}`}>{inventoryStats.outOfStockCount}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">Low stock</span>
              <span className={`stat-value${inventoryStats.lowStockCount ? ' stat-warn' : ''}`}>{inventoryStats.lowStockCount}</span>
            </div>
          </div>

          {stockValueByCategory.length > 0 && (
            <>
              <h3 className="stats-subhead">Stock value by category</h3>
              <div className="card" style={{ padding: 0 }}>
                <table>
                  <thead><tr><th>Category</th><th>Variants</th><th>Stock value</th></tr></thead>
                  <tbody>
                    {stockValueByCategory.map((row) => (
                      <tr key={row.category}>
                        <td>{row.category}</td>
                        <td>{row.variantCount}</td>
                        <td>{formatMoney(row.stockValue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {outOfStock.length > 0 && (
            <>
              <h3 className="stats-subhead">Out of stock</h3>
              <div className="card" style={{ padding: 0 }}>
                <table>
                  <thead><tr><th>Product</th><th>Variant</th><th>Sell price</th></tr></thead>
                  <tbody>
                    {outOfStock.map((v) => (
                      <tr key={v.id}>
                        <td>{v.productName}</td>
                        <td>{v.variant_label}</td>
                        <td className="stock-low">{formatMoney(v.unit_price)}/{v.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {lowStock.length > 0 && (
            <>
              <h3 className="stats-subhead">Low stock</h3>
              <div className="card" style={{ padding: 0 }}>
                <table>
                  <thead><tr><th>Product</th><th>Variant</th><th>Stock</th><th>Threshold</th></tr></thead>
                  <tbody>
                    {lowStock.map((v) => (
                      <tr key={v.id}>
                        <td>{v.productName}</td>
                        <td>{v.variant_label}</td>
                        <td className="stock-low">{v.stock_qty} {v.unit}</td>
                        <td>{v.low_stock_threshold} {v.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {slowMoving.length > 0 && (
            <>
              <h3 className="stats-subhead">Slow-moving stock (no sale in {SLOW_MOVING_DAYS}+ days)</h3>
              <div className="card" style={{ padding: 0 }}>
                <table>
                  <thead><tr><th>Product</th><th>Variant</th><th>Stock</th><th>Last sold</th></tr></thead>
                  <tbody>
                    {slowMoving.map((v) => (
                      <tr key={v.id}>
                        <td>{v.productName}</td>
                        <td>{v.variant_label}</td>
                        <td>{v.stock_qty} {v.unit}</td>
                        <td>{v.lastSold ? formatDate(v.lastSold) : 'never sold'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <h3 className="stats-subhead">Stock by product</h3>
          {stockByVariant.length === 0 && <p className="empty-state">No products yet.</p>}
          {stockByVariant.length > 0 && (
            <div className="card" style={{ padding: 0 }}>
              <table>
                <thead>
                  <tr><th>Product</th><th>Variant</th><th>Purchase price</th><th>Sell price</th><th>Stock</th><th>Stock value</th></tr>
                </thead>
                <tbody>
                  {stockByVariant.map((v) => {
                    const low = Number(v.stock_qty) <= Number(v.low_stock_threshold)
                    return (
                      <tr key={v.id}>
                        <td>{v.productName}</td>
                        <td>{v.variant_label}</td>
                        <td>{formatMoney(v.purchase_price ?? 0)}/{v.unit}</td>
                        <td>{formatMoney(v.unit_price)}/{v.unit}</td>
                        <td className={low ? 'stock-low' : ''}>
                          {v.stock_qty} {v.unit}
                          {low && <span className="tag tag-low" style={{ marginLeft: 6 }}>low</span>}
                        </td>
                        <td>{formatMoney(Number(v.stock_qty) * Number(v.unit_price))}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {activeTab === 'purchases' && (
        <>
          <div className="stat-grid">
            <div className="stat-tile">
              <span className="stat-label">Purchases logged</span>
              <span className="stat-value">{purchaseStats.count}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">Spent (all-time)</span>
              <span className="stat-value">{formatMoney(purchaseStats.totalSpent)}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">Spent this month</span>
              <span className="stat-value">{formatMoney(purchaseStats.monthSpent)}</span>
            </div>
          </div>

          {purchasesBySupplier.length === 0 && <p className="empty-state" style={{ marginTop: 16 }}>No purchases logged yet.</p>}

          {purchasesBySupplier.length > 0 && (
            <>
              <h3 className="stats-subhead">Spend by supplier</h3>
              <div className="card" style={{ padding: 0 }}>
                <table>
                  <thead><tr><th>Supplier</th><th>Purchases</th><th>Spent</th></tr></thead>
                  <tbody>
                    {purchasesBySupplier.map((row) => (
                      <tr key={row.supplier}>
                        <td>{row.supplier}</td>
                        <td>{row.count}</td>
                        <td>{formatMoney(row.spent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h3 className="stats-subhead">Spend by product</h3>
              <div className="card" style={{ padding: 0 }}>
                <table>
                  <thead><tr><th>Product</th><th>Variant</th><th>Qty bought</th><th>Spent</th></tr></thead>
                  <tbody>
                    {purchasesByProduct.map((row) => (
                      <tr key={`${row.productName}-${row.variantLabel}`}>
                        <td>{row.productName}</td>
                        <td>{row.variantLabel}</td>
                        <td>{row.qty}</td>
                        <td>{formatMoney(row.spent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h3 className="stats-subhead">Purchases by month</h3>
              <div className="card" style={{ padding: 0 }}>
                <table>
                  <thead><tr><th>Month</th><th>Purchases</th><th>Spent</th></tr></thead>
                  <tbody>
                    {purchasesByMonth.map((row) => (
                      <tr key={row.key}>
                        <td>{row.label}</td>
                        <td>{row.count}</td>
                        <td>{formatMoney(row.spent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {activeTab === 'profit' && (
        <>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: -4, marginBottom: 16 }}>
            Cost is each variant's <em>current</em> purchase price — not necessarily what it cost when a past sale happened,
            since cost isn't snapshotted per invoice item. Accurate for sales since the last price change, approximate before that.
          </p>
          <div className="stat-grid">
            <div className="stat-tile">
              <span className="stat-label">Revenue (costed)</span>
              <span className="stat-value">{formatMoney(profitStats.revenueKnown)}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">Cost of goods sold</span>
              <span className="stat-value">{formatMoney(profitStats.cost)}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">Gross profit</span>
              <span className="stat-value">{formatMoney(profitStats.profit)}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">Margin</span>
              <span className="stat-value">{profitStats.margin.toFixed(1)}%</span>
            </div>
          </div>
          {profitStats.revenueUnknown > 0 && (
            <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>
              {formatMoney(profitStats.revenueUnknown)} in revenue excluded above — those line items' variants were deleted, so no cost is on record.
            </p>
          )}

          <h3 className="stats-subhead">Margin by product</h3>
          {profitStats.rows.length === 0 && <p className="empty-state">No costed sales yet.</p>}
          {profitStats.rows.length > 0 && (
            <div className="card" style={{ padding: 0 }}>
              <table>
                <thead><tr><th>Product</th><th>Variant</th><th>Revenue</th><th>Cost</th><th>Profit</th><th>Margin</th></tr></thead>
                <tbody>
                  {profitStats.rows.map((row) => (
                    <tr key={`${row.productName}-${row.variantLabel}`}>
                      <td>{row.productName}</td>
                      <td>{row.variantLabel}</td>
                      <td>{formatMoney(row.revenue)}</td>
                      <td>{formatMoney(row.cost)}</td>
                      <td className={row.profit < 0 ? 'stock-low' : ''}>{formatMoney(row.profit)}</td>
                      <td>{row.margin.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
