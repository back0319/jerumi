# Vercel Services + Supabase Deployment Checklist

## 1) Target Architecture

- Frontend: Vercel `web` service from `frontend`
- Python API: Vercel `api` service from `backend/main.py`
- Database: Supabase Postgres
- File storage: Supabase Storage public bucket

이 저장소는 루트 [`vercel.json`](C:/Users/back0/skinmatch​/skinmatch/vercel.json) 기준으로 `experimentalServices`를 사용합니다. Vercel 프로젝트의 `Framework Preset`은 반드시 `Services`로 설정해야 합니다.

## 2) Required Vercel Project Settings

- Root Directory: repository root `/`
- Framework Preset: `Services`
- No separate frontend-only project root

`web` 서비스는 `frontend`를 `/`에, `api` 서비스는 `backend/main.py`를 `/api`에 노출합니다. 외부 공개 경로는 기존과 동일하게 `/api/analyze`, `/api/auth/login`, `/api/foundations...` 입니다.

## 3) Supabase Setup

### Database

`DATABASE_URL`에는 Supabase Postgres 연결 문자열을 넣습니다.

권장:

- `Session pooler` / `Supavisor session mode`
- `sslmode=require` 포함

예시:

```env
DATABASE_URL=postgresql+asyncpg://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require
```

### Storage

1. Supabase Storage에서 public bucket 하나를 생성합니다.
2. bucket 이름을 `SUPABASE_STORAGE_BUCKET`에 넣습니다.
3. Python API는 `SUPABASE_SERVICE_ROLE_KEY`로 업로드/삭제를 수행합니다.

이 앱은 `/api/foundations/from-photo` 호출 시 원본 이미지를 Supabase Storage에 저장하고, `swatch_image_url`에 public URL을 기록합니다.

## 4) Required Environment Variables

Vercel 프로젝트에 아래 값을 설정합니다.

```env
DATABASE_URL=postgresql+asyncpg://...
DATABASE_CONNECT_TIMEOUT=10
AUTO_CREATE_TABLES=false
JWT_SECRET=replace-with-a-long-random-secret
ADMIN_USERNAME=admin
ADMIN_PASSWORD=replace-with-a-strong-password
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
SUPABASE_STORAGE_BUCKET=foundation-swatches
CORS_ORIGINS=https://<your-domain>,http://localhost:3000
CORS_ORIGIN_REGEX=
```

메모:

- `NEXT_PUBLIC_API_URL`는 Vercel Services 배포에서는 비워두는 편이 맞습니다.
- 프론트만 따로 `npm run dev` 할 때만 `NEXT_PUBLIC_API_URL=http://localhost:8000` 같은 override를 사용합니다.
- 운영 배포에서는 `AUTO_CREATE_TABLES=false`를 유지하세요. `true`면 cold start 시점에 테이블 생성 경로를 타서 첫 요청 지연이 커질 수 있습니다.

## 5) Local Development

### Full stack with Vercel routing

```bash
npx vercel@latest dev -L
```

### Existing docker-compose

`docker-compose.yml`은 그대로 사용할 수 있습니다. 이 경우 frontend는 `NEXT_PUBLIC_API_URL=http://localhost:8000`를 사용하고, backend는 prefixless route(`/auth/login`, `/foundations`, `/analyze`)를 직접 노출합니다.

## 6) Verification

배포 후 아래를 확인합니다.

1. `GET /api/health`
2. `/scan`에서 분석 요청이 `/api/analyze`로 성공하는지
3. `/admin` 로그인과 foundation CRUD가 정상 동작하는지
4. `from-photo` 등록 시 `swatch_image_url`이 Supabase Storage public URL인지
5. 삭제 시 Storage object도 함께 정리되는지
