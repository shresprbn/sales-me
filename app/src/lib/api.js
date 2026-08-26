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

export { UnauthorizedError }

export const api = {
  listProducts: () => request('/products'),
  createProduct: (body) => request('/products', { method: 'POST', body: JSON.stringify(body) }),
  updateProduct: (id, body) => request(`/products/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteProduct: (id) => request(`/products/${id}`, { method: 'DELETE' }),
  deleteVariant: (id) => request(`/variants/${id}`, { method: 'DELETE' }),

  listInvoices: () => request('/invoices'),
  getInvoice: (id) => request(`/invoices/${id}`),
  createInvoice: (body) => request('/invoices', { method: 'POST', body: JSON.stringify(body) }),
  setInvoiceStatus: (id, status) => request(`/invoices/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
}
