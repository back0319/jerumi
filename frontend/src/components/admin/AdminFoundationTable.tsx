import type { Foundation } from "@/types";
import { displayShade } from "@/lib/foundation";

type AdminFoundationTableProps = {
  filterBrand: string;
  foundations: Foundation[];
  isLoadingData: boolean;
  deletingId: number | null;
  onEdit: (foundation: Foundation) => void;
  onDelete: (id: number) => void;
};

export function AdminFoundationTable({
  filterBrand,
  foundations,
  isLoadingData,
  deletingId,
  onEdit,
  onDelete,
}: AdminFoundationTableProps) {
  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-sm">
      <div className="flex items-center justify-between border-b px-4 py-3 text-sm text-gray-500">
        <p>
          {filterBrand ? `"${filterBrand}" ` : ""}파운데이션 {foundations.length}개
        </p>
        {isLoadingData && <p>최신 목록을 불러오는 중입니다...</p>}
      </div>

      <div className="divide-y lg:hidden">
        {foundations.map((foundation) => (
          <div key={foundation.id} className="space-y-3 px-4 py-4">
            <div className="flex items-start gap-3">
              <div className="w-16 shrink-0">
                <div
                  className="mx-auto h-10 w-10 rounded-lg border"
                  style={{ backgroundColor: foundation.hex_color }}
                />
                <p className="mt-1 truncate text-center font-mono text-[10px] text-gray-400">
                  {foundation.hex_color}
                </p>
              </div>
              <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="truncate text-sm font-semibold text-gray-900">
                  {foundation.brand}
                </span>
                <span className="truncate text-sm text-gray-700">
                  {foundation.product_name || "-"}
                </span>
                <span className="truncate text-xs text-gray-400">
                  {displayShade(foundation)}
                </span>
              </div>
            </div>
            <div className="rounded-lg bg-gray-50 px-3 py-2 font-mono text-[11px] text-gray-600">
              L* {foundation.L_value} / a* {foundation.a_value} / b*{" "}
              {foundation.b_value}
            </div>
            <div className="flex items-center justify-between text-xs">
              <span />
              <div className="flex items-center gap-3">
                <button
                  onClick={() => onEdit(foundation)}
                  className="text-blue-600 hover:text-blue-800"
                >
                  수정
                </button>
                <button
                  onClick={() => onDelete(foundation.id)}
                  disabled={deletingId === foundation.id}
                  className="text-red-500 hover:text-red-700 disabled:opacity-50"
                >
                  {deletingId === foundation.id ? "삭제 중..." : "삭제"}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="hidden lg:block">
        <table className="w-full table-fixed text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="w-16 px-4 py-3 text-left">색상</th>
              <th className="w-[42%] px-4 py-3 text-left">
                브랜드 / 제품 / 색상
              </th>
              <th className="w-[28%] px-4 py-3 text-left">LAB</th>
              <th className="w-24 px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {foundations.map((foundation) => (
              <tr key={foundation.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="w-14">
                    <div
                      className="mx-auto h-8 w-8 rounded border"
                      style={{ backgroundColor: foundation.hex_color }}
                    />
                    <p className="mt-1 truncate text-center font-mono text-[10px] text-gray-400">
                      {foundation.hex_color}
                    </p>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex min-w-0 items-baseline gap-3">
                    <span className="truncate font-medium text-gray-900">
                      {foundation.brand}
                    </span>
                    <span className="truncate text-gray-700">
                      {foundation.product_name || "-"}
                    </span>
                    <span className="truncate text-xs text-gray-400">
                      {displayShade(foundation)}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-gray-600">
                  L* {foundation.L_value} / a* {foundation.a_value} / b*{" "}
                  {foundation.b_value}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <button
                    onClick={() => onEdit(foundation)}
                    className="mr-3 text-xs text-blue-600 hover:text-blue-800"
                  >
                    수정
                  </button>
                  <button
                    onClick={() => onDelete(foundation.id)}
                    disabled={deletingId === foundation.id}
                    className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                  >
                    {deletingId === foundation.id ? "삭제 중..." : "삭제"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!isLoadingData && foundations.length === 0 && (
        <p className="py-8 text-center text-gray-400">
          등록된 파운데이션이 없습니다.
        </p>
      )}
    </div>
  );
}
