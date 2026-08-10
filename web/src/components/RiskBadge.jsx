/**
 * 风险徽标。
 *
 * 三重信号：颜色 + 文字 + （critical 时）锁图标。
 * 只靠颜色传达状态对色觉障碍用户等于没传达，所以文字标签是必须的，不是装饰。
 */

const TONE = {
  critical: 'text-risk-critical bg-risk-critical-bg',
  high: 'text-risk-high bg-risk-high-bg',
  medium: 'text-risk-medium bg-risk-medium-bg',
  low: 'text-risk-low bg-risk-low-bg',
};

function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M4.5 7V5.2a3.5 3.5 0 0 1 7 0V7M3.6 7h8.8v6H3.6z" strokeLinejoin="round" />
    </svg>
  );
}

export default function RiskBadge({ analysis }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-medium ${TONE[analysis.risk] || TONE.low}`}
    >
      {analysis.risk === 'critical' && <LockIcon />}
      {analysis.riskLabel}
    </span>
  );
}
