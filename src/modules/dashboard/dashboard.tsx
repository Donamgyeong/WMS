"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { AttendancePanel } from "@/modules/attendance/client";
import styles from "./dashboard.module.css";

type Props = { name: string; account: ReactNode; denied?: boolean };
const days = ["월", "화", "수", "목", "금", "토", "일"];

export function EmployeeDashboard({ name, account, denied }: Props) {
  const [notice, setNotice] = useState("");
  function preview(feature: string) {
    setNotice(`${feature} 기능은 준비 중입니다. 이 화면은 예시이며 실제 근태 기록을 저장하지 않습니다.`);
  }
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
          <div className={`${styles.card} ${styles.work}`}><AttendancePanel /></div>
          <section className={`${styles.card} ${styles.week}`} aria-labelledby="week-heading">
            <h2 id="week-heading">이번 주 근로시간 · 예시</h2>
            <p className={styles.weekDuration}>29시간 20분</p>
            <p className={styles.small}>휴게를 제외한 실제 근로시간</p>
            <ul className={styles.chart} aria-label="요일별 실제 근로시간 예시">
              {days.map((day, i) => <li key={day} className={i === 3 ? styles.currentDay : undefined}>
                <span>{i < 3 ? "8h" : i === 3 ? "5h 20m" : "—"}</span>
                <span aria-hidden="true" className={styles.bar} style={{ height: i < 3 ? 80 : i === 3 ? 53 : 2 }} />
                <span>{day}</span>
              </li>)}
            </ul>
            <p className={styles.small}>주 52시간 기준 · 누적 29시간 20분</p>
            <p className={styles.footnote}>주간 범위는 설명용 예시입니다.</p>
          </section>
          <section className={styles.attention} aria-label="확인할 사항">
            <h2>누락 기록 안내 · 예시</h2>
            <button onClick={() => preview("누락 기록 상세 조회")}>11월 10일 퇴근 기록 누락 · 상세 보기 →</button>
          </section>
          <section id="upcoming" className={`${styles.card} ${styles.upcoming}`} aria-labelledby="upcoming-heading">
            <h2 id="upcoming-heading">다가오는 일정</h2>
            <p className={styles.small}>11.13 금요일</p>
            <p className={styles.schedule}>등록된 개인 일정을 확인하세요</p>
            <p className={styles.small}>근무일·휴무일·휴일을 구분해 표시합니다.</p>
            <hr />
            <p className={styles.small}>휴가·반차 · 다우오피스 연동 검토 중</p>
          </section>
        </div>
        <p className={`${styles.footnote} ${styles.desktopOnly}`}>화면 기획 시안 · 출퇴근·휴게는 실제 기록입니다. 주간 통계·일정은 예시 데이터입니다.</p>
        <p className={`${styles.footnote} ${styles.mobileOnly}`}>출퇴근·휴게 실제 기록 · 통계·일정 예시</p>
      </main>
      {notice && <div className={styles.notice} role="status"><p>{notice}</p><button onClick={() => setNotice("")}>닫기</button></div>}
    </div>
  );
}
