"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiPost } from "@/lib/api";
import {
  buildRegionPolygons,
  extractSkinPixels,
  type FaceRegionPolygon,
  SKIN_REGIONS,
} from "@/lib/facemesh";
import {
  COLORCHECKER_REFERENCE,
  labToHex,
  type MeasuredPatch,
  buildCheckerPatches,
} from "@/lib/colorChecker";
import type { AnalysisResponse } from "@/types";
import CameraCapture from "@/components/CameraCapture";

type Step = "upload" | "camera" | "checker" | "analyzing" | "done";
type CheckerImageStatus = "idle" | "loading" | "ready" | "error";
type OverlayMode = "facemesh" | "fallback";

type AnalysisOverlay = {
  mode: OverlayMode;
  pixelCount: number;
  sampleHex: string;
  polygons: FaceRegionPolygon[];
  fallbackRect?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

const OVERLAY_FILL = "rgba(244, 63, 94, 0.22)";
const OVERLAY_STROKE = "#e11d48";
const FALLBACK_FILL = "rgba(59, 130, 246, 0.18)";
const FALLBACK_STROKE = "#2563eb";

function averagePixelsToHex(pixels: number[][]): string {
  if (pixels.length === 0) return "#000000";

  let r = 0;
  let g = 0;
  let b = 0;

  for (const pixel of pixels) {
    r += pixel[0];
    g += pixel[1];
    b += pixel[2];
  }

  const count = pixels.length;
  const avgR = Math.round(r / count);
  const avgG = Math.round(g / count);
  const avgB = Math.round(b / count);

  return `#${avgR.toString(16).padStart(2, "0")}${avgG
    .toString(16)
    .padStart(2, "0")}${avgB.toString(16).padStart(2, "0")}`;
}

function getDeltaEBadgeClass(deltaE: number): string {
  if (deltaE <= 1.0) return "bg-green-100 text-green-700";
  if (deltaE <= 2.0) return "bg-emerald-100 text-emerald-700";
  if (deltaE <= 3.5) return "bg-yellow-100 text-yellow-700";
  if (deltaE <= 5.0) return "bg-orange-100 text-orange-700";
  return "bg-red-100 text-red-700";
}

export default function ScanPage() {
  const FACE_MESH_TIMEOUT_MS = 8000;
  const INITIAL_VISIBLE_RECOMMENDATIONS = 4;
  const [step, setStep] = useState<Step>("upload");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAllRecommendations, setShowAllRecommendations] = useState(false);
  const [skinPixels, setSkinPixels] = useState<number[][] | null>(null);
  const [checkerPatches, setCheckerPatches] = useState<MeasuredPatch[]>([]);
  const [selectingPatch, setSelectingPatch] = useState<number | null>(null);
  const [checkerImageStatus, setCheckerImageStatus] =
    useState<CheckerImageStatus>("idle");
  const [checkerImageError, setCheckerImageError] = useState<string | null>(
    null,
  );
  const processingCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const checkerImgRef = useRef<HTMLImageElement>(null);
  const uploadedObjectUrlRef = useRef<string | null>(null);
  const detectionTimeoutRef = useRef<number | null>(null);
  const detectionCompletedRef = useRef(false);
  const [analysisOverlay, setAnalysisOverlay] =
    useState<AnalysisOverlay | null>(null);
  const selectedReferencePatch =
    selectingPatch !== null ? COLORCHECKER_REFERENCE[selectingPatch] : null;
  const selectedReferenceHex = selectedReferencePatch
    ? labToHex(selectedReferencePatch.lab)
    : null;
  const visibleRecommendations = result
    ? showAllRecommendations
      ? result.recommendations
      : result.recommendations.slice(0, INITIAL_VISIBLE_RECOMMENDATIONS)
    : [];

  const revokeUploadedObjectUrl = useCallback(() => {
    if (!uploadedObjectUrlRef.current) return;
    URL.revokeObjectURL(uploadedObjectUrlRef.current);
    uploadedObjectUrlRef.current = null;
  }, []);

  const drawImageToCanvas = useCallback(
    (img: HTMLImageElement, canvas: HTMLCanvasElement) => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return false;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      return true;
    },
    [],
  );

  const redrawPreviewCanvas = useCallback((overlay: AnalysisOverlay | null) => {
    const sourceCanvas = processingCanvasRef.current;
    const previewCanvas = previewCanvasRef.current;
    if (!sourceCanvas || !previewCanvas) return;

    previewCanvas.width = sourceCanvas.width;
    previewCanvas.height = sourceCanvas.height;

    const ctx = previewCanvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);

    if (!overlay) return;

    const fillColor =
      overlay.mode === "facemesh" ? OVERLAY_FILL : FALLBACK_FILL;
    const strokeColor =
      overlay.mode === "facemesh" ? OVERLAY_STROKE : FALLBACK_STROKE;

    ctx.save();
    ctx.lineWidth = Math.max(2, previewCanvas.width / 320);
    ctx.strokeStyle = strokeColor;
    ctx.fillStyle = fillColor;

    for (const polygon of overlay.polygons) {
      if (polygon.points.length === 0) continue;

      ctx.beginPath();
      ctx.moveTo(polygon.points[0].x, polygon.points[0].y);
      for (const point of polygon.points.slice(1)) {
        ctx.lineTo(point.x, point.y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    if (overlay.fallbackRect) {
      ctx.strokeStyle = FALLBACK_STROKE;
      ctx.fillStyle = FALLBACK_FILL;
      ctx.fillRect(
        overlay.fallbackRect.x,
        overlay.fallbackRect.y,
        overlay.fallbackRect.width,
        overlay.fallbackRect.height,
      );
      ctx.strokeRect(
        overlay.fallbackRect.x,
        overlay.fallbackRect.y,
        overlay.fallbackRect.width,
        overlay.fallbackRect.height,
      );
    }

    ctx.restore();
  }, []);

  const clearDetectionTimeout = useCallback(() => {
    if (detectionTimeoutRef.current === null) return;
    window.clearTimeout(detectionTimeoutRef.current);
    detectionTimeoutRef.current = null;
  }, []);

  const completeSkinExtraction = useCallback(
    (
      pixels: number[][],
      overlay: AnalysisOverlay,
      nextError: string | null = null,
    ) => {
      detectionCompletedRef.current = true;
      clearDetectionTimeout();
      setSkinPixels(pixels);
      setAnalysisOverlay(overlay);
      redrawPreviewCanvas(overlay);
      setError(nextError);
      setStep("checker");
    },
    [clearDetectionTimeout, redrawPreviewCanvas],
  );

  const handleImageUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) {
        setError("파일 크기는 10MB 이하여야 합니다.");
        return;
      }
      revokeUploadedObjectUrl();
      setError(null);
      setAnalysisOverlay(null);
      const url = URL.createObjectURL(file);
      uploadedObjectUrlRef.current = url;
      setImageUrl(url);
    },
    [revokeUploadedObjectUrl],
  );

  const processImageOnCanvas = useCallback((canvas: HTMLCanvasElement) => {
    loadFaceMeshAndExtract(canvas);
  }, []);

  const handleImageLoad = useCallback(() => {
    const img = imgRef.current;
    const canvas = processingCanvasRef.current;
    if (!img || !canvas) return;

    const drawn = drawImageToCanvas(img, canvas);
    if (!drawn) return;

    redrawPreviewCanvas(null);
    processImageOnCanvas(canvas);
  }, [drawImageToCanvas, processImageOnCanvas, redrawPreviewCanvas]);

  const handleCameraCapture = useCallback(
    (dataUrl: string) => {
      revokeUploadedObjectUrl();
      setError(null);
      setAnalysisOverlay(null);
      setImageUrl(dataUrl);
      setStep("upload");
    },
    [revokeUploadedObjectUrl],
  );

  const handleCheckerImageLoad = useCallback(() => {
    const img = checkerImgRef.current;
    const canvas = processingCanvasRef.current;
    if (!img || !canvas) return;

    const drawn = drawImageToCanvas(img, canvas);
    if (!drawn) {
      setCheckerImageStatus("error");
      setCheckerImageError(
        "캔버스를 초기화하지 못했습니다. 다시 시도해주세요.",
      );
      return;
    }

    redrawPreviewCanvas(analysisOverlay);
    setCheckerImageStatus("ready");
    setCheckerImageError(null);
  }, [analysisOverlay, drawImageToCanvas, redrawPreviewCanvas]);

  const handleCheckerImageError = useCallback(() => {
    setCheckerImageStatus("error");
    setCheckerImageError(
      "사진을 불러오지 못했습니다. 다른 사진으로 다시 시도해주세요.",
    );
  }, []);

  const fallbackExtract = useCallback(
    (
      canvas: HTMLCanvasElement,
      nextError = "얼굴 자동 인식이 지연되어 중앙 영역으로 계속 진행합니다.",
    ) => {
      if (detectionCompletedRef.current) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setError("이미지를 처리하지 못했습니다. 다시 시도해주세요.");
        return;
      }

      const w = canvas.width;
      const h = canvas.height;
      const cx = Math.round(w * 0.35);
      const cy = Math.round(h * 0.3);
      const cw = Math.round(w * 0.3);
      const ch = Math.round(h * 0.3);
      const imageData = ctx.getImageData(cx, cy, cw, ch);
      const pixels: number[][] = [];

      for (let i = 0; i < imageData.data.length; i += 4) {
        pixels.push([
          imageData.data[i],
          imageData.data[i + 1],
          imageData.data[i + 2],
        ]);
      }

      if (pixels.length < 100) {
        detectionCompletedRef.current = true;
        clearDetectionTimeout();
        setError(
          "피부 영역을 추출하지 못했습니다. 다른 사진으로 다시 시도해주세요.",
        );
        return;
      }

      completeSkinExtraction(
        pixels,
        {
          mode: "fallback",
          pixelCount: pixels.length,
          sampleHex: averagePixelsToHex(pixels),
          polygons: [
            {
              points: [
                { x: cx, y: cy },
                { x: cx + cw, y: cy },
                { x: cx + cw, y: cy + ch },
                { x: cx, y: cy + ch },
              ],
              bounds: {
                minX: cx,
                minY: cy,
                maxX: cx + cw,
                maxY: cy + ch,
              },
            },
          ],
          fallbackRect: {
            x: cx,
            y: cy,
            width: cw,
            height: ch,
          },
        },
        nextError,
      );
    },
    [clearDetectionTimeout, completeSkinExtraction],
  );

  const loadFaceMeshAndExtract = async (canvas: HTMLCanvasElement) => {
    try {
      detectionCompletedRef.current = false;
      clearDetectionTimeout();
      detectionTimeoutRef.current = window.setTimeout(() => {
        fallbackExtract(canvas);
      }, FACE_MESH_TIMEOUT_MS);

      // @ts-ignore - MediaPipe loaded from CDN
      const { FaceMesh } = await import("@mediapipe/face_mesh");
      const faceMesh = new FaceMesh({
        locateFile: (file: string) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
      });
      faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      faceMesh.onResults((results: any) => {
        if (detectionCompletedRef.current) return;

        if (
          !results.multiFaceLandmarks ||
          results.multiFaceLandmarks.length === 0
        ) {
          fallbackExtract(
            canvas,
            "얼굴을 감지하지 못해 중앙 영역 기준으로 계속 진행합니다.",
          );
          return;
        }

        const landmarks = results.multiFaceLandmarks[0];
        const pixels = extractSkinPixels(canvas, landmarks, SKIN_REGIONS);
        const polygons = buildRegionPolygons(canvas, landmarks, SKIN_REGIONS);

        if (pixels.length < 100) {
          fallbackExtract(
            canvas,
            "피부 영역 픽셀이 적어 중앙 영역 기준으로 계속 진행합니다.",
          );
          return;
        }

        completeSkinExtraction(pixels, {
          mode: "facemesh",
          pixelCount: pixels.length,
          sampleHex: averagePixelsToHex(pixels),
          polygons,
        });
      });

      await faceMesh.send({ image: canvas });
    } catch (err) {
      console.warn(
        "MediaPipe Face Mesh 로딩 실패, 전체 이미지 중앙 영역 사용:",
        err,
      );
      fallbackExtract(canvas);
    }
  };

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (selectingPatch === null) return;
      const canvas = processingCanvasRef.current;
      const previewCanvas = previewCanvasRef.current;
      if (!canvas || !previewCanvas) return;
      const rect = previewCanvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = Math.round((e.clientX - rect.left) * scaleX);
      const y = Math.round((e.clientY - rect.top) * scaleY);

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const size = 5;
      const data = ctx.getImageData(
        Math.max(0, x - size),
        Math.max(0, y - size),
        size * 2,
        size * 2,
      );
      let rSum = 0,
        gSum = 0,
        bSum = 0,
        count = 0;
      for (let i = 0; i < data.data.length; i += 4) {
        rSum += data.data[i];
        gSum += data.data[i + 1];
        bSum += data.data[i + 2];
        count++;
      }

      const measured: MeasuredPatch = {
        patchIndex: selectingPatch,
        measuredRgb: [
          Math.round(rSum / count),
          Math.round(gSum / count),
          Math.round(bSum / count),
        ],
      };

      setCheckerPatches((prev) => {
        const filtered = prev.filter((p) => p.patchIndex !== selectingPatch);
        return [...filtered, measured];
      });
      setSelectingPatch(null);
    },
    [selectingPatch],
  );

  const handleAnalyze = async () => {
    if (!skinPixels) return;
    setStep("analyzing");
    setError(null);
    setShowAllRecommendations(false);

    try {
      const patches =
        checkerPatches.length >= 3 ? buildCheckerPatches(checkerPatches) : null;

      let pixels = skinPixels;
      if (pixels.length > 10000) {
        const step = Math.ceil(pixels.length / 10000);
        pixels = pixels.filter((_, i) => i % step === 0);
      }

      const response = await apiPost<AnalysisResponse>("/analyze", {
        skin_pixels_rgb: pixels,
        checker_patches: patches,
        top_n: 10,
      });

      setResult(response);
      setStep("done");
    } catch (err: any) {
      setError(err.message || "분석 중 오류가 발생했습니다.");
      setStep("checker");
    }
  };

  const handleSelectDifferentPhoto = useCallback(() => {
    revokeUploadedObjectUrl();
    setStep("upload");
    setImageUrl(null);
    setSkinPixels(null);
    setAnalysisOverlay(null);
    setCheckerPatches([]);
    setSelectingPatch(null);
    setCheckerImageStatus("idle");
    setCheckerImageError(null);
    setError(null);
    setShowAllRecommendations(false);
  }, [revokeUploadedObjectUrl]);

  const resetAll = () => {
    revokeUploadedObjectUrl();
    setStep("upload");
    setImageUrl(null);
    setSkinPixels(null);
    setAnalysisOverlay(null);
    setCheckerPatches([]);
    setSelectingPatch(null);
    setResult(null);
    setError(null);
    setCheckerImageStatus("idle");
    setCheckerImageError(null);
    setShowAllRecommendations(false);
  };

  useEffect(() => {
    setCheckerPatches([]);
    setSelectingPatch(null);
    setCheckerImageStatus("idle");
    setCheckerImageError(null);
    setAnalysisOverlay(null);
  }, [imageUrl]);

  useEffect(() => {
    if (step !== "checker") return;
    if (!imageUrl) {
      setCheckerImageStatus("error");
      setCheckerImageError("원본 사진이 없습니다. 사진을 다시 선택해주세요.");
      return;
    }
    setCheckerImageStatus("loading");
    setCheckerImageError(null);
  }, [step, imageUrl]);

  useEffect(() => {
    if (step !== "checker") return;
    const img = checkerImgRef.current;
    if (!img || !img.complete) return;
    handleCheckerImageLoad();
  }, [handleCheckerImageLoad, imageUrl, step]);

  useEffect(() => {
    return () => {
      clearDetectionTimeout();
      revokeUploadedObjectUrl();
    };
  }, [clearDetectionTimeout, revokeUploadedObjectUrl]);

  return (
    <div className="mx-auto max-w-6xl px-3 py-3 sm:px-4 sm:py-4">
      <h1 className="mb-4 text-2xl font-bold sm:mb-5">피부톤 분석</h1>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {/* Step 1: Upload or Camera */}
      {step === "upload" && !imageUrl && (
        <div className="rounded-xl bg-white p-5 shadow-sm sm:p-6">
          <h2 className="mb-3 text-lg font-semibold">
            컬러체커가 보이는 얼굴 사진을 올리세요
          </h2>
          <p className="mb-5 text-sm text-gray-500">
            정면 얼굴과 컬러체커가 함께 보이는 사진일수록 결과가 더
            안정적입니다.
          </p>

          <div className="grid gap-3 md:grid-cols-2">
            {/* Upload option */}
            <label className="block cursor-pointer rounded-lg border-2 border-dashed border-gray-300 p-6 text-center transition hover:border-rose-400 sm:p-8">
              <input
                type="file"
                accept="image/jpeg,image/png"
                className="hidden"
                onChange={handleImageUpload}
              />
              <div className="text-4xl mb-3">📁</div>
              <span className="text-gray-700 font-medium block mb-1">
                파일 업로드
              </span>
              <span className="text-gray-400 text-sm">JPEG/PNG, 최대 10MB</span>
            </label>

            {/* Camera option */}
            <button
              onClick={() => setStep("camera")}
              className="rounded-lg border-2 border-dashed border-gray-300 p-6 text-center transition hover:border-rose-400 sm:p-8"
            >
              <div className="text-4xl mb-3">📷</div>
              <span className="text-gray-700 font-medium block mb-1">
                카메라 촬영
              </span>
              <span className="text-gray-400 text-sm">카메라로 직접 촬영</span>
            </button>
          </div>
        </div>
      )}

      {/* Upload preview (loading face mesh) */}
      {step === "upload" && imageUrl && (
        <div className="rounded-xl bg-white p-5 shadow-sm sm:p-6">
          <div className="text-center">
            <div className="relative inline-block max-w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={imgRef}
                src={imageUrl}
                alt="업로드된 얼굴"
                className="mx-auto block max-w-full rounded border max-h-[50vh] sm:max-h-[56vh]"
                onLoad={handleImageLoad}
              />
              <canvas
                ref={previewCanvasRef}
                className="pointer-events-none absolute inset-0 h-full w-full rounded"
              />
            </div>
            <canvas ref={processingCanvasRef} className="hidden" />
            <div className="mt-4">
              <div className="animate-spin w-8 h-8 border-4 border-rose-200 border-t-rose-600 rounded-full mx-auto mb-2" />
              <p className="text-sm text-gray-500">
                얼굴과 피부 영역을 찾는 중입니다...
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Step: Camera */}
      {step === "camera" && (
        <>
          <CameraCapture
            onCapture={handleCameraCapture}
            onCancel={() => setStep("upload")}
          />
        </>
      )}

      {/* Step 2: Color Checker Calibration */}
      {step === "checker" && (
        <div className="rounded-xl bg-white p-4 shadow-sm sm:p-5 lg:p-6">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold">
                컬러체커 보정 (선택사항)
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                패치를 3개 이상 선택하면 색 보정이 적용됩니다. 먼저 swatch를
                고른 뒤 사진 속 같은 칸을 클릭하세요.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-xs sm:w-fit">
              <div className="rounded-lg bg-gray-50 px-3 py-2">
                <p className="font-semibold text-gray-800">
                  {checkerPatches.length}
                </p>
                <p className="text-gray-500">패치</p>
              </div>
              <div className="rounded-lg bg-gray-50 px-3 py-2">
                <p className="font-semibold text-gray-800">
                  {skinPixels?.length?.toLocaleString() || 0}
                </p>
                <p className="text-gray-500">피부</p>
              </div>
              <div className="rounded-lg bg-gray-50 px-3 py-2">
                <p className="font-semibold text-gray-800">
                  {checkerPatches.length >= 3 ? "ON" : "OFF"}
                </p>
                <p className="text-gray-500">보정</p>
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)] lg:items-start">
            {/* Canvas for clicking */}
            <div className="space-y-3">
              <div className="relative inline-block max-w-full">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  ref={checkerImgRef}
                  src={imageUrl ?? ""}
                  alt="컬러체커 보정 원본"
                  className="block max-w-full rounded-xl border max-h-[34vh] sm:max-h-[40vh] lg:max-h-[46vh]"
                  onLoad={handleCheckerImageLoad}
                  onError={handleCheckerImageError}
                />
                <canvas
                  ref={previewCanvasRef}
                  className="absolute inset-0 h-full w-full rounded-xl cursor-crosshair"
                  onClick={handleCanvasClick}
                />
              </div>
              <canvas ref={processingCanvasRef} className="hidden" />
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-left">
                  <p className="text-[11px] font-semibold text-gray-700">
                    이미지 상태
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {checkerImageStatus === "loading"
                      ? "보정용 이미지를 준비하는 중입니다."
                      : checkerImageStatus === "error"
                        ? checkerImageError
                        : "사진에서 같은 패치를 클릭하세요."}
                  </p>
                </div>
                {selectedReferencePatch && selectedReferenceHex && (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-left">
                    <p className="text-[11px] font-semibold text-rose-700">
                      선택 중
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <span
                        className="h-6 w-6 rounded border border-black/10"
                        style={{ backgroundColor: selectedReferenceHex }}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-rose-700">
                          {selectedReferencePatch.name}
                        </p>
                        <p className="text-[11px] font-mono text-rose-600">
                          {selectedReferenceHex}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
                {analysisOverlay && (
                  <>
                    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-left">
                      <p className="text-[11px] font-semibold text-gray-700">
                        감지 방식
                      </p>
                      <p className="mt-1 text-xs text-gray-500">
                        {analysisOverlay.mode === "facemesh"
                          ? "Face Mesh 피부 영역"
                          : "중앙 fallback 영역"}
                      </p>
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-left">
                      <p className="text-[11px] font-semibold text-gray-700">
                        대표 샘플 색
                      </p>
                      <div className="mt-1 flex items-center gap-2">
                        <span
                          className="inline-block h-5 w-5 rounded border border-black/10"
                          style={{ backgroundColor: analysisOverlay.sampleHex }}
                        />
                        <span className="text-[11px] font-mono text-gray-500">
                          {analysisOverlay.sampleHex}
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Checker patch selection */}
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 sm:p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-gray-800">
                    참조 패치
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    swatch를 보고 고른 뒤 사진에서 같은 칸을 클릭하세요.
                  </p>
                </div>
                <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-gray-600">
                  24 patches
                </span>
              </div>
              <div className="max-h-[28vh] overflow-y-auto pr-1 sm:max-h-[30vh] lg:max-h-[48vh]">
                <div className="grid grid-cols-6 gap-2 sm:grid-cols-6 lg:grid-cols-4">
                  {COLORCHECKER_REFERENCE.map((patch, idx) => {
                    const measured = checkerPatches.find(
                      (p) => p.patchIndex === idx,
                    );
                    const referenceHex = labToHex(patch.lab);
                    return (
                      <button
                        key={idx}
                        onClick={() => setSelectingPatch(idx)}
                        title={`${patch.name} ${referenceHex}`}
                        className={`relative rounded-lg border p-1.5 text-xs transition ${
                          selectingPatch === idx
                            ? "border-rose-500 bg-rose-50"
                            : measured
                              ? "border-green-500 bg-green-50"
                              : "border-gray-200 hover:border-gray-400"
                        }`}
                      >
                        <span className="absolute right-1 top-1 rounded bg-white/80 px-1 text-[10px] font-semibold text-gray-500">
                          {idx + 1}
                        </span>
                        <div
                          className="aspect-square rounded-md border border-black/10"
                          style={{ backgroundColor: referenceHex }}
                        />
                        {measured ? (
                          <div className="mt-1 flex items-center justify-center gap-1">
                            <span className="text-[10px] font-medium text-green-700">
                              선택됨
                            </span>
                            <span
                              className="h-3.5 w-3.5 rounded border border-black/10"
                              style={{
                                backgroundColor: `rgb(${measured.measuredRgb.join(",")})`,
                              }}
                            />
                          </div>
                        ) : (
                          <div className="mt-1 hidden text-center text-[10px] text-gray-400 lg:block">
                            {patch.name}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-gray-500">
                <div className="rounded-lg bg-white px-3 py-2">
                  숫자는 표준 ColorChecker 순서입니다.
                </div>
                <div className="rounded-lg bg-white px-3 py-2">
                  선택된 패치는 초록 상태로 유지됩니다.
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <button
              onClick={handleAnalyze}
              disabled={checkerImageStatus !== "ready"}
              title={
                checkerImageStatus !== "ready"
                  ? "보정용 사진 로딩이 완료된 후 분석할 수 있습니다."
                  : undefined
              }
              className={`rounded-lg px-5 py-2.5 transition sm:min-w-[220px] ${
                checkerImageStatus === "ready"
                  ? "bg-rose-600 text-white hover:bg-rose-700"
                  : "bg-gray-200 text-gray-500 cursor-not-allowed"
              }`}
            >
              {checkerPatches.length >= 3
                ? `보정 적용 후 분석 (${checkerPatches.length}개 패치)`
                : "보정 없이 분석"}
            </button>
            <div className="flex items-center gap-4 text-sm">
              <button
                onClick={handleSelectDifferentPhoto}
                className="text-gray-500 hover:text-gray-700"
              >
                다른 사진 선택
              </button>
              <button
                onClick={resetAll}
                className="text-gray-500 hover:text-gray-700"
              >
                다시 촬영
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Analyzing */}
      {step === "analyzing" && (
        <div className="rounded-xl bg-white p-10 shadow-sm text-center sm:p-12">
          <div className="animate-spin w-12 h-12 border-4 border-rose-200 border-t-rose-600 rounded-full mx-auto mb-4" />
          <p className="text-gray-600">추천 색상을 계산하고 있습니다...</p>
        </div>
      )}

      {/* Step 4: Results */}
      {step === "done" && result && (
        <div>
          {/* Skin color summary */}
          <div className="mb-4 rounded-xl bg-white p-4 shadow-sm sm:p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold">내 피부색 분석 결과</h2>
                <p className="mt-1 text-sm text-gray-500">
                  대표 피부색과 추천 결과를 한 번에 비교할 수 있게 정리했습니다.
                </p>
              </div>
              <button
                onClick={resetAll}
                className="text-left text-sm font-medium text-rose-600 hover:text-rose-700 sm:text-right"
              >
                다시 분석하기
              </button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-[auto_1fr] sm:items-center">
              <div
                className="h-20 w-20 rounded-xl border shadow-inner sm:h-24 sm:w-24"
                style={{ backgroundColor: result.skin_hex }}
              />
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="rounded-lg bg-gray-50 px-3 py-2">
                  <p className="text-[11px] font-semibold text-gray-700">
                    CIELAB
                  </p>
                  <p className="mt-1 font-mono text-sm text-gray-600">
                    L*={result.skin_lab[0]} a*={result.skin_lab[1]} b*=
                    {result.skin_lab[2]}
                  </p>
                </div>
                <div className="rounded-lg bg-gray-50 px-3 py-2">
                  <p className="text-[11px] font-semibold text-gray-700">HEX</p>
                  <p className="mt-1 font-mono text-sm text-gray-600">
                    {result.skin_hex}
                  </p>
                </div>
                <div className="rounded-lg bg-gray-50 px-3 py-2">
                  <p className="text-[11px] font-semibold text-gray-700">
                    추천 개수
                  </p>
                  <p className="mt-1 text-sm text-gray-600">
                    {result.recommendations.length}개
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Recommendations */}
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">추천 결과</h2>
              <p className="mt-1 text-sm text-gray-500">
                기본으로 상위 {INITIAL_VISIBLE_RECOMMENDATIONS}개만 보여주고
                필요하면 전체를 펼칩니다.
              </p>
            </div>
            {result.recommendations.length >
              INITIAL_VISIBLE_RECOMMENDATIONS && (
              <button
                onClick={() => setShowAllRecommendations((prev) => !prev)}
                className="text-sm font-medium text-rose-600 hover:text-rose-700"
              >
                {showAllRecommendations
                  ? "상위 추천만 보기"
                  : `전체 ${result.recommendations.length}개 보기`}
              </button>
            )}
          </div>
          <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-3">
            <p className="text-sm font-semibold text-gray-800">
              CIEDE2000 색차(ΔE) 해석 기준
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-gray-600">
              <span className="rounded-full bg-white px-3 py-1.5">
                ΔE ≤ 1.0 거의 구분 어려움
              </span>
              <span className="rounded-full bg-white px-3 py-1.5">
                1.0 &lt; ΔE ≤ 2.0 아주 근접
              </span>
              <span className="rounded-full bg-white px-3 py-1.5">
                2.0 &lt; ΔE ≤ 3.5 눈에 띄는 차이
              </span>
              <span className="rounded-full bg-white px-3 py-1.5">
                3.5 &lt; ΔE ≤ 5.0 뚜렷한 차이
              </span>
              <span className="rounded-full bg-white px-3 py-1.5">
                ΔE &gt; 5.0 차이 큼
              </span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {visibleRecommendations.map((rec, i) => (
              <div
                key={rec.id}
                className="rounded-xl border bg-white p-4 shadow-sm transition hover:shadow-md"
              >
                <div className="mb-3 flex items-start justify-between gap-2">
                  <span className="rounded bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-600">
                    {i + 1}위
                  </span>
                  <span
                    className={`rounded px-2 py-0.5 text-[11px] ${getDeltaEBadgeClass(
                      rec.delta_e,
                    )}`}
                  >
                    {rec.delta_e_category}
                  </span>
                </div>

                {/* Color comparison */}
                <div className="mb-3 grid grid-cols-2 gap-2">
                  <div className="text-center">
                    <div
                      className="h-14 rounded-lg border shadow-inner"
                      style={{ backgroundColor: result.skin_hex }}
                    />
                    <p className="mt-1 text-[11px] text-gray-400">내 피부</p>
                  </div>
                  <div className="text-center">
                    <div
                      className="h-14 rounded-lg border shadow-inner"
                      style={{ backgroundColor: rec.hex_color }}
                    />
                    <p className="mt-1 text-[11px] text-gray-400">추천색</p>
                  </div>
                </div>

                <h3 className="text-sm font-semibold">{rec.shade_name}</h3>
                <p className="mt-0.5 text-xs text-gray-500">{rec.brand}</p>
                {rec.shade_code && (
                  <p className="text-xs text-gray-400">{rec.shade_code}</p>
                )}
                <div className="mt-2 rounded-lg bg-gray-50 px-3 py-2">
                  <p className="font-mono text-[11px] text-gray-600">
                    ΔE={rec.delta_e}
                  </p>
                  <p className="mt-1 text-[11px] font-semibold text-gray-700">
                    {rec.delta_e_range}
                  </p>
                  <p className="mt-1 text-[11px] text-gray-500">
                    {rec.delta_e_description}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 text-center">
            <button
              onClick={resetAll}
              className="font-medium text-rose-600 hover:text-rose-700"
            >
              새 사진으로 다시 분석
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
