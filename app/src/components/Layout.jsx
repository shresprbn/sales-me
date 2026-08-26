import { Link, useLocation, useNavigate } from 'react-router-dom'
import { logout } from '../lib/auth'

const NAV_ITEMS = [
  { to: '/', label: 'Inventory' },
  { to: '/invoices', label: 'Invoices' },
  { to: '/invoices/new', label: 'New Invoice' },
  { to: '/stats', label: 'Stats' },
]

export default function Layout({ children }) {
  const location = useLocation()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-brand">Shop</div>
        <nav className="topbar-nav">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={`topbar-link${location.pathname === item.to ? ' active' : ''}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <button type="button" className="topbar-logout" onClick={handleLogout}>
          log out
        </button>
      </header>
      <main className="page">{children}</main>
    </div>
  )
}
