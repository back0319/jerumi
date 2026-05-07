import type { RefObject } from "react";

import type {
  FoundationAnalysisResult,
  FoundationDetectionResult,
} from "@/types";
import type { PhotoMetaValues } from "@/components/admin/types";

type AdminPhotoAnalysisFormProps = {
  photoPreview: string | null;
  photoMeta: PhotoMetaValues;
  analysisResult: FoundationAnalysisResult | null;
  photoDetection: FoundationDetectionResult | null;
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
  onAnalyze: () => void;
  onSave: () => void;
  onReset: () => void;
  onClose: () => void;
};

export function AdminPhotoAnalysisForm({
  photoPreview,
  photoMeta,
  analysisResult,
  photoDetection,
  analyzing,
  isSavingPhoto,
  photoError,
  photoImgRef,
  photoCanvasRef,
  onPhotoMetaFieldChange,
  onPhotoUpload,
  onPhotoImageLoad,
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
              사진 미리보기
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
              className="max-w-full rounded border"
              style={{ maxHeight: "320px" }}
            />
            <button
              onClick={onReset}
              className="mt-1 text-xs text-gray-400 hover:text-gray-600"
            >
              다른 사진 선택
            </button>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-gray-700">
                자동 감지 결과
              </p>
              {analysisResult && (
                <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] text-gray-600">
                  보라색 체커 · 초록색 샘플
                </span>
              )}
            </div>
            {!analysisResult && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500">
                색상 추출 후 감지 신뢰도와 샘플 색상이 요약됩니다.
              </div>
            )}
            {analysisResult && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      photoDetection?.color_checker
                        ? "bg-violet-100 text-violet-700"
                        : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {photoDetection?.color_checker ? "체커 검출" : "체커 미검출"}
                  </span>
                  <span className="text-gray-700">
                    신뢰도{" "}
                    <span className="font-semibold">
                      {photoDetection?.color_checker
                        ? `${Math.round(
                            photoDetection.color_checker.confidence * 100,
                          )}%`
                        : "-"}
                    </span>
                  </span>
                  <span className="text-gray-300">·</span>
                  <span className="flex items-center gap-1.5 text-gray-700">
                    샘플
                    {photoDetection?.swatch && (
                      <span
                        className="inline-block h-4 w-4 rounded border border-black/10"
                        style={{
                          backgroundColor: photoDetection.swatch.sample_hex,
                        }}
                      />
                    )}
                    <span className="font-mono font-semibold">
                      {photoDetection?.swatch
                        ? photoDetection.swatch.sample_hex
                        : "미검출"}
                    </span>
                  </span>
                  {photoDetection?.swatch && (
                    <>
                      <span className="text-gray-300">·</span>
                      <span className="text-gray-500">
                        {photoDetection.swatch.pixel_count.toLocaleString()} px
                      </span>
                    </>
                  )}
                </div>
              </div>
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
