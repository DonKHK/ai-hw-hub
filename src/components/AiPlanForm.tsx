import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  getPlanByWorkflow,
  lastPlanWriteError,
  markSelected,
  savePlan,
} from '../services/aiPlanService'
import { diffPlanChanges } from '../lib/planDiff'
import {
  cleanSteps,
  draftSignature,
  partitionDateIssue,
  savedPlanSignature,
  splitLines,
} from '../lib/planDraft'
import type { PartitionDateIssue, PlanDraft } from '../lib/planDraft'
import { todayIso } from '../lib/planStatus'
import { AI_PLAN_STEP_STATE_LABELS } from '../types'
import type {
  AiPlan,
  AiPlanLead,
  AiPlanStatus,
  AiPlanStep,
  AiPlanStepState,
} from '../types'

/**
 * Workflow AI 化嘅固定 partition（順序有意義）。
 * 整個 AI 化會被分為：AI Idea → POC → UAT → IT Inspection → Handover。
 */
const DEFAULT_TEMPLATE_STEPS = [
  'AI Idea',
  'POC',
  'UAT',
  'IT Inspection',
  'Handover to User',
]

/** Partition State 下拉選項。 */
const STEP_STATE_OPTIONS: AiPlanStepState[] = [
  'planning',
  'in_progress',
  'done',
  'on_hold',
]

function newStep(name: string): AiPlanStep {
  return {
    name,
    due: '',
    dueDate: null,
    startDate: null,
    state: 'planning',
    detail: '',
  }
}

/** 預設 5 個固定 partition。 */
function defaultSteps(): AiPlanStep[] {
  return DEFAULT_TEMPLATE_STEPS.map((name) => newStep(name))
}

/**
 * 「新計劃」嘅初始表單內容 —— 用嚟做「有冇未儲存改動」嘅基準。
 * （冇交過嘅 flow 會帶預設 5 個 partition，所以基準要同 prefill 一致。）
 */
function emptyDraft(): PlanDraft {
  return {
    flowOwnerName: '',
    flowOwnerEmail: '',
    flowOwnerPhone: '',
    startDate: '',
    endDate: '',
    plan: '',
    inputData: '',
    outputData: '',
    steps: defaultSteps(),
    painPoints: '',
    supports: '',
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again later.'
}

/**
 * 表單只需要 code／name／unit。
 * 用結構型別（唔綁死 LocalInventoryItem），令 Portal 快照嘅 `WorkflowItem`
 * 都直接傳得入 —— 佢嘅 unit 係 optional。
 */
interface AiPlanWorkflow {
  code: string
  name: string
  unit?: string
}

interface AiPlanFormProps {
  workflow: AiPlanWorkflow
  /** 邊個身份填（portal identity id 或 "fb:<uid>"） */
  ownerId: string
  /** 邊個身份填（顯示名；寫入記錄方便 dashboard 顯示） */
  ownerName?: string
  /**
   * 頁頭「總負責人」（整份提交共用，由頁面持有 state）。
   * 填一次就夠 —— 所有 AI 化 flow 都係同一個人做總負責。
   */
  lead: AiPlanLead
  /** 呢條 flow 之前交過未（顯示「已交過，可以再改」chip） */
  alreadySaved?: boolean
  /** 儲存成功後回調（傳返啱啱存好嘅計劃） */
  onSaved: (saved: AiPlan) => void
  /**
   * 「有未儲存改動」狀態變更通知（可選）。
   * 頁面用嚟喺 Back／Cancel 之前確認 —— 防止改完未儲存就跳走（真實個案：
   * 用戶改咗但兩次儲存都係 `Saved (no changes)`）。
   * ⚠️ 傳入嘅 callback 要保持穩定 identity（例如 useCallback），唔係會每個 render 都叫一次。
   */
  onDirtyChange?: (dirty: boolean) => void
}

/**
 * 「AI 計劃」表單（可重用）。
 * - 單條 workflow 頁（AiPlanPage）用
 * - 多選 workflow wizard（AiPlanWizardPage）逐條用
 */
export default function AiPlanForm({
  workflow,
  ownerId,
  ownerName = '',
  lead,
  alreadySaved = false,
  onSaved,
  onDirtyChange,
}: AiPlanFormProps) {
  // 卡1：呢條 flow 嘅負責人（每條 flow 可以唔同人，所以要逐條填）
  const [flowOwnerName, setFlowOwnerName] = useState('')
  const [flowOwnerEmail, setFlowOwnerEmail] = useState('')
  const [flowOwnerPhone, setFlowOwnerPhone] = useState('')
  // 卡2：計劃開始／完成時間
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [plan, setPlan] = useState('')
  const [inputData, setInputData] = useState('')
  const [outputData, setOutputData] = useState('')
  const [steps, setSteps] = useState<AiPlanStep[]>(defaultSteps)
  const [painPoints, setPainPoints] = useState('')
  const [supports, setSupports] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Firestore 寫入失敗嘅提示（唔會阻止儲存，但要話俾用戶知只存咗本機）
  const [storeWarning, setStoreWarning] = useState<string | null>(null)
  // 🆕 V2：由 Firestore 載入嘅原始版本（用嚟計「未儲存改動」同「儲存結果」）
  const [baseline, setBaseline] = useState<AiPlan | null>(null)
  const [savedSignature, setSavedSignature] = useState<string | null>(null)
  /** 儲存結果（null = 今次入頁後未儲存過）：變更項目清單（空 = 冇任何變更） */
  const [saveResult, setSaveResult] = useState<{ changes: string[] } | null>(null)
  const today = todayIso()

  // 冇交過就帶預設 5 個 partition；有就 prefill
  useEffect(() => {
    let cancelled = false
    getPlanByWorkflow(ownerId, workflow.code)
      .then((existing) => {
        if (cancelled) {
          return
        }
        if (existing !== null) {
          setFlowOwnerName(existing.flowOwnerName ?? '')
          setFlowOwnerEmail(existing.flowOwnerEmail ?? '')
          setFlowOwnerPhone(existing.flowOwnerPhone ?? '')
          setStartDate(existing.startDate ?? '')
          setEndDate(existing.endDate ?? '')
          setPlan(existing.plan)
          setInputData(existing.inputData)
          setOutputData(existing.outputData)
          // 有 partition 就照用；「揀咗未填」嘅空記錄就帶返預設 5 個
          setSteps(existing.steps.length > 0 ? existing.steps : defaultSteps())
          setPainPoints(existing.painPoints.join('\n'))
          setSupports(existing.supports.join('\n'))
        } else {
          setSteps(defaultSteps())
          // 標記「已揀 flow」（唔會覆蓋已有記錄）→ dashboard 分得出
          // 「揀咗但未填」同「完全未開始」
          void markSelected({
            ownerId,
            ownerName: ownerName === '' ? ownerId : ownerName,
            workflowCode: workflow.code,
            workflowName: workflow.name,
            unit: workflow.unit ?? '',
          }).catch(() => {})
        }
        // 🆕 V2：記住「已載入嘅版本」同佢嘅簽名 ——
        //    之後用嚟計「未儲存改動」同「儲存咗幾多項變更」。
        setBaseline(existing)
        setSavedSignature(
          existing !== null
            ? savedPlanSignature(existing)
            : draftSignature(emptyDraft()),
        )
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [ownerId, ownerName, workflow.code, workflow.name, workflow.unit])

  /** 表單現時內容嘅簽名（同 `savedSignature` 比較就知有冇未儲存改動）。 */
  const currentSignature = useMemo(
    () =>
      draftSignature({
        flowOwnerName,
        flowOwnerEmail,
        flowOwnerPhone,
        startDate,
        endDate,
        plan,
        inputData,
        outputData,
        steps,
        painPoints,
        supports,
      }),
    [
      flowOwnerName,
      flowOwnerEmail,
      flowOwnerPhone,
      startDate,
      endDate,
      plan,
      inputData,
      outputData,
      steps,
      painPoints,
      supports,
    ],
  )

  /** 有未儲存改動？（prefill 完成前唔計，避免一開頁就誤報） */
  const dirty = savedSignature !== null && currentSignature !== savedSignature

  /** V1：有「End date 早過 Start date」嘅 partition（呢個要用家改，唔可以當冇事）。 */
  const rangeIssues = useMemo(
    () =>
      steps
        .map((step) => partitionDateIssue(step, today))
        .filter(
          (issue): issue is PartitionDateIssue =>
            issue !== null && issue.kind === 'range',
        ),
    [steps, today],
  )

  // 🆕 V2：有未儲存改動時，reload／閂 tab 會彈瀏覽器確認
  //    （唔會再靜靜咁丟失編輯 —— 之前「兩次 Saved (no changes)」就係咁發生）
  useEffect(() => {
    if (!dirty) {
      return
    }
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      // 舊瀏覽器要設 returnValue 才會彈
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [dirty])

  // 通知頁面（令 Back／Cancel 之前可以確認）—— 頁面用 ref 接，唔會 re-render
  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  /** 更新一個 partition 嘅欄位。 */
  function updateStep(index: number, patch: Partial<AiPlanStep>) {
    setSteps((previous) =>
      previous.map((step, i) => (i === index ? { ...step, ...patch } : step)),
    )
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    if (plan.trim() === '') {
      setError('Please fill in "What is your plan? — How will AI help this workflow?".')
      return
    }
    // 🆕 V2：清走上一次嘅儲存結果（今次會重新計）
    setSaveResult(null)
    // ⚠️ Firestore 唔接受 undefined → 每個欄位都要有實際值（'' / null）
    //    （正規化規則同 `planDraft.cleanSteps()` 共用 → 簽名／diff／儲存一定一致）
    const cleanedSteps: AiPlanStep[] = cleanSteps(steps)
    if (cleanedSteps.length === 0) {
      setError('No partition data found. Please reload and try again.')
      return
    }
    // 所有 partition 都 Done = 計劃完成（監控 dashboard 用呢個狀態）
    const derivedStatus: AiPlanStatus = cleanedSteps.every(
      (step) => step.state === 'done',
    )
      ? 'done'
      : 'in_progress'

    const payload = {
      workflowCode: workflow.code,
      workflowName: workflow.name,
      unit: workflow.unit ?? '',
      ownerId,
      ownerName: ownerName === '' ? ownerId : ownerName,
      // 頁頭：總負責人（整份提交共用，填一次）
      leadName: lead.name.trim(),
      leadEmail: lead.email.trim(),
      leadPhone: lead.phone.trim(),
      // 卡1：呢條 flow 嘅負責人（逐條唔同）
      flowOwnerName: flowOwnerName.trim(),
      flowOwnerEmail: flowOwnerEmail.trim(),
      flowOwnerPhone: flowOwnerPhone.trim(),
      // 卡2：計劃時間
      startDate: startDate === '' ? null : startDate,
      endDate: endDate === '' ? null : endDate,
      plan: plan.trim(),
      inputData: inputData.trim(),
      outputData: outputData.trim(),
      steps: cleanedSteps,
      status: derivedStatus,
      painPoints: splitLines(painPoints),
      supports: splitLines(supports),
    }
    // 🆕 V2：同「已載入嘅版本」比較 —— 0 項 = 今次送出嘅內容同雲端一模一樣
    //    （即係改動根本冇入到表單；唔可以再當「已更新」）
    const changeLabels = diffPlanChanges(baseline, payload).map(
      (change) => change.label,
    )

    setSaving(true)
    try {
      const saved = await savePlan(payload)
      // Firestore 寫入失敗時（靜默 fallback 落本機）要大聲講出嚟
      setStoreWarning(lastPlanWriteError())
      // 🆕 V2：儲存結果（0 項 = 送出嘅內容同雲端一模一樣 → 改動冇入到表單）
      setSaveResult({ changes: changeLabels })
      setBaseline(saved)
      setSavedSignature(currentSignature)
      onSaved(saved)
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="field-stack" onSubmit={handleSubmit}>

      {/* ── 卡1：Work Flow 資料（由 Firebase 帶入，只顯示唔可改）── */}
      <section className="card">
        <h2>Work Flow details</h2>
        <div className="field-row">
          <div className="field">
            <span>Work Flow Name</span>
            <p className="flow-readonly">
              {workflow.name}
              {alreadySaved && (
                <span className="chip chip-done flow-badge">
                  Already submitted — you can edit it
                </span>
              )}
            </p>
          </div>
          <div className="field">
            <span>Unit</span>
            <p className="flow-readonly">{workflow.unit ?? '—'}</p>
          </div>
        </div>
        <div className="field-row">
          <label className="field">
            <span>Work Flow Person Responsible (full name)</span>
            <input
              className="input"
              type="text"
              value={flowOwnerName}
              onChange={(event) => setFlowOwnerName(event.target.value)}
              placeholder="e.g. Tai Man Chan"
            />
          </label>
          <label className="field">
            <span>Email</span>
            <input
              className="input"
              type="email"
              value={flowOwnerEmail}
              onChange={(event) => setFlowOwnerEmail(event.target.value)}
              placeholder="e.g. taiman.chan@aai.com"
            />
          </label>
          <label className="field">
            <span>Phone</span>
            <input
              className="input"
              type="tel"
              value={flowOwnerPhone}
              onChange={(event) => setFlowOwnerPhone(event.target.value)}
              placeholder="e.g. 9123 4567"
            />
          </label>
        </div>
      </section>

      {/* ── 卡2：計劃內容 ── */}
      <section className="card">
        <h2>Plan details</h2>
        <div className="field-row">
          <label className="field">
            <span>Start date</span>
            <input
              className="input"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </label>
          <label className="field">
            <span>End date</span>
            <input
              className="input"
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </label>
        </div>
        <label className="field">
          <span>What is your plan? — How will AI help this workflow?</span>
          <textarea
            className="input input-area"
            value={plan}
            onChange={(event) => setPlan(event.target.value)}
            placeholder="e.g. Use AI to assess funding-application eligibility and draft the first version…"
            required
          />
        </label>
        <label className="field">
          <span>Input Data — What data goes in, and where does it come from?</span>
          <textarea
            className="input input-area"
            value={inputData}
            onChange={(event) => setInputData(event.target.value)}
            placeholder="e.g. Government funding application PDFs, company financial data…"
          />
        </label>
        <label className="field">
          <span>
            Output Data — What comes out, and who or where uses it?
          </span>
          <textarea
            className="input input-area"
            value={outputData}
            onChange={(event) => setOutputData(event.target.value)}
            placeholder="e.g. An eligibility checklist, a draft application, risk alerts…"
          />
        </label>
        <label className="field">
          <span>Pain Point — Expected pain points</span>
          <textarea
            className="input input-area"
            value={painPoints}
            onChange={(event) => setPainPoints(event.target.value)}
            placeholder="One per line. e.g. Slow manual approvals, inconsistent file formats…"
          />
        </label>
        <label className="field">
          <span>Resources needed (beyond funding)</span>
          <textarea
            className="input input-area"
            value={supports}
            onChange={(event) => setSupports(event.target.value)}
            placeholder="One per line. e.g. Support from the AI team, database access, training…"
          />
        </label>
      </section>

      {/* ── 卡3：Workflow AI 化嘅 Partition（固定 5 個，唔可以加減）── */}
      <section className="card">
        <h2>Work Flow AI partitions</h2>
        <p className="muted hint-text">
          The AI transformation is split into{' '}
          {DEFAULT_TEMPLATE_STEPS.join(' → ')}. For each partition, fill in the
          start date, end date, state and details.
        </p>

        {steps.map((step, index) => {
          const stepState = step.state ?? 'planning'
          // 🆕 V1：日期問題（End 早過 Start／已過期但未 Done）即時提示
          const dateIssue = partitionDateIssue(step, today)
          return (
            <div className="partition-card" key={index}>
              <div className="partition-head">
                <h3>
                  {index + 1}. {step.name}
                </h3>
                <span className={`state-chip state-${stepState}`}>
                  {AI_PLAN_STEP_STATE_LABELS[stepState]}
                </span>
              </div>

              <div className="partition-dates">
                <label className="field">
                  <span>Start date</span>
                  <input
                    className="input"
                    type="date"
                    value={step.startDate ?? ''}
                    onChange={(event) =>
                      updateStep(index, {
                        startDate:
                          event.target.value === '' ? null : event.target.value,
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>End date</span>
                  <input
                    className="input"
                    type="date"
                    value={step.dueDate ?? ''}
                    onChange={(event) => {
                      const value =
                        event.target.value === '' ? null : event.target.value
                      // due 保留做向後兼容（舊版 dashboard 讀佢）
                      updateStep(index, { due: value ?? '', dueDate: value })
                    }}
                  />
                </label>
                <label className="field">
                  <span>State</span>
                  <select
                    className="input select-input"
                    value={stepState}
                    onChange={(event) =>
                      updateStep(index, {
                        state: event.target.value as AiPlanStepState,
                      })
                    }
                  >
                    {STEP_STATE_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {AI_PLAN_STEP_STATE_LABELS[option]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {dateIssue !== null && (
                <p className="field-warning">{dateIssue.message}</p>
              )}

              <label className="field">
                <span>Details</span>
                <textarea
                  className="input input-area"
                  value={step.detail ?? ''}
                  onChange={(event) =>
                    updateStep(index, { detail: event.target.value })
                  }
                  placeholder="What will this partition do?"
                />
              </label>
            </div>
          )
        })}
      </section>

      {error !== null && <p className="error-text">{error}</p>}

      {/* ── V1：End date 早過 Start date（要即刻改，否則未開始就當過期）── */}
      {rangeIssues.length > 0 && (
        <p className="form-status form-status-danger">
          ⚠️ {rangeIssues.length} partition(s) have an End date earlier than the
          Start date — see the note on the partition card above. This is usually
          a typing mistake, and it makes the partition look overdue before it
          even starts.
        </p>
      )}

      {/* ── V2：未儲存改動（reload／閂 tab 前亦會彈瀏覽器確認）── */}
      {dirty && (
        <p className="form-status form-status-warn">
          ● Unsaved changes — click Edit and Save (bottom) to store them.
          Reloading or leaving this page without saving will lose them.
        </p>
      )}

      {/* ── V2：儲存結果（0 項 = 送出嘅內容同雲端一模一樣）── */}
      {saveResult !== null && (
        <p
          className={
            'form-status ' +
            (saveResult.changes.length === 0
              ? 'form-status-warn'
              : 'form-status-ok')
          }
        >
          {saveResult.changes.length === 0
            ? '⚠️ Saved, but nothing changed — the data sent was identical to what is already stored. If you expected a change, it never reached the form (this happens when the page was reloaded before saving). Please re-enter it and save again.'
            : `✅ Saved — ${saveResult.changes.length} change(s) recorded: ${saveResult.changes.slice(0, 3).join(', ')}${saveResult.changes.length > 3 ? ', …' : ''}`}
        </p>
      )}

      {storeWarning !== null && (
        <p className="form-status form-status-danger">
          ⚠️ The plan was saved, but only on this device (the Firestore write
          failed). {storeWarning}
        </p>
      )}

      <div className="ai-plan-actions">
        <button
          type="submit"
          className="btn btn-primary"
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Edit and Save'}
        </button>
      </div>

    </form>
  )
}
