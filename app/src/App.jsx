import { BrowserRouter, Routes, Route } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import Login from './pages/Login'
import Inventory from './pages/Inventory'
import Invoices from './pages/Invoices'
import NewInvoice from './pages/NewInvoice'
import InvoiceDetail from './pages/InvoiceDetail'

function Protected({ children }) {
  return (
    <ProtectedRoute>
      <Layout>{children}</Layout>
    </ProtectedRoute>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Protected><Inventory /></Protected>} />
        <Route path="/invoices" element={<Protected><Invoices /></Protected>} />
        <Route path="/invoices/new" element={<Protected><NewInvoice /></Protected>} />
        <Route path="/invoices/:id" element={<Protected><InvoiceDetail /></Protected>} />
      </Routes>
    </BrowserRouter>
  )
}
