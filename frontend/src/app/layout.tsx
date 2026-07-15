import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { SiteHeader } from "@/components/SiteHeader";
import "./globals.css";

export const metadata: Metadata = {
  title: "제루미 | 피부색 기반 파운데이션 추천",
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
        <SiteHeader />
        <main className="pb-6">{children}</main>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
