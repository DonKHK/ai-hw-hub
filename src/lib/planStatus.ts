import type { AiPlan, AiPlanStep } from '../types'

/**
 * AI 計劃 timeline 狀態推導（純函式，無副作用）。
 *
 * 點解要獨立一個檔：dashboard 要「就到期 / 已到期」嘅判斷，
 * 而舊資料嘅 `step.due` 係自由文字（可能係 "Q2"、"下個月"），
 * 所以要集中處理「parse 唔到就當未定日期」呢件事。
 *
 * 「到期點」有兩層：
 * 1. 每個 step 嘅 due date（`step.dueDate`，舊資料用 `step.due`）
 * 2. Plan details 嘅 end date（`plan.endDate`）—— 整條計劃嘅大限
 * 兩者一齊計，所以 KPI 嘅「就到期 / 已到期」係兩層都包含。
 */

/** 「就到期」門檻（日）。想改就改呢個。 */
export const DUE_SOON_DAYS = 14

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** 今日（本機時區）嘅 yyyy-mm-dd。 */
export function todayIso(now: Date = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function toUtcMs(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

/** toIso - fromIso 相差幾多日（正數 = 未來）。 */
function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((toUtcMs(toIso) - toUtcMs(fromIso)) / 86_400_000)
}

/**
 * 攞一個 step 嘅到期日。
 * 優先 `dueDate`，其次 `due`（只接受 yyyy-mm-dd）。
 * parse 唔到就 null（例如 "Q2"、"待定"）。
 */
export function stepDueDate(step: AiPlanStep): string | null {
  if (typeof step.dueDate === 'string' && ISO_DATE.test(step.dueDate)) {
    return step.dueDate
  }
  if (typeof step.due === 'string' && ISO_DATE.test(step.due.trim())) {
    return step.due.trim()
  }
  return null
}

/**
 * 攞一條計劃「Plan details」嘅完成日（`plan.endDate`）。
 * 只接受 yyyy-mm-dd；parse 唔到就 null（同 `stepDueDate` 一致）。
 */
export function planEndDate(plan: AiPlan): string | null {
  if (typeof plan.endDate === 'string' && ISO_DATE.test(plan.endDate.trim())) {
    return plan.endDate.trim()
  }
  return null
}

/**
 * 一個到期點（step 或 plan end date）嘅狀態。
 * 🆕 `done` = 呢個 partition 已做完 —— 做完就冇嘢要跟，唔會再算 Overdue。
 */
export type TimelineState =
  | 'done'
  | 'overdue'
  | 'dueSoon'
  | 'onTrack'
  | 'noDate'

export interface StepTimeline {
  index: number
  name: string
  due: string | null
  /** 距離到期仲有幾日（負數 = 已過期）；冇日期就 null */
  daysLeft: number | null
  state: TimelineState
}

export function stateForDue(
  due: string | null,
  today: string,
): TimelineState {
  if (due === null) {
    return 'noDate'
  }
  const daysLeft = daysBetween(today, due)
  if (daysLeft < 0) {
    return 'overdue'
  }
  return daysLeft <= DUE_SOON_DAYS ? 'dueSoon' : 'onTrack'
}

/** 呢個 partition 係唔係已經做完？（Done 就冇嘢要跟） */
export function isDoneStep(step: AiPlanStep): boolean {
  return step.state === 'done'
}

/**
 * 一個 step 嘅 timeline 狀態。
 *
 * ⚠️ 一定要**先**睇 `step.state`：overdue 係「未完成 + 過咗期」嘅跟進訊號，
 * 做完嘅 partition 唔應該再出 Overdue（否則一個已交嘅 partition 會
 * 一路拖住整條計劃同單位變紅）。遲交嘅資訊由 UI 用 `daysLeft < 0`
 * 自己顯示灰色「(N days late)」，唔會當成 Overdue。
 */
export function stepTimelineState(
  step: AiPlanStep,
  today: string,
): TimelineState {
  if (isDoneStep(step)) {
    return 'done'
  }
  return stateForDue(stepDueDate(step), today)
}

/**
 * Plan details 嘅 end date 狀態（同 step 用同一套 overdue／dueSoon／onTrack／noDate）。
 * 冇填 end date 或者 parse 唔到 → 'noDate'。
 */
export function planEndState(
  plan: AiPlan,
  today: string = todayIso(),
): TimelineState {
  return stateForDue(planEndDate(plan), today)
}

/** 一條 AI 計劃嘅完整 timeline。 */
export function planTimeline(
  plan: AiPlan,
  today: string = todayIso(),
): StepTimeline[] {
  return (plan.steps ?? []).map((step, index) => {
    const due = stepDueDate(step)
    return {
      index,
      name: step.name,
      due,
      daysLeft: due === null ? null : daysBetween(today, due),
      state: stepTimelineState(step, today),
    }
  })
}

/**
 * 計劃層級狀態：
 * not_started（其實唔會出現，有記錄就唔係）／selected／in_progress／
 * dueSoon／overdue／done
 */
export type UnitState =
  | 'not_started'
  | 'selected'
  | 'in_progress'
  | 'dueSoon'
  | 'overdue'
  | 'done'

export function planState(
  plan: AiPlan,
  today: string = todayIso(),
): UnitState {
  if (plan.status === 'done') {
    return 'done'
  }
  // 新表單冇「計劃狀態」欄位 —— 所有 partition 都 Done 就當計劃完成。
  const steps = plan.steps ?? []
  if (steps.length > 0 && steps.every(isDoneStep)) {
    return 'done'
  }
  // plan 空白 = 只係揀咗 flow 未填（stub 或者未交）；
  // 唔可以淨係睇 status，因為存完之後 status 可能仲係 'selected'。
  if (plan.plan.trim() === '') {
    return 'selected'
  }
  // 🆕 做完嘅 partition 唔再計：一個已交嘅 partition 唔應該拖累整條計劃變
  //    Overdue（遲交只用 UI 灰色「(N days late)」記低）。
  const timeline = planTimeline(plan, today).filter(
    (item) => item.state !== 'done',
  )
  // 🆕 Plan details 嘅 end date 都係一個「到期點」——
  //    同 step due date 一齊判斷：過咗 = Overdue，14 日內 = Due soon。
  const endState = planEndState(plan, today)
  if (
    timeline.some((item) => item.state === 'overdue') ||
    endState === 'overdue'
  ) {
    return 'overdue'
  }
  if (
    timeline.some((item) => item.state === 'dueSoon') ||
    endState === 'dueSoon'
  ) {
    return 'dueSoon'
  }
  return 'in_progress'
}

/** 嚴重程度（越大越需要關注）。 */
const SEVERITY: Record<UnitState, number> = {
  overdue: 5,
  dueSoon: 4,
  selected: 3,
  in_progress: 2,
  done: 1,
  not_started: 0,
}

export function stateSeverity(state: UnitState): number {
  return SEVERITY[state]
}

/** 一個單位（可能有多條計劃）嘅整體狀態 = 最嚴重嗰條。 */
export function unitState(
  plans: AiPlan[],
  today: string = todayIso(),
): UnitState {
  if (plans.length === 0) {
    return 'not_started'
  }
  return plans.reduce<UnitState>(
    (worst, plan) => {
      const current = planState(plan, today)
      return stateSeverity(current) > stateSeverity(worst) ? current : worst
    },
    'not_started',
  )
}

/**
 * 一個單位入面最近（最早就到期／已經過期）嘅日期。
 *
 * ⚠️ 只計**未完成**嘅到期點：
 * - 已完成嘅計劃（表單揀咗 Completed，或者全部 partition 都 Done）成條唔報；
 * - 做完嘅 partition（State = Done）唔報 —— 否則完成咗嘅舊日期會一直
 *   顯示成「N days overdue」。
 * 同 `planState` 用同一套規則。
 */
export function earliestDue(
  plans: AiPlan[],
  today: string = todayIso(),
): { due: string; daysLeft: number; state: TimelineState } | null {
  let best: { due: string; daysLeft: number; state: TimelineState } | null =
    null
  for (const plan of plans) {
    // 🆕 計劃已完成 → 冇嘢要跟，成條計劃（連 plan end date）都唔報。
    if (planState(plan, today) === 'done') {
      continue
    }
    for (const item of planTimeline(plan, today)) {
      if (
        item.due === null ||
        item.daysLeft === null ||
        // 🆕 做完嘅 partition 唔再係「最近到期」
        item.state === 'done'
      ) {
        continue
      }
      if (best === null || item.daysLeft < best.daysLeft) {
        best = { due: item.due, daysLeft: item.daysLeft, state: item.state }
      }
    }
    // 🆕 Plan details 嘅 end date 都係一個「到期點」——
    //    如果佢早過所有 step due date，就會係「最近到期」。
    const end = planEndDate(plan)
    if (end !== null) {
      const daysLeft = daysBetween(today, end)
      if (best === null || daysLeft < best.daysLeft) {
        best = { due: end, daysLeft, state: stateForDue(end, today) }
      }
    }
  }
  return best
}

export const TIMELINE_STATE_LABELS: Record<TimelineState, string> = {
  done: 'Completed',
  overdue: 'Overdue',
  dueSoon: 'Due soon',
  onTrack: 'On track',
  noDate: 'No date',
}

export const UNIT_STATE_LABELS: Record<UnitState, string> = {
  not_started: 'Not started',
  selected: 'Flow selected',
  in_progress: 'In progress',
  dueSoon: 'Due soon',
  overdue: 'Overdue',
  done: 'Completed',
}
