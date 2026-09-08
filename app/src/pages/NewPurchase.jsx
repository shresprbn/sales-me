import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { formatMoney, formatUnitPrice } from '../lib/currency'
import { qtyPresets } from '../lib/qtyPresets'
import { UNITS } from '../lib/units'

export default function NewPurchase() {
  const navigate = useNavigate()
  const [products, setProducts] = useState([])
  const [loadStatus, setLoadStatus] = useState('loading')

  const [pickerOpen, setPickerOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [expandedGroups, setExpandedGroups] = useState(() => new Set())
  const [pendingVariant, setPendingVariant] = useState(null)
  const [pendingQty, setPendingQty] = useState('')
  const [pendingCost, setPendingCost] = useState('')
  const [pendingSell, setPendingSell] = useState('')

  const [lineItems, setLineItems] = useState([]) // { key, variantId, productName, variantLabel, unit, qty, costPrice, sellPrice }
  const [supplier, setSupplier] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [amountPaid, setAmountPaid] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const [newProductModalOpen, setNewProductModalOpen] = useState(false)
  const [newProductName, setNewProductName] = useState('')
  const [newVariantLabel, setNewVariantLabel] = useState('')
  const [newUnit, setNewUnit] = useState('pcs')
  const [newSellPrice, setNewSellPrice] = useState('')
  const [creatingProduct, setCreatingProduct] = useState(false)
  const [newProductError, setNewProductError] = useState('')

  const [newVariantModalOpen, setNewVariantModalOpen] = useState(null) // { productId, productName } or null
  const [existingVariantLabel, setExistingVariantLabel] = useState('')
  const [existingVariantUnit, setExistingVariantUnit] = useState('pcs')
  const [existingVariantSellPrice, setExistingVariantSellPrice] = useState('')
  const [creatingVariant, setCreatingVariant] = useState(false)
  const [existingVariantError, setExistingVariantError] = useState('')

  const loadProducts = () =>
    api
      .listProducts({ all: true })
      .then(({ rows }) => {
        setProducts(rows)
        setLoadStatus('ready')
      })
      .catch(() => setLoadStatus('error'))

  useEffect(() => {
    loadProducts()
  }, [])

  const allVariants = useMemo(() => {
    const rows = []
    for (const product of products) {
      for (const v of product.product_variants || []) {
        rows.push({
          variantId: v.id,
          productId: product.id,
          productName: product.name,
          variantLabel: v.variant_label,
          unit: v.unit || 'pcs',
          purchasePrice: Number(v.purchase_price) || 0,
          unitPrice: Number(v.unit_price) || 0,
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

  const groupedVariants = useMemo(() => {
    const groups = []
    const byName = new Map()
    for (const v of filteredVariants) {
      let group = byName.get(v.productName)
      if (!group) {
        group = { productName: v.productName, productId: v.productId, variants: [] }
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
    setPendingCost(variant.purchasePrice ? String(variant.purchasePrice) : '')
    setPendingSell(variant.unitPrice ? String(variant.unitPrice) : '')
  }

  const confirmAddItem = (e) => {
    e.preventDefault()
    const qty = Number(pendingQty)
    const cost = Number(pendingCost)
    if (!qty || qty <= 0 || !Number.isFinite(cost) || cost < 0) return
    const sell = pendingSell === '' ? undefined : Number(pendingSell)
    setLineItems((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        variantId: pendingVariant.variantId,
        productName: pendingVariant.productName,
        variantLabel: pendingVariant.variantLabel,
        unit: pendingVariant.unit,
        qty,
        costPrice: cost,
        sellPrice: sell,
      },
    ])
    setPendingVariant(null)
  }

  const updateQty = (key, qty) => {
    setLineItems((prev) =>
      prev.map((it) => (it.key === key ? { ...it, qty: Math.max(0.001, Number(qty) || 0.001) } : it)),
    )
  }

  const updateCostPrice = (key, cost) => {
    setLineItems((prev) => prev.map((it) => (it.key === key ? { ...it, costPrice: Math.max(0, Number(cost) || 0) } : it)))
  }

  const updateLineTotal = (key, total) => {
    setLineItems((prev) =>
      prev.map((it) => (it.key === key ? { ...it, costPrice: Math.max(0, Number(total) || 0) / it.qty } : it)),
    )
  }

  const removeItem = (key) => setLineItems((prev) => prev.filter((it) => it.key !== key))

  const openNewProductModal = () => {
    setPickerOpen(false)
    setNewProductName(search.trim())
    setNewVariantLabel('')
    setNewUnit('pcs')
    setNewSellPrice('')
    setNewProductError('')
    setNewProductModalOpen(true)
  }

  const handleCreateNewProduct = async (e) => {
    e.preventDefault()
    const name = newProductName.trim()
    const variantLabel = newVariantLabel.trim()
    const sellPrice = Number(newSellPrice)
    if (!name || !variantLabel) {
      setNewProductError('Product name and variant are both required')
      return
    }
    if (!Number.isFinite(sellPrice) || sellPrice < 0) {
      setNewProductError('Enter a valid sell price')
      return
    }
    setCreatingProduct(true)
    setNewProductError('')
    try {
      const product = await api.createProduct({
        name,
        category: '',
        description: '',
        variants: [{ variantLabel, unit: newUnit, purchasePrice: 0, unitPrice: sellPrice, stockQty: 0, lowStockThreshold: 0 }],
      })
      const variant = (product.product_variants || [])[0]
      loadProducts()
      setNewProductModalOpen(false)
      if (variant) {
        openQtyStep({
          variantId: variant.id,
          productId: product.id,
          productName: product.name,
          variantLabel: variant.variant_label,
          unit: variant.unit || 'pcs',
          purchasePrice: 0,
          unitPrice: Number(variant.unit_price) || 0,
        })
      }
    } catch (err) {
      setNewProductError(err.message || 'Could not create product')
    } finally {
      setCreatingProduct(false)
    }
  }

  const openNewVariantModal = (group) => {
    setPickerOpen(false)
    setExistingVariantLabel('')
    setExistingVariantUnit('pcs')
    setExistingVariantSellPrice('')
    setExistingVariantError('')
    setNewVariantModalOpen({ productId: group.productId, productName: group.productName })
  }

  const handleCreateVariantForExisting = async (e) => {
    e.preventDefault()
    const variantLabel = existingVariantLabel.trim()
    const sellPrice = Number(existingVariantSellPrice)
    if (!variantLabel) {
      setExistingVariantError('Enter a variant name')
      return
    }
    if (!Number.isFinite(sellPrice) || sellPrice < 0) {
      setExistingVariantError('Enter a valid sell price')
      return
    }
    setCreatingVariant(true)
    setExistingVariantError('')
    try {
      const before = products.find((p) => p.id === newVariantModalOpen.productId)
      const beforeIds = new Set((before?.product_variants || []).map((v) => v.id))
      const updated = await api.updateProduct(newVariantModalOpen.productId, {
        variants: [
          { variantLabel, unit: existingVariantUnit, purchasePrice: 0, unitPrice: sellPrice, stockQty: 0, lowStockThreshold: 0 },
        ],
      })
      const created = (updated.product_variants || []).find((v) => !beforeIds.has(v.id))
      loadProducts()
      setNewVariantModalOpen(null)
      if (created) {
        openQtyStep({
          variantId: created.id,
          productId: updated.id,
          productName: updated.name,
          variantLabel: created.variant_label,
          unit: created.unit || 'pcs',
          purchasePrice: 0,
          unitPrice: Number(created.unit_price) || 0,
        })
      }
    } catch (err) {
      setExistingVariantError(err.message || 'Could not create variant')
    } finally {
      setCreatingVariant(false)
    }
  }

  const totalCost = lineItems.reduce((sum, it) => sum + it.qty * it.costPrice, 0)
  const amountPaidNum = Math.max(0, Math.min(totalCost, Number(amountPaid) || 0))
  const balanceDue = Math.max(0, totalCost - amountPaidNum)

  const handleSubmit = async () => {
    if (!lineItems.length) {
      setError('Add at least one item first')
      return
    }
    setSubmitting(true)
    setError('')
    // Credit payments made "up front" are applied to items in order until the
    // amount is used up (first items get paid off first); cash/bank settle
    // each item in full. Items succeed one at a time so a mid-batch failure
    // leaves only the unsent remainder in the cart, ready to retry.
    let remaining = amountPaidNum
    try {
      for (const it of lineItems) {
        const itemTotal = Math.round(it.qty * it.costPrice * 100) / 100
        let itemPaid
        if (paymentMethod === 'credit') {
          itemPaid = Math.min(remaining, itemTotal)
          remaining = Math.round((remaining - itemPaid) * 100) / 100
        }
        await api.createPurchase({
          variantId: it.variantId,
          productName: it.productName,
          variantLabel: it.variantLabel,
          supplier: supplier.trim(),
          qty: it.qty,
          costPrice: it.costPrice,
          sellPrice: it.sellPrice,
          paymentMethod,
          amountPaid: itemPaid,
          notes: notes.trim(),
        })
        setLineItems((prev) => prev.filter((li) => li.key !== it.key))
      }
      navigate('/purchases')
    } catch (err) {
      setError((err.message || 'Could not record purchase') + ' — items already saved were kept; fix this and retry the rest.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Record purchase</h1>
          <p className="page-subtitle">Add one or more products from a supplier — stock and cost update together.</p>
        </div>
      </div>

      <div className="invoice-layout">
        <div className="invoice-main">
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="field">
              <label>Supplier (optional)</label>
              <input type="text" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="e.g. ABC Traders" />
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
                  <span>Product</span>
                  <span>Variant</span>
                  <span>Qty</span>
                  <span>Cost price</span>
                  <span>Total</span>
                  <span></span>
                </div>
                {lineItems.map((it) => (
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
                        value={it.costPrice}
                        onChange={(e) => updateCostPrice(it.key, e.target.value)}
                        className="qty-input"
                      />
                    </span>
                    <span className="qty-cell">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={Math.round(it.costPrice * it.qty * 100) / 100}
                        onChange={(e) => updateLineTotal(it.key, e.target.value)}
                        className="qty-input"
                      />
                    </span>
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => removeItem(it.key)}>×</button>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        <div className="invoice-side">
          <div className="card">
            <div className="field">
              <label>Payment</label>
              <div className="unit-toggle payment-toggle">
                {['cash', 'bank', 'credit'].map((m) => (
                  <button key={m} type="button" className={paymentMethod === m ? 'active' : ''} onClick={() => setPaymentMethod(m)}>
                    {m}
                  </button>
                ))}
              </div>
            </div>
            {paymentMethod === 'credit' && (
              <div className="field">
                <label>Paid now (optional — rest stays as credit)</label>
                <input type="number" min="0" step="0.01" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} placeholder="0" />
              </div>
            )}
            <div className="field">
              <label>Notes (optional)</label>
              <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

            <div className="totals-row"><span>Total cost</span><span>{formatMoney(totalCost)}</span></div>
            {paymentMethod === 'credit' && (
              <div className="totals-row total"><span>Balance due</span><span>{formatMoney(balanceDue)}</span></div>
            )}

            {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}

            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%', marginTop: 10 }}
              onClick={handleSubmit}
              disabled={submitting || lineItems.length === 0}
            >
              {submitting ? 'saving…' : `record purchase${lineItems.length > 1 ? ` (${lineItems.length} items)` : ''}`}
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
            <button type="button" className="btn-link" onClick={openNewProductModal} style={{ marginBottom: 12 }}>
              + new product{search.trim() ? ` "${search.trim()}"` : ''}
            </button>
            {loadStatus === 'ready' && groupedVariants.length === 0 && <p className="empty-state">no matching items</p>}
            {loadStatus === 'ready' && groupedVariants.length > 0 && (
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
                              <span className="picker-item-meta">last cost {formatMoney(v.purchasePrice)}/{v.unit}</span>
                            </div>
                          ))}
                          <div className="picker-item" onClick={() => openNewVariantModal(group)} style={{ color: 'var(--primary)', fontWeight: 600 }}>
                            <span>+ new variant</span>
                          </div>
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
            <form onSubmit={confirmAddItem}>
              <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>Quick amounts</label>
              <div className="qty-presets">
                {qtyPresets(pendingVariant.unit).map((p) => (
                  <button
                    type="button"
                    key={p.label}
                    className="btn btn-sm"
                    onClick={() => setPendingQty(String(Math.round(((Number(pendingQty) || 0) + p.value) * 1000) / 1000))}
                  >
                    +{p.label}
                  </button>
                ))}
              </div>

              <div className="field-row" style={{ marginTop: 12 }}>
                <div className="field">
                  <label>Quantity ({pendingVariant.unit})</label>
                  <input type="number" min="0.001" step="any" autoFocus value={pendingQty} onChange={(e) => setPendingQty(e.target.value)} />
                </div>
                <div className="field">
                  <label>Cost price (per {pendingVariant.unit})</label>
                  <input type="number" min="0" step="0.01" value={pendingCost} onChange={(e) => setPendingCost(e.target.value)} />
                </div>
              </div>
              <div className="field">
                <label>Sell price (per {pendingVariant.unit}) — updates inventory</label>
                <input type="number" min="0" step="0.01" value={pendingSell} onChange={(e) => setPendingSell(e.target.value)} />
              </div>

              {Number(pendingQty) > 0 && Number(pendingCost) >= 0 && (
                <p style={{ fontSize: 13, color: 'var(--muted)' }}>
                  Line total: {formatMoney(Number(pendingQty) * Number(pendingCost))}
                </p>
              )}

              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => setPendingVariant(null)}>cancel</button>
                <button type="submit" className="btn btn-primary" disabled={!(Number(pendingQty) > 0 && Number(pendingCost) >= 0)}>
                  add to purchase
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {newProductModalOpen && (
        <div className="modal-overlay" onClick={() => !creatingProduct && setNewProductModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">New product</h2>
            <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: -10, marginBottom: 16 }}>
              A minimal entry to get this into inventory — edit category, SKU, etc. later from Inventory.
            </p>
            <form onSubmit={handleCreateNewProduct}>
              <div className="field">
                <label>Product name</label>
                <input type="text" autoFocus value={newProductName} onChange={(e) => setNewProductName(e.target.value)} placeholder="e.g. Fevicol" />
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Variant</label>
                  <input type="text" value={newVariantLabel} onChange={(e) => setNewVariantLabel(e.target.value)} placeholder="e.g. 1kg" />
                </div>
                <div className="field">
                  <label>Sell price</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={newSellPrice}
                    onChange={(e) => setNewSellPrice(e.target.value)}
                    placeholder={`price/${newUnit}`}
                  />
                </div>
              </div>
              <div className="field">
                <label>Unit</label>
                <div className="unit-toggle">
                  {UNITS.map((u) => (
                    <button key={u} type="button" className={newUnit === u ? 'active' : ''} onClick={() => setNewUnit(u)}>
                      {u}
                    </button>
                  ))}
                </div>
              </div>

              {newProductError && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{newProductError}</p>}

              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => setNewProductModalOpen(false)} disabled={creatingProduct}>
                  cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={creatingProduct}>
                  {creatingProduct ? 'creating…' : 'create & continue'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {newVariantModalOpen && (
        <div className="modal-overlay" onClick={() => !creatingVariant && setNewVariantModalOpen(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">New variant — {newVariantModalOpen.productName}</h2>
            <form onSubmit={handleCreateVariantForExisting}>
              <div className="field-row">
                <div className="field">
                  <label>Variant</label>
                  <input type="text" autoFocus value={existingVariantLabel} onChange={(e) => setExistingVariantLabel(e.target.value)} placeholder="e.g. 2kg" />
                </div>
                <div className="field">
                  <label>Sell price</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={existingVariantSellPrice}
                    onChange={(e) => setExistingVariantSellPrice(e.target.value)}
                    placeholder={`price/${existingVariantUnit}`}
                  />
                </div>
              </div>
              <div className="field">
                <label>Unit</label>
                <div className="unit-toggle">
                  {UNITS.map((u) => (
                    <button key={u} type="button" className={existingVariantUnit === u ? 'active' : ''} onClick={() => setExistingVariantUnit(u)}>
                      {u}
                    </button>
                  ))}
                </div>
              </div>

              {existingVariantError && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{existingVariantError}</p>}

              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => setNewVariantModalOpen(null)} disabled={creatingVariant}>
                  cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={creatingVariant}>
                  {creatingVariant ? 'creating…' : 'create & continue'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
