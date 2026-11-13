"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
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
        <p className={styles.subtitle}><span>{name} 님의 근무 현황입니다.　 </span><span className={styles.desktopDate}>2026년 </span>11월 12일 목요일<span className={styles.mobileOnly}> · 예시 데이터</span></p>
        {denied && <p role="alert">접근 권한이 없습니다.</p>}
        <div className={styles.grid}>
          <section className={`${styles.card} ${styles.work}`} aria-labelledby="work-heading">
            <h2 id="work-heading">오늘의 근무</h2>
            <span className={styles.badge}>● 근무 중</span>
            <p className={styles.workLabel}>실근로시간</p>
            <p className={styles.duration}>05시간 20분</p>
            <dl className={styles.metrics}>
              <div><dt>출근 시각</dt><dd>09:00</dd></div>
              <div><dt>누적 휴게</dt><dd>01시간 00분</dd></div>
            </dl>
            <hr />
            <p className={styles.small}>예상 퇴근　— 산정 기준 결정 후 제공</p>
            <div className={styles.actions}>
              <button className={styles.secondary} onClick={() => preview("휴게 시작")}>휴게 시작</button>
              <button onClick={() => preview("퇴근")}>퇴근하기</button>
            </div>
            <p className={`${styles.small} ${styles.desktopOnly}`}>PC 출퇴근 시 허용 IP를 검증합니다.</p>
            <p className={`${styles.small} ${styles.mobileOnly}`}>GPS 근무지 검증 후 기록됩니다.</p>
          </section>
          <section className={`${styles.card} ${styles.week}`} aria-labelledby="week-heading">
            <h2 id="week-heading">이번 주 근로시간</h2>
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
            <h2>확인할 기록이 1건 있어요</h2>
            <button onClick={() => preview("누락 기록 상세 조회")}>11월 10일 퇴근 기록 누락 · 상세 보기 →</button>
          </section>
          <section id="today-records" className={`${styles.card} ${styles.records}`} aria-labelledby="records-heading">
            <h2 id="records-heading">오늘의 기록</h2>
            <ol className={styles.timeline}>
              {[["09:00", "출근", "PC · 허용 IP 확인"], ["12:00", "휴게 시작", "점심 휴게"], ["13:00", "휴게 종료", "근무 재개"]].map(([time, title, detail]) => <li key={time}><time>{time}</time><div><strong>{title}</strong><p>{detail}</p></div></li>)}
            </ol>
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
        <p className={`${styles.footnote} ${styles.desktopOnly}`}>화면 기획 시안 · 모든 기록은 예시 데이터입니다. 실제 근태 기록과 연결되지 않았습니다.</p>
        <p className={`${styles.footnote} ${styles.mobileOnly}`}>화면 기획 시안 · 실제 근태 미연결</p>
      </main>
      {notice && <div className={styles.notice} role="status"><p>{notice}</p><button onClick={() => setNotice("")}>닫기</button></div>}
    </div>
  );
}
