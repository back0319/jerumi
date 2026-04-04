# Vercel + Supabase Deployment Checklist

## 1) Target Architecture

- Frontend (`frontend`): Vercel
- Backend (`backend`, FastAPI): deploy to any Python host (Render/Railway/Fly.io 등)
- Database: Supabase Postgres

> 이 프로젝트는 현재 `frontend`가 `NEXT_PUBLIC_API_URL`로 백엔드에 직접 요청합니다.

## 1-1) Vercel Frontend Project 설정

이 저장소는 모노레포 구조이므로, Vercel에서 프론트를 배포할 때 `Root Directory`를 반드시 `/frontend`로 설정해야 합니다.

- Root Directory: `/frontend`
- Framework Preset: `Next.js`
- Build Command: `next build` 기본값 사용 가능

`No Next.js version detected` 에러가 나오면 거의 항상 Vercel 프로젝트가 저장소 루트에서 빌드하고 있다는 뜻입니다. 이 경우 `frontend/package.json`을 못 찾고 있는 상태입니다.

## 2) Supabase: Database URL 준비

Supabase 프로젝트 생성 후 `Connection string`(Postgres)을 복사해서 백엔드 `DATABASE_URL`로 사용합니다.

중요:

- Railway 백엔드라면 `Direct connection`보다 `Supavisor session mode` 연결 문자열을 우선 사용합니다.
- 이유: Railway 공식 문서 기준 outbound IPv6가 지원되지 않아 Supabase direct host 연결이 실패할 수 있습니다.
- `Transaction mode`는 Supabase 공식 문서상 prepared statements를 지원하지 않으므로, 이 백엔드에는 권장하지 않습니다.

예시 형식:

```bash
DATABASE_URL=postgresql+asyncpg://<user>:<password>@<session-pooler-host>:5432/<db>?sslmode=require
```

## 3) Backend 환경변수 (필수)

아래 값을 백엔드 배포 서비스에 설정:

```bash
DATABASE_URL=postgresql+asyncpg://...
JWT_SECRET=<랜덤 긴 문자열>
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<강한 비밀번호>
UPLOAD_DIR=uploads
CORS_ORIGINS=https://<your-vercel-project>.vercel.app
CORS_ORIGIN_REGEX=^https://<your-vercel-project>(-[a-z0-9-]+)?\.vercel\.app$
```

메모:
- `CORS_ORIGINS`는 쉼표 구분 문자열도 지원합니다.
- `CORS_ORIGIN_REGEX`를 쓰면 Vercel preview 도메인까지 허용할 수 있습니다.
- Vercel Storage가 Vercel 프로젝트에는 환경변수를 자동 주입해도, Railway에는 자동 전달되지 않으므로 `DATABASE_URL`은 Railway에 직접 설정해야 합니다.

## 4) Vercel 환경변수 (필수)

Vercel 프로젝트(Frontend)에 아래 변수 설정:

```bash
NEXT_PUBLIC_API_URL=https://<your-backend-domain>
```

`Production` + `Preview` 둘 다 설정 권장.

## 5) 배포 후 확인

1. 백엔드 헬스체크:

```bash
curl https://<your-backend-domain>/api/health
```

2. 프론트 배포 URL 접속 후 `/scan`에서 이미지 업로드 테스트
3. 브라우저 콘솔에 CORS 에러 없는지 확인
4. `/admin` 로그인/분석 API 호출 확인

## 6) 이 리포에서 이미 반영된 항목

- 백엔드 CORS를 환경변수 기반으로 변경:
  - `CORS_ORIGINS`
  - `CORS_ORIGIN_REGEX`
- `.env.example`에 CORS 변수 추가
- `docker-compose.yml`에 로컬 CORS 변수 추가
