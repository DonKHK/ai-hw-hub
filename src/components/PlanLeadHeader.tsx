import type { AiPlanLead } from '../types'

interface PlanLeadHeaderProps {
  /** 部門（由 Firebase／登入身份帶入） */
  unit: string
  value: AiPlanLead
  onChange: (lead: AiPlanLead) => void
  /** 額外提示（例：wizard 顯示「已揀 N 條 workflow」） */
  hint?: string
}

/**
 * 「逐條填 AI 計劃」頁頭卡。
 *
 * 總負責人係**整份提交共用** —— 填一次就夠，因為之後所有 AI 化 flow
 * 都係同一個人做總負責。每條 flow 自己嘅負責人就喺表單第一張卡逐條填
 * （因為每條 flow 可以唔同人做）。
 */
export default function PlanLeadHeader({
  unit,
  value,
  onChange,
  hint,
}: PlanLeadHeaderProps) {
  function patch(part: Partial<AiPlanLead>) {
    onChange({ ...value, ...part })
  }

  return (
    <section className="card plan-lead-head">
      <div className="plan-lead-title">
        <div>
          <p className="plan-lead-label">Unit</p>
          <p className="plan-lead-unit">{unit === '' ? '—' : unit}</p>
        </div>
        <h1 className="plan-lead-app">AI Homework</h1>
      </div>

      {hint !== undefined && <p className="muted hint-text">{hint}</p>}

      <div className="plan-lead-grid">
        <label className="field">
          <span>Overall Person Responsible (full name)</span>
          <input
            className="input"
            type="text"
            value={value.name}
            onChange={(event) => patch({ name: event.target.value })}
            placeholder="e.g. Tai Man Chan"
          />
        </label>
        <label className="field">
          <span>Email</span>
          <input
            className="input"
            type="email"
            value={value.email}
            onChange={(event) => patch({ email: event.target.value })}
            placeholder="e.g. taiman.chan@aai.com"
          />
        </label>
        <label className="field">
          <span>Phone</span>
          <input
            className="input"
            type="tel"
            value={value.phone}
            onChange={(event) => patch({ phone: event.target.value })}
            placeholder="e.g. 9123 4567"
          />
        </label>
      </div>
    </section>
  )
}
