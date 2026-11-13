# identity

인증·DB 세션·역할 및 본인/담당 부서/관리자 접근 범위를 담당한다.

- `auth.ts`: Better Auth·Drizzle 설정과 세션 발급 시 계정 상태 확인.
- `service.ts`: 요청별 현재 직원·역할 조회, 페이지/API 접근 검사.
- `domain.ts`: 역할·대상 직원 접근 범위 판정. 후속 근태 서비스는 DB에서 조회한 대상을 전달해야 한다.
- `throttle.ts`: DB 기반 계정별 원자적 로그인 제한.
- `forms.tsx`, `client.ts`: 로그인·비밀번호 변경·로그아웃 UI.
- `scripts/accounts.ts`: 운영자용 계정 발급·역할 변경·비활성화.

인증 설정과 운영 절차는 [결정 기록](../../../docs/decisions/0001-authentication.md) 및 [README](../../../README.md)를 따른다. 인증 계정은 직원과 분리되며 업무 서비스·DB 접근은 서버에서만 수행한다. 임금 API는 ADMIN 역할이 필요하다.
