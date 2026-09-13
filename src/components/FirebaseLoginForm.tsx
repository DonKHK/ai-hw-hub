import { useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from '../context/useAuth'
import { isFirebaseConfigured } from '../firebase/config'
import { FIREBASE_ROLE_OPTIONS } from '../lib/firebaseRoles'
import FirebaseSetupNotice from './FirebaseSetupNotice'

/**
 * Firebase 登入表單（Email + Password）。
 * 成功後 Firebase AuthProvider 會更新 user，LoginPage 就會自動跳去 /。
 *
 * 角色（login level）唔喺呢度決定 —— 一律由 Firestore `users/{uid}.role` 讀。
 */
export default function FirebaseLoginForm() {
  const { loginWithFirebase } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // 冇 .env 時唔好夾硬初始化 Firebase，改為顯示設定指引
  if (!isFirebaseConfigured()) {
    return <FirebaseSetupNotice />
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await loginWithFirebase(email, password)
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Sign-in failed. Please try again later.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <h2>Sign in</h2>
      <p className="muted login-sub">
        Admin account (email + password). Your login level is set by Firestore.
      </p>

      <form className="field-stack" onSubmit={handleSubmit}>
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

      <p className="muted login-hint">
        <strong>3 login levels:</strong>
      </p>
      <ul className="notice-list">
        {FIREBASE_ROLE_OPTIONS.map((option) => (
          <li key={option.id}>
            <strong>{option.label}</strong> —— {option.description}
          </li>
        ))}
      </ul>
      <p className="muted login-hint">
        Accounts are created by an administrator in the Firebase Console; role changes take effect immediately (sign in again to see them).
      </p>
    </>
  )
}
