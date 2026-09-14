import {
  TIMELINE_STATE_LABELS,
  UNIT_STATE_LABELS,
  planEndDate,
  planEndState,
  planState,
  planTimeline,
} from '../lib/planStatus'
import type { StepTimeline, TimelineState } from '../lib/planStatus'
import { isLongWorkflowCode } from '../lib/workflowCode'
import type { AiPlan } from '../types'

interface UnitPlanDetailProps {
  plans: AiPlan[]
  today: string
}

/**
 * 日期後面嘅灰色括號說明。
 *
 * - **Done**（做完）：過期只係「遲交」紀錄 → 「(N days late)」，未過期就唔加字
 * - 未做完：過期 = 「(N days overdue)」，未過期 = 「(N days left)」
 *
 * ⚠️ Done 嘅 partition 唔會出 Overdue —— overdue 係「未完成 + 過期」嘅
 * 跟進訊號，做完就冇嘢要跟（狀態 chip 由 `planTimeline` 計，見 planStatus.ts）。
 */
function dueSuffix(item: StepTimeline): string {
  if (item.daysLeft === null) {
    return ''
  }
  if (item.state === 'done') {
    return item.daysLeft < 0 ? `(${Math.abs(item.daysLeft)} days late)` : ''
  }
  return item.daysLeft < 0
    ? `(${Math.abs(item.daysLeft)} days overdue)`
    : `(${item.daysLeft} days left)`
}

/**
 * 某個單位嘅 AI 計劃明細（畀 MonitorPage 展開行用）。
 * 每條計劃顯示狀態、填報人，同每個 step 嘅 timeline 到期狀態。
 */
export default function UnitPlanDetail({
  plans,
  today,
}: UnitPlanDetailProps) {
  if (plans.length === 0) {
    return (
      <p className="muted">No records yet (no one from this unit has submitted an AI plan).</p>
    )
  }

  return (
    <ul className="plan-detail-list">
      {plans.map((plan) => {
        const state = planState(plan, today)
        const timeline = planTimeline(plan, today)
        // 🆕 Plan details 嘅開始／完成日期（KPI 嘅「就到期／已到期」包含 end date）
        const startDate =
          typeof plan.startDate === 'string' && plan.startDate.trim() !== ''
            ? plan.startDate
            : null
        const endDate = planEndDate(plan)
        // 🆕 計劃已完成（全部 step Done／表單揀咗 Completed）→ end date 唔應該
        //    再出紅色 Overdue／黃色 Due soon（同 planState 一致）。
        const endChipState: TimelineState =
          state === 'done' ? 'done' : planEndState(plan, today)

        return (
          <li key={plan.id} className="plan-detail">
            <div className="plan-detail-head">
              {!isLongWorkflowCode(plan.workflowCode) && (
                <span className="flow-code">{plan.workflowCode}</span>
              )}
              <strong title={plan.workflowCode}>{plan.workflowName}</strong>
              <span className={`state-chip state-${state}`}>
                {UNIT_STATE_LABELS[state]}
              </span>
              <span className="muted">
                Submitted by: {plan.ownerName ?? plan.ownerId}
              </span>
            </div>

            {(startDate !== null || endDate !== null) && (
              <p className="muted hint-text">
                Plan: {startDate ?? '—'} → {endDate ?? '—'}{' '}
                <span className={`state-chip state-${endChipState}`}>
                  {TIMELINE_STATE_LABELS[endChipState]}
                </span>
              </p>
            )}

            {timeline.length === 0 ? (
              <p className="muted hint-text">No steps yet.</p>
            ) : (
              <ul className="timeline-list">
                {timeline.map((item) => (
                  <li key={item.index} className="timeline-item">
                    <span className={`state-chip state-${item.state}`}>
                      {TIMELINE_STATE_LABELS[item.state]}
                    </span>
                    <span className="timeline-name">{item.name}</span>
                    <span className="muted">
                      {item.due ?? '—'}
                      {dueSuffix(item)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        )
      })}
    </ul>
  )
}
