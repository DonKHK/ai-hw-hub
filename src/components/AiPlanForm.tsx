import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  getPlanByWorkflow,
  lastPlanWriteError,
  markSelected,
  savePlan,
} from '../services/aiPlanService'
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
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [ownerId, ownerName, workflow.code, workflow.name, workflow.unit])

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
    // ⚠️ Firestore 唔接受 undefined → 每個欄位都要有實際值（'' / null）
    const cleanedSteps: AiPlanStep[] = steps
      .map((step) => ({
        name: step.name.trim(),
        due: step.dueDate ?? '',
        dueDate: step.dueDate ?? null,
        startDate: step.startDate ?? null,
        state: step.state ?? 'planning',
        detail: (step.detail ?? '').trim(),
      }))
      .filter((step) => step.name !== '')
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
    const splitLines = (text: string) =>
      text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '')

    setSaving(true)
    try {
      const saved = await savePlan({
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
      })
      // Firestore 寫入失敗時（靜默 fallback 落本機）要大聲講出嚟
      setStoreWarning(lastPlanWriteError())
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

      {storeWarning !== null && (
        <p className="error-text">
          ⚠️ The plan was saved, but only on this device (the Firestore write failed).
          {storeWarning}
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
