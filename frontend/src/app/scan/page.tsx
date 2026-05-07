"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiPost } from "@/lib/api";
import { useApiPrewarm } from "@/hooks/useApiPrewarm";
import {
  buildRegionPolygons,
  extractSkinPixelsByRegion,
  flattenSkinRegionPixels,
  type FaceRegionPolygon,
  SKIN_REGIONS,
  type SkinRegionPixels,
} from "@/lib/facemesh";
import {
  buildCheckerPatchesFromDetection,
  detectColorCheckerFromCanvas,
  type ColorCheckerDetection,
} from "@/lib/colorChecker";
import {
  brightSkinPreviewHex,
  downsamplePixels,
  downsampleSkinRegions,
  FALLBACK_OVERLAY_FILL,
  FALLBACK_OVERLAY_STROKE,
  getSkinRegionPixelCounts,
  isSkinRegionKey,
  type SkinExtraction,
  type SkinOverlayBase,
  SKIN_REGION_OVERLAY_STYLES,
} from "@/lib/skinSampling";
import { displayShade } from "@/lib/foundation";
import type { AnalysisResponse, RecommendationItem } from "@/types";
import CameraCapture from "@/components/CameraCapture";

type Step = "upload" | "camera" | "checker" | "analyzing" | "done";
type CheckerImageStatus = "idle" | "loading" | "ready" | "error";
type AnalysisOverlay = SkinOverlayBase & {
  sampleHex: string;
  colorChecker: ColorCheckerDetection | null;
};

const CHECKER_ACCEPTED_SCORE = 70;
const EXPECTED_CHECKER_PATCH_COUNT = 24;

function getDeltaEBadgeClass(deltaE: number): string {
  if (deltaE <= 1.0) return "bg-green-100 text-green-700";
  if (deltaE <= 2.0) return "bg-emerald-100 text-emerald-700";
  if (deltaE <= 3.5) return "bg-yellow-100 text-yellow-700";
  if (deltaE <= 5.0) return "bg-orange-100 text-orange-700";
  return "bg-red-100 text-red-700";
}

function getCheckerQuality(score: number): {
  label: string;
  badgeClassName: string;
  accentClassName: string;
} {
  if (score <= 30) {
    return {
      label: "안정적",
      badgeClassName: "bg-emerald-50 text-emerald-700 ring-emerald-200",
      accentClassName: "text-emerald-700",
    };
  }
  if (score <= 50) {
    return {
      label: "사용 가능",
      badgeClassName: "bg-sky-50 text-sky-700 ring-sky-200",
      accentClassName: "text-sky-700",
    };
  }
  return {
    label: "검토 필요",
    badgeClassName: "bg-amber-50 text-amber-700 ring-amber-200",
    accentClassName: "text-amber-700",
  };
}

export default function ScanPage() {
  const FACE_MESH_TIMEOUT_MS = 8000;
  const INITIAL_VISIBLE_RECOMMENDATIONS = 4;
  const MAX_ANALYSIS_PIXELS = 10000;
  const MAX_REGION_ANALYSIS_PIXELS = 2500;
  const [step, setStep] = useState<Step>("upload");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAllRecommendations, setShowAllRecommendations] = useState(false);
  const [skinExtraction, setSkinExtraction] = useState<SkinExtraction | null>(
    null,
  );
  const [detectedChecker, setDetectedChecker] =
    useState<ColorCheckerDetection | null>(null);
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
  const [comparisonBrand, setComparisonBrand] = useState<string | null>(null);
  const [comparisonProduct, setComparisonProduct] = useState<string | null>(
    null,
  );
  const [comparisonResult, setComparisonResult] = useState<
    RecommendationItem[] | null
  >(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const lastAnalyzeRequestRef = useRef<{
    skin_pixels_rgb: number[][];
    skin_regions_rgb: ReturnType<typeof downsampleSkinRegions> | null;
    checker_patches: ReturnType<typeof buildCheckerPatchesFromDetection>;
  } | null>(null);
  const visibleRecommendations = result
    ? showAllRecommendations
      ? result.recommendations
      : result.recommendations.slice(0, INITIAL_VISIBLE_RECOMMENDATIONS)
    : [];
  const checkerPatchCount = detectedChecker?.patches.length ?? 0;
  const checkerConfidence = detectedChecker
    ? Math.round(detectedChecker.confidence * 100)
    : 0;
  const checkerQuality = detectedChecker
    ? getCheckerQuality(detectedChecker.score)
    : null;

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

    ctx.save();
    ctx.lineWidth = Math.max(2, previewCanvas.width / 320);

    for (const polygon of overlay.polygons) {
      if (polygon.points.length === 0) continue;

      const regionStyle =
        overlay.mode === "facemesh" && isSkinRegionKey(polygon.name)
          ? SKIN_REGION_OVERLAY_STYLES[polygon.name]
          : null;
      const strokeColor = regionStyle?.stroke ?? FALLBACK_OVERLAY_STROKE;
      const fillColor = regionStyle?.fill ?? FALLBACK_OVERLAY_FILL;

      ctx.beginPath();
      ctx.moveTo(polygon.points[0].x, polygon.points[0].y);
      for (const point of polygon.points.slice(1)) {
        ctx.lineTo(point.x, point.y);
      }
      ctx.closePath();
      ctx.fillStyle = fillColor;
      ctx.strokeStyle = strokeColor;
      ctx.fill();
      ctx.stroke();
    }

    if (overlay.fallbackRect) {
      ctx.strokeStyle = FALLBACK_OVERLAY_STROKE;
      ctx.fillStyle = FALLBACK_OVERLAY_FILL;
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

    if (overlay.colorChecker) {
      const checker = overlay.colorChecker;

      ctx.lineWidth = Math.max(1.5, previewCanvas.width / 900);
      ctx.strokeStyle = "#7c3aed";
      ctx.fillStyle = "rgba(124, 58, 237, 0.12)";
      const checkerPolygon = checker.polygon;
      ctx.beginPath();
      ctx.moveTo(checkerPolygon[0].x, checkerPolygon[0].y);
      for (const point of checkerPolygon.slice(1)) {
        ctx.lineTo(point.x, point.y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      const labelX =
        checkerPolygon.reduce((sum, point) => sum + point.x, 0) /
        checkerPolygon.length;
      const labelY =
        checkerPolygon.reduce((sum, point) => sum + point.y, 0) /
        checkerPolygon.length;
      ctx.font = `${Math.max(12, previewCanvas.width / 72)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(124, 58, 237, 0.88)";
      ctx.fillText("ColorChecker", labelX, labelY);

      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#7c3aed";
      ctx.lineWidth = Math.max(2, previewCanvas.width / 720);
      const fiducialRadius = Math.max(4, previewCanvas.width / 180);
      if (checker.fiducials.center) {
        ctx.beginPath();
        ctx.arc(
          checker.fiducials.center.x,
          checker.fiducials.center.y,
          fiducialRadius,
          0,
          Math.PI * 2,
        );
        ctx.fill();
        ctx.stroke();
      }
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
      extractedSkin: SkinExtraction,
      overlay: AnalysisOverlay,
      nextError: string | null = null,
    ) => {
      detectionCompletedRef.current = true;
      clearDetectionTimeout();
      setSkinExtraction(extractedSkin);
      setAnalysisOverlay(overlay);
      setDetectedChecker(overlay.colorChecker);
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
      setResult(null);
      setSkinExtraction(null);
      setAnalysisOverlay(null);
      setDetectedChecker(null);
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
      setResult(null);
      setSkinExtraction(null);
      setAnalysisOverlay(null);
      setDetectedChecker(null);
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

    const recalculatedChecker = detectColorCheckerFromCanvas(canvas);
    let overlayForPreview = analysisOverlay;

    if (
      analysisOverlay &&
      recalculatedChecker &&
      (!analysisOverlay.colorChecker ||
        recalculatedChecker.score < analysisOverlay.colorChecker.score)
    ) {
      overlayForPreview = {
        ...analysisOverlay,
        colorChecker: recalculatedChecker,
      };
      setAnalysisOverlay(overlayForPreview);
      setDetectedChecker(recalculatedChecker);
    } else if (analysisOverlay?.colorChecker) {
      setDetectedChecker(analysisOverlay.colorChecker);
    }

    redrawPreviewCanvas(overlayForPreview);
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
      nextError = "얼굴 자동 인식이 지연되어 하부 중심 영역 기준으로 계속 진행합니다.",
    ) => {
      if (detectionCompletedRef.current) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setError("이미지를 처리하지 못했습니다. 다시 시도해주세요.");
        return;
      }

      const w = canvas.width;
      const h = canvas.height;
      const rectX = Math.round(w * 0.35);
      const rectY = Math.round(h * 0.46);
      const rectWidth = Math.round(w * 0.3);
      const rectHeight = Math.round(h * 0.24);
      const imageData = ctx.getImageData(rectX, rectY, rectWidth, rectHeight);
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
        {
          combinedPixels: pixels,
          skinRegions: null,
        },
        {
          mode: "fallback",
          pixelCount: pixels.length,
          sampleHex: brightSkinPreviewHex(pixels),
          colorChecker: detectColorCheckerFromCanvas(canvas),
          regionPixelCounts: {},
          polygons: [
            {
              name: "fallback",
              points: [
                { x: rectX, y: rectY },
                { x: rectX + rectWidth, y: rectY },
                { x: rectX + rectWidth, y: rectY + rectHeight },
                { x: rectX, y: rectY + rectHeight },
              ],
              bounds: {
                minX: rectX,
                minY: rectY,
                maxX: rectX + rectWidth,
                maxY: rectY + rectHeight,
              },
            },
          ],
          fallbackRect: {
            x: rectX,
            y: rectY,
            width: rectWidth,
            height: rectHeight,
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
            "얼굴을 감지하지 못해 하부 중심 영역 기준으로 계속 진행합니다.",
          );
          return;
        }

        const landmarks = results.multiFaceLandmarks[0];
        const skinRegions = extractSkinPixelsByRegion(
          canvas,
          landmarks,
          SKIN_REGIONS,
        );
        const pixels = flattenSkinRegionPixels(skinRegions);
        const polygons = buildRegionPolygons(canvas, landmarks, SKIN_REGIONS);

        if (pixels.length < 100) {
          fallbackExtract(
            canvas,
            "대표 피부색 후보 픽셀이 적어 하부 중심 영역 기준으로 계속 진행합니다.",
          );
          return;
        }

        completeSkinExtraction(
          {
            combinedPixels: pixels,
            skinRegions,
          },
          {
            mode: "facemesh",
            pixelCount: pixels.length,
            sampleHex: brightSkinPreviewHex(pixels),
            colorChecker: detectColorCheckerFromCanvas(canvas),
            polygons,
            regionPixelCounts: getSkinRegionPixelCounts(skinRegions),
          },
        );
      });

      await faceMesh.send({ image: canvas });
    } catch (err) {
      console.warn(
        "MediaPipe Face Mesh 로딩 실패, 하부 중심 fallback 영역 사용:",
        err,
      );
      fallbackExtract(canvas);
    }
  };

  const handleAnalyze = async () => {
    if (!skinExtraction) return;
    setStep("analyzing");
    setError(null);
    setShowAllRecommendations(false);
    setComparisonBrand(null);
    setComparisonProduct(null);
    setComparisonResult(null);

    try {
      const patches = buildCheckerPatchesFromDetection(detectedChecker);

      const sampledSkinRegions = skinExtraction.skinRegions
        ? downsampleSkinRegions(
            skinExtraction.skinRegions,
            MAX_REGION_ANALYSIS_PIXELS,
          )
        : null;
      const pixels = sampledSkinRegions
        ? downsamplePixels(
            flattenSkinRegionPixels(sampledSkinRegions),
            MAX_ANALYSIS_PIXELS,
          )
        : downsamplePixels(skinExtraction.combinedPixels, MAX_ANALYSIS_PIXELS);

      const baseRequestBody = {
        skin_pixels_rgb: pixels,
        skin_regions_rgb: sampledSkinRegions,
        checker_patches: patches,
      };
      lastAnalyzeRequestRef.current = baseRequestBody;

      const response = await apiPost<AnalysisResponse>("/analyze", {
        ...baseRequestBody,
        top_n: 10,
      });

      setResult(response);
      setStep("done");
    } catch (err: any) {
      setError(err.message || "분석 중 오류가 발생했습니다.");
      setStep("checker");
    }
  };

  const handleSelectComparisonBrand = useCallback(
    async (brand: string | null) => {
      setComparisonBrand(brand);
      setComparisonProduct(null);
      setComparisonResult(null);
      setComparisonError(null);

      if (!brand || !lastAnalyzeRequestRef.current) return;

      setComparisonLoading(true);
      try {
        const response = await apiPost<AnalysisResponse>("/analyze", {
          ...lastAnalyzeRequestRef.current,
          brands: [brand],
          top_n: 200,
        });
        setComparisonResult(response.recommendations);
      } catch (err: any) {
        setComparisonError(err.message || "비교 정보를 가져오지 못했습니다.");
      } finally {
        setComparisonLoading(false);
      }
    },
    [],
  );

  const handleSelectDifferentPhoto = useCallback(() => {
    revokeUploadedObjectUrl();
    setStep("upload");
    setImageUrl(null);
    setSkinExtraction(null);
    setAnalysisOverlay(null);
    setDetectedChecker(null);
    setCheckerImageStatus("idle");
    setCheckerImageError(null);
    setResult(null);
    setError(null);
    setShowAllRecommendations(false);
  }, [revokeUploadedObjectUrl]);

  const resetAll = () => {
    revokeUploadedObjectUrl();
    setStep("upload");
    setImageUrl(null);
    setSkinExtraction(null);
    setAnalysisOverlay(null);
    setDetectedChecker(null);
    setResult(null);
    setError(null);
    setCheckerImageStatus("idle");
    setCheckerImageError(null);
    setShowAllRecommendations(false);
  };

  useApiPrewarm("/analysis-ready");

  useEffect(() => {
    setDetectedChecker(null);
    setCheckerImageStatus("idle");
    setCheckerImageError(null);
    setSkinExtraction(null);
    setAnalysisOverlay(null);
    setResult(null);
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
    <div className="mx-auto max-w-7xl px-3 py-3 sm:px-4 sm:py-4">
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
          <div className="mt-4 rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-500">
            정면, 무표정, 균일한 조명에서 촬영하고 HDR·뷰티 필터·강한 그림자는
            가능한 한 피하는 편이 분석 안정성과 추천 품질에 유리합니다.
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
                피부 영역을 찾는 중입니다...
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

      {/* Step 2: Detection review */}
      {step === "checker" && (
        <div className="rounded-xl bg-white p-4 shadow-sm sm:p-5 lg:p-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold">자동 감지 영역 확인</h2>
            <p className="mt-1 text-sm text-gray-500">
              피부 영역과 컬러체커(보라색 외곽선)를 자동으로 찾았습니다. 결과가
              괜찮으면 분석을 시작하세요.
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(380px,0.95fr)_minmax(420px,1.05fr)] xl:grid-cols-[minmax(420px,0.9fr)_minmax(520px,1.1fr)] lg:items-start">
            <div className="space-y-3">
              <div className="flex justify-center">
                <div className="relative inline-block max-w-full overflow-hidden rounded-xl border bg-gray-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    ref={checkerImgRef}
                    src={imageUrl ?? ""}
                    alt="컬러체커 보정 원본"
                    className="block max-w-full max-h-[44vh] sm:max-h-[52vh] lg:max-h-[58vh]"
                    onLoad={handleCheckerImageLoad}
                    onError={handleCheckerImageError}
                  />
                  <canvas
                    ref={previewCanvasRef}
                    className="pointer-events-none absolute inset-0 h-full w-full rounded-xl"
                  />
                </div>
              </div>
              <canvas ref={processingCanvasRef} className="hidden" />
              {analysisOverlay && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  <span className="font-semibold text-gray-700">추출 색상</span>
                  <span
                    className="inline-block h-5 w-5 rounded border border-black/10"
                    style={{ backgroundColor: analysisOverlay.sampleHex }}
                  />
                  <span className="font-mono">{analysisOverlay.sampleHex}</span>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 sm:p-4 lg:p-5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
                <span
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${
                    checkerQuality
                      ? checkerQuality.badgeClassName
                      : "bg-amber-50 text-amber-700 ring-amber-200"
                  }`}
                >
                  {detectedChecker ? checkerQuality?.label : "미검출"}
                </span>
                <span className="text-gray-700">
                  신뢰도{" "}
                  <span className="font-semibold">
                    {detectedChecker ? `${checkerConfidence}%` : "-"}
                  </span>
                </span>
                <span className="text-gray-300">·</span>
                <span className="text-gray-700">
                  패치{" "}
                  <span className="font-semibold">
                    {checkerPatchCount}/{EXPECTED_CHECKER_PATCH_COUNT}
                  </span>
                </span>
                <span className="text-gray-300">·</span>
                <span className="text-gray-700">
                  보정{" "}
                  <span
                    className={`font-semibold ${
                      detectedChecker ? "text-emerald-600" : "text-gray-400"
                    }`}
                  >
                    {detectedChecker ? "ON" : "OFF"}
                  </span>
                </span>
                <span className="text-gray-300">·</span>
                <span className="text-gray-700">
                  피부{" "}
                  <span className="font-semibold">
                    {skinExtraction?.combinedPixels.length?.toLocaleString() ||
                      0}
                  </span>{" "}
                  px
                </span>
              </div>
              {detectedChecker && (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className="h-full rounded-full bg-rose-500"
                    style={{ width: `${checkerConfidence}%` }}
                  />
                </div>
              )}
              <details className="mt-3 text-xs text-gray-500">
                <summary className="cursor-pointer font-semibold text-gray-600 hover:text-gray-800">
                  자세히
                </summary>
                {detectedChecker ? (
                  <div className="mt-2 space-y-1">
                    <p>
                      <span className="font-semibold text-gray-700">score</span>{" "}
                      {detectedChecker.score.toFixed(2)} (낮을수록 정확,{" "}
                      {CHECKER_ACCEPTED_SCORE} 이하면 보정 사용)
                    </p>
                    <p>
                      신뢰도는 score · 패치 수 · 코너 정렬을 합산해 계산합니다.
                    </p>
                  </div>
                ) : (
                  <p className="mt-2">
                    컬러체커를 찾지 못해 보정 없이 분석합니다. 카드가 잘리지
                    않게 다시 촬영하면 결과가 더 안정적입니다.
                  </p>
                )}
              </details>
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
              {detectedChecker
                ? "컬러체커 보정 적용 후 분석"
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
                  컬러체커 보정 전후 색을 함께 확인할 수 있게 정리했습니다.
                </p>
              </div>
              <button
                onClick={resetAll}
                className="text-left text-sm font-medium text-rose-600 hover:text-rose-700 sm:text-right"
              >
                다시 분석하기
              </button>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-[auto_1fr] sm:items-start">
              {imageUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={imageUrl}
                  alt="분석한 얼굴"
                  className="block w-full max-w-[220px] rounded-xl border shadow-sm sm:w-[220px]"
                />
              )}
              <div className="space-y-3">
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 sm:p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-semibold text-gray-800">
                      컬러체커 보정 전 / 후
                    </p>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        result.correction_applied
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {result.correction_applied ? "보정 적용" : "보정 미적용"}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="flex items-center gap-3 rounded-lg bg-white p-2">
                      <div
                        className="aspect-square w-16 shrink-0 rounded-md border shadow-inner sm:w-20"
                        style={{ backgroundColor: result.skin_hex_raw }}
                      />
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold text-gray-500">
                          보정 전
                        </p>
                        <p className="font-mono text-xs text-gray-700">
                          {result.skin_hex_raw}
                        </p>
                        <p className="mt-0.5 font-mono text-[10px] text-gray-400">
                          L* {result.skin_lab_raw[0]} a*{" "}
                          {result.skin_lab_raw[1]} b* {result.skin_lab_raw[2]}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 rounded-lg bg-white p-2 ring-1 ring-rose-200">
                      <div
                        className="aspect-square w-16 shrink-0 rounded-md border shadow-inner sm:w-20"
                        style={{ backgroundColor: result.skin_hex }}
                      />
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold text-rose-600">
                          보정 후 (분석 사용)
                        </p>
                        <p className="font-mono text-xs text-gray-700">
                          {result.skin_hex}
                        </p>
                        <p className="mt-0.5 font-mono text-[10px] text-gray-400">
                          L* {result.skin_lab[0]} a* {result.skin_lab[1]} b*{" "}
                          {result.skin_lab[2]}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-lg bg-gray-50 px-3 py-2">
                    <p className="text-[11px] font-semibold text-gray-700">
                      분석 신뢰도
                    </p>
                    <p className="mt-1 text-sm text-gray-600">
                      {result.analysis_meta.confidence.level} ·{" "}
                      {Math.round(result.analysis_meta.confidence.score * 100)}%
                    </p>
                  </div>
                  <div className="rounded-lg bg-gray-50 px-3 py-2">
                    <p className="text-[11px] font-semibold text-gray-700">
                      컬러체커 신뢰도
                    </p>
                    <p className="mt-1 text-sm text-gray-600">
                      {detectedChecker && checkerQuality
                        ? `${checkerQuality.label} · ${checkerConfidence}%`
                        : "미검출"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Brand/product comparison */}
          {(() => {
            const recommendationBrands = Array.from(
              new Set(result.recommendations.map((r) => r.brand)),
            ).sort();
            const productsForBrand = comparisonResult
              ? Array.from(
                  new Set(
                    comparisonResult
                      .map((r) => r.product_name)
                      .filter((p): p is string => Boolean(p)),
                  ),
                ).sort()
              : [];
            const filteredShades = comparisonResult
              ? comparisonProduct
                ? comparisonResult.filter(
                    (r) => r.product_name === comparisonProduct,
                  )
                : comparisonResult
              : [];
            return (
              <div className="mb-4 rounded-xl bg-white p-4 shadow-sm sm:p-5">
                <div className="mb-3 flex flex-col gap-1">
                  <h2 className="text-lg font-semibold">
                    브랜드 · 제품별 호수 비교
                  </h2>
                  <p className="text-sm text-gray-500">
                    특정 브랜드와 제품을 골라 그 라인 안의 호수들과 내 피부색을
                    한눈에 비교합니다.
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <select
                    value={comparisonBrand ?? ""}
                    onChange={(event) =>
                      void handleSelectComparisonBrand(
                        event.target.value || null,
                      )
                    }
                    className="rounded border px-3 py-2 text-sm"
                  >
                    <option value="">브랜드 선택…</option>
                    {recommendationBrands.map((brand) => (
                      <option key={brand} value={brand}>
                        {brand}
                      </option>
                    ))}
                  </select>
                  <select
                    value={comparisonProduct ?? ""}
                    onChange={(event) =>
                      setComparisonProduct(event.target.value || null)
                    }
                    disabled={!comparisonResult || productsForBrand.length === 0}
                    className="rounded border px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-400"
                  >
                    <option value="">전체 제품</option>
                    {productsForBrand.map((product) => (
                      <option key={product} value={product}>
                        {product}
                      </option>
                    ))}
                  </select>
                </div>

                {comparisonError && (
                  <p className="mt-3 text-sm text-red-600">
                    {comparisonError}
                  </p>
                )}

                {comparisonLoading && (
                  <p className="mt-3 text-sm text-gray-500">
                    {comparisonBrand} 호수를 불러오는 중입니다...
                  </p>
                )}

                {!comparisonLoading &&
                  comparisonBrand &&
                  comparisonResult &&
                  filteredShades.length === 0 && (
                    <p className="mt-3 text-sm text-gray-500">
                      해당 조건에 맞는 호수가 없습니다.
                    </p>
                  )}

                {filteredShades.length > 0 && (
                  <div className="mt-4 space-y-2">
                    <div className="flex items-center gap-3 rounded-lg bg-gray-50 p-2">
                      <div
                        className="aspect-square w-10 shrink-0 rounded-md border shadow-inner"
                        style={{ backgroundColor: result.skin_hex }}
                      />
                      <div className="text-xs">
                        <p className="font-semibold text-gray-700">내 피부색</p>
                        <p className="font-mono text-gray-500">
                          {result.skin_hex}
                        </p>
                      </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {filteredShades.map((shade) => (
                        <div
                          key={shade.id}
                          className="flex items-center gap-3 rounded-lg border bg-white p-2"
                        >
                          <div
                            className="aspect-square w-12 shrink-0 rounded-md border shadow-inner"
                            style={{ backgroundColor: shade.hex_color }}
                          />
                          <div className="min-w-0 flex-1 text-xs">
                            <p className="truncate font-semibold text-gray-800">
                              {displayShade(shade)}
                            </p>
                            {shade.product_name && (
                              <p className="truncate text-[11px] text-gray-500">
                                {shade.product_name}
                              </p>
                            )}
                            <p className="mt-0.5 font-mono text-[11px] text-gray-500">
                              ΔE={shade.delta_e}
                            </p>
                          </div>
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${getDeltaEBadgeClass(
                              shade.delta_e,
                            )}`}
                          >
                            {shade.delta_e_category}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

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
                      className="aspect-square w-full rounded-lg border shadow-inner"
                      style={{ backgroundColor: result.skin_hex }}
                    />
                    <p className="mt-1 text-[11px] text-gray-400">내 피부</p>
                  </div>
                  <div className="text-center">
                    <div
                      className="aspect-square w-full rounded-lg border shadow-inner"
                      style={{ backgroundColor: rec.hex_color }}
                    />
                    <p className="mt-1 text-[11px] text-gray-400">추천색</p>
                  </div>
                </div>

                <h3 className="text-sm font-semibold">{displayShade(rec)}</h3>
                <p className="mt-0.5 text-xs text-gray-500">{rec.brand}</p>
                {rec.product_name && (
                  <p className="text-xs text-gray-400">{rec.product_name}</p>
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
