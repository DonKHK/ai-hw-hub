import {
  TIMELINE_STATE_LABELS,
  UNIT_STATE_LABELS,
  planState,
  planTimeline,
} from '../lib/planStatus'
import { isLongWorkflowCode } from '../lib/workflowCode'
import type { AiPlan } from '../types'

interface UnitPlanDetailProps {
  plans: AiPlan[]
  today: string
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
                      {item.daysLeft === null
                        ? ''
                        : item.daysLeft < 0
                          ? `(${Math.abs(item.daysLeft)} days overdue)`
                          : `(${item.daysLeft} days left)`}
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
