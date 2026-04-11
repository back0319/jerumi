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

## 다음 확장 포인트

- 기대 top-1 / top-3 라벨 필드 추가
- 촬영 조건 메타데이터 추가
- 케이스별 pass/fail 집계 스크립트 추가
