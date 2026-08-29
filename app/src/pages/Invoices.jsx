import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { formatMoney } from '../lib/currency'

const PAGE_SIZE = 20

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function Invoices() {
  const [invoices, setInvoices] = useState([]) // current page
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [allInvoices, setAllInvoices] = useState([]) // full list, only needed while searching
  const [status, setStatus] = useState('loading')
  const [search, setSearch] = useState('')

  const loadPage = (p) => {
    setStatus('loading')
    api
      .listInvoices({ page: p, pageSize: PAGE_SIZE })
      .then(({ rows, total: t }) => {
        setInvoices(rows)
        setTotal(t)
        setPage(p)
        setStatus('ready')
      })
      .catch(() => setStatus('error'))
  }

  useEffect(() => loadPage(1), [])

  const searching = search.trim().length > 0

  // Fetch the full list lazily, only once the user actually starts
  // searching — most visits never need it.
  useEffect(() => {
    if (searching && allInvoices.length === 0) {
      api.listInvoices({ all: true }).then(({ rows }) => setAllInvoices(rows)).catch(() => {})
    }
  }, [searching])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const filteredInvoices = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return invoices
    return allInvoices.filter(
      (inv) =>
        inv.invoice_number.toLowerCase().includes(q) ||
        (inv.customer_name || '').toLowerCase().includes(q) ||
        (inv.customer_phone || '').toLowerCase().includes(q),
    )
  }, [invoices, allInvoices, search])

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Invoices</h1>
          <p className="page-subtitle">Everything you've billed, newest first.</p>
        </div>
        <Link to="/invoices/new" className="btn btn-primary">+ new invoice</Link>
      </div>

      {status === 'ready' && (total > 0 || searching) && (
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="search invoice #, customer, phone…"
          style={{ width: '100%', maxWidth: 320, border: '1px solid var(--border)', borderRadius: 8, padding: '9px 11px', marginBottom: 16 }}
        />
      )}

      {status === 'loading' && <p className="empty-state">loading…</p>}
      {status === 'error' && <p className="empty-state">couldn't load invoices — try refreshing</p>}
      {status === 'ready' && total === 0 && (
        <div className="card empty-state">No invoices yet.</div>
      )}
      {status === 'ready' && total > 0 && searching && filteredInvoices.length === 0 && (
        <div className="card empty-state">No invoices match "{search}".</div>
      )}

      {status === 'ready' && filteredInvoices.length > 0 && (
        <>
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
                {filteredInvoices.map((inv) => (
                  <tr key={inv.id}>
                    <td><Link to={`/invoices/${inv.id}`} className="btn-link">{inv.invoice_number}</Link></td>
                    <td>{inv.customer_name || 'Walk-in customer'}</td>
                    <td>{formatDate(inv.created_at)}</td>
                    <td>{formatMoney(inv.total)}</td>
                    <td><span className={`tag tag-${inv.status}`}>{inv.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!searching && totalPages > 1 && (
            <div className="pagination">
              <button type="button" className="btn btn-sm" disabled={page <= 1} onClick={() => loadPage(page - 1)}>‹ prev</button>
              <span>page {page} of {totalPages}</span>
              <button type="button" className="btn btn-sm" disabled={page >= totalPages} onClick={() => loadPage(page + 1)}>next ›</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
