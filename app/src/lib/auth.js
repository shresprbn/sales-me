const TOKEN_KEY = 'shop-admin-token'
const EXPIRES_KEY = 'shop-admin-token-expires'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL

export function getToken() {
  const token = localStorage.getItem(TOKEN_KEY)
  const expiresAt = Number(localStorage.getItem(EXPIRES_KEY) || 0)
  if (!token || !expiresAt || expiresAt < Date.now()) return null
  return token
}

export function isLoggedIn() {
  return Boolean(getToken())
}

export function logout() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(EXPIRES_KEY)
}

export async function login(password) {
  const res = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || 'Login failed')
  }
  const { token, expiresAt } = await res.json()
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(EXPIRES_KEY, String(expiresAt))
  return true
}
