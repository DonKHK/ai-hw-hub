import { useCallback, useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import AppHeader from '../components/AppHeader'
import AiPlanForm from '../components/AiPlanForm'
import PlanLeadHeader from '../components/PlanLeadHeader'
import PlanLogList from '../components/PlanLogList'
import { useAuth } from '../context/useAuth'
import { accessForUser } from '../lib/access'
import { describeStoreError } from '../lib/firestoreError'
import { deletePlanLog, listLogsByOwner } from '../services/aiPlanLogService'
import { resolveWorkflowsByCodes } from '../services/workflowService'
import type { WorkflowItem } from '../services/workflowService'
import type { AiPlanLead, AiPlanLog } from '../types'

/** 單條 workflow 嘅 AI 計劃頁（deep-link／直接編輯用）。 */
export default function AiPlanPage() {
  const { workflowCode = '' } = useParams()
  const { user } = useAuth()
  const access = user === null ? undefined : accessForUser(user)
  const uid = user?.uid
  // Portal 用身份顯示名、Firebase 用 displayName／email（統一由 access 攞）
  const ownerName = access?.displayName ?? '—'

  // 🆕 V2：未儲存改動 → Back／Cancel 之前確認（唔會靜靜咁丟失編輯）
  //    用 ref 而唔用 state：唔會引起 re-render（表單每次變更都通知）
  const dirtyRef = useRef(false)
  const handleDirtyChange = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty
  }, [])
  const confirmLeave = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (
      dirtyRef.current &&
      !window.confirm('You have unsaved changes. Leave this page and lose them?')
    ) {
      event.preventDefault()
    }
  }

  // ⚠️ 一定要經 resolveWorkflowsByCodes（先 Firestore 快照、再本機 inventory）：
  //    Portal 嘅 code 係 UUID，LOCAL_INVENTORY 查唔到 → 會誤報「搵唔到呢條 workflow」。
  // state 連「邊個 code 嘅結果」一齊記住，所以 URL 一轉就自動當「載入中」。
  const [loadedWorkflow, setLoadedWorkflow] = useState<{
    code: string | null
    item: WorkflowItem | undefined
  }>({ code: null, item: undefined })

  useEffect(() => {
    let cancelled = false
    resolveWorkflowsByCodes([workflowCode])
      .then((items) => {
        if (!cancelled) {
          setLoadedWorkflow({ code: workflowCode, item: items[0] })
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadedWorkflow({ code: workflowCode, item: undefined })
        }
      })
    return () => {
      cancelled = true
    }
  }, [workflowCode])

  const workflowLoaded = loadedWorkflow.code === workflowCode
  const workflow = workflowLoaded ? loadedWorkflow.item : undefined
  const workflowLoading = !workflowLoaded

  /** 頁頭「總負責人」—— 整份提交共用，填一次就夠。 */
  const [lead, setLead] = useState<AiPlanLead>({
    name: '',
    email: '',
    phone: '',
  })

  // 活動紀錄 LOG（只顯示自己，只限呢條 workflow）
  const [logs, setLogs] = useState<AiPlanLog[]>([])
  const [logsLoading, setLogsLoading] = useState(true)
  const [logsError, setLogsError] = useState<string | null>(null)
  // 🆕 儲存成功後重新載入活動紀錄（令用戶即刻見到「呢次改動有入到」）
  const [logsReloadToken, setLogsReloadToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    if (uid === undefined) {
      return
    }
    listLogsByOwner(uid, [workflowCode])
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
  }, [uid, workflowCode, logsReloadToken])

  async function handleDeleteLog(logId: string) {
    if (!window.confirm('Delete this activity log entry? This cannot be undone.')) {
      return
    }
    try {
      await deletePlanLog(logId)
      setLogs((previous) => previous.filter((log) => log.id !== logId))
    } catch {
      // 刪除失敗就唔更新 UI
    }
  }

  return (
    <>
      <AppHeader />
      <main className="page">
        <Link
          to={access?.workflowScope === 'none' ? '/' : '/workflows'}
          className="back-link"
          onClick={confirmLeave}
        >
          ← Back
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
        ) : uid === undefined ||
          (!workflowLoading && workflow === undefined) ? (
          <section className="card notice">
            <h2>Workflow not found</h2>
            <p className="muted">Go back to the Workflows page and pick again.</p>
          </section>
        ) : workflowLoading ? (
          <section className="card notice">
            <h2>Loading workflow…</h2>
            <p className="muted">Fetching data from the Firestore snapshot — please wait.</p>
          </section>
        ) : workflow === undefined ? null : (
          <>
            <PlanLeadHeader
              unit={access?.unit ?? workflow.unit ?? ''}
              value={lead}
              onChange={setLead}
            />

            <div className="page-header">
              <div>
                <h1 title={workflow.code}>AI plan — {workflow.name}</h1>
              </div>
              <Link to="/workflows" className="btn btn-ghost" onClick={confirmLeave}>
                Back to workflows
              </Link>
            </div>

            {/* 儲存後**唔自動跳走**：表單會顯示儲存結果（已記錄 N 項變更／
                ⚠️ 冇任何變更），用戶即刻知改動有冇入到 Firestore；
                同時重新載入下面嘅活動紀錄，方便對照。 */}
            <AiPlanForm
              workflow={workflow}
              ownerId={uid}
              ownerName={ownerName}
              lead={lead}
              onDirtyChange={handleDirtyChange}
              onSaved={() => {
                setLogsLoading(true)
                setLogsReloadToken((token) => token + 1)
              }}
            />
          </>
        )}
        {access?.workflowScope !== 'none' &&
          access?.canEditPlans === true &&
          workflow !== undefined && (
          <section className="card">
            <h2>Activity log</h2>
            <p className="muted workflow-desc">
              Every change you make to this workflow is recorded (only your own
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
