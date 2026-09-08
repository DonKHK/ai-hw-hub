import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/useAuth'

/**
 * 路由守衛：未登入或 Firebase 未設定時跳去 /login。
 * 用法：<Route element={<ProtectedRoute />}> ... </Route>
 */
export default function ProtectedRoute() {
  const { user, loading, configured } = useAuth()

  if (loading) {
    return <div className="page-center">載入中…</div>
  }

  if (!configured || user === null) {
    return <Navigate to="/login" replace />
  }

  return <Outlet />
}
