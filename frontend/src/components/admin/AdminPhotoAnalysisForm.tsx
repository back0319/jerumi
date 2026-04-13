import type { RefObject } from "react";

import { COLORCHECKER_REFERENCE, type MeasuredPatch } from "@/lib/colorChecker";
import type { FoundationAnalysisResult } from "@/types";
import type { PhotoMetaValues } from "@/components/admin/types";

type AdminPhotoAnalysisFormProps = {
  photoPreview: string | null;
  photoMeta: PhotoMetaValues;
  checkerPatches: MeasuredPatch[];
  selectingPatch: number | null;
  analysisResult: FoundationAnalysisResult | null;
  analyzing: boolean;
  isSavingPhoto: boolean;
  photoError: string | null;
  photoImgRef: RefObject<HTMLImageElement>;
  photoCanvasRef: RefObject<HTMLCanvasElement>;
  onPhotoMetaFieldChange: <Key extends keyof PhotoMetaValues>(
    key: Key,
    value: PhotoMetaValues[Key],
  ) => void;
  onPhotoUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onPhotoImageLoad: () => void;
  onPhotoCanvasClick: (event: React.MouseEvent<HTMLCanvasElement>) => void;
  onSelectPatch: (patchIndex: number) => void;
  onAnalyze: () => void;
  onSave: () => void;
  onReset: () => void;
  onClose: () => void;
};

export function AdminPhotoAnalysisForm({
  photoPreview,
  photoMeta,
  checkerPatches,
  selectingPatch,
  analysisResult,
  analyzing,
  isSavingPhoto,
  photoError,
  photoImgRef,
  photoCanvasRef,
  onPhotoMetaFieldChange,
  onPhotoUpload,
  onPhotoImageLoad,
  onPhotoCanvasClick,
  onSelectPatch,
  onAnalyze,
  onSave,
  onReset,
  onClose,
}: AdminPhotoAnalysisFormProps) {
  return (
    <div className="mb-6 rounded-xl bg-white p-4 shadow-sm sm:p-5">
      <h2 className="mb-3 text-lg font-semibold">사진으로 색상 추출</h2>
      <p className="mb-4 text-sm text-gray-500">
        흰 종이에 바른 파운데이션과 컬러체커가 함께 보이도록 촬영한 사진을
        올리세요.
      </p>

      {photoError && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {photoError}
        </div>
      )}

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <input
          placeholder="브랜드 *"
          value={photoMeta.brand}
          onChange={(event) =>
            onPhotoMetaFieldChange("brand", event.target.value)
          }
          className="rounded border px-3 py-2 text-sm"
          required
        />
        <input
          placeholder="제품명"
          value={photoMeta.product_name}
          onChange={(event) =>
            onPhotoMetaFieldChange("product_name", event.target.value)
          }
          className="rounded border px-3 py-2 text-sm"
        />
        <input
          placeholder="색상명 *"
          value={photoMeta.shade_name}
          onChange={(event) =>
            onPhotoMetaFieldChange("shade_name", event.target.value)
          }
          className="rounded border px-3 py-2 text-sm"
          required
        />
        <input
          placeholder="호수 (예: 21호)"
          value={photoMeta.shade_code}
          onChange={(event) =>
            onPhotoMetaFieldChange("shade_code", event.target.value)
          }
          className="rounded border px-3 py-2 text-sm"
        />
      </div>

      {!photoPreview && (
        <label className="mb-4 block cursor-pointer rounded-lg border-2 border-dashed border-gray-300 p-6 text-center transition hover:border-indigo-400 sm:p-8">
          <input
            type="file"
            accept="image/jpeg,image/png"
            className="hidden"
            onChange={onPhotoUpload}
          />
          <span className="text-sm text-gray-500">
            사진 선택 (JPEG/PNG, 최대 20MB)
          </span>
        </label>
      )}

      {photoPreview && (
        <div className="mb-4 grid gap-4 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-sm font-medium text-gray-700">
              {selectingPatch !== null
                ? `"${COLORCHECKER_REFERENCE[selectingPatch].name}" 패치를 사진에서 클릭하세요`
                : "필요하면 참조 패치를 고른 뒤 사진에서 같은 칸을 클릭하세요"}
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={photoImgRef}
              src={photoPreview}
              alt="파운데이션 사진"
              className="hidden"
              onLoad={onPhotoImageLoad}
            />
            <canvas
              ref={photoCanvasRef}
              className="max-w-full cursor-crosshair rounded border"
              style={{ maxHeight: "320px" }}
              onClick={onPhotoCanvasClick}
            />
            <button
              onClick={onReset}
              className="mt-1 text-xs text-gray-400 hover:text-gray-600"
            >
              다른 사진 선택
            </button>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-gray-700">
              참조 패치 ({checkerPatches.length}/24)
            </p>
            <div className="grid max-h-64 grid-cols-6 gap-1.5 overflow-y-auto">
              {COLORCHECKER_REFERENCE.map((patch, index) => {
                const measured = checkerPatches.find(
                  (item) => item.patchIndex === index,
                );

                return (
                  <button
                    key={index}
                    onClick={() => onSelectPatch(index)}
                    className={`rounded border p-1.5 text-xs transition ${
                      selectingPatch === index
                        ? "border-indigo-500 bg-indigo-50"
                        : measured
                          ? "border-green-500 bg-green-50"
                          : "border-gray-200 hover:border-gray-400"
                    }`}
                    title={patch.name}
                  >
                    <div className="truncate text-center text-[10px]">
                      {patch.name}
                    </div>
                    {measured && (
                      <div
                        className="mx-auto mt-0.5 h-5 w-5 rounded"
                        style={{
                          backgroundColor: `rgb(${measured.measuredRgb.join(",")})`,
                        }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
            {checkerPatches.length > 0 && checkerPatches.length < 3 && (
              <p className="mt-2 text-xs text-amber-600">
                색 보정을 적용하려면 패치를 3개 이상 선택하세요.
              </p>
            )}
            {checkerPatches.length >= 3 && (
              <p className="mt-2 text-xs text-green-600">
                패치 {checkerPatches.length}개 선택됨. 색 보정이 적용됩니다.
              </p>
            )}
          </div>
        </div>
      )}

      {analysisResult && (
        <div className="mb-4 rounded-lg bg-gray-50 p-4">
          <h3 className="mb-3 text-sm font-semibold">추출 결과</h3>
          <div className="flex items-center gap-4">
            <div
              className="h-16 w-16 rounded-lg border shadow-inner"
              style={{ backgroundColor: analysisResult.hex_color }}
            />
            <div className="text-sm">
              <p className="font-mono">
                L*={analysisResult.L_value} a*={analysisResult.a_value} b*=
                {analysisResult.b_value}
              </p>
              <p className="text-gray-500">
                HEX: {analysisResult.hex_color} | 언더톤:{" "}
                {analysisResult.undertone}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-3">
        {photoPreview && !analysisResult && (
          <button
            onClick={onAnalyze}
            disabled={analyzing}
            className="rounded bg-indigo-600 px-5 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {analyzing ? "추출 중..." : "색상 추출"}
          </button>
        )}
        {analysisResult && (
          <>
            <button
              onClick={onSave}
              disabled={isSavingPhoto}
              className="rounded bg-green-600 px-5 py-2 text-sm text-white hover:bg-green-700"
            >
              {isSavingPhoto ? "저장 중..." : "DB에 저장"}
            </button>
            <button
              onClick={onAnalyze}
              disabled={analyzing}
              className="rounded bg-gray-200 px-5 py-2 text-sm text-gray-700 hover:bg-gray-300 disabled:opacity-50"
            >
              {analyzing ? "분석 중..." : "다시 분석"}
            </button>
          </>
        )}
        <button
          onClick={onClose}
          className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700"
        >
          닫기
        </button>
      </div>
    </div>
  );
}
