# 제루미

현재 기준 버전: `v1.2.5`

제루미는 얼굴 사진 1장으로 대표 피부색을 추정하고, 현재 저장된 파운데이션 데이터 중에서 색이 가장 가까운 제품을 추천하는 서비스입니다.

운영 구조는 `Vercel Services + Supabase` 기준입니다.

## 이 서비스가 하는 일

- 일반 사용자는 `/scan`에서 얼굴 사진을 올리거나 촬영해 피부색 분석 결과를 볼 수 있습니다.
- 관리자는 `/admin`에서 파운데이션 정보를 등록, 수정, 삭제할 수 있습니다.
- 관리자는 스와치 사진을 올려 제품 색상을 자동으로 추출하고 저장할 수 있습니다.
- 관리자는 ROI 검증 도구로 얼굴의 어떤 영역을 분석에 사용했는지 확인할 수 있습니다.
- 사진 안에 Calibrite ColorChecker Classic Mini가 있으면 자동으로 감지해 색 보정에 사용합니다.

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

컬러체커가 함께 찍힌 사진에서는 카드 외곽과 내부 24개 패치 격자를 자동으로 찾고, 측정된 패치 RGB를 표준 ColorChecker LAB 값에 맞춰 XYZ 보정 행렬을 계산합니다. 카드가 머리카락이나 옷처럼 어두운 영역과 붙어 보이는 경우에는 검은 카드 body 대신 6x4 컬러 패치 격자 자체를 찾는 fallback을 사용합니다.

## 현재 릴리스 요약

### `v1.2.5`

- 분석 신뢰도가 직사광 셀카에서 과도하게 낮게 표시되던 문제 완화
  - 그늘/홍조로 제외된 ROI를 ROI 간 `max_region_delta_e` 계산에서도 함께 빼서 같은 ROI가 두 번 페널티를 받던 더블카운팅 제거
  - ΔE 페널티 임계 5/8 → 7/10으로 완화, 제외 ROI 페널티 `-0.06` → `-0.03`
  - 결과적으로 직사광 셀카 기준 신뢰도가 0.55~0.65 (낮음) → 0.75~0.85 (보통/높음) 수준으로 올라옴
- 관리자 사진 기반 화장품 등록에도 분석 신뢰도 점수 추가
  - `0.5 · 컬러체커 신뢰도 + 0.3 · 샘플 픽셀수 + 0.2 · LAB 균일도`의 가중합
  - 등급(높음/보통/낮음) 배지·진행바·원인 노트(체커 미검출, 샘플 부족, 색 편차 큼 등)를 추출 결과 카드에 함께 표시
  - `/api/foundations/analyze-swatch`, `/api/foundations/from-photo` 응답에 `confidence: { score, level, notes }` 필드 추가
- DB 스키마 변경 없음. Supabase 마이그레이션 불필요

### `v1.2.4`

- `/scan` 컬러체커 확인 단계의 오버레이가 letterbox 영역까지 그려지던 정렬 버그 수정
- 자동 검출 결과 패널을 한 줄 요약(상태 · 신뢰도 · 패치 · 보정 · 피부 픽셀 수) + "자세히" 토글로 압축. `/admin` 사진 분석 폼도 동일한 형식으로 정리
- 분석 결과 화면에 얼굴 사진 썸네일과 컬러체커 보정 전/후 스와치 비교를 추가. `/api/analyze` 응답에 `skin_lab_raw`, `skin_hex_raw`, `correction_applied` 필드 추가
- 컬러체커 검출 신뢰도 산식을 score 단일 변수에서 `score · 패치 수 · 코너 정렬`의 가중 합으로 교체(프론트/백엔드 동기화). 카드 검출 다운샘플 한도를 640 → 960으로 상향해 작은 카드의 코너 정밀도 개선
- 직사광 셀카에서 결과가 그늘 쪽으로 끌려가던 문제 완화: `_trim_lightness`를 p10–p90 대칭 트림에서 **p50–p97 (밝은 절반 선호)** 로 변경, 표본 추출에서 클리핑 픽셀(≥250) 및 노이즈성 그림자 픽셀(≤8) 제외
- DB 스키마 변경 없음. Supabase 마이그레이션 불필요

### `v1.2.3`

- 얼굴 피부색 분석에서 ColorChecker 보정 행렬을 더 보수적으로 적용해 a* / b*가 과하게 붉거나 노랗게 밀리는 현상 완화
- 하부 얼굴 ROI에서 홍조/입술색 영향이 큰 영역을 더 강하게 제거하고, 고립된 붉은 ROI는 대표 피부색 선택에서 제외
- 분석 confidence note에 홍조/입술색 영향으로 제외된 ROI를 표시
- `/scan` 분석 전 화면에서 24개 컬러체커 swatch 목록을 제거하고 컬러체커 신뢰도 중심 UI로 압축
- 관리자 사진 기반 화장품 등록의 자동 감지 결과 UI를 컬러체커 신뢰도와 샘플 색상 요약 중심으로 정리
- 컬러체커 overlay는 내부 패치 박스 대신 카드 외곽/중앙점 중심으로 표시해 화면 점유와 시각적 혼잡을 줄임
- DB 스키마 변경 없음. Supabase 마이그레이션 불필요

### `v1.2.2`

- 얼굴 사진에서 ColorChecker Classic Mini가 화면 가장자리나 일부 어두운 영역에 붙어 있어도 패치 격자 후보를 보정해 자동 감지
- 패치 격자의 일부 행/열 후보가 빠진 경우에도 균일 간격으로 카드 외곽을 재추정
- 컬러체커 보정이 피부/회색축 밝기를 과하게 낮추지 않도록 XYZ 보정 후 luminance floor 적용
- 제공된 얼굴+컬러체커 3장 기준 컬러체커 자동 감지와 패치 ΔE 개선을 확인

### `v1.2.1`

- 직접 촬영 카메라 프리뷰를 좌우 반전해 거울처럼 보이도록 수정
- `/scan`에서 ColorChecker Classic Mini를 자동 감지하고 기존 수동 swatch 클릭 보정 흐름 제거
- 컬러체커 외곽과 내부 24개 패치 overlay 표시 추가
- 관리자 사진 기반 파운데이션 등록에서 컬러체커와 화장품 샘플 영역을 자동 감지
- 화장품 샘플 색 추출에 자동 컬러체커 보정을 적용
- 카드가 얼굴/머리카락/옷의 어두운 영역과 붙어 보이는 사진도 처리하도록 패치 격자 기반 fallback 추가
- 컬러체커 회전/미러링 방향을 패치 색상 점수로 자동 정렬

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
│  ├─ app/services/         # 색 분석 / 컬러체커 감지 / 스와치 추출 / Storage
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
| `POST /api/foundations/analyze-swatch` | 스와치 사진만 분석 (응답에 `confidence` 포함) |
| `POST /api/foundations/from-photo` | 스와치 사진 분석 후 DB 저장 (응답에 `confidence` 포함) |

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
7. Vercel 프로젝트가 `framework: services`이고 최신 production deployment가 `READY`인지 확인
8. Supabase 프로젝트가 `ACTIVE_HEALTHY`인지 확인
9. Supabase advisors에서 보안 ERROR가 없는지 확인

현재 운영 점검 메모:

- 이번 `v1.2.5` 변경은 DB 스키마 변경이 없어서 Supabase migration이 필요하지 않습니다.
- Supabase Storage 업로드/삭제는 backend에서만 `SUPABASE_SERVICE_ROLE_KEY`를 사용합니다. 이 값은 절대 브라우저로 노출하면 안 됩니다.
- Supabase advisor가 `public.foundations`의 RLS 비활성화를 보안 ERROR로 표시할 수 있습니다. 앱은 backend API를 통해 접근하지만, Supabase public schema 노출 정책상 운영에서는 RLS 활성화와 정책 설정을 별도 작업으로 정리하는 것이 안전합니다.
7. foundation 삭제 시 Storage object 정리 확인

## 참고 문서

- 배포 체크리스트: `DEPLOY_VERCEL_SUPABASE.md`
- Vercel 설정: `vercel.json`
- 환경 변수 예시: `.env.example`
