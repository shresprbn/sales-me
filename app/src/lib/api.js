import { getToken, logout } from './auth'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL

class UnauthorizedError extends Error {}

// Every request goes through here so the admin token is attached
// consistently and a 401 (expired/invalid token) always sends you back to
// the login screen instead of silently failing somewhere deep in a page.
async function request(path, options = {}) {
  const token = getToken()
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })

  if (res.status === 401) {
    logout()
    throw new UnauthorizedError('Session expired')
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `Request failed (${res.status})`)
  }
  if (res.status === 204) return null
  return res.json()
}

// { page, pageSize } for a browsing table, or { all: true } to fetch
// everything in one go (search-across-everything, full-dataset stats).
function pagingQuery(params = {}) {
  const q = new URLSearchParams()
  if (params.all) q.set('all', 'true')
  else {
    if (params.page) q.set('page', params.page)
    if (params.pageSize) q.set('pageSize', params.pageSize)
  }
  const s = q.toString()
  return s ? `?${s}` : ''
}

export { UnauthorizedError }

export const api = {
  // Each resolves to { rows, total, page, pageSize }.
  listProducts: (params) => request(`/products${pagingQuery(params)}`),
  createProduct: (body) => request('/products', { method: 'POST', body: JSON.stringify(body) }),
  updateProduct: (id, body) => request(`/products/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteProduct: (id) => request(`/products/${id}`, { method: 'DELETE' }),
  deleteVariant: (id) => request(`/variants/${id}`, { method: 'DELETE' }),

  listInvoices: (params) => request(`/invoices${pagingQuery(params)}`),
  listInvoiceItems: () => request('/invoice-items'),
  getInvoice: (id) => request(`/invoices/${id}`),
  createInvoice: (body) => request('/invoices', { method: 'POST', body: JSON.stringify(body) }),
  setInvoiceStatus: (id, status) => request(`/invoices/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  deleteInvoice: (id, restock) => request(`/invoices/${id}?restock=${restock ? 'true' : 'false'}`, { method: 'DELETE' }),

  listPurchases: (params) => request(`/purchases${pagingQuery(params)}`),
  createPurchase: (body) => request('/purchases', { method: 'POST', body: JSON.stringify(body) }),
}
