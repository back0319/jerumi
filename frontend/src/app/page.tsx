"use client";

export default function Home() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-5 sm:py-6">
      <section className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(280px,360px)] lg:items-stretch">
        <div className="rounded-2xl bg-white p-6 shadow-sm sm:p-8">
          <div className="mb-4 flex flex-wrap gap-2 text-xs text-gray-500">
            <span className="rounded-full bg-rose-50 px-3 py-1 text-rose-600">
              사진 1장
            </span>
            <span className="rounded-full bg-gray-100 px-3 py-1">컬러체커</span>
            <span className="rounded-full bg-gray-100 px-3 py-1">ΔE 추천</span>
          </div>

          <h1 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            피부색에 가까운 파운데이션을
            <br />
            빠르게 찾기
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-gray-600 sm:text-base">
            컬러체커가 보이는 얼굴 사진 한 장으로 피부색을 측정하고, CIEDE2000
            색차 기준으로 가까운 파운데이션을 추천합니다.
          </p>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <a
              href="/scan"
              className="inline-flex items-center justify-center rounded-xl bg-rose-600 px-6 py-3 text-base font-medium text-white transition hover:bg-rose-700"
            >
              분석 시작
            </a>
            <a
              href="/admin"
              className="inline-flex items-center justify-center rounded-xl border border-gray-200 px-6 py-3 text-base font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
            >
              데이터 관리
            </a>
          </div>
        </div>

        <div className="rounded-2xl bg-gradient-to-br from-rose-600 to-rose-500 p-6 text-white shadow-sm sm:p-7">
          <p className="text-sm font-semibold text-rose-100">빠른 흐름</p>
          <div className="mt-4 space-y-4">
            <div className="rounded-xl bg-white/10 p-4">
              <p className="text-sm font-semibold">1. 사진 준비</p>
              <p className="mt-1 text-sm text-rose-50">
                얼굴과 컬러체커가 함께 보이는 사진을 올리거나 바로 촬영합니다.
              </p>
            </div>
            <div className="rounded-xl bg-white/10 p-4">
              <p className="text-sm font-semibold">2. 영역과 패치 확인</p>
              <p className="mt-1 text-sm text-rose-50">
                추출된 피부 영역과 컬러체커 기준 패치를 바로 확인합니다.
              </p>
            </div>
            <div className="rounded-xl bg-white/10 p-4">
              <p className="text-sm font-semibold">3. ΔE 기준 추천 비교</p>
              <p className="mt-1 text-sm text-rose-50">
                추천 결과를 ΔE 범위와 함께 비교해 차이를 객관적으로 확인합니다.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold text-rose-600">피부색 추출</p>
          <p className="mt-2 text-sm text-gray-600">
            피부 픽셀을 추출해 대표 색을 계산하고 비교 오차를 줄입니다.
          </p>
        </div>
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold text-rose-600">색 보정</p>
          <p className="mt-2 text-sm text-gray-600">
            컬러체커 패치를 선택하면 조명과 카메라 편차를 함께 줄입니다.
          </p>
        </div>
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold text-rose-600">데이터 관리</p>
          <p className="mt-2 text-sm text-gray-600">
            관리자 화면에서 파운데이션 데이터를 추가, 수정, 삭제할 수 있습니다.
          </p>
        </div>
      </section>
    </div>
  );
}
