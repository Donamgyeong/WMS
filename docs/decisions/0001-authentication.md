# 인증·권한 구현 결정

2026-11-13 (Asia/Seoul). 로컬 AGENTS.md와 설계 문서를 기준으로 구현했다. Notion 원문의 재검증이나 근무정책 변경은 포함하지 않는다.

## 선택

- Better Auth 1.7.22의 이메일·비밀번호 인증, Drizzle PostgreSQL 어댑터를 사용한다. 비밀번호는 라이브러리의 scrypt 해시로 저장한다.
- 공개 가입은 설정과 HTTP 경로 허용 목록에서 차단한다. 계정 발급·역할 변경·비활성화는 서버 운영자가 CLI로 수행한다. 관리자 UI는 접근 확인용이며 계정 CRUD 화면은 제공하지 않는다.
- 인증 계정과 직원은 일대일로 분리한다. 직원은 EMPLOYEE/MANAGER/ADMIN 복수 역할을 가질 수 있다. 담당 부서 연결은 직원 소속과 별도로 관리한다. 관리자에게 MANAGER 역할을 자동 부여하지 않는다.
- 세션은 DB에 저장하고 발급 후 8시간에 만료한다. 자동 연장과 쿠키 캐시를 비활성화한다. 브라우저 종료 옵션에도 동일한 DB 만료를 적용한다. 쿠키는 HttpOnly·SameSite=Lax이며 HTTPS base URL에서는 Secure가 적용된다.
- 매 요청에서 직원 활성 상태·현재 역할·담당 부서를 읽는다. 직원 비활성화·CLI 역할 변경은 세션도 삭제한다.
- 최초 발급 비밀번호는 12~128자이며 업무 접근 전에 변경해야 한다. 변경 시 이전 세션을 전부 폐기하고 새 세션을 발급한다. 기존 비밀번호와 같은 값은 거부한다.
- 변경 요청은 설정한 BETTER_AUTH_URL의 Origin 및 application/json만 허용한다. 외부 callbackURL을 거부한다. 로그인 실패는 계정 존재·활성 여부에 관계없이 동일한 응답을 제공한다.
- 로그인은 정규화한 이메일의 SHA-256 키별 60초간 5회로 제한한다. DB UPSERT로 병렬·다중 인스턴스에서도 횟수를 공유한다. 전달 IP 헤더는 신뢰하지 않으며 Better Auth의 추가 제한은 IP 미확인 시 공유 버킷으로 동작한다. 운영 프록시 신뢰 정책 및 입구의 트래픽 제한은 배포 시 별도 결정한다.
- 본인/담당 부서 범위 판정 함수와 관리자 권한 검사를 제공한다. 향후 실제 직원·근태 조회 서비스는 대상 정보를 DB에서 읽고 이 함수를 호출해야 한다. 현재 /api/team 및 /api/admin/payroll은 권한 확인용 사용자 DTO만 반환하며 근태·임금 기능은 없다.

## 데이터와 경로

`auth_users`, `auth_accounts`, `auth_sessions`, `auth_verifications`, `auth_rate_limits`, `employees`, `employee_roles`, `departments`, `managed_departments`를 추가했다. 기존 payroll 스키마와 최초 마이그레이션은 보존한다. 직원·부서는 인증에 필요한 최소 필드이며 조직 이력 모델은 후속 기능에서 확장한다.

- 페이지: /login, /change-password, /me, /team, /admin
- 인증: POST /api/auth/sign-in/email, POST /api/auth/sign-out, POST /api/auth/change-password, GET /api/auth/get-session
- 권한 확인 API: GET /api/me, /api/team (MANAGER), /api/admin/payroll (ADMIN)
- 미인증 401, 역할 부족 및 비밀번호 변경 필요 403. 페이지에서는 로그인·비밀번호 변경 화면으로 이동하고 역할 부족은 /me?denied=1로 이동한다.

## 검증과 범위

Vitest로 범위 판정, 실제 PostgreSQL로 로그인·세션·권한·CLI·병렬 제한을 검증하고 Playwright Chromium으로 사용자 흐름을 확인한다. 테스트는 이름이 `_test`로 끝나는 전용 DB만 사용하며 해당 DB의 인증·최소 조직 데이터를 초기화한다. 개발 DB에는 테스트 계정을 만들지 않는다.

SSO·다우오피스 연동, 이메일 검증, 메일 기반 비밀번호 재설정, MFA, 계정 관리 UI, 조직 변경 이력은 후속 범위다. 이메일은 운영자가 검증해 발급하는 식별자이며 메일 소유권 인증 완료를 의미하지 않는다. 운영 전 비밀번호 분실 지원 절차와 관리자 보호 정책을 결정해야 한다.

## 참고

- https://better-auth.com/docs/installation
- https://better-auth.com/docs/adapters/drizzle
- https://better-auth.com/docs/authentication/email-password
- https://better-auth.com/docs/integrations/next
- 설치한 Next.js 16.4.6의 node_modules/next/dist/docs/01-app/02-guides/authentication.md
