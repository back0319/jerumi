# 제루미

컬러체커가 보이는 얼굴 사진 한 장으로 대표 피부색을 추출하고, CIEDE2000 색차 기준으로 가까운 파운데이션을 추천하는 프로젝트입니다.

현재 배포 구조는 `Vercel Services + Supabase` 기준입니다.

## 주요 기능

- `/scan`
  - 얼굴 사진 업로드 또는 카메라 촬영
  - MediaPipe Face Mesh 기반 피부 ROI 추출
  - 컬러체커 패치 선택을 통한 색 보정
  - 대표 피부색 계산 후 파운데이션 추천
- `/admin`
  - 관리자 로그인
  - 파운데이션 수동 등록 / 수정 / 삭제
  - 스와치 사진 업로드 후 자동 색상 추출 및 저장
- `/api`
  - FastAPI 기반 인증, 분석, 파운데이션 CRUD

## 현재 대표 피부색 추출 방식

기존 broad cheek 평균 대신, 현재는 아래 ROI를 사용합니다.

- `lower_left_cheek`
- `lower_right_cheek`
- `below_lips`
- `chin`

분석 흐름은 다음과 같습니다.

1. 얼굴 ROI 픽셀 추출
2. 선택된 컬러체커 패치가 있으면 색 보정 행렬 적용
3. 각 ROI에서 대표 LAB 계산
   - `L*` 10~90 percentile trim
   - `a*` 상위 10% trim
   - LAB 기준 MAD filter
   - centroid에 가장 가까운 실제 샘플 픽셀 선택
4. ROI 대표색들 사이에서 `CIEDE2000 medoid` 선택
5. DB에 저장된 파운데이션 색과 `ΔE` 비교 후 상위 추천 반환

Face Mesh가 실패하면 lower-center fallback 영역으로 분석을 계속합니다.

## 기술 스택

- Frontend
  - Next.js 14
  - React 18
  - TypeScript
  - Tailwind CSS
  - MediaPipe Face Mesh
  - Vercel Web Analytics
- Backend
  - FastAPI
  - SQLAlchemy Async
  - asyncpg
  - colour-science
  - OpenCV
  - Pillow
- Infra
  - Vercel Services
  - Supabase Postgres
  - Supabase Storage

## 프로젝트 구조

```text
.
├─ frontend/                # Next.js 앱
│  ├─ src/app/page.tsx      # 랜딩 페이지
│  ├─ src/app/scan/page.tsx # 피부톤 분석 화면
│  ├─ src/app/admin/page.tsx# 관리자 화면
│  └─ src/lib/facemesh.ts   # 얼굴 ROI 정의
├─ backend/                 # FastAPI 앱
│  ├─ app/main.py           # API 엔트리포인트
│  ├─ app/routers/          # auth / analysis / foundations
│  ├─ app/services/         # 색 분석 / 스와치 추출 / Storage
│  ├─ app/utils/seed.py     # 샘플 이미지 기반 DB 시드
│  └─ shade_images/         # 시드용 파운데이션 샘플 이미지
├─ vercel.json              # Vercel Services 설정
├─ docker-compose.yml       # 로컬 개발용 전체 스택
└─ DEPLOY_VERCEL_SUPABASE.md
```

## 아키텍처

### Production

- `web` 서비스: `frontend`
- `api` 서비스: `backend/main.py`
- 공개 라우팅
  - `/` -> Next.js
  - `/api/*` -> FastAPI
- DB: Supabase Postgres
- 파일 저장: Supabase Storage public bucket

루트 [`vercel.json`](C:\Users\back0\skinmatch​\skinmatch\vercel.json)에서 Vercel `framework: services`를 사용합니다.

### Local

두 가지 방식으로 개발할 수 있습니다.

1. `docker-compose`로 전체 스택 실행
2. frontend/backend를 각각 직접 실행

## 환경 변수

루트 [`.env.example`](C:\Users\back0\skinmatch​\skinmatch\.env.example)를 기준으로 설정합니다.

핵심 값:

```env
PORT=8000
DATABASE_URL=postgresql+asyncpg://skinmatch:skinmatch_dev@localhost:5432/skinmatch
DATABASE_CONNECT_TIMEOUT=10
AUTO_CREATE_TABLES=true
JWT_SECRET=change-this-to-a-random-secret
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-this-admin-password
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_STORAGE_BUCKET=foundation-swatches
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
CORS_ORIGIN_REGEX=
NEXT_PUBLIC_API_URL=
```

메모:

- Vercel Services에서는 `NEXT_PUBLIC_API_URL`를 비워두는 것이 기본입니다.
- frontend만 따로 실행할 때만 `NEXT_PUBLIC_API_URL=http://localhost:8000` 같은 값을 넣습니다.
- 현재 backend는 `AUTO_CREATE_TABLES=true`일 때 시작 시점에 테이블 생성을 시도합니다.

## 빠른 시작

### 1. Docker Compose

```bash
docker compose up --build
```

기본 주소:

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:8000`
- Postgres: `localhost:5432`

### 2. 수동 실행

#### Backend

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r backend/requirements.txt
cd backend
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

#### Frontend

```bash
cd frontend
npm install
npm run dev
```

frontend를 단독으로 띄우는 경우:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## Vercel 기준 로컬 실행

Vercel 라우팅과 최대한 비슷하게 확인하려면:

```bash
npx vercel@latest dev -L
```

이 경우 `/api/*` 경로까지 포함한 실제 Services 라우팅을 로컬에서 확인할 수 있습니다.

## 데이터 시드

`backend/shade_images/`에 있는 샘플 이미지를 기준으로 파운데이션 데이터를 다시 채울 수 있습니다.

```bash
cd backend
python -m app.utils.seed
```

이 스크립트는:

- `shade_images/{brand}/*.png`를 읽고
- 각 이미지의 LAB/HEX를 계산한 뒤
- `foundations` 테이블을 비우고 다시 채웁니다

## 주요 API

Production 기준 공개 경로는 `/api/*` 입니다.

### 분석

- `POST /api/analyze`
  - 얼굴 피부 ROI 픽셀 기반 분석
- `GET /api/health`
  - 헬스체크

### 인증

- `POST /api/auth/login`
  - 관리자 로그인

### 파운데이션

- `GET /api/foundations`
- `GET /api/foundations/brands`
- `POST /api/foundations`
- `PUT /api/foundations/{id}`
- `DELETE /api/foundations/{id}`
- `POST /api/foundations/analyze-swatch`
  - 스와치 사진만 분석
- `POST /api/foundations/from-photo`
  - 스와치 사진 분석 후 DB 저장

메모:

- backend 단독 실행 시 실제 경로는 `/analyze`, `/auth/*`, `/foundations/*` 입니다.
- Vercel Services에서는 `routePrefix: /api`가 붙어서 `/api/...`로 노출됩니다.

## 관리자 인증

관리자 계정은 환경 변수로 제어합니다.

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`

로그인 후 `/admin`에서 데이터 관리와 스와치 업로드 기능을 사용할 수 있습니다.

## 배포

배포 체크리스트는 [DEPLOY_VERCEL_SUPABASE.md](C:\Users\back0\skinmatch​\skinmatch\DEPLOY_VERCEL_SUPABASE.md)를 참고하세요.

핵심 조건:

- Vercel 프로젝트 `Framework Preset`을 `Services`로 설정
- 루트 `vercel.json` 사용
- DB는 Supabase Postgres
- 업로드 이미지는 Supabase Storage 사용

## 확인 포인트

변경 후 최소 확인 항목:

1. `npm run build`
2. `GET /api/health`
3. `/scan`에서 분석 성공
4. `/admin` 로그인 및 foundation CRUD
5. `/api/foundations/from-photo` 업로드 후 `swatch_image_url` 생성 확인
6. foundation 삭제 시 Storage object 정리 확인

## 주의 사항

- 현재 색 분석은 컬러체커가 있을 때 가장 안정적입니다.
- 컬러체커 없이도 동작하지만, 조명/화이트밸런스 영향은 완전히 제거할 수 없습니다.
- DB 마이그레이션은 현재 Alembic보다 `create_all()` 기반 초기화 흐름이 우선입니다.
- `backend/uploads/`는 현재 production runtime 저장소가 아니라 과거 로컬 흔적입니다. 운영 업로드는 Supabase Storage를 사용합니다.
