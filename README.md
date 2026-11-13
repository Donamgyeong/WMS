# WMS

Next.js App Router + TypeScript + PostgreSQL 17 + Drizzle ORM (`node-postgres`). Node.js 24와 npm을 개발 컨테이너에서 사용한다. 근무 규칙은 [AGENTS.md](AGENTS.md), 구현 계획은 [docs](docs/attendance-system-plan.md)를 참고한다.

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

`src/db/schema.ts`에 도메인 스키마를 작성하고 SQL을 생성·검토·적용한다. 현재 업무 테이블은 없으며 payroll 스키마를 생성하는 초기 마이그레이션을 포함했다. 마이그레이션은 앱 시작 시 자동 적용하지 않는다.

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

`docker compose down`은 DB 데이터를 보존한다. `docker compose down -v`는 DB를 포함한 개발 볼륨을 모두 삭제하므로 초기화가 필요할 때만 사용한다. 실제 운영 배포·인증·업무 기능은 후속 구현 범위다.

설정 참고: [Next.js 설치](https://nextjs.org/docs/app/getting-started/installation), [Drizzle PostgreSQL](https://orm.drizzle.team/docs/get-started/postgresql-new).
