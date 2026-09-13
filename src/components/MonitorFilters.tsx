/** 監控 dashboard 嘅篩選選項。 */
export type MonitorFilterKey =
  | 'all'
  | 'action'
  | 'overdue'
  | 'dueSoon'
  | 'selected'
  | 'not_started'
  | 'in_progress'
  | 'done'

const OPTIONS: Array<{ key: MonitorFilterKey; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'action', label: 'Needs action' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'dueSoon', label: 'Due soon' },
  { key: 'selected', label: 'Selected, not filled' },
  { key: 'not_started', label: 'Not started' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'done', label: 'Completed' },
]

interface MonitorFiltersProps {
  value: MonitorFilterKey
  counts: Record<MonitorFilterKey, number>
  onChange: (key: MonitorFilterKey) => void
}

/** 篩選掣（重用 index.css 已有嘅 .wizard-chip 樣式）。 */
export default function MonitorFilters({
  value,
  counts,
  onChange,
}: MonitorFiltersProps) {
  return (
    <div className="filter-row">
      {OPTIONS.map((option) => (
        <button
          key={option.key}
          type="button"
          className={
            value === option.key
              ? 'wizard-chip wizard-chip-active'
              : 'wizard-chip'
          }
          onClick={() => onChange(option.key)}
        >
          {option.label}（{counts[option.key] ?? 0}）
        </button>
      ))}
    </div>
  )
}
