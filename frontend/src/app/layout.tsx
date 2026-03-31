import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SkinMatch - 피부톤 맞춤 파운데이션 추천",
  description: "CIELAB 색공간 기반 피부톤 분석을 이용한 파운데이션 색상 추천 시스템",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-gray-50">
        <nav className="bg-white shadow-sm border-b">
          <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
            <a href="/" className="text-xl font-bold text-rose-600">
              SkinMatch
            </a>
            <div className="flex gap-4 text-sm">
              <a href="/scan" className="text-gray-600 hover:text-rose-600">
                피부 분석
              </a>
              <a href="/admin" className="text-gray-400 hover:text-gray-600">
                관리자
              </a>
            </div>
          </div>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
