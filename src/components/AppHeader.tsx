import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { accessForUser } from '../lib/access'

function navClass({ isActive }: { isActive: boolean }): string {
  return isActive ? 'nav-link nav-link-active' : 'nav-link'
}

export default function AppHeader() {
  const { user, logout } = useAuth()
  const access = user === null ? null : accessForUser(user)
  // Firebase 帳號（管理員／觀察員）冇 workflow → 唔顯示「Workflows」
  // Portal Dept／Business 冇監控權限 → 唔顯示「監控」（避免撳完被彈走）
  const showMonitor = access?.monitorScope !== 'none'
  const showWorkflows = access?.workflowScope !== 'none'

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <NavLink to="/" className="brand topbar-brand">
          AI HW HUB
        </NavLink>
        <nav className="topbar-nav">
          {showMonitor && (
            <NavLink to="/" end className={navClass}>
              Monitoring
            </NavLink>
          )}
          {showWorkflows && (
            <NavLink to="/workflows" className={navClass}>
              Workflows
            </NavLink>
          )}
        </nav>
        <div className="topbar-right">
          <span className="topbar-user">
            {user?.displayName !== null && user?.displayName
              ? user.displayName
              : '—'}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void logout()}
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  )
}
