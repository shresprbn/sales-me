import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { formatMoney } from '../lib/currency'

function startOfMonth() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1)
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

  const inventoryStats = useMemo(() => {
    const stockValue = stockByVariant.reduce((sum, v) => sum + Number(v.stock_qty) * Number(v.unit_price), 0)
    const lowStockCount = stockByVariant.filter((v) => Number(v.stock_qty) <= Number(v.low_stock_threshold)).length
    return { productCount: products.length, variantCount: stockByVariant.length, stockValue, lowStockCount }
  }, [products, stockByVariant])

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
      paidCount: paid.length,
      unpaidCount: unpaid.length,
      voidCount: invoices.length - active.length,
      totalRevenue,
      outstanding,
      monthRevenue,
      avgInvoice: active.length ? totalRevenue / active.length : 0,
    }
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
              <span className="stat-label">Low stock</span>
              <span className={`stat-value${inventoryStats.lowStockCount ? ' stat-warn' : ''}`}>
                {inventoryStats.lowStockCount}
              </span>
            </div>
          </div>

          <h3 style={{ fontSize: 13, fontWeight: 700, margin: '20px 0 10px' }}>Stock by product</h3>
          {stockByVariant.length === 0 && <p className="empty-state">No products yet.</p>}
          {stockByVariant.length > 0 && (
            <div className="card" style={{ padding: 0 }}>
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Variant</th>
                    <th>Unit price</th>
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
              <span className="stat-value">{salesStats.paidCount}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">Unpaid</span>
              <span className="stat-value">{salesStats.unpaidCount}</span>
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
