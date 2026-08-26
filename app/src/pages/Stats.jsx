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
  const [status, setStatus] = useState('loading')

  useEffect(() => {
    Promise.all([api.listProducts(), api.listInvoices()])
      .then(([productRows, invoiceRows]) => {
        setProducts(productRows)
        setInvoices(invoiceRows)
        setStatus('ready')
      })
      .catch(() => setStatus('error'))
  }, [])

  const inventoryStats = useMemo(() => {
    const variants = products.flatMap((p) =>
      (p.product_variants || []).map((v) => ({ ...v, productName: p.name })),
    )
    const stockValue = variants.reduce((sum, v) => sum + Number(v.stock_qty) * Number(v.unit_price), 0)
    const lowStock = variants.filter((v) => Number(v.stock_qty) <= Number(v.low_stock_threshold))
    return { productCount: products.length, variantCount: variants.length, stockValue, lowStock }
  }, [products])

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
              <span className={`stat-value${inventoryStats.lowStock.length ? ' stat-warn' : ''}`}>
                {inventoryStats.lowStock.length}
              </span>
            </div>
          </div>

          {inventoryStats.lowStock.length > 0 && (
            <div className="card" style={{ marginTop: 16, padding: 0 }}>
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
                  {inventoryStats.lowStock.map((v) => (
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
        </>
      )}
    </div>
  )
}
