import type { RefObject } from "react";

import type {
  FoundationAnalysisResult,
  FoundationDetectionResult,
} from "@/types";
import type { PhotoMetaValues } from "@/components/admin/types";
import type {
  CandidateDeltaStats,
  PhotoCandidate,
} from "@/hooks/admin/usePhotoFoundationWorkflow";

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
  candidates: PhotoCandidate[];
  primaryId: string | null;
  deltaStats: CandidateDeltaStats | null;
  onSetPrimary: (id: string) => void;
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
  candidates,
  primaryId,
  deltaStats,
  onSetPrimary,
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

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
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
          placeholder="색상명/호수 * (예: 21호 / Vanilla 1.5)"
          value={photoMeta.shade_name}
          onChange={(event) =>
            onPhotoMetaFieldChange("shade_name", event.target.value)
          }
          className="rounded border px-3 py-2 text-sm"
          required
        />
      </div>

      {!photoPreview && (
        <label className="mb-4 block cursor-pointer rounded-lg border-2 border-dashed border-gray-300 p-6 text-center transition hover:border-indigo-400 sm:p-8">
          <input
            type="file"
            accept="image/jpeg,image/png"
            multiple
            className="hidden"
            onChange={onPhotoUpload}
          />
          <span className="text-sm text-gray-500">
            사진 선택 (JPEG/PNG, 최대 5장 · 각 20MB 이하)
          </span>
          <span className="mt-1 block text-[11px] text-gray-400">
            같은 환경에서 찍은 여러 장을 선택하면 신뢰도가 가장 높은 사진을
            기준으로 진행합니다.
          </span>
        </label>
      )}

      {candidates.length > 1 && (
        <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600">
            <span className="font-semibold text-gray-800">
              사진 {candidates.length}장
            </span>
            {deltaStats && (
              <>
                <span className="text-gray-300">·</span>
                <span>
                  평균 ΔE{" "}
                  <span className="font-semibold text-gray-800">
                    {deltaStats.mean.toFixed(2)}
                  </span>
                </span>
                <span className="text-gray-300">·</span>
                <span>
                  최대 ΔE{" "}
                  <span className="font-semibold text-gray-800">
                    {deltaStats.max.toFixed(2)}
                  </span>
                </span>
                <span className="text-gray-400">
                  (값이 작을수록 사진 간 색이 일관됨)
                </span>
              </>
            )}
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {candidates.map((candidate) => {
              const isPrimary = candidate.id === primaryId;
              const score = candidate.result?.confidence?.score ?? null;
              return (
                <button
                  key={candidate.id}
                  type="button"
                  onClick={() => onSetPrimary(candidate.id)}
                  className={`relative shrink-0 overflow-hidden rounded-lg border-2 transition ${
                    isPrimary
                      ? "border-rose-500 ring-2 ring-rose-200"
                      : "border-transparent hover:border-gray-300"
                  }`}
                  style={{ width: 96 }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={candidate.preview}
                    alt="후보 사진"
                    className="block h-24 w-24 object-cover"
                  />
                  <div className="absolute inset-x-0 bottom-0 bg-black/55 px-1.5 py-0.5 text-center text-[10px] font-semibold text-white">
                    {candidate.status === "analyzing" && "분석 중…"}
                    {candidate.status === "pending" && "대기"}
                    {candidate.status === "failed" && "실패"}
                    {candidate.status === "done" &&
                      (score !== null ? `${Math.round(score * 100)}%` : "—")}
                  </div>
                  {isPrimary && (
                    <span className="absolute left-1 top-1 rounded bg-rose-500 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-white">
                      기준
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {photoPreview && (
        <div className="mb-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
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

          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 sm:p-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-gray-800">
                {analysisResult ? "분석 결과" : "분석 대기 중"}
              </p>
              {analysisResult?.confidence && (
                <span
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                    analysisResult.confidence.level === "높음"
                      ? "bg-emerald-100 text-emerald-700"
                      : analysisResult.confidence.level === "보통"
                        ? "bg-sky-100 text-sky-700"
                        : "bg-amber-100 text-amber-700"
                  }`}
                >
                  분석 신뢰도 {analysisResult.confidence.level} ·{" "}
                  {Math.round(analysisResult.confidence.score * 100)}%
                </span>
              )}
            </div>

            {!analysisResult ? (
              <p className="text-sm text-gray-500">
                "색상 추출"을 누르면 컬러체커 검출과 샘플 색이 자동으로 표시됩니다.
              </p>
            ) : (
              <div className="space-y-3">
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
                    체커 신뢰도{" "}
                    <span className="font-semibold">
                      {photoDetection?.color_checker
                        ? `${Math.round(
                            photoDetection.color_checker.confidence * 100,
                          )}%`
                        : "-"}
                    </span>
                  </span>
                  {photoDetection?.swatch && (
                    <>
                      <span className="text-gray-300">·</span>
                      <span className="text-gray-500">
                        샘플 {photoDetection.swatch.pixel_count.toLocaleString()} px
                      </span>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-3 rounded-lg bg-white p-3">
                  <div
                    className="aspect-square w-16 shrink-0 rounded-lg border shadow-inner"
                    style={{ backgroundColor: analysisResult.hex_color }}
                  />
                  <div className="min-w-0 text-sm">
                    <p className="font-mono">
                      L*={analysisResult.L_value} a*={analysisResult.a_value} b*=
                      {analysisResult.b_value}
                    </p>
                    <p className="truncate text-gray-500">
                      HEX: {analysisResult.hex_color} · 언더톤:{" "}
                      {analysisResult.undertone}
                    </p>
                  </div>
                </div>

                {analysisResult.confidence && (
                  <>
                    <div className="h-1.5 overflow-hidden rounded-full bg-gray-200">
                      <div
                        className={`h-full rounded-full ${
                          analysisResult.confidence.level === "높음"
                            ? "bg-emerald-500"
                            : analysisResult.confidence.level === "보통"
                              ? "bg-sky-500"
                              : "bg-amber-500"
                        }`}
                        style={{
                          width: `${Math.round(analysisResult.confidence.score * 100)}%`,
                        }}
                      />
                    </div>
                    {analysisResult.confidence.notes.length > 0 && (
                      <ul className="list-disc space-y-0.5 pl-5 text-[11px] text-gray-500">
                        {analysisResult.confidence.notes.map((note, idx) => (
                          <li key={idx}>{note}</li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
            )}
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
