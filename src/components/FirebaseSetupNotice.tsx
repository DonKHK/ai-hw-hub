import { firebaseConfigStatus } from '../firebase/config'
import type { FirebaseConfigFieldState } from '../firebase/config'
import { FIREBASE_ROLE_OPTIONS } from '../lib/firebaseRoles'

/** 診斷狀態 → 顯示文字。 */
const STATE_TEXT: Record<FirebaseConfigFieldState, string> = {
  ok: '✓ Configured',
  empty: '✗ No value',
  placeholder: '✗ Still a placeholder (real value not filled in)',
}

/**
 * Firebase 未設定（.env 未填真值）時顯示嘅指引 —— 優雅降級，唔會令 app crash。
 *
 * 特登加咗即時診斷，直接話你知 4 個必需值仲爭邊個（**唔會露出真值**）。
 * 用返 src/index.css 已有嘅 .notice-list / .login-hint 樣式，唔使加新 CSS。
 */
export default function FirebaseSetupNotice() {
  const fields = firebaseConfigStatus()

  return (
    <>
      <h2>Firebase sign-in is not configured</h2>
      <p className="muted login-sub">
        This feature needs a Firebase Web config. Until it is set up you can still
        sign in above with an &quot;AAI Portal identity&quot;.
      </p>

      <h3 className="notice-heading">Current .env status</h3>
      <ul className="notice-list">
        {fields.map((field) => (
          <li key={field.envName}>
            <code>{field.envName}</code> — {STATE_TEXT[field.state]}
          </li>
        ))}
      </ul>
      <p className="muted login-hint">
        When all 4 show &quot;✓ Configured&quot; it works immediately. After filling
        them in you <b>must restart</b> <code>npm run dev</code> (Vite does not
        hot-reload <code>.env</code>).
      </p>

      <h3 className="notice-heading">Setup steps (Firebase Console)</h3>
      <ol className="notice-list">
        <li>
          <strong>Firebase Console</strong> → project{' '}
          <strong>AI Homework</strong> → left menu <strong>Build</strong> →{' '}
          <strong>Authentication</strong> → <strong>Sign-in method</strong> tab →
          enable <strong>Email/Password</strong> → Save
          <br />
          <span className="muted">(On first use, click &quot;Get started&quot;)</span>
        </li>
        <li>
          Authentication → <strong>Users</strong> tab → <strong>Add user</strong> →
          create one account per login level (3 total), and note each account&apos;s{' '}
          <strong>UID</strong>
        </li>
        <li>
          Left menu <strong>Build</strong> → <strong>Firestore</strong> →{' '}
          <strong>Data</strong> tab → <strong>Start collection</strong> → collection
          ID <code>users</code> → document ID: paste the <strong>UID</strong> from
          above (<b>do not use &quot;Auto-ID&quot;</b>) → add fields:
          <br />
          <code>{'{ role, unit, displayName, isActive }'}</code>
        </li>
        <li>
          <strong>Get the Web App config</strong>: ⚙️{' '}
          <strong>Project settings</strong> → <strong>General</strong> tab → scroll to{' '}
          <strong>Your apps</strong>
          <br />• Already registered: pick the <code>{'</>'}</code> Web App →{' '}
          &quot;SDK setup and configuration&quot; → <strong>Config</strong>
          <br />• <strong>Not registered (&quot;Your apps&quot; is empty)</strong>:
          click <strong>Add app</strong> → choose <strong>Web</strong> →{' '}
          <strong>Register app</strong> (no need to tick Hosting) — the{' '}
          <code>firebaseConfig</code> appears immediately
        </li>
        <li>
          Copy the 4 values from <code>firebaseConfig</code> into <code>.env</code> in
          the project root (only those 4 are required; the rest can stay empty), then
          restart <code>npm run dev</code>
        </li>
      </ol>

      <h3 className="notice-heading">3 login levels</h3>
      <ul className="notice-list">
        {FIREBASE_ROLE_OPTIONS.map((option) => (
          <li key={option.id}>
            <strong>{option.label}</strong> — {option.description}
          </li>
        ))}
      </ul>
      <p className="muted login-hint">
        The <code>unit</code> value must match a unit name in the system exactly (e.g.
        Innovation and Development Department (I&amp;DD)), otherwise no workflows will
        load.
      </p>
    </>
  )
}

