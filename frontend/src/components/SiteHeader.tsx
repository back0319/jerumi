"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navigationItems = [
  { href: "/scan", label: "피부 분석" },
  { href: "/admin", label: "데이터 관리" },
] as const;

export function SiteHeader() {
  const pathname = usePathname();
  const showNavigation = pathname === "/scan" || pathname === "/admin";

  return (
    <header className="sticky top-0 z-40 border-b bg-white/90 shadow-sm backdrop-blur">
      <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-3 py-2 sm:gap-4 sm:px-4">
        <Link
          href="/"
          className="justify-self-start text-base font-semibold tracking-tight text-rose-600 sm:text-lg"
        >
          제루미
        </Link>

        {showNavigation && (
          <nav
            aria-label="주요 메뉴"
            className="col-start-2 flex items-center gap-1 text-xs font-medium sm:gap-2 sm:text-sm"
          >
            {navigationItems.map((item) => {
              const isActive = pathname === item.href;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`whitespace-nowrap rounded-md px-2 py-1.5 transition sm:px-3 ${
                    isActive
                      ? "bg-rose-50 text-rose-700"
                      : "text-gray-500 hover:bg-gray-50 hover:text-gray-800"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        )}

        <a
          href="https://github.com/back0319/jerumi"
          target="_blank"
          rel="noreferrer"
          aria-label="Jerumi GitHub 저장소 새 탭에서 열기"
          className="col-start-3 inline-flex items-center gap-2 justify-self-end rounded-md px-2 py-1.5 text-sm font-medium text-gray-600 transition hover:bg-gray-50 hover:text-gray-900 sm:px-3"
        >
          <svg
            className="h-5 w-5"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M12 2C6.477 2 2 6.484 2 12.017c0 4.426 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.009-.866-.014-1.7-2.782.605-3.369-1.343-3.369-1.343-.455-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.031 1.531 1.031.892 1.53 2.341 1.088 2.91.832.091-.647.35-1.088.636-1.338-2.221-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.026A9.564 9.564 0 0112 6.844a9.59 9.59 0 012.504.337c1.909-1.295 2.747-1.026 2.747-1.026.546 1.377.203 2.394.1 2.647.64.7 1.028 1.595 1.028 2.688 0 3.848-2.337 4.695-4.566 4.943.359.31.678.921.678 1.856 0 1.34-.012 2.421-.012 2.75 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
              clipRule="evenodd"
            />
          </svg>
          <span className="hidden sm:inline">GitHub</span>
        </a>
      </div>
    </header>
  );
}
