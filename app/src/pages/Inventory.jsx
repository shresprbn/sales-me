import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { formatMoney, formatUnitPrice } from '../lib/currency'

const UNITS = ['pcs', 'kg', 'litre', 'packet']
const PAGE_SIZE = 20

function normalizeUnit(unit) {
  const u = (unit || '').trim().toLowerCase()
  if (UNITS.includes(u)) return u
  if (u.startsWith('k')) return 'kg'
  if (u.startsWith('l')) return 'litre'
  if (u.startsWith('pack') || u.startsWith('box')) return 'packet'
  return 'pcs'
}

function emptyVariant() {
  return {
    _key: crypto.randomUUID(),
    id: null,
    variantLabel: '',
    sku: '',
    unit: 'pcs',
    purchasePrice: '',
    unitPrice: '',
    stockQty: '',
    lowStockThreshold: '',
  }
}

export default function Inventory() {
  const [products, setProducts] = useState([]) // current page, for the table
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [allProducts, setAllProducts] = useState([]) // full catalog — for the low-stock banner and search, which need to see everything, not just the current page
  const [status, setStatus] = useState('loading')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState(null)
  const [formName, setFormName] = useState('')
  const [formCategory, setFormCategory] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formVariants, setFormVariants] = useState([emptyVariant()])
  const [expandedVariants, setExpandedVariants] = useState(() => new Set())
  const [removedVariantIds, setRemovedVariantIds] = useState([])
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [search, setSearch] = useState('')

  const loadPage = (p) => {
    setStatus('loading')
    api
      .listProducts({ page: p, pageSize: PAGE_SIZE })
      .then(({ rows, total: t }) => {
        setProducts(rows)
        setTotal(t)
        setPage(p)
        setStatus('ready')
      })
      .catch(() => setStatus('error'))
  }

  const loadAll = () => {
    api
      .listProducts({ all: true })
      .then(({ rows }) => setAllProducts(rows))
      .catch(() => {})
  }

  const reload = (p = page) => {
    loadPage(p)
    loadAll()
  }

  useEffect(() => reload(1), [])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const lowStockVariants = useMemo(() => {
    const rows = []
    for (const p of allProducts) {
      for (const v of p.product_variants || []) {
        if (Number(v.stock_qty) <= Number(v.low_stock_threshold)) {
          rows.push({ ...v, productName: p.name })
        }
      }
    }
    return rows
  }, [allProducts])

  const searching = search.trim().length > 0

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return products
    return allProducts.filter((p) => {
      if (p.name.toLowerCase().includes(q)) return true
      if ((p.category || '').toLowerCase().includes(q)) return true
      return (p.product_variants || []).some(
        (v) => v.variant_label.toLowerCase().includes(q) || (v.sku || '').toLowerCase().includes(q),
      )
    })
  }, [products, allProducts, search])

  const openCreateModal = () => {
    const first = emptyVariant()
    setEditingProduct(null)
    setFormName('')
    setFormCategory('')
    setFormDescription('')
    setFormVariants([first])
    setExpandedVariants(new Set([first._key])) // empty and needs filling in, so start open
    setRemovedVariantIds([])
    setFormError('')
    setModalOpen(true)
  }

  const openEditModal = (product) => {
    setEditingProduct(product)
    setFormName(product.name)
    setFormCategory(product.category || '')
    setFormDescription(product.description || '')
    setFormVariants(
      (product.product_variants || []).map((v) => ({
        _key: v.id,
        id: v.id,
        variantLabel: v.variant_label,
        sku: v.sku || '',
        unit: normalizeUnit(v.unit),
        purchasePrice: String(v.purchase_price ?? 0),
        unitPrice: String(v.unit_price),
        stockQty: String(v.stock_qty),
        lowStockThreshold: String(v.low_stock_threshold),
      })),
    )
    setExpandedVariants(new Set()) // existing variants collapsed by default, so they stay separated and scannable
    setRemovedVariantIds([])
    setFormError('')
    setModalOpen(true)
  }

  const closeModal = () => {
    if (saving) return
    setModalOpen(false)
  }

  const updateVariantField = (key, field, value) => {
    setFormVariants((prev) => prev.map((v) => (v._key === key ? { ...v, [field]: value } : v)))
  }

  const addVariantRow = () => {
    const next = emptyVariant()
    setFormVariants((prev) => [...prev, next])
    setExpandedVariants((prev) => new Set(prev).add(next._key)) // new row is empty, open it right away
  }

  const removeVariantRow = (key) => {
    const variant = formVariants.find((v) => v._key === key)
    if (variant?.id) setRemovedVariantIds((prev) => [...prev, variant.id])
    setFormVariants((prev) => prev.filter((v) => v._key !== key))
    setExpandedVariants((prev) => {
      const next = new Set(prev)
      next.delete(key)
      return next
    })
  }

  const toggleVariantExpanded = (key) => {
    setExpandedVariants((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!formName.trim()) {
      setFormError('Product name is required')
      return
    }
    const variants = formVariants
      .filter((v) => v.variantLabel.trim() && v.unitPrice !== '')
      .map((v) => ({
        id: v.id || undefined,
        variantLabel: v.variantLabel.trim(),
        sku: v.sku.trim(),
        unit: v.unit.trim() || 'pcs',
        purchasePrice: Number(v.purchasePrice) || 0,
        unitPrice: Number(v.unitPrice),
        stockQty: Number(v.stockQty) || 0,
        lowStockThreshold: Number(v.lowStockThreshold) || 0,
      }))

    setSaving(true)
    setFormError('')
    try {
      const body = { name: formName.trim(), category: formCategory.trim(), description: formDescription.trim() }
      if (editingProduct) {
        await api.updateProduct(editingProduct.id, { ...body, variants, removedVariantIds })
      } else {
        await api.createProduct({ ...body, variants })
      }
      setModalOpen(false)
      reload()
    } catch (err) {
      setFormError(err.message || 'Could not save product')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteProduct = async (product) => {
    if (!window.confirm(`Delete "${product.name}" and all its variants?`)) return
    try {
      await api.deleteProduct(product.id)
      reload()
    } catch {
      window.alert('Could not delete product')
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Inventory</h1>
          <p className="page-subtitle">Products and their variants — price and stock on hand.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={openCreateModal}>
          + add product
        </button>
      </div>

      {status === 'ready' && lowStockVariants.length > 0 && (
        <div className="alert-banner">
          <strong>⚠ {lowStockVariants.length} variant{lowStockVariants.length > 1 ? 's' : ''} low on stock:</strong>{' '}
          {lowStockVariants.map((v, i) => (
            <span key={v.id}>
              {i > 0 && ', '}
              {v.productName} ({v.variant_label}) — {v.stock_qty} {v.unit} left
            </span>
          ))}
        </div>
      )}

      {status === 'ready' && (total > 0 || searching) && (
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="search products, variants, SKU…"
          style={{ width: '100%', maxWidth: 320, border: '1px solid var(--border)', borderRadius: 8, padding: '9px 11px', marginBottom: 16 }}
        />
      )}

      {status === 'loading' && <p className="empty-state">loading…</p>}
      {status === 'error' && <p className="empty-state">couldn't load inventory — try refreshing</p>}
      {status === 'ready' && total === 0 && (
        <div className="card empty-state">No products yet — add your first one.</div>
      )}
      {status === 'ready' && total > 0 && searching && filteredProducts.length === 0 && (
        <div className="card empty-state">No products match "{search}".</div>
      )}

      {status === 'ready' && filteredProducts.length > 0 && (
        <>
          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Variant</th>
                  <th>Purchase price</th>
                  <th>Sell price</th>
                  <th>Stock</th>
                  <th>SKU</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((product) => {
                  const variants = product.product_variants || []
                  if (variants.length === 0) {
                    return (
                      <tr key={product.id}>
                        <td>{product.name}</td>
                        <td colSpan={4} style={{ color: 'var(--muted)' }}>no variants</td>
                        <td></td>
                        <td>
                          <button type="button" className="btn btn-sm" onClick={() => openEditModal(product)}>edit</button>{' '}
                          <button type="button" className="btn btn-sm btn-danger" onClick={() => handleDeleteProduct(product)}>delete</button>
                        </td>
                      </tr>
                    )
                  }
                  return variants.map((v, i) => {
                    const low = v.stock_qty <= v.low_stock_threshold
                    return (
                      <tr key={v.id}>
                        {i === 0 && <td rowSpan={variants.length}>{product.name}</td>}
                        <td>{v.variant_label}</td>
                        <td>{formatUnitPrice(v.purchase_price ?? 0, v.unit)}</td>
                        <td>{formatUnitPrice(v.unit_price, v.unit)}</td>
                        <td className={low ? 'stock-low' : ''}>
                          {v.stock_qty} {v.unit}
                          {low && <span className="tag tag-low" style={{ marginLeft: 6 }}>low</span>}
                        </td>
                        <td>{v.sku || '—'}</td>
                        {i === 0 && (
                          <td rowSpan={variants.length}>
                            <button type="button" className="btn btn-sm" onClick={() => openEditModal(product)}>edit</button>{' '}
                            <button type="button" className="btn btn-sm btn-danger" onClick={() => handleDeleteProduct(product)}>delete</button>
                          </td>
                        )}
                      </tr>
                    )
                  })
                })}
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

      {modalOpen && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">{editingProduct ? 'Edit product' : 'Add product'}</h2>
            <form onSubmit={handleSubmit}>
              <div className="field-row">
                <div className="field">
                  <label>Product name</label>
                  <input type="text" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g. Fevicol" autoFocus />
                </div>
                <div className="field">
                  <label>Category (optional)</label>
                  <input type="text" value={formCategory} onChange={(e) => setFormCategory(e.target.value)} placeholder="e.g. Adhesives" />
                </div>
              </div>
              <div className="field">
                <label>Description (optional)</label>
                <textarea
                  rows={2}
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Notes about this product…"
                />
              </div>

              <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>Variants</label>
              {formVariants.map((v) => {
                const expanded = expandedVariants.has(v._key)
                return (
                  <div className="variant-accordion" key={v._key}>
                    <div className="variant-accordion-header">
                      <button
                        type="button"
                        className={`variant-accordion-toggle${expanded ? ' expanded' : ''}`}
                        onClick={() => toggleVariantExpanded(v._key)}
                      >
                        <span className="accordion-caret">{expanded ? '▾' : '▸'}</span>
                        <span className="variant-accordion-title">{v.variantLabel || 'New variant'}</span>
                        {!expanded && v.unitPrice !== '' && (
                          <span className="variant-accordion-summary">
                            {formatMoney(v.unitPrice)}/{v.unit} · {v.stockQty || 0} {v.unit} in stock
                          </span>
                        )}
                      </button>
                      <button type="button" className="btn btn-sm btn-danger" onClick={() => removeVariantRow(v._key)}>×</button>
                    </div>
                    {expanded && (
                      <div className="variant-row">
                        <div className="field">
                          <label>Variant</label>
                          <input
                            type="text"
                            value={v.variantLabel}
                            onChange={(e) => updateVariantField(v._key, 'variantLabel', e.target.value)}
                            placeholder="e.g. 1kg"
                          />
                        </div>
                        <div className="field narrow">
                          <label>SKU</label>
                          <input
                            type="text"
                            value={v.sku}
                            onChange={(e) => updateVariantField(v._key, 'sku', e.target.value)}
                            placeholder="SKU"
                          />
                        </div>
                        <div className="field narrow">
                          <label>Unit</label>
                          <div className="unit-toggle">
                            {UNITS.map((u) => (
                              <button
                                key={u}
                                type="button"
                                className={v.unit === u ? 'active' : ''}
                                onClick={() => updateVariantField(v._key, 'unit', u)}
                              >
                                {u}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="field narrow">
                          <label>Purchase price</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={v.purchasePrice}
                            onChange={(e) => updateVariantField(v._key, 'purchasePrice', e.target.value)}
                            placeholder={`cost/${v.unit || 'pcs'}`}
                          />
                        </div>
                        <div className="field narrow">
                          <label>Sell price</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={v.unitPrice}
                            onChange={(e) => updateVariantField(v._key, 'unitPrice', e.target.value)}
                            placeholder={`price/${v.unit || 'pcs'}`}
                          />
                        </div>
                        <div className="field narrow">
                          <label>Stock</label>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={v.stockQty}
                            onChange={(e) => updateVariantField(v._key, 'stockQty', e.target.value)}
                            placeholder="stock"
                          />
                        </div>
                        <div className="field narrow">
                          <label>Low stock at</label>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={v.lowStockThreshold}
                            onChange={(e) => updateVariantField(v._key, 'lowStockThreshold', e.target.value)}
                            placeholder="alert below"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
              <button type="button" className="btn-link" onClick={addVariantRow} style={{ marginBottom: 12 }}>
                + add variant
              </button>

              {formError && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{formError}</p>}

              <div className="modal-actions">
                <button type="button" className="btn" onClick={closeModal} disabled={saving}>cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'saving…' : 'save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
