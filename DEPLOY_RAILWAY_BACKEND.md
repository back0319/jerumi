# SkinMatch Backend on Railway

이 문서는 `backend` FastAPI 서비스만 Railway에 Dockerfile 기반으로 배포하는 절차를 정리합니다.

## 배포 대상

- Repository: `https://github.com/back0319/skinmatch`
- Service type: Railway `Empty Service` 또는 `Connect Repo`
- Root Directory: `/backend`
- Build method: `backend/Dockerfile`

`backend` 디렉토리에 `Dockerfile`이 있으므로, Railway 서비스의 Root Directory를 `/backend`로 지정하면 Dockerfile이 자동으로 사용됩니다.

## Railway 준비

1. Railway 프로젝트를 생성합니다.
2. 같은 프로젝트에 `Postgres` 서비스를 추가합니다.
3. 백엔드용 서비스를 하나 만듭니다.
4. 백엔드 서비스의 Source를 이 GitHub 저장소로 연결합니다.
5. 백엔드 서비스 Settings에서 Root Directory를 `/backend`로 설정합니다.
6. Healthcheck Path를 `/health`로 설정합니다.

## 필수 환경변수

서비스 Variables에 아래 값을 넣습니다.

```env
PORT=8000
DATABASE_URL=${{Postgres.DATABASE_URL}}
JWT_SECRET=replace-with-a-long-random-secret
ADMIN_USERNAME=admin
ADMIN_PASSWORD=replace-with-a-strong-password
CORS_ORIGINS=http://localhost:5173,https://your-frontend-domain.com
UPLOAD_DIR=uploads
AUTO_CREATE_TABLES=true
DATABASE_CONNECT_TIMEOUT=10
```

메모:

- Railway Postgres가 제공하는 `DATABASE_URL`이 `postgres://` 또는 `postgresql://` 형식이어도 앱에서 `postgresql+asyncpg://` 형식으로 자동 보정합니다.
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
