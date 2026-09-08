import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/useAuth'

type AuthMode = 'login' | 'register'

const FIREBASE_ERROR_MESSAGES: Record<string, string> = {
  'auth/email-already-in-use': '呢個 email 已經註冊咗，請直接登入。',
  'auth/invalid-credential': 'Email 或密碼不正確。',
  'auth/invalid-email': 'Email 格式不正確。',
  'auth/user-disabled': '此帳戶已被停用。',
  'auth/user-not-found': '搵唔到呢個帳戶。',
  'auth/wrong-password': '密碼不正確。',
  'auth/weak-password': '密碼太弱，至少需要 6 個字元。',
  'auth/popup-closed-by-user': '你關閉咗 Google 登入視窗。',
  'auth/account-exists-with-different-credential':
    '此 email 已用其他登入方式註冊，請改用該方式登入。',
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && 'code' in error) {
    const code = (error as { code?: string }).code
    if (code !== undefined && FIREBASE_ERROR_MESSAGES[code] !== undefined) {
      return FIREBASE_ERROR_MESSAGES[code]
    }
  }
  return error instanceof Error ? error.message : '發生未知錯誤，請稍後再試。'
}

export default function LoginPage() {
  const { user, loading, configured, login, register, loginWithGoogle } =
    useAuth()
  const [mode, setMode] = useState<AuthMode>('login')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
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
      if (mode === 'register') {
        await register(email, password, displayName)
      } else {
        await login(email, password)
      }
    } catch (caught) {
      setError(toErrorMessage(caught))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleGoogleLogin() {
    setError(null)
    setSubmitting(true)
    try {
      await loginWithGoogle()
    } catch (caught) {
      setError(toErrorMessage(caught))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand brand-lg">AI HW HUB</span>
          <p className="muted">一站式專案管理平台</p>
        </div>

        {!configured ? (
          <section className="card notice">
            <h2>需要設定 Firebase 先可以用到登入</h2>
            <ol className="notice-list">
              <li>
                複製 <code>.env.example</code> 為 <code>.env</code>
              </li>
              <li>去 Firebase Console 建立專案並加入 Web App</li>
              <li>喺 Authentication 啟用 Email/Password（同 Google）</li>
              <li>將 Firebase config 填入 <code>.env</code> 後重啟 dev server</li>
            </ol>
            <p className="muted">
              詳細步驟見 README.md：<code>Firebase 設定步驟</code>
            </p>
          </section>
        ) : (
          <section className="card">
            <div className="tab-row">
              <button
                type="button"
                className={mode === 'login' ? 'tab tab-active' : 'tab'}
                onClick={() => setMode('login')}
              >
                登入
              </button>
              <button
                type="button"
                className={mode === 'register' ? 'tab tab-active' : 'tab'}
                onClick={() => setMode('register')}
              >
                註冊
              </button>
            </div>

            <form className="field-stack" onSubmit={handleSubmit}>
              {mode === 'register' && (
                <label className="field">
                  <span>名稱（可選）</span>
                  <input
                    type="text"
                    className="input"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder="例如：小明"
                    autoComplete="name"
                  />
                </label>
              )}
              <label className="field">
                <span>Email</span>
                <input
                  type="email"
                  className="input"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                />
              </label>
              <label className="field">
                <span>密碼</span>
                <input
                  type="password"
                  className="input"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="至少 6 個字元"
                  autoComplete={
                    mode === 'register' ? 'new-password' : 'current-password'
                  }
                  required
                />
              </label>

              {error !== null && <p className="error-text">{error}</p>}

              <button
                type="submit"
                className="btn btn-primary btn-block"
                disabled={submitting}
              >
                {submitting
                  ? '處理中…'
                  : mode === 'login'
                    ? '登入'
                    : '註冊並登入'}
              </button>
            </form>

            <div className="divider">或</div>

            <button
              type="button"
              className="btn btn-google btn-block"
              onClick={() => void handleGoogleLogin()}
              disabled={submitting}
            >
              使用 Google 登入
            </button>
          </section>
        )}
      </div>
    </main>
  )
}
