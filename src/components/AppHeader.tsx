import { useAuth } from '../context/useAuth'

export default function AppHeader() {
  const { user, logout } = useAuth()

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <span className="brand">AI HW HUB</span>
        <div className="topbar-right">
          <span className="topbar-user">
            {user?.displayName?.trim() !== '' && user?.displayName
              ? user.displayName
              : user?.email ?? '—'}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void logout()}
          >
            登出
          </button>
        </div>
      </div>
    </header>
  )
}
