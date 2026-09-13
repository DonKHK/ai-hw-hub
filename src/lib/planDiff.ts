import { AI_PLAN_STEP_STATE_LABELS } from '../types'
import type {
  AiPlan,
  AiPlanStep,
  AiPlanStepState,
  NewAiPlan,
  PlanChange,
} from '../types'

/**
 * 比較新舊 AI 計劃，產生「人話」變更清單 —— 用嚟寫活動紀錄 LOG。
 * 純函式，無副作用，方便獨立驗證。
 */

const PREVIEW_LENGTH = 30

function preview(text: string): string {
  const trimmed = text.trim()
  if (trimmed === '') {
    return '(empty)'
  }
  const oneLine = trimmed.replace(/\s+/g, ' ')
  return oneLine.length <= PREVIEW_LENGTH
    ? oneLine
    : `${oneLine.slice(0, PREVIEW_LENGTH)}…`
}

function stepLabel(step: AiPlanStep, index: number): string {
  const name = step.name.trim()
  return name === '' ? `Step ${index + 1}` : `"${name}"`
}

/** Step 嘅到期日（優先 dueDate，其次 due）；冇就「未定日期」。 */
function dueOf(step: AiPlanStep): string {
  const due = (step.dueDate ?? step.due ?? '').trim()
  return due === '' ? 'No date' : due
}

/** Step 嘅開始日期；冇就「未定日期」。 */
function startOf(step: AiPlanStep): string {
  const start = (step.startDate ?? '').trim()
  return start === '' ? 'No date' : start
}

/** Step 嘅 State（舊資料冇就當 Planning）。 */
function stateOf(step: AiPlanStep): AiPlanStepState {
  return step.state ?? 'planning'
}

/**
 * previous 為 null = 新建。
 * 回傳空陣列 = 儲存但冇實際改動（例如原封不動再撳儲存）。
 */
export function diffPlanChanges(
  previous: AiPlan | null,
  next: NewAiPlan,
): PlanChange[] {
  if (previous === null) {
    return [{ label: 'Action', from: '—', to: 'Plan created' }]
  }

  const changes: PlanChange[] = []

  if (previous.plan !== next.plan) {
    changes.push({
      label: 'AI approach',
      from: preview(previous.plan),
      to: preview(next.plan),
    })
  }
  if (previous.inputData !== next.inputData) {
    changes.push({
      label: 'Input Data',
      from: preview(previous.inputData),
      to: preview(next.inputData),
    })
  }
  if (previous.outputData !== next.outputData) {
    changes.push({
      label: 'Output Data',
      from: preview(previous.outputData),
      to: preview(next.outputData),
    })
  }

  // ── 頁頭「總負責人」（整份提交共用）＋ 卡1「Flow 負責人」──
  const people: { label: string; before?: string; after?: string }[] = [
    {
      label: 'Overall Person Responsible (full name)',
      before: previous.leadName,
      after: next.leadName,
    },
    {
      label: 'Overall Person Responsible email',
      before: previous.leadEmail,
      after: next.leadEmail,
    },
    {
      label: 'Overall Person Responsible phone',
      before: previous.leadPhone,
      after: next.leadPhone,
    },
    {
      label: 'Work Flow Person Responsible (full name)',
      before: previous.flowOwnerName,
      after: next.flowOwnerName,
    },
    {
      label: 'Work Flow Person Responsible email',
      before: previous.flowOwnerEmail,
      after: next.flowOwnerEmail,
    },
    {
      label: 'Work Flow Person Responsible phone',
      before: previous.flowOwnerPhone,
      after: next.flowOwnerPhone,
    },
  ]
  for (const person of people) {
    if ((person.before ?? '') !== (person.after ?? '')) {
      changes.push({
        label: person.label,
        from: preview(person.before ?? ''),
        to: preview(person.after ?? ''),
      })
    }
  }

  // ── 卡2「計劃開始／完成時間」──
  const spans: {
    label: string
    before?: string | null
    after?: string | null
  }[] = [
    { label: 'Plan start date', before: previous.startDate, after: next.startDate },
    { label: 'Plan end date', before: previous.endDate, after: next.endDate },
  ]
  for (const span of spans) {
    const before = span.before ?? ''
    const after = span.after ?? ''
    if (before !== after) {
      changes.push({
        label: span.label,
        from: before === '' ? 'Not set' : before,
        to: after === '' ? 'Not set' : after,
      })
    }
  }

  const previousStatus = previous.status ?? 'in_progress'
  const nextStatus = next.status ?? 'in_progress'
  if (previousStatus !== nextStatus) {
    changes.push({ label: 'Status', from: previousStatus, to: nextStatus })
  }

  const previousSteps = previous.steps ?? []
  const nextSteps = next.steps ?? []
  const maxLength = Math.max(previousSteps.length, nextSteps.length)

  for (let index = 0; index < maxLength; index += 1) {
    const hasBefore = index < previousSteps.length
    const hasAfter = index < nextSteps.length

    if (!hasBefore && hasAfter) {
      const after = nextSteps[index]
      changes.push({
        label: 'Step added',
        from: '—',
        to: `${stepLabel(after, index)} (${dueOf(after)})`,
      })
    } else if (hasBefore && !hasAfter) {
      const before = previousSteps[index]
      changes.push({
        label: 'Step removed',
        from: stepLabel(before, index),
        to: '—',
      })
    } else if (hasBefore && hasAfter) {
      const before = previousSteps[index]
      const after = nextSteps[index]
      if (before.name.trim() !== after.name.trim()) {
        changes.push({
          label: `Step ${index + 1} name`,
          from: before.name.trim(),
          to: after.name.trim(),
        })
      }
      if (dueOf(before) !== dueOf(after)) {
        changes.push({
          label: `Step ${stepLabel(after, index)} end date`,
          from: dueOf(before),
          to: dueOf(after),
        })
      }
      if (startOf(before) !== startOf(after)) {
        changes.push({
          label: `Step ${stepLabel(after, index)} start date`,
          from: startOf(before),
          to: startOf(after),
        })
      }
      if (stateOf(before) !== stateOf(after)) {
        changes.push({
          label: `Step ${stepLabel(after, index)} state`,
          from: AI_PLAN_STEP_STATE_LABELS[stateOf(before)],
          to: AI_PLAN_STEP_STATE_LABELS[stateOf(after)],
        })
      }
      const beforeDetail = (before.detail ?? '').trim()
      const afterDetail = (after.detail ?? '').trim()
      if (beforeDetail !== afterDetail) {
        changes.push({
          label: `Step ${stepLabel(after, index)} details`,
          from: preview(beforeDetail),
          to: preview(afterDetail),
        })
      }
    }
  }

  const previousPain = (previous.painPoints ?? []).join('\n')
  const nextPain = (next.painPoints ?? []).join('\n')
  if (previousPain !== nextPain) {
    changes.push({
      label: 'Pain Point',
      from: `${(previous.painPoints ?? []).length} items`,
      to: `${(next.painPoints ?? []).length} items`,
    })
  }

  const previousSupports = (previous.supports ?? []).join('\n')
  const nextSupports = (next.supports ?? []).join('\n')
  if (previousSupports !== nextSupports) {
    changes.push({
      label: 'Support',
      from: `${(previous.supports ?? []).length} items`,
      to: `${(next.supports ?? []).length} items`,
    })
  }

  return changes
}

/** 變更清單 → 一句 summary。 */
export function summarizeChanges(
  changes: PlanChange[],
  isNew: boolean,
): string {
  if (isNew) {
    return 'Plan created'
  }
  if (changes.length === 0) {
    return 'Saved (no changes)'
  }
  if (changes.length === 1) {
    return `Updated ${changes[0].label}`
  }
  const firstTwo = changes
    .slice(0, 2)
    .map((change) => change.label)
    .join(', ')
  return `Updated ${changes.length} fields (${firstTwo}, …)`
}

/** 變更清單 → LOG details（每行一項）。 */
export function changesToDetails(changes: PlanChange[]): string[] {
  return changes.map(
    (change) => `${change.label}: ${change.from} → ${change.to}`,
  )
}
