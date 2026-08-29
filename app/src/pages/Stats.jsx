import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { formatMoney } from '../lib/currency'

function startOfMonth() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function Stats() {
  const [products, setProducts] = useState([])
  const [invoices, setInvoices] = useState([])
  const [invoiceItems, setInvoiceItems] = useState([])
  const [status, setStatus] = useState('loading')

  useEffect(() => {
    Promise.all([api.listProducts(), api.listInvoices(), api.listInvoiceItems()])
      .then(([productRows, invoiceRows, itemRows]) => {
        setProducts(productRows)
        setInvoices(invoiceRows)
        setInvoiceItems(itemRows)
        setStatus('ready')
      })
      .catch(() => setStatus('error'))
  }, [])

  const stockByVariant = useMemo(() => {
    const rows = products.flatMap((p) =>
      (p.product_variants || []).map((v) => ({ ...v, productName: p.name })),
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
      const d = new Date(inv.created_at)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const entry = map.get(key) || {
        key,
        label: d.toLocaleDateString(undefined, { year: 'numeric', month: 'long' }),
        invoiceCount: 0,
        revenue: 0,
      }
      entry.invoiceCount += 1
      entry.revenue += Number(inv.total)
      map.set(key, entry)
    }
    return [...map.values()].sort((a, b) => b.key.localeCompare(a.key))
  }, [invoices])

  const salesByProduct = useMemo(() => {
    const map = new Map()
    for (const it of invoiceItems) {
      if (it.invoices?.status === 'void') continue
      const key = `${it.product_name} — ${it.variant_label}`
      const entry = map.get(key) || {
        productName: it.product_name,
        variantLabel: it.variant_label,
        unit: it.unit,
        qty: 0,
        revenue: 0,
      }
      entry.qty += Number(it.qty)
      entry.revenue += Number(it.line_total)
      map.set(key, entry)
    }
    return [...map.values()].sort((a, b) => b.revenue - a.revenue)
  }, [invoiceItems])

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Stats</h1>
          <p className="page-subtitle">Inventory value and sales at a glance.</p>
        </div>
      </div>

      {status === 'loading' && <p className="empty-state">loading…</p>}
      {status === 'error' && <p className="empty-state">couldn't load stats — try refreshing</p>}

      {status === 'ready' && (
        <>
          <h2 className="section-title">Inventory</h2>
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
              <span className={`stat-value${inventoryStats.outOfStockCount ? ' stat-warn' : ''}`}>
                {inventoryStats.outOfStockCount}
              </span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">Low stock</span>
              <span className={`stat-value${inventoryStats.lowStockCount ? ' stat-warn' : ''}`}>
                {inventoryStats.lowStockCount}
              </span>
            </div>
          </div>

          {outOfStock.length > 0 && (
            <>
              <h3 style={{ fontSize: 13, fontWeight: 700, margin: '20px 0 10px' }}>Out of stock</h3>
              <div className="card" style={{ padding: 0 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Variant</th>
                      <th>Sell price</th>
                    </tr>
                  </thead>
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
              <h3 style={{ fontSize: 13, fontWeight: 700, margin: '20px 0 10px' }}>Low stock</h3>
              <div className="card" style={{ padding: 0 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Variant</th>
                      <th>Stock</th>
                      <th>Threshold</th>
                    </tr>
                  </thead>
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

          <h3 style={{ fontSize: 13, fontWeight: 700, margin: '20px 0 10px' }}>Stock by product</h3>
          {stockByVariant.length === 0 && <p className="empty-state">No products yet.</p>}
          {stockByVariant.length > 0 && (
            <div className="card" style={{ padding: 0 }}>
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Variant</th>
                    <th>Purchase price</th>
                    <th>Sell price</th>
                    <th>Stock</th>
                    <th>Stock value</th>
                  </tr>
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

          <h2 className="section-title" style={{ marginTop: 28 }}>Sales</h2>
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
              <span className={`stat-value${salesStats.outstanding ? ' stat-warn' : ''}`}>
                {formatMoney(salesStats.outstanding)}
              </span>
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

          {salesStats.unpaid.length > 0 && (
            <>
              <h3 style={{ fontSize: 13, fontWeight: 700, margin: '20px 0 10px' }}>Unpaid invoices</h3>
              <div className="card" style={{ padding: 0 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Customer</th>
                      <th>Date</th>
                      <th>Total</th>
                    </tr>
                  </thead>
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
              <h3 style={{ fontSize: 13, fontWeight: 700, margin: '20px 0 10px' }}>Paid invoices</h3>
              <div className="card" style={{ padding: 0 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Customer</th>
                      <th>Date</th>
                      <th>Total</th>
                    </tr>
                  </thead>
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

          <h3 style={{ fontSize: 13, fontWeight: 700, margin: '20px 0 10px' }}>Sales by month</h3>
          {salesByMonth.length === 0 && <p className="empty-state">No sales yet.</p>}
          {salesByMonth.length > 0 && (
            <div className="card" style={{ padding: 0 }}>
              <table>
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Invoices</th>
                    <th>Revenue</th>
                    <th>Avg. invoice</th>
                  </tr>
                </thead>
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

          <h3 style={{ fontSize: 13, fontWeight: 700, margin: '20px 0 10px' }}>Sales by product</h3>
          {salesByProduct.length === 0 && <p className="empty-state">No sales yet.</p>}
          {salesByProduct.length > 0 && (
            <div className="card" style={{ padding: 0 }}>
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Variant</th>
                    <th>Units sold</th>
                    <th>Revenue</th>
                  </tr>
                </thead>
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
    </div>
  )
}
