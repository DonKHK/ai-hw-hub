import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import AppHeader from '../components/AppHeader'
import AiPlanForm from '../components/AiPlanForm'
import PlanLeadHeader from '../components/PlanLeadHeader'
import PlanLogList from '../components/PlanLogList'
import { useAuth } from '../context/useAuth'
import { accessForUser } from '../lib/access'
import { describeStoreError } from '../lib/firestoreError'
import { isLongWorkflowCode } from '../lib/workflowCode'
import { listPlansByOwner } from '../services/aiPlanService'
import { deletePlanLog, listLogsByOwner } from '../services/aiPlanLogService'
import { resolveWorkflowsByCodes } from '../services/workflowService'
import type { WorkflowItem } from '../services/workflowService'
import type { AiPlanLead, AiPlanLog } from '../types'

/**
 * 多選 workflow 之後嘅「逐條填 AI 計劃」wizard。
 * 揀咗幾多條都 OK：每條顯示同一張表，逐份存 localStorage。
 * 路徑：/workflows/ai-plan?codes=1A-001,1A-002,…
 */
export default function AiPlanWizardPage() {
  const [searchParams] = useSearchParams()
  const { user } = useAuth()

  const access = user === null ? undefined : accessForUser(user)
  const uid = user?.uid
  // Portal 用身份顯示名、Firebase 用 displayName／email（統一由 access 攞）
  const ownerName = access?.displayName ?? '—'

  // URL 帶住嘅 workflow code（Portal 係 UUID、本機係 1A-001）
  const requestedCodes = useMemo(() => {
    const raw = searchParams.get('codes') ?? ''
    return [
      ...new Set(
        raw
          .split(',')
          .map((code) => code.trim())
          .filter((code) => code !== ''),
      ),
    ]
  }, [searchParams])
  const codesKey = requestedCodes.join(',')

  // ⚠️ 一定要經 resolveWorkflowsByCodes（先 Firestore 快照、再本機 inventory）：
  //    Portal 嘅 code 係 UUID，淨係查 LOCAL_INVENTORY 會搵唔到 → 誤報「冇揀到」。
  // state 連「邊組 code 嘅結果」一齊記住，所以 URL 一轉就自動當「載入中」。
  const [loadedWorkflows, setLoadedWorkflows] = useState<{
    codes: string | null
    items: WorkflowItem[]
  }>({ codes: null, items: [] })

  useEffect(() => {
    let cancelled = false
    resolveWorkflowsByCodes(requestedCodes)
      .then((items) => {
        if (!cancelled) {
          setLoadedWorkflows({ codes: codesKey, items })
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadedWorkflows({ codes: codesKey, items: [] })
        }
      })
    return () => {
      cancelled = true
    }
  }, [requestedCodes, codesKey])

  const workflowsLoaded = loadedWorkflows.codes === codesKey
  const workflows = workflowsLoaded ? loadedWorkflows.items : []
  const workflowsLoading = !workflowsLoaded

  const [index, setIndex] = useState(0)
  const [done, setDone] = useState(false)
  const [filledCodes, setFilledCodes] = useState<string[]>([])

  /**
   * 頁頭「總負責人」—— **整份提交共用**（填一次就夠），
   * 所以升到 page level：切換 flow（AiPlanForm 會 remount）都唔會冇咗。
   */
  const [lead, setLead] = useState<AiPlanLead>({
    name: '',
    email: '',
    phone: '',
  })

  useEffect(() => {
    let cancelled = false
    if (uid === undefined) {
      return
    }
    listPlansByOwner(uid)
      .then((plans) => {
        if (!cancelled) {
          setFilledCodes(plans.map((plan) => plan.workflowCode))
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [uid])

  // ── 活動紀錄 LOG（只顯示自己）──
  const [logs, setLogs] = useState<AiPlanLog[]>([])
  const [logsLoading, setLogsLoading] = useState(true)
  const [logsError, setLogsError] = useState<string | null>(null)
  const [logToken, setLogToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    if (uid === undefined) {
      return
    }
    const codes = codesKey === '' ? [] : codesKey.split(',')
    listLogsByOwner(uid, codes)
      .then((items) => {
        if (!cancelled) {
          setLogs(items)
          setLogsError(null)
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setLogs([])
          setLogsError(describeStoreError(caught))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLogsLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [uid, codesKey, logToken])

  async function handleDeleteLog(logId: string) {
    if (!window.confirm('Delete this activity log entry? This cannot be undone.')) {
      return
    }
    try {
      await deletePlanLog(logId)
      setLogs((previous) => previous.filter((log) => log.id !== logId))
    } catch {
      // 刪除失敗就唔更新 UI（清單下次 reload 會顯示返）
    }
  }

  const total = workflows.length
  const safeIndex = total === 0 ? 0 : Math.min(index, total - 1)
  const current = total === 0 ? undefined : workflows[safeIndex]
  const isLast = safeIndex === total - 1

  function handleSaved(code: string) {
    setFilledCodes((previous) =>
      previous.includes(code) ? previous : [...previous, code],
    )
    // 儲存完即刻更新 LOG
    setLogsLoading(true)
    setLogToken((token) => token + 1)
    if (isLast) {
      setDone(true)
    } else {
      setIndex(safeIndex + 1)
    }
  }

  return (
    <>
      <AppHeader />
      <main className="page">
        <Link to="/workflows" className="back-link">
          ← Back to Workflows
        </Link>

        {access?.canEditPlans === false ? (
          <section className="card notice">
            <h2>View-only access — you cannot fill in AI plans</h2>
            <p className="muted">
              You have view-only access — you can see all units&apos; workflows, plan
              details and status on the Monitoring Dashboard, but cannot create, edit
              or delete.
            </p>
            <Link to="/" className="btn btn-primary">
              Go to Monitoring Dashboard
            </Link>
          </section>
        ) : access?.workflowScope === 'none' ? (
          <section className="card notice">
            <h2>Admin accounts have no workflows</h2>
            <p className="muted">
              Admin accounts are for admin / view-only use and do not fill in AI
              plans. To fill in plans, sign in with an &quot;AAI Portal identity&quot;.
            </p>
            <Link to="/" className="btn btn-ghost">
              Go to Monitoring Dashboard
            </Link>
          </section>
        ) : uid === undefined || (!workflowsLoading && total === 0) ? (
          <section className="card notice">
            <h2>No workflows selected</h2>
            <p className="muted">
              Go back to the Workflows page and select at least one workflow.
            </p>
          </section>
        ) : workflowsLoading ? (
          <section className="card notice">
            <h2>Loading workflows…</h2>
            <p className="muted">
              Fetching your selected workflows from the Firestore snapshot — please
              wait.
            </p>
          </section>
        ) : done ? (
          <section className="card wizard-done">
            <h2>All done 🎉</h2>
            <p className="muted">
              You have saved AI plans for the following {workflows.length} workflows
              (stored in Firebase Firestore — next time you sign in you can edit them
              directly):
            </p>
            <ul className="wizard-done-list">
              {workflows.map((workflow) => (
                <li key={workflow.code}>
                  <span className="chip chip-done">✓</span>
                  {!isLongWorkflowCode(workflow.code) && (
                    <span className="flow-code">{workflow.code}</span>
                  )}
                  <span className="flow-name" title={workflow.code}>
                    {workflow.name}
                  </span>
                </li>
              ))}
            </ul>
            <Link to="/workflows" className="btn btn-primary">
              Back to Workflows
            </Link>
          </section>
        ) : (
          <>
            <PlanLeadHeader
              unit={access?.unit ?? current?.unit ?? ''}
              value={lead}
              onChange={setLead}
              hint={`${total} workflow(s) selected — filling in item ${safeIndex + 1} of ${total}.`}
            />

            <div className="wizard-stepper">
              {workflows.map((workflow, i) => {
                const filled = filledCodes.includes(workflow.code)
                const active = i === safeIndex
                return (
                  <button
                    key={workflow.code}
                    type="button"
                    className={
                      'wizard-chip wizard-chip-tall' +
                      (active ? ' wizard-chip-active' : '') +
                      (filled ? ' wizard-chip-done' : '')
                    }
                    onClick={() => setIndex(i)}
                    title={workflow.code}
                  >
                    <span className="wizard-chip-line">
                      {filled ? '✓ ' : ''}
                      {isLongWorkflowCode(workflow.code)
                        ? `Item ${i + 1}`
                        : workflow.code}
                    </span>
                    <span className="wizard-chip-name">{workflow.name}</span>
                  </button>
                )
              })}
            </div>

            {current !== undefined && (
              <AiPlanForm
                key={current.code}
                workflow={current}
                ownerId={uid}
                ownerName={ownerName}
                lead={lead}
                alreadySaved={filledCodes.includes(current.code)}
                onSaved={(saved) => handleSaved(saved.workflowCode)}
              />
            )}
          </>
        )}
        {access?.workflowScope !== 'none' && access?.canEditPlans === true && (
          <section className="card">
            <h2>Activity log</h2>
            <p className="muted workflow-desc">
              Every change you make to these workflows is recorded (only your own
              records are shown).
            </p>
            <PlanLogList
              logs={logs}
              loading={logsLoading}
              error={logsError}
              canDelete={access?.canManage === true}
              onDelete={(logId) => void handleDeleteLog(logId)}
              emptyText="No records yet — they appear after you save a plan."
            />
          </section>
        )}
      </main>
    </>
  )
}
