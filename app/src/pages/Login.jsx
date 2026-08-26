import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { login } from '../lib/auth'

export default function Login() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await login(password)
      const redirectTo = location.state?.from?.pathname || '/'
      navigate(redirectTo, { replace: true })
    } catch (err) {
      setError(err.message || 'Login failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-brand">Shop</div>
        <p className="login-copy">Inventory & invoices — admin only.</p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="password"
          className="login-input"
          autoFocus
        />
        {error && <p className="login-error">{error}</p>}
        <button type="submit" className="login-btn" disabled={submitting || !password}>
          {submitting ? 'checking…' : 'log in'}
        </button>
      </form>
    </div>
  )
}
