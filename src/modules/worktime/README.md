# worktime

- `domain.ts`: 기존 출퇴근 화면의 실시간 실근로·휴게 요약.
- `engine.ts`: 순수 구간 생성·분류·기간 집계.
- `repository.ts`: 원본·정책·일정·휴일·휴가·정정 입력 조회.
- `service.ts`: 권한·직원 잠금·종료 세션 재계산·버전 저장·조회.
- `http.ts`: 조회 및 관리자 재계산 API 계약.

계산 옵션·미정 처리·버전·API와 후속 범위는 [결정 기록](../../../docs/decisions/0003-worktime-calculation.md)을 따른다. 테스트는 인접 `engine.test.ts`, `tests/integration/worktime.test.ts`, `tests/e2e/worktime.spec.ts`에 있다.
