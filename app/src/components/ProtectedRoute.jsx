import { Navigate, useLocation } from 'react-router-dom'
import { isLoggedIn } from '../lib/auth'

export default function ProtectedRoute({ children }) {
  const location = useLocation()
  if (!isLoggedIn()) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }
  return children
}
