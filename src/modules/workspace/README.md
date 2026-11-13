# 부서장·관리자 화면

모든 부서장·관리자 화면은 실제 DB를 조회한다. 원래 화면의 JSON과 디자인 CSS는 참고 자료로 보존하며 예시 데이터는 더 이상 화면이나 서버 응답에 사용하지 않는다.

- 경로·제목: `routes.ts`
- 인증 및 라우팅: `server.tsx`, 공통 메뉴: `screen.tsx`
- 대시보드: `dashboard.tsx`, `dashboard-service.ts`, `dashboard-http.ts`
- 하위 관리 화면: `management.tsx`, `management-service.ts`, `management-http.ts`
- 조회 계약·검증: `management-types.ts`, `management-domain.ts`
- 디자인 토큰·반응형: `design.css`, `workspace.css`

`/team/**`는 MANAGER, `/admin/**`는 ADMIN을 서버에서 확인한다. 부서장은 담당 부서 범위만 조회하며 관리자 겸직자도 team 경로의 범위를 넓히지 않는다. 시급·계약·정산은 관리자 API에서만 조회한다. API 경로를 바꾸거나 직원 ID를 직접 입력해도 권한 검사가 적용된다.

대시보드는 30초마다 갱신한다. 하위 화면은 기간 조회·직원 선택·수동 재조회로 최신 데이터를 불러온다. 종료일은 제외하며 근태는 출근일 기준, 일정은 실제 기간 중첩 기준이다. 시급·계약·정책 전체 이력은 날짜 필터로 지우지 않는다. 검색·부서 필터는 직원 연결 행에 적용하고 공통 설정 행은 유지한다. 표는 30행씩 나눈다.

근태의 기록 선택으로 원본·정정·계산 버전·구간을 조회한다. 검증 결과는 표시하지만 IP/GPS 검증 증거 원문은 반환하지 않는다. 관리자는 선택한 종료 근무일을 기존 재계산 API로 처리할 수 있다. 원본과 이전 버전은 보존한다. 승인 정정 재반영은 아직 구현되지 않았다.

정산은 실제 저장 결과만 표시하며 직원·기간별 최신 계산 버전과 이전 이력을 구분한다. 상세 선택 시 계산 근거·입력 스냅샷·별도 조정 이력을 조회한다. 미확정 금액을 0으로 변환하지 않는다.

등록·수정·승인·새 임금 계산·정산 확정·Excel 등 서버 기능이 없는 작업은 각 화면의 **미구현 기능**에 명시한다. 전체 목록과 기존 CLI에서 가능한 작업은 [구현 현황](../../../docs/feature-status.md)에 정리했다.

검증: `management-domain.test.ts`, `tests/integration/workspace-management.test.ts`, `tests/e2e/workspace.spec.ts`. 대시보드 전용 DB 통합 테스트는 `tests/integration/workspace-dashboard.test.ts`다.
