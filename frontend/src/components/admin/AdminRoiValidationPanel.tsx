import type { RefObject } from "react";

import type { AnalysisResponse } from "@/types";
import type { SkinOverlayBase, SkinRegionKey } from "@/lib/skinSampling";

type AdminRoiValidationPanelProps = {
  show: boolean;
  roiPreview: string | null;
  roiFileName: string | null;
  roiOverlay: SkinOverlayBase | null;
  roiResult: AnalysisResponse | null;
  roiError: string | null;
  roiImageStatus: "idle" | "loading" | "ready" | "error";
  roiExtractionReady: boolean;
  roiAnalyzing: boolean;
  roiImgRef: RefObject<HTMLImageElement>;
  roiPreviewCanvasRef: RefObject<HTMLCanvasElement>;
  roiProcessingCanvasRef: RefObject<HTMLCanvasElement>;
  onClose: () => void;
  onReset: () => void;
  onUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onImageLoad: () => void;
  onAnalyze: () => void;
};

const ROI_REGION_LABELS: Record<SkinRegionKey, string> = {
  lower_left_cheek: "왼쪽 하부 볼",
  lower_right_cheek: "오른쪽 하부 볼",
  below_lips: "입 아래",
  chin: "턱",
};

function formatAnalysisMethod(method: string): string {
  switch (method) {
    case "region-medoid":
      return "다중 ROI 대표색";
    case "flat-fallback":
      return "fallback 평면 픽셀";
    case "flat-pixels":
      return "단일 평면 픽셀";
    default:
      return method;
  }
}

function getConfidenceBadgeClass(level: string): string {
  if (level === "높음") return "bg-emerald-100 text-emerald-700";
  if (level === "보통") return "bg-yellow-100 text-yellow-700";
  return "bg-red-100 text-red-700";
}

export function AdminRoiValidationPanel({
  show,
  roiPreview,
  roiFileName,
  roiOverlay,
  roiResult,
  roiError,
  roiImageStatus,
  roiExtractionReady,
  roiAnalyzing,
  roiImgRef,
  roiPreviewCanvasRef,
  roiProcessingCanvasRef,
  onClose,
  onReset,
  onUpload,
  onImageLoad,
  onAnalyze,
}: AdminRoiValidationPanelProps) {
  if (!show) return null;

  return (
    <div className="mb-6 rounded-xl bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">ROI 검증</h2>
          <p className="mt-1 text-sm text-gray-500">
            관리자 전용으로 얼굴 ROI 오버레이, 픽셀 수, fallback 여부,
            confidence를 확인합니다.
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          닫기
        </button>
      </div>

      {roiError && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {roiError}
        </div>
      )}

      {!roiPreview && (
        <label className="mb-4 block cursor-pointer rounded-lg border-2 border-dashed border-gray-300 p-6 text-center transition hover:border-rose-400 sm:p-8">
          <input
            type="file"
            accept="image/jpeg,image/png"
            className="hidden"
            onChange={onUpload}
          />
          <span className="text-sm text-gray-500">
            얼굴 사진 선택 (JPEG/PNG, 최대 10MB)
          </span>
        </label>
      )}

      {roiPreview && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-3">
            <div className="relative inline-block max-w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={roiImgRef}
                src={roiPreview}
                alt="ROI 검증용 얼굴"
                className="block max-w-full rounded-xl border"
                onLoad={onImageLoad}
              />
              <canvas
                ref={roiPreviewCanvasRef}
                className="pointer-events-none absolute inset-0 h-full w-full rounded-xl"
              />
            </div>
            <canvas ref={roiProcessingCanvasRef} className="hidden" />
            <div className="flex items-center gap-4 text-sm text-gray-500">
              <span>{roiFileName}</span>
              <button
                onClick={onReset}
                className="text-gray-500 hover:text-gray-700"
              >
                다른 사진 선택
              </button>
            </div>
          </div>

          <div className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
            <div className="grid grid-cols-2 gap-2 text-center text-xs">
              <div className="rounded-lg bg-white px-3 py-2">
                <p className="font-semibold text-gray-800">
                  {roiOverlay?.mode === "facemesh"
                    ? "FaceMesh"
                    : roiOverlay
                      ? "Fallback"
                      : "-"}
                </p>
                <p className="text-gray-500">감지 방식</p>
              </div>
              <div className="rounded-lg bg-white px-3 py-2">
                <p className="font-semibold text-gray-800">
                  {roiOverlay ? roiOverlay.pixelCount.toLocaleString() : 0}
                </p>
                <p className="text-gray-500">추출 px</p>
              </div>
            </div>

            {roiOverlay && (
              <div className="grid gap-2 sm:grid-cols-2">
                {(Object.keys(ROI_REGION_LABELS) as SkinRegionKey[]).map(
                  (regionName) => (
                    <div key={regionName} className="rounded-lg bg-white px-3 py-2">
                      <p className="text-[11px] font-semibold text-gray-700">
                        {ROI_REGION_LABELS[regionName]}
                      </p>
                      <p className="mt-1 text-sm text-gray-600">
                        {(
                          roiOverlay.regionPixelCounts[regionName] ?? 0
                        ).toLocaleString()}{" "}
                        px
                      </p>
                    </div>
                  ),
                )}
              </div>
            )}

            <button
              onClick={onAnalyze}
              disabled={!roiExtractionReady || roiImageStatus !== "ready" || roiAnalyzing}
              className="w-full rounded bg-rose-600 px-4 py-2 text-sm text-white hover:bg-rose-700 disabled:opacity-50"
            >
              {roiAnalyzing ? "분석 중..." : "ROI 분석"}
            </button>

            {roiResult && (
              <div className="space-y-3 rounded-lg bg-white px-3 py-3">
                <div className="flex items-center gap-3">
                  <div
                    className="h-12 w-12 rounded-lg border"
                    style={{ backgroundColor: roiResult.skin_hex }}
                  />
                  <div>
                    <p className="font-mono text-sm text-gray-700">
                      {roiResult.skin_hex}
                    </p>
                    <p className="text-xs text-gray-500">
                      L*={roiResult.skin_lab[0]} a*={roiResult.skin_lab[1]} b*=
                      {roiResult.skin_lab[2]}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-center text-xs">
                  <div className="rounded-lg bg-gray-50 px-3 py-2">
                    <p className="font-semibold text-gray-800">
                      {formatAnalysisMethod(roiResult.analysis_meta.method)}
                    </p>
                    <p className="text-gray-500">분석 방식</p>
                  </div>
                  <div className="rounded-lg bg-gray-50 px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${getConfidenceBadgeClass(
                        roiResult.analysis_meta.confidence.level,
                      )}`}
                    >
                      {roiResult.analysis_meta.confidence.level}
                    </span>
                    <p className="mt-1 font-mono text-gray-800">
                      {roiResult.analysis_meta.confidence.score}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-lg bg-gray-50 px-3 py-2">
                    <p className="font-semibold text-gray-800">
                      {roiResult.analysis_meta.valid_region_count}
                    </p>
                    <p className="text-gray-500">유효 ROI</p>
                  </div>
                  <div className="rounded-lg bg-gray-50 px-3 py-2">
                    <p className="font-semibold text-gray-800">
                      {roiResult.analysis_meta.fallback_used ? "YES" : "NO"}
                    </p>
                    <p className="text-gray-500">Fallback</p>
                  </div>
                  <div className="rounded-lg bg-gray-50 px-3 py-2">
                    <p className="font-semibold text-gray-800">
                      {roiResult.analysis_meta.max_region_delta_e ?? "-"}
                    </p>
                    <p className="text-gray-500">최대 ΔE</p>
                  </div>
                </div>

                {roiResult.analysis_meta.confidence.notes.length > 0 && (
                  <div className="flex flex-wrap gap-2 text-[11px] text-gray-600">
                    {roiResult.analysis_meta.confidence.notes.map((note) => (
                      <span
                        key={note}
                        className="rounded-full bg-gray-100 px-3 py-1.5"
                      >
                        {note}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
