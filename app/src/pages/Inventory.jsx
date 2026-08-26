import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { formatMoney, formatUnitPrice } from '../lib/currency'

const COMMON_UNITS = ['pcs', 'kg', 'g', 'l', 'ml', 'box', 'dozen']

function emptyVariant() {
  return {
    _key: crypto.randomUUID(),
    id: null,
    variantLabel: '',
    sku: '',
    unit: 'pcs',
    unitPrice: '',
    stockQty: '',
    lowStockThreshold: '',
  }
}

export default function Inventory() {
  const [products, setProducts] = useState([])
  const [status, setStatus] = useState('loading')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState(null)
  const [formName, setFormName] = useState('')
  const [formCategory, setFormCategory] = useState('')
  const [formVariants, setFormVariants] = useState([emptyVariant()])
  const [removedVariantIds, setRemovedVariantIds] = useState([])
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const load = () => {
    setStatus('loading')
    api
      .listProducts()
      .then((rows) => {
        setProducts(rows)
        setStatus('ready')
      })
      .catch(() => setStatus('error'))
  }

  useEffect(load, [])

  const openCreateModal = () => {
    setEditingProduct(null)
    setFormName('')
    setFormCategory('')
    setFormVariants([emptyVariant()])
    setRemovedVariantIds([])
    setFormError('')
    setModalOpen(true)
  }

  const openEditModal = (product) => {
    setEditingProduct(product)
    setFormName(product.name)
    setFormCategory(product.category || '')
    setFormVariants(
      (product.product_variants || []).map((v) => ({
        _key: v.id,
        id: v.id,
        variantLabel: v.variant_label,
        sku: v.sku || '',
        unit: v.unit || 'pcs',
        unitPrice: String(v.unit_price),
        stockQty: String(v.stock_qty),
        lowStockThreshold: String(v.low_stock_threshold),
      })),
    )
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
    setFormVariants((prev) => [...prev, emptyVariant()])
  }

  const removeVariantRow = (key) => {
    const variant = formVariants.find((v) => v._key === key)
    if (variant?.id) setRemovedVariantIds((prev) => [...prev, variant.id])
    setFormVariants((prev) => prev.filter((v) => v._key !== key))
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
        unitPrice: Number(v.unitPrice),
        stockQty: Number(v.stockQty) || 0,
        lowStockThreshold: Number(v.lowStockThreshold) || 0,
      }))

    setSaving(true)
    setFormError('')
    try {
      if (editingProduct) {
        await api.updateProduct(editingProduct.id, { name: formName.trim(), category: formCategory.trim(), variants, removedVariantIds })
      } else {
        await api.createProduct({ name: formName.trim(), category: formCategory.trim(), variants })
      }
      setModalOpen(false)
      load()
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
      load()
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

      {status === 'loading' && <p className="empty-state">loading…</p>}
      {status === 'error' && <p className="empty-state">couldn't load inventory — try refreshing</p>}
      {status === 'ready' && products.length === 0 && (
        <div className="card empty-state">No products yet — add your first one.</div>
      )}

      {status === 'ready' && products.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Variant</th>
                <th>SKU</th>
                <th>Unit price</th>
                <th>Stock</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => {
                const variants = product.product_variants || []
                if (variants.length === 0) {
                  return (
                    <tr key={product.id}>
                      <td>{product.name}</td>
                      <td colSpan={3} style={{ color: 'var(--muted)' }}>no variants</td>
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
                      <td>{v.sku || '—'}</td>
                      <td>{formatUnitPrice(v.unit_price, v.unit)}</td>
                      <td className={low ? 'stock-low' : ''}>
                        {v.stock_qty} {v.unit}
                        {low && <span className="tag tag-low" style={{ marginLeft: 6 }}>low</span>}
                      </td>
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

              <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>Variants</label>
              {formVariants.map((v) => (
                <div className="variant-row" key={v._key}>
                  <div className="field">
                    <input
                      type="text"
                      value={v.variantLabel}
                      onChange={(e) => updateVariantField(v._key, 'variantLabel', e.target.value)}
                      placeholder="e.g. 1kg"
                    />
                  </div>
                  <div className="field narrow">
                    <input
                      type="text"
                      value={v.sku}
                      onChange={(e) => updateVariantField(v._key, 'sku', e.target.value)}
                      placeholder="SKU"
                    />
                  </div>
                  <div className="field narrow">
                    <input
                      type="text"
                      list="unit-options"
                      value={v.unit}
                      onChange={(e) => updateVariantField(v._key, 'unit', e.target.value)}
                      placeholder="unit"
                    />
                  </div>
                  <div className="field narrow">
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
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={v.stockQty}
                      onChange={(e) => updateVariantField(v._key, 'stockQty', e.target.value)}
                      placeholder="stock"
                    />
                  </div>
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => removeVariantRow(v._key)}>×</button>
                </div>
              ))}
              <datalist id="unit-options">
                {COMMON_UNITS.map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
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
