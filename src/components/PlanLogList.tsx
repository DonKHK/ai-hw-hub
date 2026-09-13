import {
  formatLogClock,
  formatLogDate,
} from '../services/aiPlanLogService'
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

  // 保險：無論 caller 傳咩次序，一律最新喺最頂（唔會改動原本 array）
  const ordered = [...logs].sort((a, b) => b.at - a.at)

  const showActions = canDelete && onDelete !== undefined

  return (
    <div className="log-table-wrap">
      <table className="log-table">
        <thead>
          <tr>
            <th className="log-col-date">Date</th>
            <th className="log-col-time">Time</th>
            {showMeta && <th className="log-col-person">Person</th>}
            <th className="log-col-activity">Activity</th>
            {showActions && <th className="log-col-action" aria-label="Actions" />}
          </tr>
        </thead>
        <tbody>
          {ordered.map((log) => {
            const actionLabel = AI_PLAN_LOG_ACTION_LABELS[log.action]
            // 舊紀錄冇存 workflow 名就會等於 code —— 兩種情況都唔好露 UUID
            const hasRealName =
              log.workflowName !== '' && log.workflowName !== log.workflowCode
            // summary 同 action 標籤一樣就唔好講兩次（例：selected = 開始填計劃）
            const summary = log.summary === actionLabel ? '' : log.summary
            const showCode = !isLongWorkflowCode(log.workflowCode)
            const flowText = [
              showCode ? log.workflowCode : '',
              hasRealName ? log.workflowName : '',
            ]
              .filter((part) => part !== '')
              .join(' · ')

            return (
              <tr key={log.id}>
                <td className="log-col-date">{formatLogDate(log.at)}</td>
                <td className="log-col-time">{formatLogClock(log.at)}</td>
                {showMeta && (
                  <td className="log-col-person">
                    <span className="log-who">{log.ownerName}</span>
                    {log.unit !== '' && (
                      <span className="log-cell-unit">{log.unit}</span>
                    )}
                  </td>
                )}
                <td className="log-col-activity">
                  <span className={`log-action log-action-${log.action}`}>
                    {actionLabel}
                  </span>
                  {summary !== '' && (
                    <span className="log-summary">{summary}</span>
                  )}
                  {flowText !== '' && (
                    <span className="log-cell-flow" title={`ID: ${log.workflowCode}`}>
                      {flowText}
                    </span>
                  )}
                  {log.details.length > 0 && (
                    <ul className="log-details">
                      {log.details.map((detail, index) => (
                        <li key={index}>{detail}</li>
                      ))}
                    </ul>
                  )}
                </td>
                {showActions && (
                  <td className="log-col-action">
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => onDelete(log.id)}
                    >
                      Delete
                    </button>
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
