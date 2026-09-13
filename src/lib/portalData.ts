/**
 * Portal 登入資料 —— 身份清單同密碼**全部由 `.env` 提供**，
 * 唔會 commit 落 repo（參考 `.env.example`）。
 *
 * ⚠️ 呢個係前端驗證（同原 AAI Portal 一樣），唔係伺服器端鎖 ——
 *    密碼最終仍然會 embed 落 build 出嘅 bundle，要真鎖就要搬去後端。
 *
 * 身份：CEO / Read-only Steering（固定）＋ 部門／業務單位（由 .env 清單）
 */

export type PortalKind = 'ceo' | 'readonly' | 'dept' | 'business'

export interface PortalIdentity {
  id: string
  name: string
  kind: PortalKind
}

const SPECIAL: PortalIdentity[] = [
  { id: 'ceo', name: 'CEO', kind: 'ceo' },
  { id: 'readonly', name: 'Read-only Steering Committee', kind: 'readonly' },
]

/** `.env` 值 → 去空白；冇設定就係空字串。 */
function envValue(value: string | undefined): string {
  return (value ?? '').trim()
}

/** `.env` 逗號分隔清單 → 陣列（去空白、去空項）。 */
function envList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '')
}

/**
 * 🏢 部門／業務單位清單 —— 由 `.env` 提供（**唔會 commit 落 repo**）：
 *   VITE_PORTAL_DEPT_NAMES=Department One,Department Two
 *   VITE_PORTAL_BUSINESS_NAMES=Business Unit One,Business Unit Two
 *
 * ⚠️ 唔填 = 登入下拉空白 = 登入唔到（fail-closed，唔會誤放人入）。
 */
const DEPT_NAMES: string[] = envList(import.meta.env.VITE_PORTAL_DEPT_NAMES)
const BUSINESS_NAMES: string[] = envList(
  import.meta.env.VITE_PORTAL_BUSINESS_NAMES,
)

function toId(kind: 'dept' | 'business', name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `${kind}-${slug}`
}

const DEPTS: PortalIdentity[] = DEPT_NAMES.map((name) => ({
  id: toId('dept', name),
  name,
  kind: 'dept',
}))

const BUSINESS: PortalIdentity[] = BUSINESS_NAMES.map((name) => ({
  id: toId('business', name),
  name,
  kind: 'business',
}))

export const PORTAL_IDENTITIES: PortalIdentity[] = [
  ...SPECIAL,
  ...DEPTS,
  ...BUSINESS,
]

export function findIdentity(id: string): PortalIdentity | undefined {
  return PORTAL_IDENTITIES.find((identity) => identity.id === id)
}

/**
 * 🔐 Portal 登入密碼 —— 由 `.env` 提供（**唔會 commit 落 repo**）。
 *
 * ⚠️ 冇設定 = 空字串 = 該身份登入唔到（fail-closed）。
 */
const PASSWORD_CEO = envValue(import.meta.env.VITE_PORTAL_CEO_PASSWORD)
const PASSWORD_STEERING = envValue(
  import.meta.env.VITE_PORTAL_STEERING_PASSWORD,
)
const PASSWORD_ADMIN = envValue(import.meta.env.VITE_PORTAL_ADMIN_PASSWORD)
/** 單位密碼 = 單位英文名頭 3 個字母 + 呢個尾碼 */
const PASSWORD_UNIT_SUFFIX = envValue(
  import.meta.env.VITE_PORTAL_UNIT_PASSWORD_SUFFIX,
)

/** Portal 登入係咪已經設定好（`.env` 有填單位清單同密碼）。 */
export function isPortalLoginConfigured(): boolean {
  const hasUnits = DEPT_NAMES.length > 0 || BUSINESS_NAMES.length > 0
  const hasPassword =
    PASSWORD_CEO !== '' ||
    PASSWORD_STEERING !== '' ||
    PASSWORD_ADMIN !== '' ||
    PASSWORD_UNIT_SUFFIX !== ''
  return hasUnits && hasPassword
}

/** 某身份嘅預期密碼（由 `.env` 提供；冇設定就係空字串）。 */
export function expectedPassword(identity: PortalIdentity): string {
  if (identity.kind === 'ceo') {
    return PASSWORD_CEO
  }
  if (identity.kind === 'readonly') {
    return PASSWORD_STEERING
  }
  if (identity.name === 'Administration') {
    return PASSWORD_ADMIN
  }
  // 單位密碼 = 單位英文名（細楷、去除非英文字母）頭 3 個字母 + 尾碼
  const base =
    identity.name.toLowerCase().replace(/[^a-z]/g, '') ||
    identity.id.toLowerCase().replace(/[^a-z0-9]/g, '')
  return `${base.slice(0, 3)}${PASSWORD_UNIT_SUFFIX}`
}

export function validatePortalLogin(
  id: string,
  password: string,
): PortalIdentity | null {
  const identity = findIdentity(id)
  if (!identity) {
    return null
  }
  const expected = expectedPassword(identity)
  // 🔒 `.env` 未填密碼 → 一律唔放行。
  //    （否則 expected = ''，打【空密碼】就會登入成功 —— 嚴重漏洞。）
  if (expected === '') {
    return null
  }
  return password.trim().toLowerCase() === expected ? identity : null
}
