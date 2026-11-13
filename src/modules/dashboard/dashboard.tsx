"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { AttendancePanel } from "@/modules/attendance/client";
import { duration, type DashboardData } from "./domain";
import styles from "./dashboard.module.css";

type Props = { name: string; account: ReactNode; denied?: boolean };
const days = ["월", "화", "수", "목", "금", "토", "일"];

export function EmployeeDashboard({ name, account, denied }: Props) {
  const [data, setData] = useState<DashboardData>();
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error);
      setData(value); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "대시보드를 불러오지 못했습니다."); }
  }, []);
  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    const interval = setInterval(() => void refresh(), 30000);
    return () => { clearTimeout(initial); clearInterval(interval); };
  }, [refresh]);
  return (
    <div className={styles.dashboard}>
      <header className={styles.header}>
        <Link href="/me" className={styles.logo}>WMS</Link>
        <nav aria-label="직원 메뉴" className={styles.navigation}>
          <Link href="/me" aria-current="page">대시보드</Link>
          <a href="#today-records" aria-label="내 근태">내 근태</a>
          <a href="#upcoming" aria-label="근무 캘린더">근무 캘린더</a>
        </nav>
        <details className={styles.account}>
          <summary><span className={styles.employeeLabel}>직원 화면 · </span>{name} 님</summary>
          <div className={styles.accountMenu}>{account}</div>
        </details>
      </header>
      <main className={styles.main}>
        <p className={styles.eyebrow}>MY WORKSPACE</p>
        <h1>오늘도, 나의 속도로.</h1>
        <p className={styles.subtitle}><span>{name} 님의 근무 현황입니다.　 </span><span className={styles.desktopDate}>근태 기록</span><span className={styles.mobileOnly}> · 출퇴근 기록</span></p>
        {denied && <p role="alert">접근 권한이 없습니다.</p>}
        <div className={styles.grid}>
          <div className={`${styles.card} ${styles.work}`}><AttendancePanel onRecorded={refresh} /></div>
          <section className={`${styles.card} ${styles.week}`} aria-labelledby="week-heading">
            <h2 id="week-heading">이번 주 근로시간</h2>
            {error && <p role="alert">{error} {data && "이전 조회 결과입니다."}<button onClick={() => void refresh()}>다시 시도</button></p>}
            {!data ? <p>통계를 불러오는 중입니다.</p> : <>
              <p className={styles.weekDuration}>{duration(data.totalMinutes)}</p>
              <p className={styles.small}>휴게를 제외한 실제 근로시간{data.provisional && " · 진행 중 근무 포함 잠정 집계"}</p>
              <ul className={styles.chart} aria-label="요일별 실제 근로시간">
                {data.daily.map((day, i) => <li key={day.date} className={day.date === data.today ? styles.currentDay : undefined}>
                  <span>{duration(day.minutes)}</span>
                  <span aria-hidden="true" className={styles.bar} style={{ height: Math.max(2, day.minutes / Math.max(480, ...data.daily.map(d => d.minutes)) * 80) }} />
                  <span>{days[i]}</span>
                </li>)}
              </ul>
              <p className={styles.small}>주 52시간 기준 · 누적 {duration(data.totalMinutes)}</p>
              <p className={styles.footnote}>서울 시간 · 월~일 표시 범위 {data.from}~{data.daily.at(-1)?.date} · 실제 시각 기준</p>
              <p className={styles.footnote}>주 시작일·경보 정책은 미정입니다. 조회 시각 {new Date(data.asOf).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</p>
            </>}
          </section>
          <section className={styles.attention} aria-label="확인할 사항">
            <h2>미종료 근무 확인</h2>
            {!data ? <p>기록을 불러오는 중입니다.</p> : data.missing.length ? data.missing.map(record => <p key={record.id}>{record.date} 출근 후 미종료 · 퇴근 누락 여부를 확인하세요.</p>) : <p>이전 근무일의 미종료 기록이 없습니다.</p>}
          </section>
          <section id="upcoming" className={`${styles.card} ${styles.upcoming}`} aria-labelledby="upcoming-heading">
            <h2 id="upcoming-heading">다가오는 일정</h2>
            <p className={styles.small}>오늘부터 14일 · 서울 시간</p>
            {!data ? <p>일정을 불러오는 중입니다.</p> : data.upcoming.length ? <ul className={styles.timeline}>{data.upcoming.map(item => <li key={item.id}><span>{item.date}</span><strong>{item.label}</strong></li>)}</ul> : <p className={styles.schedule}>등록된 일정이 없습니다.</p>}
            <hr />
            <p className={styles.small}>휴가·반차 · 다우오피스 연동 검토 중</p>
          </section>
        </div>
        <p className={styles.footnote}>등록된 근태·일정 기준입니다. 미등록 날짜의 근무일·휴무일은 추정하지 않습니다.</p>
      </main>
    </div>
  );
}
