# WMS

Next.js App Router + TypeScript + PostgreSQL 17 + Drizzle ORM (`node-postgres`). Node.js 24와 npm을 개발 컨테이너에서 사용한다. 근무 규칙은 [AGENTS.md](AGENTS.md), 구현 계획은 [docs](docs/attendance-system-plan.md), 전체 구조와 모듈 경계는 [설계 문서](docs/architecture.md)를 참고한다.

## Docker Compose 개발

```sh
cp .env.example .env
docker compose up --build -d
docker compose exec app npm run db:migrate
```

호스트 DB 포트는 기존 PostgreSQL과 충돌하지 않도록 `5433`을 사용한다.

앱: http://localhost:3001 · DB 연결 확인: http://localhost:3001/api/health (연결 성공 200, 실패 503).
소스 변경은 바인드 마운트로 반영된다. PostgreSQL은 healthcheck 통과 후 앱이 시작되며 데이터는 named volume에 유지된다. 개발용 기본 자격증명과 localhost 포트 바인딩을 사용한다.

```sh
docker compose logs -f app
docker compose exec app npm run lint
docker compose exec app npm run typecheck
docker compose down
```

의존성 변경 후에는 이미지와 컨테이너의 node_modules를 함께 갱신한다.

```sh
docker compose up --build -d
docker compose exec app npm ci
```

## 호스트에서 Next.js 실행

```sh
cp .env.example .env
npm ci
docker compose up -d db
npm run dev -- --port 3001
```

호스트에서는 DATABASE_URL의 호스트가 `localhost`, Compose 앱에서는 `db`다. DB 포트·자격증명을 바꾸면 호스트용 DATABASE_URL도 맞춘다. `.env.local`이 있으면 Next.js와 Drizzle 모두 `.env`보다 우선한다. 컨테이너 환경변수는 이 파일들보다 우선한다.

## Drizzle 마이그레이션

`src/db/schema/index.ts`에 도메인 스키마를 작성하고 SQL을 생성·검토·적용한다. payroll 초기 스키마와 인증·최소 직원/부서 테이블 마이그레이션을 포함한다. 마이그레이션은 앱 시작 시 자동 적용하지 않는다.

```sh
docker compose exec app npm run db:generate
# drizzle/ 아래 생성된 SQL 검토
docker compose exec app npm run db:migrate
```

호스트 실행 시에는 `npm run db:generate`, `npm run db:migrate`를 사용한다. 생성된 SQL과 메타데이터는 버전 관리한다. `npm run db:studio`는 호스트에서 실행할 수 있다.

## 검증 및 데이터 관리

```sh
npm run lint
npm run typecheck
npm run build
```

`docker compose down`은 DB 데이터를 보존한다. `docker compose down -v`는 DB를 포함한 개발 볼륨을 모두 삭제하므로 초기화가 필요할 때만 사용한다. 인증과 출퇴근·휴게 기본 기록은 구현되어 있으며 실제 운영 배포와 근로 구간 분류·집계·임금 업무는 후속 구현 범위다.

설정 참고: [Next.js 설치](https://nextjs.org/docs/app/getting-started/installation), [Drizzle PostgreSQL](https://orm.drizzle.team/docs/get-started/postgresql-new).

## 인증 실행 및 계정 관리

`.env`에 `BETTER_AUTH_URL=http://localhost:3001`과 `BETTER_AUTH_SECRET`을 설정한다. 비밀키는 `openssl rand -base64 32`로 생성한 고유 값(최소 32자)을 사용한다. 운영에서는 HTTPS URL과 별도 키를 사용한다. 비밀키를 저장소에 커밋하지 않는다.

```sh
docker compose up --build -d
docker compose exec app npm ci
docker compose exec app npm run db:migrate
# 예시 이메일과 이름을 실제 관리자 정보로 바꾼다. 비밀번호는 숨겨진 프롬프트에서 입력한다.
docker compose exec app npm run accounts -- create admin@example.com 관리자 ADMIN
```

로그인: http://localhost:3001/login. 처음 로그인하면 비밀번호(12~128자)를 변경해야 한다. 공개 회원가입은 제공하지 않는다. 발급할 실제 관리자 정보와 임시 비밀번호가 아직 없으므로 개발 DB에 기본 관리자나 공용 비밀번호는 생성하지 않는다.

```sh
# 직원 / 부서장 발급 (부서장은 담당 부서명 필수)
npm run accounts -- create employee@example.com 직원 EMPLOYEE 개발
npm run accounts -- create manager@example.com 부서장 EMPLOYEE,MANAGER 개발
# 역할 변경은 전체 역할을 교체하며 기존 세션을 폐기한다.
npm run accounts -- roles manager@example.com 부서장 EMPLOYEE,MANAGER 개발
npm run accounts -- disable employee@example.com
```

위 명령을 호스트에서 실행하면 호스트용 DATABASE_URL을 사용한다. Docker에서는 앞에 `docker compose exec app`을 붙인다. CLI는 DB 운영 권한이 있는 관리자만 실행하며, 비밀번호를 명령행 인자로 넘기지 않는다. 세션은 발급 후 8시간에 만료하며 비활성 계정은 로그인과 기존 세션 접근이 차단된다. 관리자·부서장 화면과 API는 현재 권한 확인만 제공한다. 상세 결정은 [인증 결정 기록](docs/decisions/0001-authentication.md)을 참고한다.

## 인증 테스트

```sh
npm run test
# 최초 1회 전용 DB 생성 (이미 있으면 생략)
docker compose exec db psql -U wms -d postgres -c 'CREATE DATABASE wms_auth_test;'
DATABASE_URL=postgresql://wms:wms_dev@localhost:5433/wms_auth_test npm run db:migrate
TEST_DATABASE_URL=postgresql://wms:wms_dev@localhost:5433/wms_auth_test npm run test:integration
npx playwright install chromium
TEST_DATABASE_URL=postgresql://wms:wms_dev@localhost:5433/wms_auth_test npm run test:e2e
```

통합/E2E 테스트는 `_test`로 끝나는 DB만 허용하고 해당 DB의 인증·직원·부서 데이터를 초기화한다. 동일 테스트 DB를 사용하는 통합/E2E 테스트를 동시에 실행하지 않는다. E2E는 3002 포트에 별도 Next.js 서버를 띄우고 종료한다. 포트·자격증명을 바꾼 환경에서는 URL도 맞춘다.

## 업무 DB 스키마

ERD v1.2의 조직·근태·휴일·시급·계약·정산 테이블을 포함한다. 물리 제약과 미정 정책 처리 방식은 [DB 설계](docs/database-schema.md)를 참고한다. 기존 DB에도 `npm run db:migrate`로 순서대로 적용하며 기존 마이그레이션은 수정하지 않는다. btree_gist 확장 설치 권한이 필요하다.

스키마 테스트는 위 인증 테스트와 동일한 전용 `_test` DB에서 `npm run test:integration`으로 실행한다. 인증 테스트의 TRUNCATE CASCADE는 업무 데이터도 초기화한다. 개발·운영 DB를 테스트 DB로 사용하지 않는다.

## 출퇴근·휴게 기록

`/me`에서 출근·휴게 시작/종료·퇴근과 본인 현재 기록을 사용한다. 자정 이후 근무는 출근일에 귀속하며 PC는 헤더 IP의 허용 CIDR, 모바일은 GPS 반경 100m를 확인한다. GPS는 HTTPS 또는 localhost에서 사용한다. 개인 대시보드는 본인의 실제 근로시간, 이전 근무일의 미종료 기록, 오늘부터 14일간 등록 일정과 승인 휴가를 조회한다.

먼저 DB 운영자가 실제 근무지와 직원별 기본 정책을 등록한다. 아래 예시 좌표·CIDR·이메일·적용일은 실제 값으로 바꾼다. 네트워크를 무제한 허용하는 기본 설정은 만들지 않는다.

```sh
npx tsx scripts/attendance-setup.ts workplace main 본사 37.5665 126.9780 192.0.2.0/24
npx tsx scripts/attendance-setup.ts assign employee@example.com 2026-11-13
```

Docker에서는 `docker compose exec app`을 앞에 붙인다. 기존 근무지 ID나 정책 적용 기간과 충돌하면 실패하며 기존 데이터를 덮어쓰지 않는다. 정책 배정은 기본 8시간·휴게 1시간 규칙을 저장하고 반차·포괄·휴일 등 미정 항목은 유지한다. 실제 휴게 기록만 근로시간에서 제외한다.

요청 IP는 `X-Forwarded-For` 첫 IP, 없으면 `X-Real-IP`를 신뢰한다. 앱에 이 헤더가 전달되어야 PC 기록이 가능하다. 기기는 `X-Attendance-Device` 우선이며 없으면 모바일 관련 브라우저 헤더로 판별한다. 상세 API·상태·보존 및 후속 범위는 [근태 결정 기록](docs/decisions/0002-attendance-recording.md)을 따른다.

근태 테스트는 기존 테스트 명령(`npm run test`, `npm run test:integration`, `npm run test:e2e`)에 포함된다. 통합/E2E는 전용 `_test` DB의 업무 데이터도 초기화한다. 임금·주간 집계·근로 구간 분류와 정정 승인은 후속 기능이다.

## 근로시간 계산 엔진

마이그레이션 0006 적용 후 `GET /api/worktime?from=2026-11-01&to=2026-12-01&basis=WORK_DATE`로 본인 일·주·월 근로시간과 구간을 조회한다. `basis=ACTUAL_TIME`은 실제 시각 기준 배분이다. 종료일은 제외하며 주 시작일(`weekStartsOn`)·야간 종료(`nightEndHour`)를 생략하면 관련 결과는 미정으로 유지한다.

관리자는 `POST /api/admin/worktime/recalculate`에 `employeeId`, `from`, `to`, 선택적 `nightEndHour` JSON을 보내 종료 세션을 새 버전으로 계산한다. 정책·일정 변경 후에는 명시적 재계산이 필요하다. 기존 원본과 파생 이력을 보존한다. 상세 API·미정 정책·권한·후속 범위는 [결정 기록](docs/decisions/0003-worktime-calculation.md), 검증 결과는 [테스트 보고서](docs/worktime-test-results.md)를 참고한다. 개인 대시보드 차트는 서울 시간 월~일의 실제 시각 기준 실근로시간을 표시한다. 월~일은 화면 조회 범위이며 주 시작일·경보 정책을 확정하지 않는다. 진행 중 근무는 잠정 집계하고 미등록 날짜의 근무 여부는 추정하지 않는다. `GET /api/dashboard`는 로그인한 본인 데이터만 제공하며 30초마다 및 출퇴근·휴게 기록 직후 갱신한다.

## 부서장·관리자 대시보드

`/team`은 담당 부서의 재직자 근태, `/admin`은 전체 재직자·부서별 현황과 저장된 최신 정산 상태를 조회한다. 이름 검색·부서 필터와 30초 자동 갱신을 제공한다. 미확정 정산 금액은 미확정으로 표시한다. 하위 관리 화면도 실제 DB 조회에 연결했다. 근태 원본·정정·계산 버전·구간, 조직·권한, 정책·근무지·IP, 휴일·개인 일정, 시급·계약 이력, 정산 근거·조정 이력을 확인할 수 있다. 관리자 종료 근무일 재계산을 제공한다. 등록·수정·승인·새 임금 계산·정산 확정·Excel 등의 미구현 범위는 [기능별 구현 현황](docs/feature-status.md), 모듈 구조는 [화면 모듈](src/modules/workspace/README.md)을 참고한다.
