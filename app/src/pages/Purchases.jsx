import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { formatMoney } from '../lib/currency'

const PAGE_SIZE = 20

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function Purchases() {
  const navigate = useNavigate()
  const [purchases, setPurchases] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('loading')

  const [payModalOpen, setPayModalOpen] = useState(null) // purchase row being paid down, or null
  const [payAmount, setPayAmount] = useState('')
  const [paying, setPaying] = useState(false)
  const [payError, setPayError] = useState('')

  const loadPage = (p) => {
    setStatus('loading')
    api
      .listPurchases({ page: p, pageSize: PAGE_SIZE })
      .then(({ rows, total: t }) => {
        setPurchases(rows)
        setTotal(t)
        setPage(p)
        setStatus('ready')
      })
      .catch(() => setStatus('error'))
  }

  useEffect(() => loadPage(1), [])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const openPayModal = (purchase) => {
    setPayModalOpen(purchase)
    setPayAmount('')
    setPayError('')
  }

  const handlePay = async (e) => {
    e.preventDefault()
    const amount = Number(payAmount)
    if (!amount || amount <= 0) {
      setPayError('Enter a valid amount')
      return
    }
    setPaying(true)
    setPayError('')
    try {
      await api.recordPurchasePayment(payModalOpen.id, amount)
      setPayModalOpen(null)
      loadPage(page)
    } catch (err) {
      setPayError(err.message || 'Could not record payment')
    } finally {
      setPaying(false)
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Purchases</h1>
          <p className="page-subtitle">Stock bought from suppliers — adds straight to inventory.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => navigate('/purchases/new')}>
          + record purchase
        </button>
      </div>

      {status === 'loading' && <p className="empty-state">loading…</p>}
      {status === 'error' && <p className="empty-state">couldn't load purchases — try refreshing</p>}
      {status === 'ready' && total === 0 && (
        <div className="card empty-state">No purchases logged yet.</div>
      )}

      {status === 'ready' && purchases.length > 0 && (
        <>
          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Product</th>
                  <th>Variant</th>
                  <th>Supplier</th>
                  <th>Qty</th>
                  <th>Cost/unit</th>
                  <th>Total cost</th>
                  <th>Payment</th>
                </tr>
              </thead>
              <tbody>
                {purchases.map((p) => {
                  const balance = Math.max(0, Number(p.total_cost) - Number(p.amount_paid ?? p.total_cost))
                  return (
                    <tr key={p.id}>
                      <td>{formatDate(p.created_at)}</td>
                      <td>{p.product_name}</td>
                      <td>{p.variant_label}</td>
                      <td>{p.supplier || '—'}</td>
                      <td>{p.qty}</td>
                      <td>{formatMoney(p.cost_price)}</td>
                      <td>{formatMoney(p.total_cost)}</td>
                      <td>
                        {p.payment_method !== 'credit' && <span className="tag">{p.payment_method}</span>}
                        {p.payment_method === 'credit' && balance > 0 && (
                          <>
                            <span className="stock-low">{formatMoney(balance)} due</span>{' '}
                            <button type="button" className="btn btn-sm" onClick={() => openPayModal(p)}>pay</button>
                          </>
                        )}
                        {p.payment_method === 'credit' && balance <= 0 && <span className="tag tag-paid">paid off</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              <button type="button" className="btn btn-sm" disabled={page <= 1} onClick={() => loadPage(page - 1)}>‹ prev</button>
              <span>page {page} of {totalPages}</span>
              <button type="button" className="btn btn-sm" disabled={page >= totalPages} onClick={() => loadPage(page + 1)}>next ›</button>
            </div>
          )}
        </>
      )}

      {payModalOpen && (
        <div className="modal-overlay" onClick={() => !paying && setPayModalOpen(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">Pay {payModalOpen.product_name} — {payModalOpen.variant_label}</h2>
            <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: -10, marginBottom: 16 }}>
              Balance due: {formatMoney(Math.max(0, Number(payModalOpen.total_cost) - Number(payModalOpen.amount_paid ?? 0)))}
            </p>
            <form onSubmit={handlePay}>
              <div className="field">
                <label>Amount</label>
                <input type="number" min="0.01" step="0.01" autoFocus value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
              </div>

              {payError && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{payError}</p>}

              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => setPayModalOpen(null)} disabled={paying}>cancel</button>
                <button type="submit" className="btn btn-primary" disabled={paying}>
                  {paying ? 'saving…' : 'record payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
