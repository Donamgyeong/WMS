"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./client.module.css";
import type { EventType, Input, State } from "./domain";
type Status = { state: State; canStartNewSession: boolean; workDate: string; clockInAt: string | null; actualWorkMinutes: number; breakMinutes: number; needsReview: boolean; events: { id: string; eventType: EventType; occurredAt: string; source: string }[]; workplaces: { id: string; name: string }[] };
const labels: Record<EventType, string> = { CLOCK_IN: "출근하기", CLOCK_OUT: "퇴근하기", BREAK_START: "휴게 시작", BREAK_END: "휴게 종료" };
const states = { NOT_STARTED: "출근 전", WORKING: "근무 중", ON_BREAK: "휴게 중", FINISHED: "퇴근 완료" };
function duration(minutes: number) { return `${Math.floor(minutes / 60)}시간 ${Math.floor(minutes % 60)}분`; }
function time(at: string) { return new Date(at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }); }
export function AttendancePanel({ onRecorded }: { onRecorded?: () => Promise<void> } = {}) {
  const [data, setData] = useState<Status>();
  const [place, setPlace] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(false);
  const pending = useRef<Input | null>(null);
  const acting = useRef(false);
  const mobile = useRef(false);
  const refresh = useCallback(async () => {
    const response = await fetch("/api/attendance/status", { cache: "no-store" });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error);
    setData(value);
    setPlace(current => current || value.workplaces[0]?.id || "");
  }, []);
  useEffect(() => {
    const initial = setTimeout(() => { void refresh().catch(e => setError(e.message)); }, 0);
    const interval = setInterval(() => { void refresh().catch(e => setError(e.message)); }, 30000);
    return () => { clearTimeout(initial); clearInterval(interval); };
  }, [refresh]);
  async function submit(eventType?: EventType) {
    if (acting.current) return;
    acting.current = true; setBusy(true); setError(""); setNotice("");
    try {
      if (!pending.current) {
        if (!eventType) return;
        const input: Input = { eventType, requestId: crypto.randomUUID(), workplaceId: place };
        mobile.current = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
        if (mobile.current) {
          if (!navigator.geolocation) throw new Error("GPS를 지원하는 브라우저가 필요합니다.");
          const position = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }));
          input.location = { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy };
        }
        pending.current = input;
      }
      const response = await fetch("/api/attendance/events", { method: "POST", headers: { "Content-Type": "application/json", "x-attendance-device": mobile.current ? "MOBILE" : "PC" }, body: JSON.stringify(pending.current) });
      const value = await response.json();
      if (!response.ok) {
        if (response.status < 500) pending.current = null;
        throw new Error(value.error);
      }
      pending.current = null; setRetry(false); setNotice("기록했습니다.");
      await refresh();
      await onRecorded?.();
    } catch (e) {
      setRetry(Boolean(pending.current));
      setError(e instanceof Error ? e.message : "GPS 위치 권한과 연결 상태를 확인하세요.");
    } finally { acting.current = false; setBusy(false); }
  }
  const actions: EventType[] = !data ? [] : (data.state === "NOT_STARTED" || data.canStartNewSession) ? ["CLOCK_IN"] : data.state === "WORKING" ? ["BREAK_START", "CLOCK_OUT"] : data.state === "ON_BREAK" ? ["BREAK_END"] : [];
  return <section className={styles.panel} aria-label="출퇴근·휴게 기록">
    <h2>오늘의 근무</h2>
    {!data && !error && <p>기록을 불러오는 중입니다.</p>}
    {data && <>
      <p className={styles.state}><strong>{states[data.state]}</strong> · 근무일 {data.workDate}</p>
      {data.needsReview && <p>출근일 이후까지 이어진 미종료 근무입니다. 퇴근 누락 여부를 확인하세요.</p>}
      <p>실근로시간 <strong className={styles.duration}>{duration(data.actualWorkMinutes)}</strong></p>
      <p>누적 휴게 {duration(data.breakMinutes)}</p>
      <p className={styles.detail}>출근 시각 {data.clockInAt ? time(data.clockInAt) : "—"}</p>
      <label className={styles.workplace}>근무지 <select value={place} disabled={busy || retry} onChange={e => setPlace(e.target.value)}>{data.workplaces.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      {!data.workplaces.length && <p>등록된 근무지가 없습니다. 관리자에게 문의하세요.</p>}
      <div className={styles.actions}>{actions.map(type => <button key={type} disabled={busy || retry || !place} onClick={() => void submit(type)}>{labels[type]}</button>)}</div>
      <p className={styles.detail}>PC는 허용 IP, 모바일은 GPS 반경 100m를 확인합니다.</p>
      <h3 className={styles.recordsHeading} id="today-records">근무 기록</h3>
      {!data.events.length ? <p>아직 기록이 없습니다.</p> : <ol className={styles.records}>{data.events.map(e => <li key={e.id}>{time(e.occurredAt)} · {labels[e.eventType]} · {e.source}</li>)}</ol>}
    </>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {notice && <p className={styles.success} role="status">{notice}</p>}
    {retry ? <button disabled={busy} onClick={() => void submit()}>같은 요청으로 다시 시도</button> : <button className={styles.refresh} disabled={busy} onClick={() => { void refresh().then(() => setError("")).catch(e => setError(e.message)); }}>기록 새로고침</button>}
  </section>;
}
