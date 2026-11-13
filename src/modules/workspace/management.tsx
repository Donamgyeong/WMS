"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { dashboardRange } from "@/modules/dashboard/domain";
import type { WorkspaceRoute } from "./routes";
import type { ManagementData, ManagementQuery, ManagementRow, ManagementSection } from "./management-types";

export function WorkspaceManagement({ area, route }: { area: "team" | "admin"; route: WorkspaceRoute }) {
  const params = useSearchParams();
  const [query, setQuery] = useState<ManagementQuery>(() => {
    const range = dashboardRange(new Date());
    const rawDate = params.get("workDate");
    const workDate = rawDate && /^20\d\d-\d{2}-\d{2}$/.test(rawDate) && Number.isFinite(Date.parse(`${rawDate}T00:00:00Z`)) && new Date(`${rawDate}T00:00:00Z`).toISOString().slice(0, 10) === rawDate ? rawDate : undefined;
    return { from: workDate ?? (area === "team" ? range.from : `${range.today.slice(0, 7)}-01`), to: workDate ? new Date(new Date(`${workDate}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10) : range.upcomingTo, employeeId: params.get("employeeId") ?? undefined, workDate };
  });
  const [from, setFrom] = useState(query.from), [to, setTo] = useState(query.to);
  const [data, setData] = useState<ManagementData>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("");
  const [status, setStatus] = useState("");
  const controller = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    controller.current?.abort();
    const active = new AbortController(); controller.current = active;
    setBusy(true); setError("");
    try {
      const searchParams = new URLSearchParams({ from: query.from, to: query.to });
      for (const k of ["employeeId", "workDate", "calculationId"] as const) if (query[k]) searchParams.set(k, query[k]!);
      const response = await fetch(`/api/${area}/management/${route.key}?${searchParams}`, { cache: "no-store", signal: active.signal });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error);
      if (!active.signal.aborted) setData(value);
    } catch (e) { if (!active.signal.aborted) { setData(undefined); setError(e instanceof Error ? e.message : "조회에 실패했습니다."); } }
    finally { if (!active.signal.aborted) setBusy(false); }
  }, [area, route.key, query]);
  useEffect(() => { const first = setTimeout(() => void refresh(), 0); return () => { clearTimeout(first); controller.current?.abort(); }; }, [refresh]);
  const attendance = ["team-attendance", "team-detail", "admin-attendance"].includes(route.key);
  const selectedPeople = data?.employees.filter(p => (!department || (p.departmentId ?? "unassigned") === department)) ?? [];
  const allowedIds = new Set(selectedPeople.map(p => p.id));
  const filter = (row: ManagementRow) => (!row.employeeId || allowedIds.has(row.employeeId)) && (!status || row.cells.some(c => c.includes(status))) && (!search || row.cells.join(" ").toLowerCase().includes(search.toLowerCase()));
  function selectRecord(record: ManagementRow) {
    setNotice(""); setData(undefined); setQuery(q => ({ ...q, employeeId: record.employeeId ?? q.employeeId, workDate: record.workDate, calculationId: record.calculationId }));
  }
  async function recalculate() {
    if (!query.employeeId || !query.workDate || recalculating) return;
    setRecalculating(true); setNotice(""); setError("");
    try {
      const end = new Date(new Date(`${query.workDate}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
      const response = await fetch("/api/admin/worktime/recalculate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employeeId: query.employeeId, from: query.workDate, to: end }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setNotice(result.sessions.length ? "재계산을 완료했습니다. 원본과 이전 버전을 보존했습니다." : "재계산할 세션이 없습니다.");
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "재계산에 실패했습니다."); }
    finally { setRecalculating(false); }
  }
  return <div className="ws-live">
    <p className="ws-live-eyebrow">{area === "admin" ? "ADMIN" : "TEAM"} WORKSPACE</p><h1>{route.title}</h1>
    <p>서울 시간 기준 실제 저장 데이터 · 등록되지 않은 기록은 추정하지 않습니다.</p>
    <form className="ws-live-filters" onSubmit={e => { e.preventDefault(); setNotice(""); setQuery(q => ({ ...q, from, to, workDate: undefined, calculationId: undefined })); }}>
      <label>시작일<input type="date" required aria-label="시작일" value={from} onChange={e => setFrom(e.target.value)} /></label>
      <label>종료일 (제외)<input type="date" required aria-label="종료일" value={to} onChange={e => setTo(e.target.value)} /></label>
      <button type="submit" disabled={busy}>기간 조회</button><button type="button" disabled={busy} onClick={() => void refresh()}>다시 조회</button>
    </form>
    <div className="ws-live-filters">
      <label>직원<select aria-label="직원" value={query.employeeId ?? ""} onChange={e => { setData(undefined); setQuery(q => ({ ...q, employeeId: e.target.value || undefined, workDate: undefined, calculationId: undefined })); }}><option value="">직원 전체</option>{data?.employees.map(p => <option key={p.id} value={p.id}>{p.name} · {p.department}</option>)}</select></label>
      <label>이름·내용 검색<input type="search" aria-label="이름·내용 검색" value={search} onChange={e => setSearch(e.target.value)} /></label>
      <label>부서<select aria-label="부서" value={department} onChange={e => setDepartment(e.target.value)}><option value="">전체 부서</option>{data?.departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}{data?.employees.some(p => p.departmentId === null) && <option value="unassigned">부서 미배정</option>}</select></label>
      {attendance && <label>상태<select aria-label="상태" value={status} onChange={e => setStatus(e.target.value)}><option value="">상태 전체</option><option value="WORKING">근무 중</option><option value="ON_BREAK">휴게 중</option><option value="FINISHED">퇴근 완료</option><option value="OPEN_SESSION">미종료</option></select></label>}
    </div>
    {busy && <p role="status">조회 중입니다.</p>}{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {query.workDate && <section className="ws-live-card"><h2>선택 근무일 {query.workDate}</h2><p>{data?.employees.find(p => p.id === query.employeeId)?.name ?? ""}</p><div className="ws-inline-actions"><button onClick={() => setQuery(q => ({ ...q, workDate: undefined, calculationId: undefined }))}>전체 기록 보기</button>{area === "admin" && attendance && <button disabled={busy || recalculating} onClick={() => void recalculate()}>선택 근무일 재계산</button>}{area === "team" && route.key !== "team-detail" && <Link href={`/team/attendance/detail?employeeId=${encodeURIComponent(query.employeeId ?? "")}&workDate=${query.workDate}`}>근태 상세 페이지 →</Link>}</div></section>}
    {data && <>
      {attendance && <p>출근일 기준 집계입니다. 미종료 근무는 현재 시각까지 잠정 계산합니다. 야간 종료·주 시작일·정정 반영 등 미정 사항은 미확정 사유에 표시합니다. 기록의 ‘선택’을 누르면 원본·정정·계산 이력을 확인할 수 있습니다.</p>}
      {route.key.endsWith("calendar") && <p>토·일을 자동 휴일로 취급하지 않습니다. 휴일 적용은 직원별 캘린더 배정 기간 기준입니다.</p>}
      {route.key === "admin-contracts" && <p>시급·계약 이력은 전체 유효 기간을 보존해 표시합니다. 유효 여부 기준일: {data.from}. 종료일은 제외합니다.</p>}
      {route.key === "admin-settings" && <p>PC는 허용 CIDR, 모바일은 GPS 100m 검증을 사용합니다. 미정 정책은 수정하지 않습니다.</p>}
      {route.key === "admin-settlements" && <p>저장된 계산 결과를 조회합니다. 미확정 금액은 0원이 아닙니다. 원본 스냅샷·이전 버전과 별도 조정 이력을 보존합니다. 목록의 ‘선택’으로 계산 근거를 확인하세요.</p>}
      {data.sections.map(section => <ManagementTable key={`${route.key}-${section.title}`} section={section} rows={section.rows.filter(filter)} onSelect={selectRecord} />)}
      <section className="ws-live-card" aria-label="미구현 기능"><h2>미구현 기능</h2><ul>{data.unavailable.map(item => <li key={item}>{item}</li>)}</ul><p>등록·수정·승인 처리는 제공되지 않습니다.</p></section>
      <p className="ws-live-note">실제 DB 조회 · {new Date(data.asOf).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} 기준 · 시작일 포함·종료일 제외 · 최대 366일</p>
    </>}
  </div>;
}
function ManagementTable({ section, rows, onSelect }: { section: ManagementSection; rows: ManagementRow[]; onSelect: (row: ManagementRow) => void }) {
  const [page, setPage] = useState(0);
  const max = Math.max(0, Math.ceil(rows.length / 30) - 1), current = Math.min(page, max);
  const actionable = rows.some(r => r.workDate && r.employeeId || r.calculationId);
  return <section className="ws-live-card" aria-label={section.title}><h2>{section.title}</h2><p>{rows.length}건</p>
    {rows.length ? <><div className="ws-live-table"><table><thead><tr>{section.columns.map(c => <th key={c}>{c}</th>)}{actionable && <th>상세</th>}</tr></thead><tbody>{rows.slice(current * 30, (current + 1) * 30).map(r => <tr key={r.id}>{r.cells.map((c, i) => <td key={i}>{c.length > 80 ? <details><summary>전체 내용 보기</summary><pre className="ws-live-json">{c}</pre></details> : c}</td>)}{actionable && <td>{(r.workDate && r.employeeId || r.calculationId) && <button onClick={() => onSelect(r)} aria-label={`${r.cells[0]} ${r.workDate ?? "정산"} 선택`}>선택</button>}</td>}</tr>)}</tbody></table></div>{max > 0 && <div className="ws-inline-actions"><button disabled={current === 0} onClick={() => setPage(current - 1)}>이전</button><span>{current + 1}/{max + 1} 페이지</span><button disabled={current === max} onClick={() => setPage(current + 1)}>다음</button></div>}</> : <p>조회 결과가 없습니다.</p>}
  </section>;
}
