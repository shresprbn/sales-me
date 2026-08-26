import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { downloadInvoicePdf } from '../lib/pdf'
import { formatMoney } from '../lib/currency'

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

const STATUSES = ['unpaid', 'paid', 'void']

export default function InvoiceDetail() {
  const { id } = useParams()
  const [invoice, setInvoice] = useState(null)
  const [status, setStatus] = useState('loading')
  const [updating, setUpdating] = useState(false)

  const load = () => {
    setStatus('loading')
    api
      .getInvoice(id)
      .then((row) => {
        setInvoice(row)
        setStatus('ready')
      })
      .catch(() => setStatus('error'))
  }

  useEffect(load, [id])

  const changeStatus = async (newStatus) => {
    setUpdating(true)
    try {
      const updated = await api.setInvoiceStatus(id, newStatus)
      setInvoice((prev) => ({ ...prev, status: updated.status }))
    } catch {
      window.alert('Could not update status')
    } finally {
      setUpdating(false)
    }
  }

  if (status === 'loading') return <p className="empty-state">loading…</p>
  if (status === 'error' || !invoice) return <p className="empty-state">couldn't load that invoice</p>

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{invoice.invoice_number}</h1>
          <p className="page-subtitle">{formatDate(invoice.created_at)} · <span className={`tag tag-${invoice.status}`}>{invoice.status}</span></p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to="/invoices" className="btn">back to invoices</Link>
          <button type="button" className="btn btn-primary" onClick={() => downloadInvoicePdf(invoice)}>
            download PDF
          </button>
        </div>
      </div>

      <div className="invoice-layout">
        <div className="invoice-main">
          <div className="card" style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>BILL TO</label>
            <p style={{ margin: '6px 0 0', fontWeight: 700 }}>{invoice.customer_name || 'Walk-in customer'}</p>
            {invoice.customer_phone && <p style={{ margin: '2px 0', color: 'var(--muted)' }}>{invoice.customer_phone}</p>}
            {invoice.customer_address && <p style={{ margin: '2px 0', color: 'var(--muted)' }}>{invoice.customer_address}</p>}
          </div>

          <div className="card">
            <div className="line-item-row header">
              <span>Item</span>
              <span>Variant</span>
              <span>Qty</span>
              <span>Total</span>
              <span></span>
            </div>
            {(invoice.invoice_items || []).map((it) => (
              <div className="line-item-row" key={it.id}>
                <span>{it.product_name}</span>
                <span>{it.variant_label} · {formatMoney(it.unit_price)}</span>
                <span>{it.qty}</span>
                <span>{formatMoney(it.line_total)}</span>
                <span></span>
              </div>
            ))}
          </div>

          {invoice.notes && (
            <div className="card" style={{ marginTop: 16 }}>
              <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>NOTES</label>
              <p style={{ margin: '6px 0 0' }}>{invoice.notes}</p>
            </div>
          )}
        </div>

        <div className="invoice-side">
          <div className="card">
            <div className="totals-row"><span>Subtotal</span><span>{formatMoney(invoice.subtotal)}</span></div>
            {Number(invoice.tax_percent) > 0 && (
              <div className="totals-row"><span>Tax ({invoice.tax_percent}%)</span><span>{formatMoney(invoice.tax_amount)}</span></div>
            )}
            <div className="totals-row total"><span>Total</span><span>{formatMoney(invoice.total)}</span></div>

            <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, display: 'block', marginTop: 16, marginBottom: 6 }}>
              STATUS
            </label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`btn btn-sm${invoice.status === s ? ' btn-primary' : ''}`}
                  disabled={updating || invoice.status === s}
                  onClick={() => changeStatus(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
