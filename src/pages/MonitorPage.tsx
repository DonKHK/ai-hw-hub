import { Fragment, useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import AppHeader from '../components/AppHeader'
import ConfirmResetModal from '../components/ConfirmResetModal'
import MonitorActivityLog from '../components/MonitorActivityLog'
import MonitorFilters from '../components/MonitorFilters'
import type { MonitorFilterKey } from '../components/MonitorFilters'
import UnitPlanDetail from '../components/UnitPlanDetail'
import { useAuth } from '../context/useAuth'
import {
  confirmSuperadminPassword,
  firebaseErrorMessage,
} from '../firebase/authService'
import { accessForUser } from '../lib/access'
import { describeStoreError } from '../lib/firestoreError'
import { LOCAL_INVENTORY } from '../lib/localInventory'
import { PORTAL_IDENTITIES } from '../lib/portalData'
import {
  DUE_SOON_DAYS,
  UNIT_STATE_LABELS,
  earliestDue,
  todayIso,
  unitState,
} from '../lib/planStatus'
import type { TimelineState, UnitState } from '../lib/planStatus'
import {
  countLocalPlans,
  countUnitData,
  lastPlanStoreError,
  listAllPlans,
  resetUnitData,
  syncLocalPlansToFirestore,
} from '../services/aiPlanService'
import type { UnitDataCount } from '../services/aiPlanService'
import { isPlanStoreReady } from '../services/aiPlanFirestore'
import type { AiPlan } from '../types'

/**
 * 監控 Dashboard —— 取代原本首頁（「我的專案」搬去 /projects）。
 *
 * 睇到「所有 BU/DEPT」邊個揀咗 flow、邊個入咗 AI 方法、
 * timeline 有冇就到期／已到期。
 *
 * 資料來源：Firestore `aiPlans`（Portal 用戶同 Firebase 用戶都會寫入）。
 * 冇 .env 時會自動 fallback 本機 localStorage。
 */

interface UnitRow {
  unit: string
  workflowCount: number
  plans: AiPlan[]
  state: UnitState
  nextDue: { due: string; daysLeft: number; state: TimelineState } | null
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Failed to load. Please try again later.'
}

/**
 * 重設流程嘅錯誤 → 人話。
 *
 * 唔可以淨係用 `firebaseErrorMessage` —— 佢把所有 permission-denied
 * 都當成「讀唔到角色設定」，但如果係寫 `aiPlanLogs` 備份失敗就會誤導。
 * 所以：Auth 錯誤（密碼錯…）→ auth 訊息；Firestore 錯誤 → store 訊息。
 */
function resetErrorMessage(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : ''
  // 🛡️ 備份失敗嘅訊息本身已經寫得好清楚（含「NOTHING was deleted」）——
  //    唔好交俾 describeStoreError，否則會被通用 permission 訊息蓋掉。
  if (code === 'backup-failed') {
    return error instanceof Error ? error.message : describeStoreError(error)
  }
  if (code.startsWith('auth/')) {
    return firebaseErrorMessage(error)
  }
  return describeStoreError(error)
}

/** 需要跟進嘅狀態（已到期 / 就到期 / 揀咗未填）。 */
function needsAction(state: UnitState): boolean {
  return state === 'overdue' || state === 'dueSoon' || state === 'selected'
}

export default function MonitorPage() {
  const { user } = useAuth()
  const [plans, setPlans] = useState<AiPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [filter, setFilter] = useState<MonitorFilterKey>('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [storeWarning, setStoreWarning] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  // 🔄 單位重設（只限 superadmin）—— 撳咗之後要先 re-authenticate 先真刪
  const [resetTarget, setResetTarget] = useState<{
    unit: string
    counts: UnitDataCount
  } | null>(null)
  const [resetBusy, setResetBusy] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)

  const today = todayIso()
  const access = user === null ? null : accessForUser(user)

  useEffect(() => {
    let cancelled = false
    // 註：loading 由事件（重新載入／同步）設定，唔喺 effect 度 setState ——
    // 避免 react(set-state-in-effect) 警告同多一次 render。
    listAllPlans()
      .then((items) => {
        if (!cancelled) {
          setPlans(items)
          setStoreWarning(lastPlanStoreError())
          setError(null)
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(errorText(caught))
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
  }, [reloadToken])

  // 所有單位 = Portal 身份清單 ∪ inventory 單位 ∪ 計劃入面出現過嘅單位
  const allUnits = useMemo(() => {
    const set = new Set<string>()
    for (const identity of PORTAL_IDENTITIES) {
      if (identity.kind === 'dept' || identity.kind === 'business') {
        set.add(identity.name)
      }
    }
    for (const item of LOCAL_INVENTORY) {
      set.add(item.unit)
    }
    for (const plan of plans) {
      if (plan.unit.trim() !== '') {
        set.add(plan.unit)
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [plans])

  const rows = useMemo<UnitRow[]>(
    () =>
      allUnits.map((unit) => {
        const unitPlans = plans.filter((plan) => plan.unit === unit)
        return {
          unit,
          workflowCount: LOCAL_INVENTORY.filter((item) => item.unit === unit)
            .length,
          plans: unitPlans,
          state: unitState(unitPlans, today),
          nextDue: earliestDue(unitPlans, today),
        }
      }),
    [allUnits, plans, today],
  )

  // 權限：monitorScope 'unit'（admin）只睇自己單位；'all' 睇全部
  const scopedRows = useMemo(() => {
    if (
      access !== null &&
      access.monitorScope === 'unit' &&
      access.unit !== undefined
    ) {
      return rows.filter((row) => row.unit === access.unit)
    }
    return rows
  }, [rows, access])

  const counts = useMemo<Record<MonitorFilterKey, number>>(
    () => ({
      all: scopedRows.length,
      action: scopedRows.filter((row) => needsAction(row.state)).length,
      overdue: scopedRows.filter((row) => row.state === 'overdue').length,
      dueSoon: scopedRows.filter((row) => row.state === 'dueSoon').length,
      selected: scopedRows.filter((row) => row.state === 'selected').length,
      not_started: scopedRows.filter((row) => row.state === 'not_started')
        .length,
      in_progress: scopedRows.filter((row) => row.state === 'in_progress')
        .length,
      done: scopedRows.filter((row) => row.state === 'done').length,
    }),
    [scopedRows],
  )

  const kpis = useMemo(
    () => ({
      units: scopedRows.length,
      started: scopedRows.filter((row) => row.plans.length > 0).length,
      aiCount: scopedRows.reduce(
        (sum, row) =>
          sum + row.plans.filter((plan) => plan.plan.trim() !== '').length,
        0,
      ),
      dueSoon: counts.dueSoon,
      overdue: counts.overdue,
    }),
    [scopedRows, counts],
  )

  const visibleRows = useMemo(() => {
    if (filter === 'all') {
      return scopedRows
    }
    if (filter === 'action') {
      return scopedRows.filter((row) => needsAction(row.state))
    }
    return scopedRows.filter((row) => row.state === filter)
  }, [scopedRows, filter])

  async function handleSync() {
    setSyncing(true)
    setNotice(null)
    try {
      const count = await syncLocalPlansToFirestore()
      setNotice(`Uploaded ${count} local plan(s) to Firestore.`)
      setLoading(true)
      setReloadToken((token) => token + 1)
    } catch (caught) {
      setNotice(errorText(caught))
    } finally {
      setSyncing(false)
    }
  }

  /**
   * 🔄 撳「重設」—— **先數清楚**有幾多（唔會刪），再彈 re-auth modal。
   */
  async function openReset(unit: string) {
    setResetError(null)
    setResetBusy(true)
    try {
      const counts = await countUnitData(unit)
      setResetTarget({ unit, counts })
    } catch (caught) {
      setNotice(errorText(caught))
    } finally {
      setResetBusy(false)
    }
  }

  /**
   * 🔐 使用者喺 modal 入面打 Superadmin 密碼 →
   *    Firebase 伺服器驗證 → **通過先真正刪**。
   */
  async function handleConfirmedReset(email: string, password: string) {
    if (resetTarget === null) {
      return
    }
    setResetBusy(true)
    setResetError(null)
    try {
      // ① 真驗證（密碼錯 = throw，唔會刪任何嘢）
      await confirmSuperadminPassword(email, password)
      // ② 驗證通過先執行（只刪計劃，LOG 保留）
      const result = await resetUnitData(resetTarget.unit, {
        id: user?.uid ?? 'unknown',
        name: access?.displayName ?? 'Superadmin',
      })
      setResetTarget(null)
      setNotice(
        `✅ Reset "${resetTarget.unit}" — deleted ${result.plansDeleted} AI plan(s); ` +
          `${result.logsKept} activity log entry/entries kept. ` +
          `🛡️ Backed up ${result.backupPlans} plan(s) + ${result.backupLogs} log entry/entries ` +
          `(aiPlanLogs backup ${result.backupId}).`,
      )
      setLoading(true)
      setReloadToken((token) => token + 1)
    } catch (caught) {
      setResetError(resetErrorMessage(caught))
    } finally {
      setResetBusy(false)
    }
  }

  // ⚠️ 所有 hooks 都要喺 early return 之前
  // Portal Dept／Business 冇監控權限 → 直接去 Workflows（佢哋係落手填計劃嘅人）
  if (access !== null && access.monitorScope === 'none') {
    return <Navigate to="/workflows" replace />
  }

  const localCount = countLocalPlans()

  return (
    <>
      <AppHeader />
      <main className="page">
        <div className="page-header">
          <div>
            <h1>Monitoring Dashboard</h1>
            <p className="muted">
              You are: {access === null ? '—' : access.displayName}
              {access !== null && (
                <span className="identity-id">
                  （{access.roleLabel} ·{' '}
                  {access.monitorScope === 'unit'
                    ? 'your own unit only'
                    : 'all units'}）
                </span>
              )}
            </p>
            {access !== null && access.canManage !== true && (
              <p className="muted hint-text">
                View-only account — unit Reset and activity-log deletion are
                reserved for the Firebase Superadmin (Admin account sign-in).
              </p>
            )}
          </div>
          <div className="monitor-actions">
            {access !== null &&
              access.canManage &&
              localCount > 0 && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void handleSync()}
                  disabled={syncing || !isPlanStoreReady()}
                  title={
                    isPlanStoreReady()
                      ? 'Upload the AI plans in this browser (localStorage) to Firestore'
                      : 'Firebase is not configured — cannot sync'
                  }
                >
                  {syncing ? 'Syncing…' : `Sync local data (${localCount})`}
                </button>
              )}
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setLoading(true)
                setReloadToken((token) => token + 1)
              }}
              disabled={loading}
            >
              {loading ? 'Loading…' : 'Reload'}
            </button>
          </div>
        </div>

        <div className="kpi-grid">
          <div className="kpi-card">
            <p className="kpi-label">Total units</p>
            <p className="kpi-value">{kpis.units}</p>
          </div>
          <div className="kpi-card">
            <p className="kpi-label">Units that selected a flow</p>
            <p className="kpi-value">{kpis.started}</p>
          </div>
          <div className="kpi-card">
            <p className="kpi-label">AI plans filled in</p>
            <p className="kpi-value">{kpis.aiCount}</p>
          </div>
          <div className="kpi-card">
            <p className="kpi-label">Due soon (within {DUE_SOON_DAYS} days)</p>
            <p className="kpi-value kpi-value-warn">{kpis.dueSoon}</p>
          </div>
          <div className="kpi-card">
            <p className="kpi-label">Overdue</p>
            <p className="kpi-value kpi-value-danger">{kpis.overdue}</p>
          </div>
        </div>

        {storeWarning !== null && (
          <p className="error-text">
            ⚠️ Cannot read Firestore — showing local data only. {storeWarning}
          </p>
        )}
        {error !== null && <p className="error-text">{error}</p>}
        {notice !== null && <p className="muted hint-text">{notice}</p>}

        <section className="card">
          <h2>
            Unit monitoring ({visibleRows.length} / {scopedRows.length})
          </h2>
          <p className="muted workflow-desc">
            Click a unit row to expand and see each workflow's timeline and due status.
          </p>

          <MonitorFilters
            value={filter}
            counts={counts}
            onChange={setFilter}
          />

          {visibleRows.length === 0 ? (
            <p className="muted">
              {loading ? 'Loading…' : 'No units match this filter.'}
            </p>
          ) : (
            <div className="monitor-table-wrap">
              <table className="monitor-table">
                <thead>
                  <tr>
                    <th>Unit</th>
                    <th>Workflow</th>
                    <th>Flows selected</th>
                    <th>AI plans filled</th>
                    <th>Next due</th>
                    <th>Status</th>
                    {access?.canManage === true && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => {
                    const aiCount = row.plans.filter(
                      (plan) => plan.plan.trim() !== '',
                    ).length
                    const isOpen = expanded === row.unit
                    return (
                      <Fragment key={row.unit}>
                        <tr
                          className="monitor-row"
                          onClick={() => setExpanded(isOpen ? null : row.unit)}
                        >
                          <td className="monitor-unit-name">
                            {isOpen ? '▾ ' : '▸ '}
                            {row.unit}
                          </td>
                          <td>{row.workflowCount}</td>
                          <td>{row.plans.length}</td>
                          <td>{aiCount}</td>
                          <td>
                            {row.nextDue === null
                              ? '—'
                              : `${row.nextDue.due} (${
                                  row.nextDue.daysLeft < 0
                                    ? `${Math.abs(row.nextDue.daysLeft)} days overdue`
                                    : `${row.nextDue.daysLeft} days left`
                                })`}
                          </td>
                          <td>
                            <span className={`state-chip state-${row.state}`}>
                              {UNIT_STATE_LABELS[row.state]}
                            </span>
                          </td>
                          {access?.canManage === true && (
                            <td>
                              <button
                                type="button"
                                className="btn btn-danger btn-sm"
                                disabled={resetBusy}
                                onClick={(event) => {
                                  // ⚠️ 一定要 stopPropagation ——
                                  //    唔好連帶展開／收起成行
                                  event.stopPropagation()
                                  void openReset(row.unit)
                                }}
                              >
                                Reset
                              </button>
                            </td>
                          )}
                        </tr>
                        {isOpen && (
                          <tr className="monitor-detail-row">
                            <td colSpan={access?.canManage === true ? 7 : 6}>
                              <UnitPlanDetail
                                plans={row.plans}
                                today={today}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {access?.monitorScope === 'all' && (
          <MonitorActivityLog canDelete={access.canManage} />
        )}
      </main>

      {resetTarget !== null && (
        <ConfirmResetModal
          unit={resetTarget.unit}
          counts={resetTarget.counts}
          defaultEmail={user?.email ?? ''}
          busy={resetBusy}
          error={resetError}
          onCancel={() => {
            if (!resetBusy) {
              setResetTarget(null)
              setResetError(null)
            }
          }}
          onConfirm={(email, password) =>
            void handleConfirmedReset(email, password)
          }
        />
      )}
    </>
  )
}
