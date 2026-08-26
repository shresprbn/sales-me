import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { downloadInvoicePdf } from '../lib/pdf'

export default function NewInvoice() {
  const navigate = useNavigate()
  const [products, setProducts] = useState([])
  const [loadStatus, setLoadStatus] = useState('loading')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [lineItems, setLineItems] = useState([]) // { key, variantId, productName, variantLabel, unitPrice, qty, stockQty }
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerAddress, setCustomerAddress] = useState('')
  const [taxPercent, setTaxPercent] = useState('0')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .listProducts()
      .then((rows) => {
        setProducts(rows)
        setLoadStatus('ready')
      })
      .catch(() => setLoadStatus('error'))
  }, [])

  const allVariants = useMemo(() => {
    const rows = []
    for (const product of products) {
      for (const v of product.product_variants || []) {
        rows.push({
          variantId: v.id,
          productName: product.name,
          variantLabel: v.variant_label,
          unitPrice: Number(v.unit_price),
          stockQty: Number(v.stock_qty),
        })
      }
    }
    return rows
  }, [products])

  const filteredVariants = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return allVariants
    return allVariants.filter(
      (v) => v.productName.toLowerCase().includes(q) || v.variantLabel.toLowerCase().includes(q),
    )
  }, [allVariants, search])

  const addItem = (variant) => {
    setLineItems((prev) => {
      const existing = prev.find((it) => it.variantId === variant.variantId)
      if (existing) {
        return prev.map((it) => (it.variantId === variant.variantId ? { ...it, qty: it.qty + 1 } : it))
      }
      return [...prev, { key: crypto.randomUUID(), ...variant, qty: 1 }]
    })
    setPickerOpen(false)
    setSearch('')
  }

  const updateQty = (key, qty) => {
    setLineItems((prev) => prev.map((it) => (it.key === key ? { ...it, qty: Math.max(1, Number(qty) || 1) } : it)))
  }

  const removeItem = (key) => {
    setLineItems((prev) => prev.filter((it) => it.key !== key))
  }

  const subtotal = lineItems.reduce((sum, it) => sum + it.unitPrice * it.qty, 0)
  const taxPct = Math.max(0, Math.min(100, Number(taxPercent) || 0))
  const taxAmount = subtotal * (taxPct / 100)
  const total = subtotal + taxAmount

  const handleSubmit = async () => {
    if (!lineItems.length) {
      setError('Add at least one item first')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const invoice = await api.createInvoice({
        customerName,
        customerPhone,
        customerAddress,
        taxPercent: taxPct,
        notes,
        items: lineItems.map((it) => ({
          variantId: it.variantId,
          productName: it.productName,
          variantLabel: it.variantLabel,
          unitPrice: it.unitPrice,
          qty: it.qty,
        })),
      })
      downloadInvoicePdf(invoice)
      navigate(`/invoices/${invoice.id}`)
    } catch (err) {
      setError(err.message || 'Could not create invoice')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">New invoice</h1>
          <p className="page-subtitle">Pick items, set a quantity, save — the PDF downloads automatically.</p>
        </div>
      </div>

      <div className="invoice-layout">
        <div className="invoice-main">
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="field-row">
              <div className="field">
                <label>Customer name (optional)</label>
                <input type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Walk-in customer" />
              </div>
              <div className="field">
                <label>Phone (optional)</label>
                <input type="text" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label>Address (optional)</label>
              <textarea rows={2} value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} />
            </div>
          </div>

          <div className="card">
            <div className="page-header" style={{ marginBottom: 12 }}>
              <h2 style={{ fontSize: 14, margin: 0 }}>Items</h2>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setPickerOpen(true)}>
                + add item
              </button>
            </div>

            {lineItems.length === 0 && <p className="empty-state" style={{ padding: '24px 0' }}>No items added yet.</p>}

            {lineItems.length > 0 && (
              <>
                <div className="line-item-row header">
                  <span>Item</span>
                  <span>Variant</span>
                  <span>Qty</span>
                  <span>Total</span>
                  <span></span>
                </div>
                {lineItems.map((it) => {
                  const over = it.qty > it.stockQty
                  return (
                    <div className="line-item-row" key={it.key}>
                      <span>{it.productName}</span>
                      <span>{it.variantLabel} · ₹{it.unitPrice.toFixed(2)}</span>
                      <input
                        type="number"
                        min="1"
                        value={it.qty}
                        onChange={(e) => updateQty(it.key, e.target.value)}
                        style={{ width: 60, border: '1px solid var(--border)', borderRadius: 6, padding: '4px 6px' }}
                      />
                      <span style={over ? { color: 'var(--danger)' } : undefined}>
                        ₹{(it.unitPrice * it.qty).toFixed(2)}
                        {over && ' ⚠'}
                      </span>
                      <button type="button" className="btn btn-sm btn-danger" onClick={() => removeItem(it.key)}>×</button>
                    </div>
                  )
                })}
              </>
            )}
          </div>
        </div>

        <div className="invoice-side">
          <div className="card">
            <div className="field">
              <label>Tax %</label>
              <input type="number" min="0" max="100" step="0.01" value={taxPercent} onChange={(e) => setTaxPercent(e.target.value)} />
            </div>
            <div className="field">
              <label>Notes (optional)</label>
              <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

            <div className="totals-row"><span>Subtotal</span><span>₹{subtotal.toFixed(2)}</span></div>
            {taxPct > 0 && <div className="totals-row"><span>Tax ({taxPct}%)</span><span>₹{taxAmount.toFixed(2)}</span></div>}
            <div className="totals-row total"><span>Total</span><span>₹{total.toFixed(2)}</span></div>

            {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}

            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%', marginTop: 12 }}
              onClick={handleSubmit}
              disabled={submitting || lineItems.length === 0}
            >
              {submitting ? 'saving…' : 'save & download PDF'}
            </button>
          </div>
        </div>
      </div>

      {pickerOpen && (
        <div className="modal-overlay" onClick={() => setPickerOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">Add item</h2>
            <input
              type="text"
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="search products…"
              style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 11px', marginBottom: 12 }}
            />
            {loadStatus === 'loading' && <p className="empty-state">loading…</p>}
            {loadStatus === 'ready' && filteredVariants.length === 0 && <p className="empty-state">no matching items</p>}
            {loadStatus === 'ready' && filteredVariants.length > 0 && (
              <div className="picker-list">
                {filteredVariants.map((v) => (
                  <div className="picker-item" key={v.variantId} onClick={() => addItem(v)}>
                    <span>{v.productName} — {v.variantLabel}</span>
                    <span className="picker-item-meta">₹{v.unitPrice.toFixed(2)} · {v.stockQty} in stock</span>
                  </div>
                ))}
              </div>
            )}
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setPickerOpen(false)}>close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
