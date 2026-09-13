import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

export interface ConfirmResetCounts {
  /** 會刪幾多份 AI 計劃 */
  plans: number
  /** 有幾多筆活動紀錄（LOG）—— 呢啲會【保留】 */
  logs: number
  /** 有幾多份本機舊紀錄 */
  localPlans: number
}

interface ConfirmResetModalProps {
  unit: string
  counts: ConfirmResetCounts
  /** 預先填好目前登入嘅電郵（通常就係 superadmin 自己） */
  defaultEmail: string
  busy: boolean
  error: string | null
  onCancel: () => void
  onConfirm: (email: string, password: string) => void
}

/**
 * ⚠️ 重設單位前嘅雙重確認 Modal。
 *
 * 除咗列出「會刪幾多」，仲要**重新輸入 Superadmin 帳號密碼** ——
 * 因為重設係不可逆，要防「有人偷用一個已解鎖嘅瀏覽器」。
 * 密碼由 Firebase 伺服器驗證（reauthenticateWithCredential）。
 */
export default function ConfirmResetModal({
  unit,
  counts,
  defaultEmail,
  busy,
  error,
  onCancel,
  onConfirm,
}: ConfirmResetModalProps) {
  const [email, setEmail] = useState(defaultEmail)
  const [password, setPassword] = useState('')

  // Esc 關得（busy 時唔關，避免刪到一半走咗）
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) {
        onCancel()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [busy, onCancel])

  const canSubmit = !busy && email.trim() !== '' && password !== ''

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (canSubmit) {
      onConfirm(email, password)
    }
  }

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onClick={() => {
        if (!busy) {
          onCancel()
        }
      }}
    >
      <form
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-modal-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <h2 className="modal-title" id="reset-modal-title">
          ⚠️ Reset "{unit}"
        </h2>

        <div className="danger-box">
          <strong>This permanently deletes the following (cannot be undone):</strong>
          <ul className="danger-list">
            <li>{counts.plans} AI plan(s)</li>
            {counts.localPlans > 0 && (
              <li>{counts.localPlans} local record(s)</li>
            )}
          </ul>
        </div>

        <p className="keep-note">
          ✅ Activity log: {counts.logs} entries —{' '}
          <strong>will be kept</strong>
          (a new entry will also record this reset)
        </p>

        <p className="backup-note">
          🛡️ Confirming will <strong>create an automatic backup first</strong> (
          {counts.plans} plan(s) + {counts.logs} log entries) to Firestore{' '}
          <code>aiPlanLogs</code>.{' '}
          <strong>Deletion only happens after a successful backup.</strong>{' '}
          You can restore it any time from the Firebase Console.
        </p>

        <p className="modal-hint">
          🔐 Enter your <strong>Superadmin</strong> account and password to confirm.
          The password is verified by Firebase and is not stored on this device.
        </p>

        <label className="field">
          <span>Email</span>
          <input
            className="input"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="username"
            disabled={busy}
          />
        </label>

        <label className="field">
          <span>Password</span>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            autoFocus
            disabled={busy}
            placeholder="Superadmin password"
          />
        </label>

        {error !== null && <p className="error-text">{error}</p>}

        <div className="modal-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button type="submit" className="btn btn-danger" disabled={!canSubmit}>
            {busy ? 'Working…' : 'Confirm reset'}
          </button>
        </div>
      </form>
    </div>
  )
}
