import "server-only";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { getDb } from "@/db";
import * as s from "@/db/schema";
import { authorize, AccessError, type Principal } from "@/modules/identity/domain";
import { getWorktime } from "@/modules/worktime/service";
import { midnight, dayAfter } from "@/modules/worktime/engine";
import { duration } from "@/modules/dashboard/domain";
import { adminRoutes, teamRoutes } from "./routes";
import { ManagementError } from "./management-domain";
import type { ManagementData, ManagementQuery, ManagementSection, ManagementRow } from "./management-types";
const value = (v: unknown) => v === null || v === undefined ? "미확정" : typeof v === "object" ? JSON.stringify(v) : String(v);
const at = (v: Date | null) => v ? v.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "—";
const effective = (v: { effectiveFrom: string; effectiveTo: string | null }) => `${v.effectiveFrom}~${v.effectiveTo ?? "종료 없음"} (종료일 제외)`;
const minutes = (v: string | number | null) => v === null ? "미확정" : duration(Number(v));
const money = (v: string | null) => v === null ? "미확정" : `${v}원`;
const row = (id: string, cells: unknown[], extra: Partial<ManagementRow> = {}): ManagementRow => ({ id, cells: cells.map(value), ...extra });

export async function getManagement(principal: Principal, area: "team" | "admin", key: string, query: ManagementQuery): Promise<ManagementData> {
  authorize(principal, area === "admin" ? "ADMIN" : "MANAGER");
  const routes = area === "admin" ? adminRoutes : teamRoutes;
  if (!routes.some(r => r.key === key) || key === area) throw new ManagementError(404, "화면을 찾을 수 없습니다.");
  const db = getDb();
  const scope = area === "team" ? (principal.departmentIds.length ? inArray(s.employees.departmentId, principal.departmentIds) : sql`false`) : undefined;
  const people = await db.select({ id: s.employees.id, name: sql<string>`coalesce(${s.employees.name}, ${s.user.name})`, departmentId: s.employees.departmentId, department: sql<string>`coalesce(${s.departments.name}, '부서 미배정')`, employeeNo: s.employees.employeeNo, active: s.employees.active, hiredAt: s.employees.hiredAt, terminatedAt: s.employees.terminatedAt }).from(s.employees).innerJoin(s.user, eq(s.user.id, s.employees.userId)).leftJoin(s.departments, eq(s.departments.id, s.employees.departmentId)).where(scope).orderBy(asc(s.user.name), asc(s.employees.id));
  // Strict team scope also applies to self and dual-role users.
  if (query.employeeId && !people.some(p => p.id === query.employeeId)) throw new AccessError(403);
  const departmentList = await db.select({ id: s.departments.id, name: s.departments.name }).from(s.departments).where(area === "team" ? (principal.departmentIds.length ? inArray(s.departments.id, principal.departmentIds) : sql`false`) : undefined).orderBy(asc(s.departments.name));
  const selected = query.employeeId ? people.filter(p => p.id === query.employeeId) : people;
  const ids = selected.map(p => p.id);
  const employeeScope = (column: AnyPgColumn) => ids.length ? inArray(column, ids) : sql`false`;
  const names = new Map(people.map(p => [p.id, `${p.name} · ${p.department}`]));
  const sections: ManagementSection[] = [];
  const add = (title: string, columns: string[], rows: ManagementRow[]) => sections.push({ title, columns, rows });
  const unavailable: string[] = [];

  if (["team-attendance", "team-detail", "admin-attendance"].includes(key)) {
    const records: ManagementRow[] = [], daily: ManagementRow[] = [], segments: ManagementRow[] = [];
    for (const person of selected) {
      const report = await getWorktime(principal, person.id, { from: query.from, to: query.to, basis: "WORK_DATE" });
      for (const session of report.sessions.filter(r => !query.workDate || r.workDate === query.workDate)) {
        const c = session.calculation;
        const extra = { employeeId: person.id, workDate: session.workDate };
        records.push(row(session.id, [names.get(person.id), session.workDate, minutes(c.actualWorkMinutes), minutes(c.breakMinutes), c.state, c.provisional ? "잠정" : "종료", `v${session.calculationVersion}`, c.unresolvedReasons.join(", ") || "—"], extra));
        c.segments.forEach((segment, i) => segments.push(row(`${session.id}-${i}`, [names.get(person.id), session.workDate, at(segment.startedAt), at(segment.endedAt), minutes(segment.durationMinutes), value(segment.isOvertime), value(segment.isNight), value(segment.isHolidayWork), segment.unresolvedReasons.join(", ") || "—"], extra)));
      }
      report.daily.forEach(d => daily.push(row(`${person.id}-${d.key}`, [names.get(person.id), d.key, minutes(d.actualWorkMinutes), minutes(d.overtimeMinutes), minutes(d.nightMinutes), minutes(d.holidayMinutes)], { employeeId: person.id, workDate: d.key })));
    }
    add("근무일별 기록", ["직원·부서", "근무일", "실근로", "휴게", "상태", "계산 상태", "계산 버전", "미확정 사유"], records);
    if (key !== "team-detail") add("일별 집계", ["직원·부서", "근무일", "실근로", "연장", "야간", "휴일"], daily);
    if (query.employeeId && query.workDate) {
      const sessions = await db.select().from(s.workSessions).where(and(eq(s.workSessions.employeeId, query.employeeId), eq(s.workSessions.workDate, query.workDate))).orderBy(asc(s.workSessions.calculationVersion));
      const source = sessions.find(v => v.calculationVersion === 1);
      const events = await db.select({ id: s.attendanceEvents.id, eventType: s.attendanceEvents.eventType, occurredAt: s.attendanceEvents.occurredAt, recordedAt: s.attendanceEvents.recordedAt, source: s.attendanceEvents.source, verificationStatus: s.attendanceEvents.verificationStatus, workplace: s.workplaces.name }).from(s.attendanceEvents).leftJoin(s.workplaces, eq(s.workplaces.id, s.attendanceEvents.workplaceId)).where(and(eq(s.attendanceEvents.employeeId, query.employeeId), or(source ? eq(s.attendanceEvents.workSessionId, source.id) : sql`false`, and(isNull(s.attendanceEvents.workSessionId), sql`${s.attendanceEvents.occurredAt} >= ${midnight(query.workDate)} and ${s.attendanceEvents.occurredAt} < ${midnight(dayAfter(query.workDate))}`)))).orderBy(asc(s.attendanceEvents.occurredAt), asc(s.attendanceEvents.recordedAt));
      add("원본 이벤트", ["발생 시각", "기록 시각", "이벤트", "출처", "근무지", "검증"], events.map(e => row(e.id, [at(e.occurredAt), at(e.recordedAt), e.eventType, e.source, e.workplace ?? "—", e.verificationStatus])));
      const eventIds = events.map(e => e.id);
      const corrections = eventIds.length ? await db.select().from(s.attendanceCorrections).where(and(eq(s.attendanceCorrections.employeeId, query.employeeId), inArray(s.attendanceCorrections.eventId, eventIds))).orderBy(asc(s.attendanceCorrections.createdAt)) : [];
      add("정정 이력", ["원본 이벤트 ID", "요청 변경", "사유", "상태", "승인자 ID", "기록 시각"], corrections.map(c => row(c.id, [c.eventId, c.requestedChange, c.reason, c.status, c.approvedBy ?? "—", at(c.createdAt)])));
      add("계산 버전 이력", ["버전", "출근", "퇴근", "실근로", "휴게", "상태", "정책 ID"], sessions.map(c => row(c.id, [c.calculationVersion, at(c.clockInAt), at(c.clockOutAt), minutes(c.actualWorkMinutes), minutes(c.breakMinutes), c.status, c.workPolicyId])));
      add("근로 구간", ["직원·부서", "근무일", "시작", "종료", "실근로", "연장", "야간", "휴일", "미확정 사유"], segments);
      const policies = sessions.length ? await db.select().from(s.workPolicies).where(inArray(s.workPolicies.id, [...new Set(sessions.map(c => c.workPolicyId))])) : [];
      add("적용 정책", ["정책", "버전", "유효 기간", "일 실근로", "휴게", "미정 정책"], policies.map(p => row(p.id, [p.name, p.version, effective(p), minutes(p.dailyWorkMinutes), minutes(p.breakMinutes), p.unresolvedPolicies])));
    }
    unavailable.push("근태 정정 신청·승인·반려 및 승인 정정의 계산 재반영", "연장근무 승인", "주 52시간 자동 경보·알림");
  } else if (key.endsWith("calendar")) {
    const [schedules, leaves, assignments] = await Promise.all([
      db.select().from(s.workSchedules).where(and(employeeScope(s.workSchedules.employeeId), sql`${s.workSchedules.workDate} >= ${query.from}::date and ${s.workSchedules.workDate} < ${query.to}::date`)).orderBy(asc(s.workSchedules.workDate)),
      db.select().from(s.leaveRecords).where(and(employeeScope(s.leaveRecords.employeeId), sql`${s.leaveRecords.startAt} < ${midnight(query.to)} and ${s.leaveRecords.endAt} > ${midnight(query.from)}`)).orderBy(asc(s.leaveRecords.startAt)),
      db.select({ assignment: s.employeeCalendarAssignments, name: s.holidayCalendars.name, timezone: s.holidayCalendars.timezone }).from(s.employeeCalendarAssignments).innerJoin(s.holidayCalendars, eq(s.employeeCalendarAssignments.calendarId, s.holidayCalendars.id)).where(and(employeeScope(s.employeeCalendarAssignments.employeeId), sql`${s.employeeCalendarAssignments.effectiveFrom} < ${query.to}::date and (${s.employeeCalendarAssignments.effectiveTo} is null or ${s.employeeCalendarAssignments.effectiveTo} > ${query.from}::date)`)),
    ]);
    const calendarIds = [...new Set(assignments.map(a => a.assignment.calendarId))];
    const holidayList = await db.select({ holiday: s.holidays, calendar: s.holidayCalendars.name, timezone: s.holidayCalendars.timezone }).from(s.holidays).innerJoin(s.holidayCalendars, eq(s.holidayCalendars.id, s.holidays.calendarId)).where(and(area === "team" || query.employeeId ? (calendarIds.length ? inArray(s.holidays.calendarId, calendarIds) : sql`false`) : undefined, sql`${s.holidays.holidayDate} >= ${query.from}::date and ${s.holidays.holidayDate} < ${query.to}::date`)).orderBy(asc(s.holidays.holidayDate));
    const types = { WORKDAY: "근무일", DAY_OFF: "휴무일", HOLIDAY: "휴일" };
    add("직원별 근무·휴무", ["직원·부서", "날짜", "구분", "근무 예정", "의무 실근로"], schedules.map(v => row(v.id, [names.get(v.employeeId), v.workDate, types[v.dayType], v.isWorkScheduled ? "있음" : "없음", minutes(v.requiredWorkMinutes)], { employeeId: v.employeeId })));
    add("휴가·반차", ["직원·부서", "유형", "시작", "종료", "승인 상태", "동기화 시각"], leaves.map(v => row(v.id, [names.get(v.employeeId), v.leaveType, at(v.startAt), at(v.endAt), v.approvedStatus, at(v.syncedAt)], { employeeId: v.employeeId })));
    const applicableHolidays = area === "team" || query.employeeId ? holidayList.filter(h => assignments.some(a => a.assignment.calendarId === h.holiday.calendarId && a.assignment.effectiveFrom <= h.holiday.holidayDate && (!a.assignment.effectiveTo || a.assignment.effectiveTo > h.holiday.holidayDate))) : holidayList;
    add("휴일 목록", ["날짜", "이름", "종류", "캘린더", "시간대", "유급 여부", "출처"], applicableHolidays.map(({ holiday: h, calendar, timezone }) => row(h.id, [h.holidayDate, h.name, h.holidayType, calendar, timezone, h.isPaid, h.source])));
    add("직원 캘린더 배정", ["직원·부서", "캘린더", "시간대", "유효 기간"], assignments.map(a => row(a.assignment.id, [names.get(a.assignment.employeeId), a.name, a.timezone, effective(a.assignment)], { employeeId: a.assignment.employeeId })));
    unavailable.push("휴일·개인 일정 등록·수정·삭제 UI/API", "공휴일 자동 수집", "다우오피스 휴가·반차 동기화");
  } else if (key === "admin-organization") {
    const [roles, managed, deptRows] = await Promise.all([db.select().from(s.employeeRoles), db.select().from(s.managedDepartments), db.select().from(s.departments)]);
    add("직원 목록", ["직원", "사번", "부서", "계정 상태", "입사일", "퇴사일", "역할", "담당 부서"], selected.map(p => row(p.id, [p.name, p.employeeNo ?? "—", p.department, p.active ? "활성" : "비활성", p.hiredAt ?? "—", p.terminatedAt ?? "—", roles.filter(r => r.employeeId === p.id).map(r => r.role).join(", "), managed.filter(m => m.employeeId === p.id).map(m => departmentList.find(d => d.id === m.departmentId)?.name ?? m.departmentId).join(", ") || "—"], { employeeId: p.id })));
    add("부서 정보", ["부서", "상위 부서", "지정 부서장", "활성 직원"], deptRows.map(d => row(d.id, [d.name, departmentList.find(p => p.id === d.parentId)?.name ?? "—", names.get(d.managerId ?? "") ?? "미지정", people.filter(p => p.active && p.departmentId === d.id).length])));
    unavailable.push("직원 기본 정보·부서 구조 편집 UI/API", "계정 발급·역할 변경·비활성화 웹 UI/API (기존 accounts CLI 사용 가능)");
  } else if (key === "admin-settings") {
    const [policies, places, networks, assignments] = await Promise.all([db.select().from(s.workPolicies).orderBy(asc(s.workPolicies.name), desc(s.workPolicies.version)), db.select().from(s.workplaces), db.select().from(s.workplaceIpRanges), db.select().from(s.employeePolicyAssignments).where(employeeScope(s.employeePolicyAssignments.employeeId)).orderBy(asc(s.employeePolicyAssignments.effectiveFrom))]);
    add("근무 정책", ["정책", "버전", "기간", "자율 출근", "의무 실근로", "휴게", "반차 실근로", "반차 휴게", "기본/연장/야간 연장 배율", "휴일 배율", "미정 정책"], policies.map(p => row(p.id, [p.name, p.version, effective(p), `${p.clockInFrom}~${p.clockInTo}`, minutes(p.dailyWorkMinutes), minutes(p.breakMinutes), minutes(p.halfDayWorkMinutes), minutes(p.halfDayBreakMinutes), `${p.regularMultiplier}/${p.overtimeMultiplier}/${p.nightOvertimeMultiplier}`, p.holidayMultiplier, p.unresolvedPolicies])));
    add("근무지·접속 검증", ["근무지", "GPS 위도", "GPS 경도", "등록 반경(m)", "허용 CIDR"], places.map(p => row(p.id, [p.name, p.latitude, p.longitude, p.gpsRadiusMeters, networks.filter(n => n.workplaceId === p.id).map(n => n.ipNetwork).join(", ") || "등록 없음"])));
    add("정책 적용 이력", ["직원·부서", "정책", "버전", "유효 기간"], assignments.map(a => row(a.id, [names.get(a.employeeId), policies.find(p => p.id === a.workPolicyId)?.name ?? a.workPolicyId, policies.find(p => p.id === a.workPolicyId)?.version, effective(a)], { employeeId: a.employeeId })));
    unavailable.push("근무 정책·근무지·허용 IP 편집 웹 UI/API (근무지 등록·기본 정책 배정은 기존 attendance-setup CLI 사용 가능)");
  } else if (key === "admin-contracts") {
    const [rates, contracts] = await Promise.all([db.select().from(s.hourlyRateHistories).where(employeeScope(s.hourlyRateHistories.employeeId)).orderBy(desc(s.hourlyRateHistories.effectiveFrom)), db.select().from(s.compensationContracts).where(employeeScope(s.compensationContracts.employeeId)).orderBy(desc(s.compensationContracts.effectiveFrom))]);
    add("시급 이력", ["직원·부서", "시급", "유효 기간"], rates.map(r => row(r.id, [names.get(r.employeeId), money(r.hourlyRate), effective(r)], { employeeId: r.employeeId })));
    add("계약 이력", ["직원·부서", "유효 기간", "포괄 포함시간", "고정 연장수당", "배정·차감 정책", "법정수당 비교 정책"], contracts.map(c => row(c.id, [names.get(c.employeeId), effective(c), minutes(c.includedOvertimeMinutes), money(c.fixedOvertimeAllowance), c.allocationPolicy, c.allowanceComparisonPolicy], { employeeId: c.employeeId })));
    add("미등록 항목", ["직원·부서", "시급", "계약"], selected.map(p => row(p.id, [names.get(p.id), rates.some(r => r.employeeId === p.id && r.effectiveFrom <= query.from && (!r.effectiveTo || r.effectiveTo > query.from)) ? "기준일 유효" : "기준일 유효 시급 없음", contracts.some(c => c.employeeId === p.id && c.effectiveFrom <= query.from && (!c.effectiveTo || c.effectiveTo > query.from)) ? "기준일 유효" : "기준일 유효 계약 없음"], { employeeId: p.id })));
    unavailable.push("시급·계약 등록·변경 UI/API", "포괄 포함 순서와 고정수당·법정수당 비교 정책 적용");
  } else if (key === "admin-settlements") {
    const periods = await db.select().from(s.payrollPeriods).where(sql`${s.payrollPeriods.periodStart} < ${query.to}::date and ${s.payrollPeriods.periodEnd} > ${query.from}::date`).orderBy(desc(s.payrollPeriods.periodStart));
    const periodIds = periods.map(p => p.id);
    const calculations = await db.select().from(s.payrollCalculations).where(and(employeeScope(s.payrollCalculations.employeeId), periodIds.length ? inArray(s.payrollCalculations.payrollPeriodId, periodIds) : sql`false`)).orderBy(desc(s.payrollCalculations.calculationVersion));
    const latest = new Map<string, typeof calculations[number]>();
    calculations.forEach(c => { const k = `${c.payrollPeriodId}:${c.employeeId}`; if (!latest.has(k)) latest.set(k, c); });
    const calculationRow = (c: typeof calculations[number]) => row(c.id, [names.get(c.employeeId), periods.find(p => p.id === c.payrollPeriodId)?.periodStart, c.status, c.calculationVersion, minutes(c.overtimeMinutes), minutes(c.includedOvertimeMinutes), minutes(c.payableOvertimeMinutes), money(c.additionalOvertimePay), money(c.totalCalculatedPay), c.unresolvedReasons], { employeeId: c.employeeId, calculationId: c.id });
    add("정산 기간", ["시작일", "종료일(제외)", "상태", "확정 시각"], periods.map(p => row(p.id, [p.periodStart, p.periodEnd, p.status, at(p.finalizedAt)])));
    const columns = ["직원·부서", "기간 시작", "상태", "버전", "실제 연장", "포괄 포함", "추가 대상", "추가 지급액", "총액", "미확정 사유"];
    add("정산 목록 · 직원별 최신 버전", columns, [...latest.values()].map(calculationRow));
    if (query.calculationId) {
      const c = calculations.find(v => v.id === query.calculationId);
      if (!c) throw new ManagementError(404, "조회 범위에 정산 기록이 없습니다.");
      const [lines, adjustments] = await Promise.all([db.select().from(s.payrollLineItems).where(eq(s.payrollLineItems.payrollCalculationId, c.id)), db.select().from(s.payrollAdjustments).where(eq(s.payrollAdjustments.payrollCalculationId, c.id)).orderBy(asc(s.payrollAdjustments.createdAt))]);
      add("선택 정산", ["직원", "계산 ID", "일반 근로", "일반 임금", "야간 연장", "계약 ID", "입력 스냅샷"], [row(c.id, [names.get(c.employeeId), c.id, minutes(c.regularMinutes), money(c.regularPay), minutes(c.nightOvertimeMinutes), c.contractId, c.inputSnapshot])]);
      add("계산 근거", ["근로 구간 ID", "근로시간", "시급", "배율", "총 산출액", "포괄 포함", "추가 대상", "추가 금액", "근거 스냅샷"], lines.map(l => row(l.id, [l.workSegmentId ?? "—", minutes(l.durationMinutes), money(l.hourlyRate), l.multiplier, money(l.grossAmount), minutes(l.includedMinutes), minutes(l.payableMinutes), money(l.additionalAmount), l.basisSnapshot])));
      add("정산 버전 이력", columns, calculations.filter(v => v.employeeId === c.employeeId && v.payrollPeriodId === c.payrollPeriodId).map(calculationRow));
      add("별도 조정 이력", ["금액", "사유", "작성자", "기록 시각"], adjustments.map(a => row(a.id, [money(a.amount), a.reason, names.get(a.createdBy) ?? a.createdBy, at(a.createdAt)])));
    }
    unavailable.push("임금 계산 엔진·새 정산 생성·확정·별도 조정 처리 API/UI", "요약 Excel·상세 구간 Excel 내보내기", "관리자 상세 접근·Excel 감사 로그 기록 및 조회 UI");
  }
  return { asOf: new Date().toISOString(), from: query.from, to: query.to, employees: people.map(({ id, name, departmentId, department }) => ({ id, name, departmentId, department })), departments: departmentList, sections, unavailable };
}
