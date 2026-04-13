import type { Foundation } from "@/types";

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
              <div
                className="h-10 w-10 shrink-0 rounded-lg border"
                style={{ backgroundColor: foundation.hex_color }}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-gray-900">
                  {foundation.brand}
                </p>
                <p className="truncate text-sm text-gray-700">
                  {foundation.shade_name}
                  {foundation.shade_code && (
                    <span className="ml-1 text-gray-400">
                      ({foundation.shade_code})
                    </span>
                  )}
                </p>
                {foundation.product_name && (
                  <p className="truncate text-xs text-gray-400">
                    {foundation.product_name}
                  </p>
                )}
              </div>
              <span className="rounded-full bg-gray-100 px-2 py-1 text-[11px] text-gray-600">
                {foundation.undertone || "-"}
              </span>
            </div>
            <div className="rounded-lg bg-gray-50 px-3 py-2 font-mono text-[11px] text-gray-600">
              L* {foundation.L_value} / a* {foundation.a_value} / b*{" "}
              {foundation.b_value}
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="font-mono text-gray-400">
                {foundation.hex_color}
              </span>
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
              <th className="w-[32%] px-4 py-3 text-left">브랜드 / 색상</th>
              <th className="w-[24%] px-4 py-3 text-left">LAB</th>
              <th className="w-20 px-4 py-3 text-left">톤</th>
              <th className="w-28 px-4 py-3 text-left">HEX</th>
              <th className="w-24 px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {foundations.map((foundation) => (
              <tr key={foundation.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div
                    className="h-8 w-8 rounded border"
                    style={{ backgroundColor: foundation.hex_color }}
                  />
                </td>
                <td className="px-4 py-3">
                  <p className="truncate font-medium text-gray-900">
                    {foundation.brand}
                  </p>
                  <p className="truncate text-gray-700">
                    {foundation.shade_name}
                    {foundation.shade_code && (
                      <span className="ml-1 text-gray-400">
                        ({foundation.shade_code})
                      </span>
                    )}
                  </p>
                  {foundation.product_name && (
                    <p className="truncate text-xs text-gray-400">
                      {foundation.product_name}
                    </p>
                  )}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-gray-600">
                  L* {foundation.L_value} / a* {foundation.a_value} / b*{" "}
                  {foundation.b_value}
                </td>
                <td className="px-4 py-3">{foundation.undertone || "-"}</td>
                <td className="px-4 py-3 font-mono text-xs">
                  {foundation.hex_color}
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
