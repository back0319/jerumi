# 제루미

현재 기준 버전: `v1.2.0`

제루미는 얼굴 사진 1장으로 대표 피부색을 추정하고, 현재 저장된 파운데이션 데이터 중에서 색이 가장 가까운 제품을 추천하는 서비스입니다.

운영 구조는 `Vercel Services + Supabase` 기준입니다.

## 이 서비스가 하는 일

- 일반 사용자는 `/scan`에서 얼굴 사진을 올리거나 촬영해 피부색 분석 결과를 볼 수 있습니다.
- 관리자는 `/admin`에서 파운데이션 정보를 등록, 수정, 삭제할 수 있습니다.
- 관리자는 스와치 사진을 올려 제품 색상을 자동으로 추출하고 저장할 수 있습니다.
- 관리자는 ROI 검증 도구로 얼굴의 어떤 영역을 분석에 사용했는지 확인할 수 있습니다.

## 일반 사용자 기준 사용 흐름

1. 얼굴 사진을 올립니다.
2. 시스템이 얼굴에서 피부색을 보기 좋은 영역을 찾습니다.
3. 컬러체커가 있으면 색 보정을 적용합니다.
4. 여러 영역을 비교해 대표 피부색을 하나로 정합니다.
5. 저장된 파운데이션 색과 비교해 가장 가까운 후보를 추천합니다.

## 정확도를 위해 하는 일

제루미는 얼굴 전체 평균색을 단순히 쓰지 않습니다.

- 하부 볼
- 입 아래
- 턱

이 영역들을 따로 보고, 조명 반사나 홍조처럼 흔들리기 쉬운 픽셀을 줄인 뒤 대표 피부색을 계산합니다. 그래서 단순 평균보다 결과가 덜 흔들리도록 설계되어 있습니다.

## 현재 릴리스 요약

### `v1.2.0`

- 관리자용 ROI 검증 기능을 `/admin`으로 정리
- 일반 사용자 `/scan` 화면을 더 단순하게 정리
- 관리자 페이지 내부 구조를 리팩터링해 유지보수성을 개선
- Python cold start를 줄이기 위해 런타임 번들과 startup import를 경량화
- `colour-science` 제거 후 내부 NumPy 색 계산으로 교체
- 스와치 추출을 `Pillow + NumPy` 기반으로 재작성
- Vercel Speed Insights 추가

### `v1.1.0`

- 대표 피부색 추출을 `lower_left_cheek / lower_right_cheek / below_lips / chin` 기반으로 개편
- ROI별 대표색을 계산한 뒤 `CIEDE2000 medoid` 방식으로 최종 피부색 선택
- 분석 응답에 `analysis_meta`, confidence, ROI pixel count 추가
- ROI 검증용 `evaluation/` 워크플로우 추가

## 기술 스택 한눈에 보기

아래 표는 이 프로젝트에서 실제로 사용 중인 핵심 기술과 그 역할을 정리한 것입니다.

### 제품 핵심 스택

| 분야 | 기술 | 버전 | 이 기술을 쓰는 이유 |
| --- | --- | --- | --- |
| 웹 프론트엔드 | Next.js | `^14.2.0` | 사용자 화면, 관리자 화면, 페이지 라우팅을 담당합니다. |
| UI 라이브러리 | React | `^18.3.0` | 화면 컴포넌트와 상호작용을 구성합니다. |
| 프론트엔드 언어 | TypeScript | `^5.5.0` | 화면 코드의 안정성과 유지보수성을 높입니다. |
| 스타일링 | Tailwind CSS | `^3.4.0` | 화면 스타일을 빠르게 일관되게 관리합니다. |
| 카메라/사진 입력 | react-webcam | `^7.2.0` | 브라우저 카메라 촬영 기능에 사용합니다. |
| 얼굴 랜드마크 추출 | MediaPipe Face Mesh | `^0.4.1633559619` | 얼굴에서 피부색 분석용 ROI를 찾는 데 사용합니다. |
| 카메라 유틸 | @mediapipe/camera_utils | `^0.3.1675466862` | MediaPipe와 브라우저 카메라를 연결할 때 사용합니다. |
| 백엔드 API | FastAPI | `0.115.0` | 로그인, 피부색 분석, 파운데이션 CRUD API를 제공합니다. |
| ORM | SQLAlchemy Async | `2.0.35` | 데이터베이스 테이블과 쿼리를 Python 코드로 다룹니다. |
| PostgreSQL 드라이버 | asyncpg | `0.30.0` | PostgreSQL과 빠르게 비동기 통신합니다. |
| 수치 계산 | NumPy | `1.26.4` | 피부색 변환, 색차 계산, 대표값 계산에 사용합니다. |
| 이미지 처리 | Pillow | `11.2.1` | 업로드된 이미지 해석과 스와치 추출에 사용합니다. |
| 인증 토큰 | python-jose[cryptography] | `3.3.0` | 관리자 로그인용 JWT 처리에 사용합니다. |
| 업로드 처리 | python-multipart | `0.0.12` | 이미지 파일 업로드 API를 처리합니다. |
| 설정 관리 | pydantic-settings | `2.5.0` | 환경 변수를 안전하게 읽어 앱 설정으로 씁니다. |
| Supabase SDK | supabase | `>=2.15,<3.0` | Supabase Storage 업로드/삭제에 사용합니다. |
| 배포 플랫폼 | Vercel Services | 관리형 서비스 | Next.js와 Python API를 하나의 프로젝트로 함께 배포합니다. |
| 운영 데이터베이스 | Supabase Postgres | 관리형 서비스 | 파운데이션 데이터와 운영 데이터를 저장합니다. |
| 이미지 저장소 | Supabase Storage | 관리형 서비스 | 스와치 원본 이미지를 저장합니다. |
| 방문 분석 | @vercel/analytics | `^1.5.0` | 웹 방문 지표를 수집합니다. |
| 성능 모니터링 | @vercel/speed-insights | `^2.0.0` | 실제 사용자 기준 성능 지표를 확인합니다. |

### 개발과 운영 보조 스택

| 분야 | 기술 | 버전 | 역할 |
| --- | --- | --- | --- |
| 로컬 Python 서버 | uvicorn[standard] | `0.30.0` | 로컬에서 FastAPI를 실행할 때 사용합니다. |
| DB 마이그레이션 보조 | alembic | `1.13.0` | 현재 운영 핵심 경로는 아니지만 개발용으로 남아 있습니다. |
| 로컬 시드 이미지 처리 | opencv-python-headless | `4.10.0.84` | 로컬 시드 스크립트에서 파운데이션 샘플 이미지를 처리합니다. |

메모:

- 버전은 `package.json`, `requirements.txt`, `requirements-dev.txt` 기준입니다.
- `Vercel Services`, `Supabase Postgres`, `Supabase Storage`는 저장소 안에 고정 버전이 적히는 패키지가 아니라 관리형 클라우드 서비스라서 “관리형 서비스”로 표기했습니다.

## 현재 배포 구조

운영 기준 구조는 아래와 같습니다.

- `web` 서비스: `frontend`
- `api` 서비스: `backend/main.py`
- 공개 라우팅
  - `/` -> Next.js
  - `/api/*` -> FastAPI
- 데이터베이스 -> Supabase Postgres
- 이미지 저장 -> Supabase Storage

즉, 사용자는 웹 화면을 보고, 웹 화면은 같은 도메인의 `/api`를 호출하고, API는 DB와 Storage를 사용하는 구조입니다.

## 폴더 구조

```text
.
├─ frontend/                # Next.js 웹 앱
│  ├─ src/app/page.tsx      # 랜딩 페이지
│  ├─ src/app/scan/page.tsx # 일반 사용자 분석 화면
│  ├─ src/app/admin/page.tsx# 관리자 화면
│  └─ src/lib/facemesh.ts   # 얼굴 ROI 정의
├─ backend/                 # FastAPI API 서버
│  ├─ app/main.py           # API 엔트리포인트
│  ├─ app/routers/          # auth / analysis / foundations
│  ├─ app/services/         # 색 분석 / 스와치 추출 / Storage
│  ├─ app/utils/seed.py     # 샘플 이미지 기반 DB 시드
│  ├─ tests/                # 회귀 테스트
│  └─ shade_images/         # 로컬 시드용 이미지
├─ evaluation/              # 로컬 ROI 검증용 샘플/기록
├─ vercel.json              # Vercel Services 설정
├─ docker-compose.yml       # 로컬 전체 실행 설정
└─ DEPLOY_VERCEL_SUPABASE.md
```

## 환경 변수

루트 `.env.example`를 기준으로 설정합니다.

핵심 값은 아래와 같습니다.

| 변수명 | 의미 |
| --- | --- |
| `DATABASE_URL` | PostgreSQL 연결 문자열 |
| `DATABASE_CONNECT_TIMEOUT` | DB 연결 대기 시간 |
| `AUTO_CREATE_TABLES` | 시작 시 테이블 생성 경로 사용 여부 |
| `JWT_SECRET` | 관리자 로그인 토큰 서명 키 |
| `ADMIN_USERNAME` | 관리자 아이디 |
| `ADMIN_PASSWORD` | 관리자 비밀번호 |
| `SUPABASE_URL` | Supabase 프로젝트 URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Storage 업로드/삭제 권한 키 |
| `SUPABASE_STORAGE_BUCKET` | 스와치 이미지가 저장될 bucket 이름 |
| `CORS_ORIGINS` | 허용할 브라우저 출처 목록 |
| `NEXT_PUBLIC_API_URL` | 프론트만 따로 띄울 때 API 주소 override |

중요:

- 운영 배포에서는 `AUTO_CREATE_TABLES=false`를 유지하는 것이 좋습니다.
- Vercel Services 환경에서는 `NEXT_PUBLIC_API_URL`를 비워두는 것이 기본입니다.
- `backend/requirements.txt`는 Vercel 런타임용 최소 의존성입니다.
- 로컬에서 backend를 직접 실행하거나 Docker 개발 환경을 쓸 때는 `backend/requirements-dev.txt`를 사용합니다.

## 빠른 시작

### 1. 전체 스택을 한 번에 실행

```bash
docker compose up --build
```

기본 주소:

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:8000`
- Postgres: `localhost:5432`

### 2. 각각 따로 실행

#### Backend

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r backend/requirements-dev.txt
cd backend
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

#### Frontend

```bash
cd frontend
npm install
npm run dev
```

프론트만 따로 띄우는 경우에는 아래 값을 넣습니다.

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

### 3. Vercel 라우팅과 가깝게 로컬에서 보기

```bash
npx vercel@latest dev -L
```

이 방식은 `/api/*`를 포함한 실제 배포 라우팅과 가장 비슷하게 확인할 때 유용합니다.

## 주요 API

운영 기준 공개 경로는 `/api/*` 입니다.

| 경로 | 역할 |
| --- | --- |
| `POST /api/analyze` | 얼굴 피부 ROI 픽셀을 분석하고 추천 결과를 반환 |
| `GET /api/health` | 헬스체크 |
| `POST /api/auth/login` | 관리자 로그인 |
| `GET /api/foundations` | 파운데이션 목록 조회 |
| `GET /api/foundations/brands` | 브랜드 목록 조회 |
| `POST /api/foundations` | 파운데이션 수동 등록 |
| `PUT /api/foundations/{id}` | 파운데이션 수정 |
| `DELETE /api/foundations/{id}` | 파운데이션 삭제 |
| `POST /api/foundations/analyze-swatch` | 스와치 사진만 분석 |
| `POST /api/foundations/from-photo` | 스와치 사진 분석 후 DB 저장 |

메모:

- backend만 직접 실행하면 실제 경로는 `/analyze`, `/auth/*`, `/foundations/*` 입니다.
- Vercel Services에서는 `routePrefix: /api`가 붙어서 `/api/...`로 외부에 노출됩니다.

## 데이터 시드

`backend/shade_images/`에 있는 샘플 이미지를 기준으로 파운데이션 데이터를 다시 채울 수 있습니다.

```bash
cd backend
python -m app.utils.seed
```

이 스크립트는 샘플 이미지에서 색을 읽어 `foundations` 테이블을 다시 구성합니다.

## ROI 검증용 로컬 자료

대표 피부색 추출 튜닝을 위해 `evaluation/` 디렉터리를 사용합니다.

- `evaluation/samples`
  - 로컬 검증용 얼굴 샘플 이미지
- `evaluation/records`
  - ROI 오버레이 이미지, 평가 JSON, 배치 검증 결과

이 자료들은 `.gitignore`로 제외되어 있어서 로컬 검증에는 쓰지만 Git 저장소에는 올라가지 않습니다.

## 운영 체크 포인트

변경 후 최소 확인 항목:

1. `npm run build`
2. `python -m unittest discover -s backend/tests -p "test_*.py"`
3. `GET /api/health`
4. `/scan`에서 분석 성공
5. `/admin` 로그인 및 foundation CRUD
6. `/api/foundations/from-photo` 업로드 후 `swatch_image_url` 생성 확인
7. foundation 삭제 시 Storage object 정리 확인

## 참고 문서

- 배포 체크리스트: `DEPLOY_VERCEL_SUPABASE.md`
- Vercel 설정: `vercel.json`
- 환경 변수 예시: `.env.example`
