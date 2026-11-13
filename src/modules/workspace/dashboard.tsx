"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { duration } from "@/modules/dashboard/domain";
import type { Overview } from "./dashboard-types";
const states: Record<string, string> = { NOT_STARTED: "출근 기록 없음", WORKING: "근무 중", ON_BREAK: "휴게 중", FINISHED: "퇴근 완료" };
export function WorkspaceDashboard({ area }: { area: "team" | "admin" }) {
  const [data, setData] = useState<Overview>();
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch(`/api/${area}/dashboard`, { cache: "no-store" });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error);
      setData(value); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "현황 조회에 실패했습니다."); }
    finally { setBusy(false); }
  }, [area]);
  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const interval = setInterval(() => void refresh(), 30000);
    return () => { clearTimeout(first); clearInterval(interval); };
  }, [refresh]);
  const rows = data?.employees.filter(e => (!department || (e.departmentId ?? "unassigned") === department) && (!search || e.name.toLowerCase().includes(search.toLowerCase()))) ?? [];
  const missing = rows.flatMap(e => e.missingDates.map(date => ({ id: `${e.id}-${date}`, name: e.name, date })));
  return <div className="ws-live">
    <p className="ws-live-eyebrow">{area === "admin" ? "ADMIN" : "TEAM"} WORKSPACE</p>
    <h1>{area === "admin" ? "전체 운영 현황" : "우리 부서의 오늘"}</h1>
    <p>{data ? `${data.today} · ${area === "admin" ? "전체 조직" : "담당 부서"}` : "현황을 불러오는 중입니다."}</p>
    <div className="ws-live-filters">
      <label>이름 검색<input type="search" aria-label="이름 검색" placeholder="이름 검색" value={search} onChange={e => setSearch(e.target.value)} /></label>
      <label>부서<select aria-label="부서" value={department} onChange={e => setDepartment(e.target.value)}><option value="">전체 부서</option>{data?.departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}{data?.employees.some(e => e.departmentId === null) && <option value="unassigned">부서 미배정</option>}</select></label>
      <button onClick={() => void refresh()} disabled={busy}>현황 새로고침</button>
    </div>
    {error && <p role="alert">{error}{data && " 이전 조회 결과입니다."}</p>}
    {data && <>
      <div className="ws-live-metrics">
        {[["재직 직원", rows.length], ["근무 중", rows.filter(e => e.state === "WORKING").length], ["휴게 중", rows.filter(e => e.state === "ON_BREAK").length], ["승인 휴가·반차", rows.filter(e => e.onLeave).length], ["미종료 기록", missing.length]].map(([label, count]) => <section key={label} className="ws-live-card"><h2>{label}</h2><strong>{count}{label === "미종료 기록" ? "건" : "명"}</strong></section>)}
      </div>
      <section className="ws-live-card" aria-label="미종료 근무 확인"><h2>미종료 근무 확인</h2>{missing.length ? <ul>{missing.map(m => <li key={m.id}>{m.name} · {m.date} 출근 후 미종료 · 퇴근 누락 여부 확인</li>)}</ul> : <p>이전 근무일의 미종료 기록이 없습니다.</p>}</section>
      {area === "admin" && <section className="ws-live-card" aria-label="부서별 오늘 현황"><h2>부서별 오늘 현황</h2>{[...new Set(rows.map(e => e.department))].map(name => {
        const members = rows.filter(e => e.department === name);
        return <p key={name}>{name} · 직원 {members.length}명 · 근무 중 {members.filter(e => e.state === "WORKING").length}명 · 휴게 중 {members.filter(e => e.state === "ON_BREAK").length}명 · 승인 휴가·반차 {members.filter(e => e.onLeave).length}명</p>;
      })}{!rows.length && <p>조회 결과가 없습니다.</p>}</section>}
      <section className="ws-live-card" aria-label="직원별 근무 현황"><h2>{area === "admin" ? "전체 직원 근무 현황" : "부서원 근무 현황"}</h2>
        <p>서울 시간 · 월~일 {data.from}~{data.to} · 휴게를 제외한 실제 시각 기준</p>
        <div className="ws-live-table"><table><thead><tr><th>직원</th><th>부서</th><th>현재 상태</th><th>오늘 실근로</th><th>이번 주 실근로</th><th>확인 사항</th></tr></thead><tbody>{rows.map(e => <tr key={e.id}><th scope="row">{e.name}</th><td>{e.department}</td><td>{states[e.state]}{e.onLeave && " · 승인 휴가·반차"}</td><td>{duration(e.todayMinutes)}</td><td>{duration(e.weekMinutes)}{e.provisional && " (잠정)"}</td><td>{e.missingDates.length ? `미종료 ${e.missingDates.length}건 · ` : ""}{e.unresolved ? "계산 미확정 항목 있음" : "—"}{e.weekMinutes > 3120 && " · 표시 범위 내 52시간 초과"}</td></tr>)}</tbody></table></div>
        {!rows.length && <p role="status">조회 결과가 없습니다.</p>}
        <p>월~일은 화면 조회 범위입니다. 주 시작일·경보 정책은 미정이며 진행 중 근무는 잠정 집계합니다.</p>
      </section>
      {area === "admin" && <section className="ws-live-card" aria-label="임금·정산 현황"><h2>임금·정산 현황 · 관리자 전용</h2><p>전체 조직 기준 최근 6개 정산 기간 · 직원별 최신 계산 버전</p>
        {!data.settlements?.length ? <p>등록된 정산 기간이 없습니다.</p> : data.settlements.map(s => <div key={s.id} className="ws-live-settlement"><h3>{s.from}~{s.to} (종료일 제외)</h3><p>상태 {s.status === "FINALIZED" ? "확정" : s.status === "CALCULATED" ? "계산 완료" : "진행 중"} · 계산 {s.calculations}명 · 미확정 {s.unresolved}명</p><p>추가 지급액 {s.additionalPay === null ? "미확정" : `${s.additionalPay}원`} · 총액 {s.totalPay === null ? "미확정" : `${s.totalPay}원`}</p></div>)}
        <p>저장된 계산 대상의 합계입니다. 미등록 직원의 임금은 포함하지 않습니다.</p><Link href="/admin/settlements">정산 목록 보기 →</Link>
      </section>}
      <p className="ws-live-note">실제 DB 조회 · {new Date(data.asOf).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} 기준 · 30초마다 갱신</p>
    </>}
  </div>;
}
