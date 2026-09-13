import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import AppHeader from '../components/AppHeader'
import { useAuth } from '../context/useAuth'
import { accessForUser } from '../lib/access'
import { describeStoreError } from '../lib/firestoreError'
import { ROLE_LABELS } from '../lib/firebaseRoles'
import { UNIT_STATE_LABELS, planState, todayIso } from '../lib/planStatus'
import { findIdentity } from '../lib/portalData'
import type { PortalIdentity } from '../lib/portalData'
import { isLongWorkflowCode } from '../lib/workflowCode'
import { listPlansByOwner } from '../services/aiPlanService'
import {
  invalidatePortalStoreCache,
  syncPortalWorkflowsToFirestore,
} from '../services/portalWorkflowStore'
import { fetchWorkflowsForAccess } from '../services/workflowService'
import type {
  WorkflowFetchReason,
  WorkflowFetchResult,
  WorkflowItem,
} from '../services/workflowService'
import type { AiPlan } from '../types'

const KIND_LABELS: Record<PortalIdentity['kind'], string> = {
  ceo: 'CEO',
  readonly: 'Read-only Steering Committee',
  dept: 'Dept',
  business: 'Business',
}

export default function WorkflowsPage() {
  const { user } = useAuth()
  const [items, setItems] = useState<WorkflowItem[]>([])
  const [loading, setLoading] = useState(true)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reason, setReason] = useState<WorkflowFetchReason>('ok')
  const [source, setSource] = useState<'firestore' | 'portal' | 'local'>(
    'firestore',
  )
  const [syncedAt, setSyncedAt] = useState<number | undefined>(undefined)
  // 只有 Firebase superadmin 會用到（sync 落 Firestore）
  const [syncing, setSyncing] = useState(false)
  const [syncNotice, setSyncNotice] = useState<string | null>(null)
  // 手動撳「重新載入」嘅時間（有值才顯示回饋；自動載入唔顯示）
  const [pulledAt, setPulledAt] = useState<number | null>(null)
  const [selectedCodes, setSelectedCodes] = useState<string[]>([])
  // 我呢個身份交過 AI 計劃嘅 workflow code（用嚟顯示「已交」badge）
  const [planCodes, setPlanCodes] = useState<string[]>([])
  // 我交過／揀過嘅 AI 計劃 —— 直接由 Firestore 讀，唔使再抽
  const [myPlans, setMyPlans] = useState<AiPlan[]>([])
  const today = todayIso()

  const uid = user?.uid
  // 統一 access model：Portal 同 Firebase 兩種登入方法都用得
  const access = user === null ? undefined : accessForUser(user)
  // 只有 Portal 用戶先有 portal 身份（用嚟顯示原本 Role／Dept／Business 標籤）
  const identity =
    user?.provider === 'portal' ? findIdentity(user.uid) : undefined
  const canPullWorkflows =
    access !== undefined && access.workflowScope !== 'none'
  // 部門／業務單位下拉篩選（superadmin／觀察員睇全部單位時好亂）
  const [unitFilter, setUnitFilter] = useState('')

  const unitOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of items) {
      const unit = item.unit ?? ''
      if (unit !== '') {
        counts.set(unit, (counts.get(unit) ?? 0) + 1)
      }
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [items])

  /** 下拉篩選之後實際顯示嘅 workflow。 */
  const visibleItems =
    unitFilter === ''
      ? items
      : items.filter((item) => item.unit === unitFilter)

  /** 篩選後仲有多過一個單位先顯示單位標籤 */
  const showUnit =
    new Set(visibleItems.map((item) => item.unit ?? '')).size > 1

  function toggleSelect(code: string) {
    setSelectedCodes((previous) =>
      previous.includes(code)
        ? previous.filter((c) => c !== code)
        : [...previous, code],
    )
  }

  const allSelected =
    visibleItems.length > 0 && selectedCodes.length === visibleItems.length

  // 睇返自己交過邊啲 workflow 嘅 AI 計劃
  useEffect(() => {
    let cancelled = false
    if (uid === undefined) {
      return
    }
    listPlansByOwner(uid)
      .then((plans) => {
        if (!cancelled) {
          setPlanCodes(plans.map((plan) => plan.workflowCode))
          setMyPlans(plans)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPlanCodes([])
          setMyPlans([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [uid])

  /** 統一處理 fetch 結果。 */
  function applyResult(result: WorkflowFetchResult) {
    if (!result.ok) {
      setError(result.error ?? 'Failed to load. Please try again.')
      return
    }
    setItems(result.items)
    setNote(result.note ?? null)
    setReason(result.reason)
    setSource(result.source)
    setSyncedAt(result.syncedAt)
  }

  // 開頁自動載入（async —— workflow 可能由 AAI Portal Supabase 嚟）
  useEffect(() => {
    if (user === null) {
      return
    }
    let cancelled = false
    fetchWorkflowsForAccess(accessForUser(user))
      .then((result) => {
        if (cancelled) {
          return
        }
        setError(result.ok ? null : (result.error ?? 'Failed to load. Please try again.'))
        setItems(result.items)
        setNote(result.note ?? null)
        setReason(result.reason)
        setSource(result.source)
        setSyncedAt(result.syncedAt)
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(
            caught instanceof Error ? caught.message : 'Failed to load. Please try again.',
          )
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [user])

  /** 🔄 只有 Firebase superadmin：由 AAI Portal 抽全部 → 寫入 Firestore 快照。 */
  async function handleSync() {
    setSyncing(true)
    setSyncNotice(null)
    setError(null)
    try {
      const result = await syncPortalWorkflowsToFirestore()
      setSyncNotice(
        `✅ Synced ${result.count} workflows from AAI Portal to Firestore.`,
      )
      await handlePull()
    } catch (caught: unknown) {
      setSyncNotice(`⚠️ Sync failed: ${describeStoreError(caught)}`)
    } finally {
      setSyncing(false)
    }
  }

  async function handlePull() {
    if (access === undefined) {
      setError('Your session has expired. Please sign in again.')
      return
    }
    setLoading(true)
    setError(null)
    setNote(null)
    setSelectedCodes([])
    // 「重新載入」要真係去 Firestore 再攞一次（唔可以用 module cache）
    invalidatePortalStoreCache()
    try {
      const result = await fetchWorkflowsForAccess(access)
      applyResult(result)
      // 令撳掣一定有回饋（唔會再似「冇反應」）
      setPulledAt(Date.now())
    } catch (caught: unknown) {
      setError(
        caught instanceof Error ? caught.message : 'Failed to load. Please try again.',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <AppHeader />
      <main className="page">
        <div className="page-header">
          <div>
            <h1>Workflows</h1>
            <p className="muted">
              You are:
              {access === undefined ? '—' : access.displayName}
              {identity !== undefined && (
                <span className="identity-id">
                  （{KIND_LABELS[identity.kind]}）
                </span>
              )}
              {identity === undefined && access !== undefined && (
                <span className="identity-id">
                  （{ROLE_LABELS[access.role]}）
                </span>
              )}
            </p>
          </div>
        </div>

        {access?.canEditPlans === false && (
          <section className="card notice">
            <p className="muted">
              You have view-only access — you can see every unit's workflows and plan
              status, but cannot create, edit or delete.
            </p>
          </section>
        )}

        {canPullWorkflows && myPlans.length > 0 && (
          <section className="card">
            <h2>My AI plans ({myPlans.length})</h2>
            <p className="muted workflow-desc">
              These are the plans you submitted before — <strong>no need to load
              again</strong>, just open one to edit. Data is stored in Firebase, so it
              comes back when you sign in or switch device.
            </p>
            <ul className="my-plan-list">
              {myPlans.map((plan) => {
                const state = planState(plan, today)
                return (
                  <li key={plan.id} className="my-plan-item">
                    {!isLongWorkflowCode(plan.workflowCode) && (
                      <span className="flow-code">{plan.workflowCode}</span>
                    )}
                    <span
                      className="flow-name"
                      title={`ID: ${plan.workflowCode}`}
                    >
                      {plan.workflowName}
                    </span>
                    <span className={`state-chip state-${state}`}>
                      {UNIT_STATE_LABELS[state]}
                    </span>
                    {access?.canEditPlans === true && (
                      <Link
                        to={`/workflows/${plan.workflowCode}/plan`}
                        className="btn btn-ghost btn-sm my-plan-action"
                      >
                        Continue / edit
                      </Link>
                    )}
                  </li>
                )
              })}
            </ul>
            {access?.canEditPlans === true && (
              <div className="workflow-next">
                <p className="muted">
                  Continue all (one by one) — {myPlans.length} workflow(s)
                </p>
                <Link
                  to={`/workflows/ai-plan?codes=${encodeURIComponent(
                    myPlans.map((plan) => plan.workflowCode).join(','),
                  )}`}
                  className="btn btn-primary"
                >
                  Continue all →
                </Link>
              </div>
            )}
          </section>
        )}

        <section className="card">
          <h2>Workflow list</h2>

          {canPullWorkflows ? (
            <>
              <p className="muted workflow-desc">
                {access?.canPullFromPortal === true
                  ? 'You are the Firebase Superadmin — you can sync all AAI Portal workflows into Firestore; every unit then reads from the snapshot.'
                  : access?.canEditPlans === true
                    ? 'Loaded the workflows you can see (read from the Firestore snapshot — the administrator has synced). Select one or more to add AI elements / submit an AI plan.'
                    : 'These are all the workflows you can see (view-only — you cannot create or edit AI plans).'}
              </p>
              <p className="source-badge">
                Source:{' '}
                {source === 'firestore'
                  ? 'Firestore snapshot'
                  : source === 'portal'
                    ? 'Live AAI Portal'
                    : 'Local inventory (fallback)'}
                {syncedAt !== undefined && syncedAt > 0
                  ? ` · last synced ${new Date(syncedAt).toLocaleString('en-GB')}`
                  : ''}
              </p>

              {access?.canPullFromPortal === true && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void handleSync()}
                  disabled={syncing || loading}
                >
                  {syncing
                    ? 'Syncing…'
                    : '🔄 Sync workflows from AAI Portal to Firestore'}
                </button>
              )}

              {/*
                「重新載入」只有 Firebase superadmin 需要 ——
                dept／BU 嘅 workflow 已經由 superadmin 抽晒落 Firestore 快照，
                佢哋開頁會自動載入，唔需要（亦冇得）自己再「抽取」。
              */}
              {access?.canPullFromPortal === true && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => void handlePull()}
                  disabled={loading || syncing}
                >
                  {loading ? 'Loading…' : 'Reload'}
                </button>
              )}

              {syncNotice !== null && (
                <p className="pull-feedback">{syncNotice}</p>
              )}

              {pulledAt !== null && (
                <p className="pull-feedback">
                  ✅ Loaded: {items.length} workflow(s)
                  {items.length === 0 ? ' (no matching workflows)' : ''}
                  <span className="muted">
                    （{new Date(pulledAt).toLocaleTimeString('zh-Hant')}）
                  </span>
                </p>
              )}

              {unitOptions.length > 1 && (
                <label className="field unit-filter">
                  <span>Filter by unit ({unitOptions.length} units)</span>
                  <select
                    className="input select-input"
                    value={unitFilter}
                    onChange={(event) => {
                      setUnitFilter(event.target.value)
                      // 轉單位時清走揀選，避免誤交其他單位嘅計劃
                      setSelectedCodes([])
                    }}
                  >
                    <option value="">All units ({items.length})</option>
                    {unitOptions.map(([unit, count]) => (
                      <option key={unit} value={unit}>
                        {unit} ({count})
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          ) : (
            <p className="muted workflow-note">
              This sign-in has no workflow access. Contact an administrator, or sign out and use a different identity.
            </p>
          )}

          {error !== null && <p className="error-text">{error}</p>}

          {canPullWorkflows && loading && (
            <p className="muted">Loading…</p>
          )}

          {canPullWorkflows && !loading && items.length === 0 && error === null && (
            <div className="empty-state">
              <h3>
                {reason === 'unit-no-data'
                  ? `No workflow data for "${access?.displayName ?? ''}"`
                  : reason === 'unit-empty'
                    ? 'Your account is not linked to a unit'
                    : 'No workflow data yet'}
              </h3>
              {note !== null && <p className="muted">{note}</p>}
              {(reason === 'unit-no-data' || reason === 'unit-empty') && (
                <p className="muted">
                  Ask an administrator to add workflow data for your unit.
                </p>
              )}
            </div>
          )}

          {visibleItems.length > 0 && (
            <div className="workflow-results">
              <div className="workflow-results-head">
                <p className="muted">
                  {access?.canEditPlans === true
                    ? `${visibleItems.length} workflow(s) loaded — select any number:`
                    : `${visibleItems.length} workflow(s) loaded:`}
                </p>
                {access?.canEditPlans === true && visibleItems.length > 1 && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() =>
                      setSelectedCodes(
                        allSelected
                          ? []
                          : visibleItems.map((item) => item.code),
                      )
                    }
                  >
                    {allSelected ? 'Clear all' : 'Select all'}
                  </button>
                )}
              </div>
              <ul
                className={
                  access?.canEditPlans === true
                    ? 'workflow-list'
                    : 'workflow-list workflow-list-readonly'
                }
              >
                {visibleItems.map((item) => {
                  const editable = access?.canEditPlans === true
                  const isSelected =
                    editable && selectedCodes.includes(item.code)
                  const hasPlan = planCodes.includes(item.code)
                  return (
                    <li
                      key={`${item.unit}-${item.code}-${item.name}`}
                      className={
                        isSelected
                          ? 'workflow-item workflow-item-selected'
                          : 'workflow-item'
                      }
                      onClick={
                        editable ? () => toggleSelect(item.code) : undefined
                      }
                      onKeyDown={
                        editable
                          ? (event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault()
                                toggleSelect(item.code)
                              }
                            }
                          : undefined
                      }
                      role={editable ? 'checkbox' : undefined}
                      aria-checked={editable ? isSelected : undefined}
                      tabIndex={editable ? 0 : undefined}
                    >
                      {editable && (
                        <span className="workflow-radio" aria-hidden="true">
                          {isSelected ? '☑' : '☐'}
                        </span>
                      )}
                      {!isLongWorkflowCode(item.code) && (
                        <span className="flow-code">{item.code}</span>
                      )}
                      <span className="flow-name" title={`ID: ${item.code}`}>
                        {item.name}
                      </span>
                      {hasPlan && (
                        <span className="chip chip-done flow-badge">
                          AI plan ✓
                        </span>
                      )}
                      {showUnit && (
                        <span className="flow-unit">{item.unit}</span>
                      )}
                    </li>
                  )
                })}
              </ul>

              {selectedCodes.length > 0 && (
                <div className="workflow-next">
                  <p className="muted">
                    {selectedCodes.length} workflow(s) selected
                  </p>
                  <Link
                    to={`/workflows/ai-plan?codes=${encodeURIComponent(
                      selectedCodes.join(','),
                    )}`}
                    className="btn btn-primary"
                  >
                    Enter AI plans →
                  </Link>
                </div>
              )}
            </div>
          )}

        </section>

      </main>
    </>
  )
}
