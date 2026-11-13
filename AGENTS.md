# WMS 작업 지침 및 근무 규칙

## 작업 절차 규칙

- 기존 파일을 변경하기 전에 어떤 파일을 어떻게 수정할지 사용자에게 사전 고지한다.
- 기능 구현 전에 반드시 구현 계획을 사용자에게 고지한다.
- 기능 구현 후 해당 기능의 테스트 코드를 작성하고 실행하여 정상 동작을 확인한다.

## 기준 문서

- 확인일: 2026-11-12 (Asia/Seoul).
- Notion 경로: 근로 → 근태 관리 시스템 → 근무정책 / 시스템 설계 / ERD.
- [근무정책](https://app.notion.com/p/41623542cf8c8169a41bd9cc3b48c3fb)
- [시스템 설계](https://app.notion.com/p/41623542cf8c8103bcf9f6887e09ecb0)
- [ERD v1.2](https://app.notion.com/p/41623542cf8c81a3bf3be8375a9f754a)
- 구현 계획: `docs/attendance-system-plan.md`.

## 확정 근무 규칙

| 항목 | 규칙 |
| --- | --- |
| 출근 | 08:00~10:00 자율 출근 |
| 기본근무 | 실근로 8시간, 휴게 1시간 |
| 반차 | 의무 실근로 4시간. 휴게시간은 미정 |
| PC 출퇴근 | 허용 IP 검증 |
| 모바일 출퇴근 | GPS 근무지 검증 |
| 기본 임금 | 개인별 시급 × 1.0 |
| 일반 연장 | 시급 × 1.5 |
| 야간 연장 | 연장근무이면서 22:00 이후인 구간은 시급 × 2.0 |
| 포괄임금 | 월 연장근무 16시간(960분)은 고정수당 포함. 실제 근로시간 집계에서는 공제하지 않음 |
| 주간 관리 | 실제 근로시간 기준 주 52시간 모니터링 |
| 휴가 | 다우오피스에서 신청·승인. 신규 시스템 연동은 검토 대상 |
| 임금 접근 | 시스템 관리자 전용. 직원·부서장에게 임금 비노출 |

공휴일·대체공휴일·회사 지정 휴일을 관리한다. 토·일을 무조건 법정 휴일로 취급하지 않고 직원별 근무일·휴무일과 구분한다.

## 계산 및 데이터 보존 규칙

- 휴게시간을 실근로시간에서 제외한다. 실제 연장근무시간, 포괄 포함시간, 추가 지급시간을 분리한다.
- 실제 연장근무 20시간이면 포괄 포함 16시간, 추가 지급 대상 4시간이라는 시간 집계는 가능하다. 일반·야간 연장 중 포함 순서가 미정이므로 최종 추가 지급액은 확정하지 않는다.
- 포괄임금이 법정수당 지급 의무를 자동 면제한다고 가정하지 않는다. 계약상 고정수당과 실제 법정수당을 비교하는 절차가 필요하다.
- 근태 원본 이벤트는 보존하고 정정은 별도 기록한다. 세션·근로 구간은 재계산 가능한 파생 데이터로 관리한다.
- 정책·시급·계약의 적용 기간과 계산 버전을 보존한다. 적용 기간 및 근로 구간 중복을 방지한다.
- 휴일·야간·연장은 독립 플래그로 모델링한다. 미정인 휴일 배율을 임의로 적용하지 않는다.
- 임금·시급·계약은 별도 `payroll` 스키마 및 관리자 전용 API의 서버 권한 검사로 보호한다.
- 정산 확정 스냅샷은 불변으로 유지한다. 이후 변경은 새 버전 및 별도 조정 이력으로 남긴다.
- 포괄 차감 정책이 미정이면 `allocation_policy=UNDECIDED`로 유지하고 추가 지급액은 `NULL`/미확정으로 표시한다. 미확정 값을 0원으로 취급하지 않는다.

## 미정 정책 — 구현 시 임의 확정 금지

- 월 16시간 포괄 포함 구간의 배정·차감 순서.
- 고정 연장수당 계약 금액과 법정수당 비교·검증 방식.
- 반차일 휴게시간 및 실근로 4시간 초과분의 연장 인정.
- 연장근무 승인 절차.
- 휴일근로 가산율 및 포괄 포함 여부.
- 근태 정정 승인 절차, 주 52시간 경보 기준, 반올림 정책.
- 공휴일 데이터 수집 방식, 세금·공제 범위.

미정 정책은 설정·상태로 명시하고 해당 결과의 확정 처리를 보류한다. 원문 변경 시 위 출처와 계획 문서의 관련 요구사항을 함께 갱신한다. 이 문서는 원문 정책의 구현 기준이며 별도 법률 검토 결과를 의미하지 않는다.

## 확정 개발 스택

- Next.js App Router + TypeScript, PostgreSQL, Drizzle ORM(node-postgres)을 사용한다.
- Docker Compose로 앱과 PostgreSQL 개발 환경을 실행한다. 실행 절차는 `README.md`를 따른다.
- 스키마 변경은 Drizzle 마이그레이션을 생성·검토·적용하고 SQL과 메타데이터를 보존한다.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
