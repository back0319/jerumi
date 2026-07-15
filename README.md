# 제루미 (Jerumi)

얼굴 사진에서 대표 피부색을 분석하고, 색차를 기준으로 가까운 파운데이션을 추천하는 웹 서비스입니다.

- 프로젝트 상태: 개발 완료
- 현재 버전: `v1.4.0`
- 라이브 데모: [https://jerumi.vercel.app/](https://jerumi.vercel.app/)
- GitHub: [https://github.com/back0319/jerumi](https://github.com/back0319/jerumi)

## 프로젝트 소개

제루미는 얼굴 전체의 단순 평균색 대신 볼, 입 아래, 턱 등 여러 피부 영역을 각각 분석해 대표 피부색을 계산합니다. 사진에 Calibrite ColorChecker Classic Mini가 포함되어 있으면 조명과 카메라에 따른 색 편차를 보정하고, 저장된 파운데이션 색상과 CIEDE2000 색차를 비교해 가까운 제품을 추천합니다.

일반 사용자는 사진 업로드 또는 카메라 촬영으로 분석을 시작할 수 있으며, 관리자는 별도의 데이터 관리 화면에서 파운데이션 정보를 등록하고 관리할 수 있습니다.

## 주요 기능

- 얼굴 랜드마크를 이용한 피부 ROI 자동 추출
- 업로드 이미지와 브라우저 카메라 촬영 지원
- ColorChecker Classic Mini 자동 감지 및 색 보정
- CIELAB 색공간과 CIEDE2000 기반 파운데이션 추천
- 브랜드와 제품별 추천 결과 필터링
- 파운데이션 데이터 등록, 수정, 삭제
- 스와치 사진 분석 및 색상 자동 추출
- 관리자용 얼굴 ROI 검증 도구

## 사용 흐름

### 피부 분석

1. `/scan`에서 얼굴과 컬러체커가 함께 보이는 사진을 업로드하거나 촬영합니다.
2. 브라우저에서 얼굴 랜드마크와 피부 분석 영역을 찾습니다.
3. 컬러체커가 감지되면 패치 색상을 기준으로 색 보정을 적용합니다.
4. 여러 피부 영역의 색을 비교해 대표 피부색을 계산합니다.
5. 저장된 파운데이션과의 색차가 작은 순서로 추천 결과를 보여줍니다.

### 데이터 관리

1. `/admin`에서 관리자 계정으로 로그인합니다.
2. 파운데이션 정보를 직접 입력하거나 스와치 사진을 분석해 등록합니다.
3. 브랜드별 데이터를 조회하고 기존 항목을 수정하거나 삭제합니다.
4. 필요할 때 ROI 검증 도구로 얼굴 분석 영역과 픽셀 수를 확인합니다.

## 기술 스택

| 영역 | 기술 |
| --- | --- |
| Frontend | Next.js 14, React 18, TypeScript, Tailwind CSS |
| 얼굴 분석 | MediaPipe Face Mesh, Canvas API |
| Backend | FastAPI, SQLAlchemy Async, NumPy, Pillow, OpenCV |
| 인증 | JWT (`python-jose`) |
| Database | Supabase Postgres |
| Storage | Supabase Storage |
| Deployment | Vercel Services |
| Monitoring | Vercel Analytics, Speed Insights |

## 아키텍처

```text
Browser
  └─ Next.js web service
       ├─ 얼굴 랜드마크·피부 ROI·컬러체커 전처리
       └─ /api 요청
            └─ FastAPI service
                 ├─ 피부색·색차 계산
                 ├─ 파운데이션 추천 및 관리
                 ├─ Supabase Postgres
                 └─ Supabase Storage
```

Vercel Services에서 `frontend`는 `/`, `backend`는 `/api` 경로를 담당합니다. 프론트엔드와 API를 따로 실행할 때는 `NEXT_PUBLIC_API_URL`로 API 주소를 지정할 수 있습니다.

## 폴더 구조

```text
.
├─ frontend/                   # Next.js 웹 애플리케이션
│  └─ src/
│     ├─ app/                  # 홈, 피부 분석, 데이터 관리 화면
│     ├─ components/           # 카메라 및 관리자 UI
│     ├─ hooks/                # 분석·관리 워크플로 상태
│     └─ lib/                  # API, 색 계산, ROI, 컬러체커 로직
├─ backend/                    # FastAPI 애플리케이션
│  ├─ app/
│  │  ├─ routers/              # 인증, 분석, 파운데이션 API
│  │  ├─ services/             # 색 분석, 스와치 추출, Storage
│  │  └─ models/               # 데이터베이스 모델
│  └─ tests/                   # 백엔드 회귀 테스트
├─ evaluation/                 # ROI 분석 검증 자료
├─ docker-compose.yml          # 로컬 통합 실행 환경
└─ vercel.json                 # Vercel Services 설정
```

## 로컬 실행

### Docker Compose

저장소 루트에서 전체 서비스를 실행합니다.

```bash
docker compose up --build
```

- 웹: `http://localhost:3000`
- API: `http://localhost:8000`
- PostgreSQL: `localhost:5432`

### 개별 실행

Backend:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements-dev.txt
cd backend
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Frontend:

```bash
cd frontend
npm install
NEXT_PUBLIC_API_URL=http://localhost:8000 npm run dev
```

개별 실행 전 PostgreSQL과 필요한 환경 변수를 준비해야 합니다.

## 환경 변수

루트의 [`.env.example`](.env.example)을 기준으로 설정합니다.

| 변수 | 설명 |
| --- | --- |
| `DATABASE_URL` | PostgreSQL 연결 문자열 |
| `DATABASE_CONNECT_TIMEOUT` | 데이터베이스 연결 제한 시간 |
| `AUTO_CREATE_TABLES` | 시작 시 테이블 자동 생성 여부 |
| `JWT_SECRET` | 관리자 인증 토큰 서명 키 |
| `ADMIN_USERNAME` | 관리자 계정 이름 |
| `ADMIN_PASSWORD` | 관리자 계정 비밀번호 |
| `SUPABASE_URL` | Supabase 프로젝트 URL |
| `SUPABASE_SERVICE_ROLE_KEY` | 서버에서 Storage를 사용할 서비스 역할 키 |
| `SUPABASE_STORAGE_BUCKET` | 파운데이션 이미지 저장 버킷 |
| `CORS_ORIGINS` | 허용할 브라우저 출처 목록 |
| `NEXT_PUBLIC_API_URL` | 프론트엔드와 API를 따로 실행할 때 사용할 API 주소 |

`SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`, 관리자 비밀번호는 서버 환경 변수로만 관리하고 브라우저나 Git 기록에 노출하지 않아야 합니다.

## 검증

Frontend:

```bash
cd frontend
npx tsc --noEmit
npm run build
```

Backend:

```bash
python3 -m pytest backend/tests
```

## 배포

운영 환경은 하나의 Vercel 프로젝트에서 Next.js 웹 서비스와 FastAPI 서비스를 함께 배포하는 Vercel Services 구조입니다. 데이터베이스와 이미지 저장소는 Supabase를 사용합니다.

배포 환경 변수, 라우팅, 점검 절차는 [DEPLOY_VERCEL_SUPABASE.md](DEPLOY_VERCEL_SUPABASE.md)를 참고하세요.

## 참고 문서

- [기존 README 및 릴리스 기록](README_LEGACY.md)
- [Vercel·Supabase 배포 가이드](DEPLOY_VERCEL_SUPABASE.md)
- [ROI 평가 자료 안내](evaluation/README.md)
