# ROI Evaluation Workflow

이 디렉터리는 얼굴 ROI 검증과 추천 품질 비교를 위한 가벼운 평가셋 구조입니다.

## 구조

- `samples/`
  - 검증에 사용할 원본 얼굴 사진을 둡니다.
- `records/`
  - `/scan` 결과 화면의 `평가 JSON 내보내기`로 받은 결과를 둡니다.

## 권장 규칙

- 파일명은 같은 prefix를 공유합니다.
  - 예: `samples/case-001.jpg`
  - 예: `records/case-001.analysis.json`
- 한 사진당 최소 1개의 메모를 남깁니다.
  - 예: 홍조 여부
  - 예: 컬러체커 사용 여부
  - 예: 사람이 보기 좋은 top-3 shade

## 현재 JSON 필드

- `exported_at`
- `image_label`
- `evaluation_note`
- `overlay_mode`
- `extraction_region_pixel_counts`
- `analysis_meta`
- `representative_skin`
- `top_recommendations`

## 자동 회귀 fixture

백엔드의 합성 입력 fixture는 `backend/tests/fixtures/`에 있습니다. 실제 얼굴
사진이나 운영 DB 데이터 없이 다음 동작을 고정합니다.

- `flat_skin_recommendation.json`: 단일 ROI의 RGB → CIELAB → 추천 순서
- `regional_colorchecker_recommendation.json`: 다중 ROI, ColorChecker 보정,
  raw/보정 LAB, CIEDE2000 추천 순서

실행 명령:

```bash
cd backend
.venv/bin/python -m pytest tests/test_analysis_golden_fixtures.py
```

LAB와 ColorChecker 행렬은 절대 오차 `1e-6`, 공개 응답에서 소수 셋째 자리로
반올림되는 ΔE는 절대 오차 `1e-3`을 허용합니다. 추천 ID 순서, ΔE 구간,
대표색 hex, 분석 방식과 confidence 문구는 정확히 일치해야 합니다.

fixture 기준값은 의도적으로 분석 정책을 바꿀 때만 갱신합니다. 갱신 PR에는
기존 값과 새 값의 차이, 사용자에게 보이는 추천 순서 변화, 승인 근거를 함께
기록합니다. 테스트를 통과시키기 위한 자동 재생성은 허용하지 않습니다.

## 다음 확장 포인트

- 기대 top-1 / top-3 라벨 필드 추가
- 촬영 조건 메타데이터 추가
- 케이스별 pass/fail 집계 스크립트 추가
