import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function Invoices() {
  const [invoices, setInvoices] = useState([])
  const [status, setStatus] = useState('loading')

  useEffect(() => {
    api
      .listInvoices()
      .then((rows) => {
        setInvoices(rows)
        setStatus('ready')
      })
      .catch(() => setStatus('error'))
  }, [])

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Invoices</h1>
          <p className="page-subtitle">Everything you've billed, newest first.</p>
        </div>
        <Link to="/invoices/new" className="btn btn-primary">+ new invoice</Link>
      </div>

      {status === 'loading' && <p className="empty-state">loading…</p>}
      {status === 'error' && <p className="empty-state">couldn't load invoices — try refreshing</p>}
      {status === 'ready' && invoices.length === 0 && (
        <div className="card empty-state">No invoices yet.</div>
      )}

      {status === 'ready' && invoices.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Customer</th>
                <th>Date</th>
                <th>Total</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td><Link to={`/invoices/${inv.id}`} className="btn-link">{inv.invoice_number}</Link></td>
                  <td>{inv.customer_name || 'Walk-in customer'}</td>
                  <td>{formatDate(inv.created_at)}</td>
                  <td>₹{Number(inv.total).toFixed(2)}</td>
                  <td><span className={`tag tag-${inv.status}`}>{inv.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
