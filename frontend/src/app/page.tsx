export default function Home() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-16 text-center">
      <h1 className="text-4xl font-bold text-gray-900 mb-4">
        내 피부에 딱 맞는 파운데이션 찾기
      </h1>
      <p className="text-lg text-gray-600 mb-8">
        CIELAB 색공간 기반 과학적 피부톤 분석으로
        <br />
        가장 정확한 파운데이션 색상을 추천해드립니다.
      </p>

      <div className="grid md:grid-cols-3 gap-6 mb-12">
        <div className="bg-white rounded-xl p-6 shadow-sm">
          <div className="text-3xl mb-3">1</div>
          <h3 className="font-semibold mb-2">사진 촬영</h3>
          <p className="text-sm text-gray-500">
            컬러체커와 함께 통제된 환경에서 얼굴 사진을 촬영합니다
          </p>
        </div>
        <div className="bg-white rounded-xl p-6 shadow-sm">
          <div className="text-3xl mb-3">2</div>
          <h3 className="font-semibold mb-2">피부톤 분석</h3>
          <p className="text-sm text-gray-500">
            컬러체커로 색 보정 후 CIELAB 색공간에서 정밀하게 피부색을 측정합니다
          </p>
        </div>
        <div className="bg-white rounded-xl p-6 shadow-sm">
          <div className="text-3xl mb-3">3</div>
          <h3 className="font-semibold mb-2">맞춤 추천</h3>
          <p className="text-sm text-gray-500">
            CIEDE2000 색차 공식으로 가장 유사한 파운데이션을 추천합니다
          </p>
        </div>
      </div>

      <a
        href="/scan"
        className="inline-block bg-rose-600 text-white px-8 py-3 rounded-lg text-lg font-medium hover:bg-rose-700 transition"
      >
        피부 분석 시작하기
      </a>
    </div>
  );
}
