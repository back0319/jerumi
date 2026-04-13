import type { ActiveAdminPanel } from "@/components/admin/types";

type AdminPageHeaderProps = {
  activePanel: ActiveAdminPanel;
  filterBrand: string;
  brands: string[];
  isLoadingData: boolean;
  onFilterChange: (value: string) => void;
  onRefresh: () => void;
  onToggleRoiTool: () => void;
  onTogglePhotoForm: () => void;
  onToggleManualCreateForm: () => void;
};

export function AdminPageHeader({
  activePanel,
  filterBrand,
  brands,
  isLoadingData,
  onFilterChange,
  onRefresh,
  onToggleRoiTool,
  onTogglePhotoForm,
  onToggleManualCreateForm,
}: AdminPageHeaderProps) {
  return (
    <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <h1 className="text-2xl font-bold">파운데이션 데이터 관리</h1>
        <p className="mt-1 text-sm text-gray-500">
          브랜드별로 빠르게 확인하고 바로 수정할 수 있습니다.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
        <select
          value={filterBrand}
          onChange={(event) => onFilterChange(event.target.value)}
          disabled={isLoadingData}
          className="rounded border px-3 py-1.5 text-sm"
        >
          <option value="">전체 브랜드</option>
          {brands.map((brand) => (
            <option key={brand} value={brand}>
              {brand}
            </option>
          ))}
        </select>
        <button
          onClick={onRefresh}
          disabled={isLoadingData}
          className="rounded border border-gray-200 bg-white px-4 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          {isLoadingData ? "동기화 중..." : "새로고침"}
        </button>
        <button
          onClick={onToggleRoiTool}
          className={`rounded border border-gray-200 px-4 py-1.5 text-sm ${
            activePanel === "roi" ? "bg-gray-100" : "bg-white hover:bg-gray-50"
          }`}
        >
          ROI 검증
        </button>
        <button
          onClick={onTogglePhotoForm}
          className={`rounded px-4 py-1.5 text-sm text-white ${
            activePanel === "photo"
              ? "bg-indigo-700"
              : "bg-indigo-600 hover:bg-indigo-700"
          }`}
        >
          사진 등록
        </button>
        <button
          onClick={onToggleManualCreateForm}
          className={`rounded px-4 py-1.5 text-sm text-white ${
            activePanel === "manual-create"
              ? "bg-rose-700"
              : "bg-rose-600 hover:bg-rose-700"
          }`}
        >
          + 직접 등록
        </button>
      </div>
    </div>
  );
}
