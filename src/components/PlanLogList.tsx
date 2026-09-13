import { formatLogTime } from '../services/aiPlanLogService'
import { isLongWorkflowCode } from '../lib/workflowCode'
import { AI_PLAN_LOG_ACTION_LABELS } from '../types'
import type { AiPlanLog } from '../types'

interface PlanLogListProps {
  logs: AiPlanLog[]
  loading?: boolean
  /** 讀取錯誤（人話）——有值就唔會顯示「未有紀錄」 */
  error?: string | null
  /** 只有 superadmin 會傳 true → 顯示「刪除」掣 */
  canDelete?: boolean
  onDelete?: (logId: string) => void
  emptyText?: string
  /** 顯示「邊個 + 邊個單位」（監控頁用；wizard 頁自己嘅 log 唔使顯示） */
  showMeta?: boolean
}

/**
 * 活動紀錄（LOG）清單。
 * 刪除限制只係前端 UI gate（Portal 用戶冇 Firebase Auth，rules 鎖唔到）。
 */
export default function PlanLogList({
  logs,
  loading = false,
  error = null,
  canDelete = false,
  onDelete,
  emptyText = 'No records yet.',
  showMeta = false,
}: PlanLogListProps) {
  if (loading) {
    return <p className="muted">Loading…</p>
  }

  // 有錯誤就唔好同時顯示「未有紀錄」（會自相矛盾、誤導）
  if (error !== null) {
    return <p className="error-text">{error}</p>
  }

  if (logs.length === 0) {
    return <p className="muted">{emptyText}</p>
  }

  return (
    <ul className="log-list">
      {logs.map((log) => {
        const actionLabel = AI_PLAN_LOG_ACTION_LABELS[log.action]
        // 舊紀錄冇存 workflow 名就會等於 code —— 兩種情況都唔好露 UUID
        const hasRealName =
          log.workflowName !== '' && log.workflowName !== log.workflowCode
        // summary 同 action 標籤一樣就唔好講兩次（例：selected = 開始填計劃）
        const summary = log.summary === actionLabel ? '' : log.summary
        return (
          <li key={log.id} className="log-item">
            <div className="log-head">
              <span className="log-time">{formatLogTime(log.at)}</span>
              {showMeta && (
                <>
                  <span className="log-who">{log.ownerName}</span>
                  <span className="flow-unit">{log.unit}</span>
                </>
              )}
              {!isLongWorkflowCode(log.workflowCode) && (
                <span className="flow-code">{log.workflowCode}</span>
              )}
              {hasRealName && (
                <span className="flow-name" title={`ID: ${log.workflowCode}`}>
                  {log.workflowName}
                </span>
              )}
              <span className={`log-action log-action-${log.action}`}>
                {actionLabel}
              </span>
              {summary !== '' && (
                <span className="log-summary">{summary}</span>
              )}
              {canDelete && onDelete !== undefined && (
                <button
                  type="button"
                  className="btn btn-danger btn-sm log-delete"
                  onClick={() => onDelete(log.id)}
                >
                  Delete
                </button>
              )}
            </div>

            {log.details.length > 0 && (
              <ul className="log-details">
                {log.details.map((detail, index) => (
                  <li key={index}>{detail}</li>
                ))}
              </ul>
            )}
          </li>
        )
      })}
    </ul>
  )
}
