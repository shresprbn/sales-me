import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { downloadInvoicePdf } from '../lib/pdf'
import { formatMoney, formatUnitPrice } from '../lib/currency'

const WEIGHT_PRESETS = { g: [200, 500, 1000, 2000], kg: [0.2, 0.5, 1, 2] }
const VOLUME_PRESETS = { ml: [200, 500, 1000, 2000], l: [0.2, 0.5, 1, 2], litre: [0.2, 0.5, 1, 2] }
const WEIGHT_LABELS = ['200g', '500g', '1kg', '2kg']
const VOLUME_LABELS = ['200ml', '500ml', '1l', '2l']
const COUNT_PRESETS = [1, 2, 5, 10]

function qtyPresets(unit) {
  const u = (unit || 'pcs').toLowerCase()
  if (WEIGHT_PRESETS[u]) return WEIGHT_PRESETS[u].map((value, i) => ({ label: WEIGHT_LABELS[i], value }))
  if (VOLUME_PRESETS[u]) return VOLUME_PRESETS[u].map((value, i) => ({ label: VOLUME_LABELS[i], value }))
  return COUNT_PRESETS.map((value) => ({ label: String(value), value }))
}

export default function NewInvoice() {
  const navigate = useNavigate()
  const [products, setProducts] = useState([])
  const [loadStatus, setLoadStatus] = useState('loading')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [expandedGroups, setExpandedGroups] = useState(() => new Set())
  const [pendingVariant, setPendingVariant] = useState(null)
  const [pendingQty, setPendingQty] = useState('')
  const [lineItems, setLineItems] = useState([]) // { key, variantId, productName, variantLabel, unitPrice, qty, stockQty }
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerAddress, setCustomerAddress] = useState('')
  const [discountType, setDiscountType] = useState('percent')
  const [discountValue, setDiscountValue] = useState('0')
  const [taxPercent, setTaxPercent] = useState('0')
  const [notes, setNotes] = useState('')
  const [autoDownload, setAutoDownload] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .listProducts({ all: true })
      .then(({ rows }) => {
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
          unit: v.unit || 'pcs',
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

  // Grouped by product so each product's variants sit together in a clearly
  // separated box, instead of one flat list where they blend together.
  const groupedVariants = useMemo(() => {
    const groups = []
    const byName = new Map()
    for (const v of filteredVariants) {
      let group = byName.get(v.productName)
      if (!group) {
        group = { productName: v.productName, variants: [] }
        byName.set(v.productName, group)
        groups.push(group)
      }
      group.variants.push(v)
    }
    return groups
  }, [filteredVariants])

  const toggleGroup = (productName) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(productName)) next.delete(productName)
      else next.add(productName)
      return next
    })
  }

  const openQtyStep = (variant) => {
    setPickerOpen(false)
    setSearch('')
    setExpandedGroups(new Set())
    setPendingVariant(variant)
    setPendingQty('')
  }

  const confirmAddItem = (e) => {
    e.preventDefault()
    const qty = Number(pendingQty)
    if (!qty || qty <= 0) return
    setLineItems((prev) => {
      const existing = prev.find((it) => it.variantId === pendingVariant.variantId)
      if (existing) {
        return prev.map((it) => (it.variantId === pendingVariant.variantId ? { ...it, qty: it.qty + qty } : it))
      }
      return [...prev, { key: crypto.randomUUID(), ...pendingVariant, qty }]
    })
    setPendingVariant(null)
  }

  const updateQty = (key, qty) => {
    // Allow fractional quantities (0.2kg, 1.5l, etc.) — only floor out at a
    // tiny positive minimum so the field never goes to 0/negative/NaN.
    setLineItems((prev) =>
      prev.map((it) => (it.key === key ? { ...it, qty: Math.max(0.001, Number(qty) || 0.001) } : it)),
    )
  }

  // Both editable — unit price directly, or the line total which backs out
  // to an equivalent unit price at the current qty. Only one number is ever
  // actually stored (unitPrice); total is always unitPrice * qty.
  const updateUnitPrice = (key, price) => {
    setLineItems((prev) =>
      prev.map((it) => (it.key === key ? { ...it, unitPrice: Math.max(0, Number(price) || 0) } : it)),
    )
  }

  const updateLineTotal = (key, total) => {
    setLineItems((prev) =>
      prev.map((it) => (it.key === key ? { ...it, unitPrice: Math.max(0, Number(total) || 0) / it.qty } : it)),
    )
  }

  const removeItem = (key) => {
    setLineItems((prev) => prev.filter((it) => it.key !== key))
  }

  const subtotal = lineItems.reduce((sum, it) => sum + it.unitPrice * it.qty, 0)
  const discountValueNum = Math.max(0, Number(discountValue) || 0)
  const discountAmount =
    discountType === 'percent' ? subtotal * (Math.min(100, discountValueNum) / 100) : Math.min(discountValueNum, subtotal)
  const discounted = subtotal - discountAmount
  const taxPct = Math.max(0, Math.min(100, Number(taxPercent) || 0))
  const taxAmount = discounted * (taxPct / 100)
  const total = discounted + taxAmount

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
        discountType,
        discountValue: discountValueNum,
        taxPercent: taxPct,
        notes,
        items: lineItems.map((it) => ({
          variantId: it.variantId,
          productName: it.productName,
          variantLabel: it.variantLabel,
          unit: it.unit,
          unitPrice: it.unitPrice,
          qty: it.qty,
        })),
      })
      if (autoDownload) downloadInvoicePdf(invoice)
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
          <p className="page-subtitle">Pick items, set a quantity, save — the PDF is optional, on or off below.</p>
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
                  <span>Unit price</span>
                  <span>Total</span>
                  <span></span>
                </div>
                {lineItems.map((it) => {
                  const over = it.qty > it.stockQty
                  return (
                    <div className="line-item-row" key={it.key}>
                      <span>{it.productName}</span>
                      <span>{it.variantLabel}</span>
                      <span className="qty-cell">
                        <input
                          type="number"
                          min="0.001"
                          step="any"
                          value={it.qty}
                          onChange={(e) => updateQty(it.key, e.target.value)}
                          className="qty-input"
                        />
                        <span className="qty-unit">{it.unit}</span>
                      </span>
                      <span className="qty-cell">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={it.unitPrice}
                          onChange={(e) => updateUnitPrice(it.key, e.target.value)}
                          className="qty-input"
                        />
                      </span>
                      <span className="qty-cell">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={Math.round(it.unitPrice * it.qty * 100) / 100}
                          onChange={(e) => updateLineTotal(it.key, e.target.value)}
                          className="qty-input"
                        />
                        {over && <span style={{ color: 'var(--danger)' }}>⚠</span>}
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
              <label>Discount</label>
              <div className="discount-row">
                <div className="unit-toggle discount-type-toggle">
                  <button
                    type="button"
                    className={discountType === 'percent' ? 'active' : ''}
                    onClick={() => setDiscountType('percent')}
                  >
                    %
                  </button>
                  <button
                    type="button"
                    className={discountType === 'flat' ? 'active' : ''}
                    onClick={() => setDiscountType('flat')}
                  >
                    Rs.
                  </button>
                </div>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                />
              </div>
            </div>
            <div className="field">
              <label>Tax %</label>
              <input type="number" min="0" max="100" step="0.01" value={taxPercent} onChange={(e) => setTaxPercent(e.target.value)} />
            </div>
            <div className="field">
              <label>Notes (optional)</label>
              <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

            <div className="totals-row"><span>Subtotal</span><span>{formatMoney(subtotal)}</span></div>
            {discountAmount > 0 && (
              <div className="totals-row"><span>Discount</span><span>-{formatMoney(discountAmount)}</span></div>
            )}
            {taxPct > 0 && <div className="totals-row"><span>Tax ({taxPct}%)</span><span>{formatMoney(taxAmount)}</span></div>}
            <div className="totals-row total"><span>Total</span><span>{formatMoney(total)}</span></div>

            {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginTop: 14, cursor: 'pointer' }}>
              <input type="checkbox" checked={autoDownload} onChange={(e) => setAutoDownload(e.target.checked)} />
              download PDF after saving
            </label>

            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%', marginTop: 10 }}
              onClick={handleSubmit}
              disabled={submitting || lineItems.length === 0}
            >
              {submitting ? 'saving…' : autoDownload ? 'save & download PDF' : 'save invoice'}
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
              <div className="picker-groups">
                {groupedVariants.map((group) => {
                  const expanded = expandedGroups.has(group.productName)
                  return (
                    <div className="picker-group" key={group.productName}>
                      <button
                        type="button"
                        className={`picker-group-title accordion-toggle${expanded ? ' expanded' : ''}`}
                        onClick={() => toggleGroup(group.productName)}
                      >
                        <span>{group.productName}</span>
                        <span className="accordion-caret">{expanded ? '▾' : '▸'}</span>
                      </button>
                      {expanded && (
                        <div className="picker-list">
                          {group.variants.map((v) => (
                            <div className="picker-item" key={v.variantId} onClick={() => openQtyStep(v)}>
                              <span>{v.variantLabel}</span>
                              <span className="picker-item-meta">{formatUnitPrice(v.unitPrice, v.unit)} · {v.stockQty} {v.unit} in stock</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setPickerOpen(false)}>close</button>
            </div>
          </div>
        </div>
      )}

      {pendingVariant && (
        <div className="modal-overlay" onClick={() => setPendingVariant(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">{pendingVariant.productName} — {pendingVariant.variantLabel}</h2>
            <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: -10, marginBottom: 16 }}>
              {formatUnitPrice(pendingVariant.unitPrice, pendingVariant.unit)} · {pendingVariant.stockQty} {pendingVariant.unit} in stock
            </p>
            <form onSubmit={confirmAddItem}>
              <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>Quick amounts</label>
              <div className="qty-presets">
                {qtyPresets(pendingVariant.unit).map((p) => (
                  <button
                    type="button"
                    key={p.label}
                    className={`btn btn-sm ${Number(pendingQty) === p.value ? 'btn-primary' : ''}`}
                    onClick={() => setPendingQty(String(p.value))}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <div className="field" style={{ marginTop: 12 }}>
                <label>Quantity ({pendingVariant.unit})</label>
                <input
                  type="number"
                  min="0.001"
                  step="any"
                  autoFocus
                  value={pendingQty}
                  onChange={(e) => setPendingQty(e.target.value)}
                  placeholder={`amount in ${pendingVariant.unit}`}
                />
              </div>

              {Number(pendingQty) > 0 && (
                <p style={{ fontSize: 13, color: 'var(--muted)' }}>
                  Line total: {formatMoney(Number(pendingQty) * pendingVariant.unitPrice)}
                </p>
              )}

              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => setPendingVariant(null)}>cancel</button>
                <button type="submit" className="btn btn-primary" disabled={!(Number(pendingQty) > 0)}>
                  add to invoice
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
