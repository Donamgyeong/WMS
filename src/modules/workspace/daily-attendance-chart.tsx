import type { ManagementRow } from "./management-types";

const metrics = ["실근로", "연장", "야간", "휴일"];

export function DailyAttendanceChart({ rows, onSelect }: { rows: ManagementRow[]; onSelect: (row: ManagementRow) => void }) {
  const maximum = Math.max(480, ...rows.flatMap(row => row.dailyMinutes ?? []).map(value => value ?? 0));
  return <section className="ws-live-card" aria-label="일별 집계">
    <h2>일별 집계</h2>
    <p>날짜별 근로시간 · 공통 눈금 0~{Math.round(maximum / 60 * 10) / 10}시간 · 날짜를 누르면 상세 기록을 확인합니다.</p>
    <p>연장·야간·휴일은 서로 겹칠 수 있으며 실근로에 더하지 않습니다. 미종료 근무는 잠정 집계입니다.</p>
    {rows.length ? <ul className="ws-daily-chart" aria-label="일별 근로시간 막대그래프">
      {rows.map(row => <li key={row.id}>
        <button type="button" className="ws-daily-date" onClick={() => onSelect(row)} aria-label={`${row.workDate} 근태 상세 선택`}>{row.workDate}</button>
        <div className="ws-daily-metrics">{metrics.map((metric, index) => {
          const value = row.dailyMinutes?.[index] ?? null;
          return <div className="ws-daily-metric" key={metric}>
            <span>{metric}</span>
            <span className="ws-daily-track" aria-hidden="true"><span className={`ws-daily-bar ws-daily-bar-${index}`} style={{ width: `${value === null ? 0 : value / maximum * 100}%` }} /></span>
            <span>{value === null ? "미확정" : row.cells[index + 2]}</span>
          </div>;
        })}</div>
      </li>)}
    </ul> : <p>조회 결과가 없습니다.</p>}
  </section>;
}
