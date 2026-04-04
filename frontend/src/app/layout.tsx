import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SkinMatch | 피부색 기반 파운데이션 추천",
  description:
    "컬러체커가 포함된 사진으로 피부색을 분석하고 CIEDE2000 색차로 가까운 파운데이션을 추천합니다.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body className="min-h-screen overflow-x-hidden bg-gray-50">
        <nav className="sticky top-0 z-40 border-b bg-white/90 shadow-sm backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-2">
            <a
              href="/"
              className="text-base font-semibold tracking-tight text-rose-600 sm:text-lg"
            >
              SkinMatch
            </a>
            <div className="flex gap-3 text-sm font-medium sm:gap-4">
              <a
                href="/scan"
                className="text-gray-600 transition hover:text-rose-600"
              >
                피부 분석
              </a>
              <a
                href="/admin"
                className="text-gray-500 transition hover:text-gray-700"
              >
                관리자
              </a>
            </div>
          </div>
        </nav>
        <main className="pb-6">{children}</main>
      </body>
    </html>
  );
}
