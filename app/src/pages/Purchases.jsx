import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { formatMoney } from '../lib/currency'

const PAGE_SIZE = 20

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function Purchases() {
  const [purchases, setPurchases] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [products, setProducts] = useState([])
  const [status, setStatus] = useState('loading')

  const [pickerOpen, setPickerOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [expandedGroups, setExpandedGroups] = useState(() => new Set())
  const [pendingVariant, setPendingVariant] = useState(null)
  const [supplier, setSupplier] = useState('')
  const [qty, setQty] = useState('')
  const [costPrice, setCostPrice] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

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

  const loadProducts = () => {
    api.listProducts({ all: true }).then(({ rows }) => setProducts(rows)).catch(() => {})
  }

  const reload = (p = page) => {
    loadPage(p)
    loadProducts()
  }

  useEffect(() => reload(1), [])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const allVariants = useMemo(() => {
    const rows = []
    for (const product of products) {
      for (const v of product.product_variants || []) {
        rows.push({
          variantId: v.id,
          productName: product.name,
          variantLabel: v.variant_label,
          unit: v.unit || 'pcs',
          purchasePrice: Number(v.purchase_price) || 0,
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

  const openDetail = (variant) => {
    setPickerOpen(false)
    setSearch('')
    setExpandedGroups(new Set())
    setPendingVariant(variant)
    setSupplier('')
    setQty('')
    setCostPrice(variant.purchasePrice ? String(variant.purchasePrice) : '')
    setNotes('')
    setFormError('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const qtyNum = Number(qty)
    const costNum = Number(costPrice)
    if (!qtyNum || qtyNum <= 0) {
      setFormError('Enter a valid quantity')
      return
    }
    if (!Number.isFinite(costNum) || costNum < 0) {
      setFormError('Enter a valid cost price')
      return
    }
    setSaving(true)
    setFormError('')
    try {
      await api.createPurchase({
        variantId: pendingVariant.variantId,
        productName: pendingVariant.productName,
        variantLabel: pendingVariant.variantLabel,
        supplier: supplier.trim(),
        qty: qtyNum,
        costPrice: costNum,
        notes: notes.trim(),
      })
      setPendingVariant(null)
      reload()
    } catch (err) {
      setFormError(err.message || 'Could not record purchase')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Purchases</h1>
          <p className="page-subtitle">Stock bought from suppliers — adds straight to inventory.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setPickerOpen(true)}>
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
                </tr>
              </thead>
              <tbody>
                {purchases.map((p) => (
                  <tr key={p.id}>
                    <td>{formatDate(p.created_at)}</td>
                    <td>{p.product_name}</td>
                    <td>{p.variant_label}</td>
                    <td>{p.supplier || '—'}</td>
                    <td>{p.qty}</td>
                    <td>{formatMoney(p.cost_price)}</td>
                    <td>{formatMoney(p.total_cost)}</td>
                  </tr>
                ))}
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

      {pickerOpen && (
        <div className="modal-overlay" onClick={() => setPickerOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">Record purchase</h2>
            <input
              type="text"
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="search products…"
              style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 11px', marginBottom: 12 }}
            />
            {groupedVariants.length === 0 && <p className="empty-state">no matching items</p>}
            {groupedVariants.length > 0 && (
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
                            <div className="picker-item" key={v.variantId} onClick={() => openDetail(v)}>
                              <span>{v.variantLabel}</span>
                              <span className="picker-item-meta">last cost {formatMoney(v.purchasePrice)}/{v.unit}</span>
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
        <div className="modal-overlay" onClick={() => !saving && setPendingVariant(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">{pendingVariant.productName} — {pendingVariant.variantLabel}</h2>
            <form onSubmit={handleSubmit}>
              <div className="field-row">
                <div className="field">
                  <label>Quantity ({pendingVariant.unit})</label>
                  <input type="number" min="0.001" step="any" autoFocus value={qty} onChange={(e) => setQty(e.target.value)} />
                </div>
                <div className="field">
                  <label>Cost price (per {pendingVariant.unit})</label>
                  <input type="number" min="0" step="0.01" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} />
                </div>
              </div>
              <div className="field">
                <label>Supplier (optional)</label>
                <input type="text" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="e.g. ABC Traders" />
              </div>
              <div className="field">
                <label>Notes (optional)</label>
                <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>

              {Number(qty) > 0 && Number(costPrice) >= 0 && (
                <p style={{ fontSize: 13, color: 'var(--muted)' }}>
                  Total cost: {formatMoney(Number(qty) * Number(costPrice))}
                </p>
              )}

              {formError && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{formError}</p>}

              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => setPendingVariant(null)} disabled={saving}>cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'saving…' : 'record purchase'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
