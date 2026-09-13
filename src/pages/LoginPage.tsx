import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import FirebaseLoginForm from '../components/FirebaseLoginForm'
import { useAuth } from '../context/useAuth'
import { PORTAL_IDENTITIES } from '../lib/portalData'
import { isPortalLoginConfigured } from '../lib/portalData'
import type { PortalIdentity } from '../lib/portalData'

const SPECIAL = PORTAL_IDENTITIES.filter(
  (identity) => identity.kind === 'ceo' || identity.kind === 'readonly',
)
const DEPTS = PORTAL_IDENTITIES.filter((identity) => identity.kind === 'dept')
const BUSINESS = PORTAL_IDENTITIES.filter(
  (identity) => identity.kind === 'business',
)

/** 兩個登入方法：Portal（原有）／ Firebase（新加）。 */
type LoginMethod = 'portal' | 'firebase'

export default function LoginPage() {
  const { user, loading, login } = useAuth()
  const [method, setMethod] = useState<LoginMethod>('portal')
  const [selectedId, setSelectedId] = useState('ceo')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (!loading && user !== null) {
    return <Navigate to="/" replace />
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(selectedId, password)
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Sign-in failed. Please try again later.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  function switchTo(next: LoginMethod) {
    setMethod(next)
    setError(null)
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand brand-lg">AI HW HUB</span>
          <p className="muted">AI Workflow planning &amp; monitoring platform</p>
        </div>

        <section className="card">
          <div className="tab-row" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={method === 'portal'}
              className={method === 'portal' ? 'tab tab-active' : 'tab'}
              onClick={() => switchTo('portal')}
            >
              AAI Portal identity
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={method === 'firebase'}
              className={method === 'firebase' ? 'tab tab-active' : 'tab'}
              onClick={() => switchTo('firebase')}
            >
              Admin account
            </button>
          </div>

          {method === 'firebase' ? (
            <FirebaseLoginForm />
          ) : (
            <>
              <h2>Sign in</h2>
              <p className="muted login-sub">
                Pick your unit / identity, then enter the password (same rules as AAI Portal)
              </p>
              <form className="field-stack" onSubmit={handleSubmit}>
                <label className="field">
                  <span>Department / Business / Role</span>
                  <select
                    className="input select-input"
                    value={selectedId}
                    onChange={(event) => setSelectedId(event.target.value)}
                  >
                    <optgroup label="Role">
                      {SPECIAL.map(option)}
                    </optgroup>
                    <optgroup label="Dept">
                      {DEPTS.map(option)}
                    </optgroup>
                    <optgroup label="Business">
                      {BUSINESS.map(option)}
                    </optgroup>
                  </select>
                </label>

                <label className="field">
                  <span>Password</span>
                  <input
                    type="password"
                    className="input"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Password"
                    autoComplete="current-password"
                    required
                  />
                </label>

                {error !== null && <p className="error-text">{error}</p>}

                <button
                  type="submit"
                  className="btn btn-primary btn-block"
                  disabled={submitting}
                >
                  {submitting ? 'Signing in…' : 'Sign in'}
                </button>
              </form>

              {isPortalLoginConfigured() ? (
                <p className="muted login-hint">
                  Sign in with your AAI Portal credentials. If you do not know
                  your unit password, ask your administrator.
                </p>
              ) : (
                <p className="muted login-hint">
                  ⚠️ Portal sign-in is not configured — add the{' '}
                  <code>VITE_PORTAL_*</code> values to <code>.env</code> and
                  restart <code>npm run dev</code>.
                </p>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  )
}

function option(identity: PortalIdentity) {
  return (
    <option key={identity.id} value={identity.id}>
      {identity.name}
    </option>
  )
}

