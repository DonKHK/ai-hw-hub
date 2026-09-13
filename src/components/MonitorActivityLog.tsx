import { useEffect, useState } from 'react'
import PlanLogList from './PlanLogList'
import { describeStoreError } from '../lib/firestoreError'
import { deletePlanLog, listAllLogs } from '../services/aiPlanLogService'
import type { AiPlanLog } from '../types'

/** 最多顯示幾多筆（避免一次過 render 太多）。 */
const MAX_LOGS = 100

interface MonitorActivityLogProps {
  /** 可唔可以刪（只有 Firebase superadmin = true）。 */
  canDelete?: boolean
}

/**
 * 監控頁「全部活動紀錄」—— 所有單位、所有人改過嘅嘢。
 * **只有 monitorScope === 'all' 嘅身份見到呢個區塊**（MonitorPage 會 gate）；
 * 但**只有 canManage（Firebase superadmin）先有「刪除」掣**。
 */
export default function MonitorActivityLog({
  canDelete = false,
}: MonitorActivityLogProps) {
  const [logs, setLogs] = useState<AiPlanLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    listAllLogs()
      .then((items) => {
        if (!cancelled) {
          setLogs(items.slice(0, MAX_LOGS))
          setError(null)
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(describeStoreError(caught))
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

  async function handleDelete(logId: string) {
    if (!window.confirm('Delete this activity log entry? This cannot be undone.')) {
      return
    }
    try {
      await deletePlanLog(logId)
      setLogs((previous) => previous.filter((log) => log.id !== logId))
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Delete failed.')
    }
  }

  return (
    <section className="card">
      <div className="page-header-title-row">
        <h2>All activity log</h2>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setLoading(true)
            setReloadToken((token) => token + 1)
          }}
          disabled={loading}
        >
          {loading ? 'Loading…' : 'Reload'}
        </button>
      </div>
      <p className="muted workflow-desc">
        Every change by any unit or colleague is recorded (latest {MAX_LOGS} entries only).
        {canDelete ? 'You can delete any entry.' : 'View only — you cannot delete.'}
      </p>

      <PlanLogList
        logs={logs}
        loading={loading}
        error={error}
        canDelete={canDelete}
        onDelete={(logId) => void handleDelete(logId)}
        showMeta
        emptyText="No activity log entries yet."
      />
    </section>
  )
}
