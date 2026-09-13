import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/useAuth'

/**
 * 路由守衛：未登入時跳去 /login。
 * 用法：<Route element={<ProtectedRoute />}> ... </Route>
 */
export default function ProtectedRoute() {
  const { user, loading } = useAuth()

  if (loading) {
    return <div className="page-center">Loading…</div>
  }

  if (user === null) {
    return <Navigate to="/login" replace />
  }

  return <Outlet />
}
