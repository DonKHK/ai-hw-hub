import type { AiPlan, AiPlanStep } from '../types'

/**
 * 「AI 計劃表單」嘅草稿工具（純函式，無副作用）。
 *
 * 點解要獨立一個檔：
 * 1. 「有冇未儲存改動」同「儲存結果」都要用**同一套**「表單值 → 正規化內容」規則，
 *    否則會出現「改咗但 diff 話冇變」呢類矛盾 —— 真實發生過：用戶改咗 UAT
 *    嘅 State 同 Start date，但兩次儲存都係 `Saved (no changes)`
 *    （證明送出嘅內容同雲端一模一樣），令人以為「存完都冇效果」。
 * 2. 純函式可以獨立驗證（Node 直接跑），唔需要開瀏覽器。
 */

/** 多行文字 → 陣列（一格一行，去掉空行）。 */
export function splitLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

/**
 * Step 陣列正規化 —— 同儲存時用同一套規則（trim 名／內容、`due` 同 `dueDate`
 * 同步、空名 step 去掉）。
 *
 * ⚠️ 一定要 idempotent（清理兩次結果一樣）：咁「由已儲存計劃砌出嘅簽名」
 * 才會等於「表單預填後嘅簽名」，唔會一開頁就誤報「有未儲存改動」。
 */
export function cleanSteps(steps: readonly AiPlanStep[]): AiPlanStep[] {
  return steps
    .map((step) => ({
      name: step.name.trim(),
      // due 係向後兼容欄位（舊 dashboard 讀佢）→ 一律同 dueDate 同步
      due: step.dueDate ?? '',
      dueDate: step.dueDate ?? null,
      startDate: step.startDate ?? null,
      state: step.state ?? 'planning',
      detail: (step.detail ?? '').trim(),
    }))
    .filter((step) => step.name !== '')
}

/**
 * 表單內容。
 * ⚠️ 刻意**唔包括**頁頭「總負責人」（lead）—— 佢由 PlanLeadHeader 持有、
 * 唔會由已儲存計劃預填，如果計入就會一開頁就誤報「有未儲存改動」。
 */
export interface PlanDraft {
  flowOwnerName: string
  flowOwnerEmail: string
  flowOwnerPhone: string
  startDate: string
  endDate: string
  plan: string
  inputData: string
  outputData: string
  steps: readonly AiPlanStep[]
  /** 未 split 嘅 textarea 內容（一格一行） */
  painPoints: string
  supports: string
}

/** 表單內容 → 簽名（用嚟判斷「有冇未儲存改動」）。 */
export function draftSignature(draft: PlanDraft): string {
  return JSON.stringify({
    flowOwnerName: draft.flowOwnerName.trim(),
    flowOwnerEmail: draft.flowOwnerEmail.trim(),
    flowOwnerPhone: draft.flowOwnerPhone.trim(),
    startDate: draft.startDate,
    endDate: draft.endDate,
    plan: draft.plan.trim(),
    inputData: draft.inputData.trim(),
    outputData: draft.outputData.trim(),
    steps: cleanSteps(draft.steps),
    painPoints: splitLines(draft.painPoints),
    supports: splitLines(draft.supports),
  })
}

/** 已儲存計劃 → 同一格式簽名（預填之後應該等於 `draftSignature`）。 */
export function savedPlanSignature(plan: AiPlan): string {
  return draftSignature({
    flowOwnerName: plan.flowOwnerName ?? '',
    flowOwnerEmail: plan.flowOwnerEmail ?? '',
    flowOwnerPhone: plan.flowOwnerPhone ?? '',
    startDate: plan.startDate ?? '',
    endDate: plan.endDate ?? '',
    plan: plan.plan,
    inputData: plan.inputData,
    outputData: plan.outputData,
    steps: plan.steps ?? [],
    painPoints: (plan.painPoints ?? []).join('\n'),
    supports: (plan.supports ?? []).join('\n'),
  })
}

/**
 * 一個 partition 嘅日期問題（冇問題就 null）。
 *
 * - `range`：**End date 早過 Start date** → 一定要改，否則個 partition
 *   未開始就會被當成「過期」（真實個案：UAT Start 入錯成 2026-10-01、
 *   End 2026-09-10，令畫面顯示 Overdue）。
 * - `overdue`：End date 已過但 State 唔係 Done → 呢個 partition 會顯示
 *   成 Overdue（提你：真係做完就改 State，未做完就改 End date）。
 */
export interface PartitionDateIssue {
  kind: 'range' | 'overdue'
  message: string
}

export function partitionDateIssue(
  step: AiPlanStep,
  today: string,
): PartitionDateIssue | null {
  const start = (step.startDate ?? '').trim()
  // 只用 dueDate：佢就係「End date」輸入格綁住嘅值（舊資料冇就當未填）
  const end = (step.dueDate ?? '').trim()
  if (start !== '' && end !== '' && end < start) {
    return {
      kind: 'range',
      message: `⚠️ End date (${end}) is earlier than Start date (${start}) — please fix.`,
    }
  }
  if (end !== '' && end < today && (step.state ?? 'planning') !== 'done') {
    return {
      kind: 'overdue',
      message: `⚠️ End date (${end}) has already passed and State is not Done — this partition shows as Overdue.`,
    }
  }
  return null
}
