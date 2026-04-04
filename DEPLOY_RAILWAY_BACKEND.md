# SkinMatch Backend on Railway + Supabase

이 문서는 `backend` FastAPI 서비스는 Railway에 Dockerfile 기반으로 배포하고, 데이터베이스는 Vercel Storage에서 만든 Supabase Postgres를 사용하는 절차를 정리합니다.

## 배포 대상

- Repository: `https://github.com/back0319/skinmatch`
- Service type: Railway `Empty Service` 또는 `Connect Repo`
- Root Directory: `/backend`
- Build method: `backend/Dockerfile`
- Database: Supabase Postgres (created via Vercel Storage)

`backend` 디렉토리에 `Dockerfile`이 있으므로, Railway 서비스의 Root Directory를 `/backend`로 지정하면 Dockerfile이 자동으로 사용됩니다.

## 배포 구조

- Frontend: Vercel
- Backend API: Railway
- Database: Supabase Postgres

Vercel Marketplace Storage는 Vercel 프로젝트에는 환경변수를 자동 주입하지만, Railway 서비스에는 자동 연결되지 않습니다. 따라서 Supabase 연결 문자열을 Railway의 `DATABASE_URL`에 직접 넣어야 합니다.

## Supabase 연결 문자열 준비

Railway는 공식 문서 기준으로 현재 outbound IPv6를 지원하지 않으므로, Supabase의 Direct connection 대신 IPv4가 되는 `Supavisor session mode` 연결 문자열을 사용하는 것이 안전합니다.

사용 권장:

- `Session pooler` / `Supavisor session mode`
- 포트 `5432`
- `sslmode=require` 포함

피해야 할 것:

- `Direct connection`
  Supabase direct host는 IPv6 기반이라 Railway에서 실패할 수 있습니다.
- `Transaction pooler`
  Supabase 공식 문서상 prepared statements를 지원하지 않아 애플리케이션 런타임과 충돌할 수 있습니다.

예시:

```env
DATABASE_URL=postgresql+asyncpg://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require
```

`postgres://` 또는 `postgresql://` 형식이어도 앱이 내부에서 `postgresql+asyncpg://`로 자동 보정합니다.

## Railway 준비

1. Railway 프로젝트를 생성합니다.
2. 백엔드용 서비스를 하나 만듭니다.
3. 백엔드 서비스의 Source를 이 GitHub 저장소로 연결합니다.
4. 백엔드 서비스 Settings에서 Root Directory를 `/backend`로 설정합니다.
5. Healthcheck Path를 `/health`로 설정합니다.

## 필수 환경변수

서비스 Variables에 아래 값을 넣습니다.

```env
PORT=8000
DATABASE_URL=postgresql+asyncpg://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require
JWT_SECRET=replace-with-a-long-random-secret
ADMIN_USERNAME=admin
ADMIN_PASSWORD=replace-with-a-strong-password
CORS_ORIGINS=http://localhost:5173,https://your-frontend-domain.com
UPLOAD_DIR=uploads
AUTO_CREATE_TABLES=true
DATABASE_CONNECT_TIMEOUT=10
```

메모:

- Supabase를 Vercel Storage에서 만들었더라도, Railway에는 연결 문자열을 수동으로 넣어야 합니다.
- Railway에서는 Supabase `Session pooler` URL 사용을 권장합니다.
- `sslmode=require`를 유지하는 편이 안전합니다.
- `CORS_ORIGINS`는 쉼표 구분 문자열 또는 JSON 배열 문자열을 지원합니다.
- `AUTO_CREATE_TABLES=true`면 첫 시작 시 테이블 생성을 시도하지만, DB 연결 실패가 나더라도 컨테이너는 즉시 종료되지 않습니다.

## 배포 후 확인

- 서비스 도메인 예시: `https://skinmatch-backend-production.up.railway.app`
- Health check URL: `https://<your-railway-domain>/health`
- 기존 호환 경로: `https://<your-railway-domain>/api/health`

정상 응답 예시:

```json
{"status":"ok"}
```

## 선택 사항: 기초 데이터 시드

새 데이터베이스에 파운데이션 샘플 데이터를 넣어야 하면 한 번만 실행합니다.

```bash
cd backend
railway run python -m app.utils.seed
```

또는 Railway 서비스 Shell에서 아래를 실행해도 됩니다.

```bash
python -m app.utils.seed
```

주의:

- 이 시드 스크립트는 중복 실행 방지 로직이 없으므로 동일 DB에 여러 번 실행하지 않는 것이 안전합니다.

## 운영상 주의점

- `uploads/`는 컨테이너 내부의 임시 저장소입니다. 재배포나 재시작 시 사라질 수 있습니다.
- 데모/검증 용도에는 충분하지만, 장기 저장이 필요하면 추후 S3, Supabase Storage 같은 외부 스토리지로 분리해야 합니다.
- 현재는 Alembic 마이그레이션이 정리되어 있지 않아 `create_all()` 기반 초기화에 의존합니다. 운영 환경 고도화 시 마이그레이션 체계로 전환하는 것이 좋습니다.
- Supabase 쪽에서 connection string 종류를 여러 개 보여주면, Railway 백엔드에는 `Session pooler`를 우선 선택하는 것이 안전합니다.
