"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import { apiPost } from "@/lib/api";
import {
  buildRegionPolygons,
  extractSkinPixelsByRegion,
  flattenSkinRegionPixels,
  SKIN_REGIONS,
} from "@/lib/facemesh";
import {
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
import type { ActiveAdminPanel } from "@/components/admin/types";
import type { AnalysisResponse } from "@/types";

type UseRoiValidationWorkflowArgs = {
  activePanel: ActiveAdminPanel;
  setActivePanel: Dispatch<SetStateAction<ActiveAdminPanel>>;
};

const ROI_FACE_MESH_TIMEOUT_MS = 8000;
const ROI_MAX_ANALYSIS_PIXELS = 10000;
const ROI_MAX_REGION_ANALYSIS_PIXELS = 2500;

export function useRoiValidationWorkflow({
  activePanel,
  setActivePanel,
}: UseRoiValidationWorkflowArgs) {
  const [roiFileName, setRoiFileName] = useState<string | null>(null);
  const [roiPreview, setRoiPreview] = useState<string | null>(null);
  const [roiExtraction, setRoiExtraction] = useState<SkinExtraction | null>(
    null,
  );
  const [roiOverlay, setRoiOverlay] = useState<SkinOverlayBase | null>(null);
  const [roiResult, setRoiResult] = useState<AnalysisResponse | null>(null);
  const [roiError, setRoiError] = useState<string | null>(null);
  const [roiImageStatus, setRoiImageStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [roiAnalyzing, setRoiAnalyzing] = useState(false);

  const roiProcessingCanvasRef = useRef<HTMLCanvasElement>(null);
  const roiPreviewCanvasRef = useRef<HTMLCanvasElement>(null);
  const roiImgRef = useRef<HTMLImageElement>(null);
  const roiDetectionTimeoutRef = useRef<number | null>(null);
  const roiDetectionCompletedRef = useRef(false);

  const clearRoiDetectionTimeout = useCallback(() => {
    if (roiDetectionTimeoutRef.current === null) return;
    window.clearTimeout(roiDetectionTimeoutRef.current);
    roiDetectionTimeoutRef.current = null;
  }, []);

  const resetRoiState = useCallback(() => {
    roiDetectionCompletedRef.current = true;
    clearRoiDetectionTimeout();
    setRoiPreview((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }
      return null;
    });
    setRoiFileName(null);
    setRoiExtraction(null);
    setRoiOverlay(null);
    setRoiResult(null);
    setRoiError(null);
    setRoiImageStatus("idle");
    setRoiAnalyzing(false);
  }, [clearRoiDetectionTimeout]);

  useEffect(() => {
    return () => {
      roiDetectionCompletedRef.current = true;
      clearRoiDetectionTimeout();
      if (roiPreview) {
        URL.revokeObjectURL(roiPreview);
      }
    };
  }, [clearRoiDetectionTimeout, roiPreview]);

  useEffect(() => {
    if (activePanel !== "roi") {
      resetRoiState();
    }
  }, [activePanel, resetRoiState]);

  const drawImageToCanvas = useCallback(
    (image: HTMLImageElement, canvas: HTMLCanvasElement) => {
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return false;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0);
      return true;
    },
    [],
  );

  const redrawRoiPreviewCanvas = useCallback((overlay: SkinOverlayBase | null) => {
    const sourceCanvas = roiProcessingCanvasRef.current;
    const previewCanvas = roiPreviewCanvasRef.current;
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
      ctx.fillStyle = regionStyle?.fill ?? FALLBACK_OVERLAY_FILL;
      ctx.strokeStyle = regionStyle?.stroke ?? FALLBACK_OVERLAY_STROKE;

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
      ctx.fillStyle = FALLBACK_OVERLAY_FILL;
      ctx.strokeStyle = FALLBACK_OVERLAY_STROKE;
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

  const completeRoiExtraction = useCallback(
    (
      extracted: SkinExtraction,
      overlay: SkinOverlayBase,
      nextError: string | null = null,
    ) => {
      roiDetectionCompletedRef.current = true;
      clearRoiDetectionTimeout();
      setRoiExtraction(extracted);
      setRoiOverlay(overlay);
      redrawRoiPreviewCanvas(overlay);
      setRoiError(nextError);
      setRoiImageStatus("ready");
    },
    [clearRoiDetectionTimeout, redrawRoiPreviewCanvas],
  );

  const fallbackRoiExtract = useCallback(
    (
      canvas: HTMLCanvasElement,
      nextError = "얼굴 자동 인식이 지연되어 하부 중심 fallback 영역으로 표시합니다.",
    ) => {
      if (roiDetectionCompletedRef.current) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setRoiError("이미지를 처리하지 못했습니다. 다시 시도해주세요.");
        setRoiImageStatus("error");
        return;
      }

      const rectX = Math.round(canvas.width * 0.35);
      const rectY = Math.round(canvas.height * 0.46);
      const rectWidth = Math.round(canvas.width * 0.3);
      const rectHeight = Math.round(canvas.height * 0.24);
      const imageData = ctx.getImageData(rectX, rectY, rectWidth, rectHeight);
      const pixels: number[][] = [];

      for (let index = 0; index < imageData.data.length; index += 4) {
        pixels.push([
          imageData.data[index],
          imageData.data[index + 1],
          imageData.data[index + 2],
        ]);
      }

      if (pixels.length < 100) {
        roiDetectionCompletedRef.current = true;
        clearRoiDetectionTimeout();
        setRoiError("피부 후보 영역을 추출하지 못했습니다.");
        setRoiImageStatus("error");
        return;
      }

      completeRoiExtraction(
        {
          combinedPixels: pixels,
          skinRegions: null,
        },
        {
          mode: "fallback",
          pixelCount: pixels.length,
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
          regionPixelCounts: {},
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
    [clearRoiDetectionTimeout, completeRoiExtraction],
  );

  const loadFaceMeshAndExtract = useCallback(
    async (canvas: HTMLCanvasElement) => {
      try {
        roiDetectionCompletedRef.current = false;
        clearRoiDetectionTimeout();
        roiDetectionTimeoutRef.current = window.setTimeout(() => {
          fallbackRoiExtract(canvas);
        }, ROI_FACE_MESH_TIMEOUT_MS);

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
          if (roiDetectionCompletedRef.current) return;

          if (
            !results.multiFaceLandmarks ||
            results.multiFaceLandmarks.length === 0
          ) {
            fallbackRoiExtract(
              canvas,
              "얼굴을 감지하지 못해 하부 중심 fallback 영역으로 표시합니다.",
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
            fallbackRoiExtract(
              canvas,
              "대표 피부색 후보 픽셀이 적어 fallback 영역으로 표시합니다.",
            );
            return;
          }

          completeRoiExtraction(
            {
              combinedPixels: pixels,
              skinRegions,
            },
            {
              mode: "facemesh",
              pixelCount: pixels.length,
              polygons,
              regionPixelCounts: getSkinRegionPixelCounts(skinRegions),
            },
          );
        });

        await faceMesh.send({ image: canvas });
      } catch (error) {
        console.warn("Admin ROI Face Mesh fallback:", error);
        fallbackRoiExtract(canvas);
      }
    },
    [
      clearRoiDetectionTimeout,
      completeRoiExtraction,
      fallbackRoiExtract,
    ],
  );

  const handleRoiUpload = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      if (file.size > 10 * 1024 * 1024) {
        setRoiError("파일 크기는 10MB 이하여야 합니다.");
        return;
      }

      roiDetectionCompletedRef.current = false;
      setRoiPreview((current) => {
        if (current) {
          URL.revokeObjectURL(current);
        }
        return URL.createObjectURL(file);
      });
      setRoiFileName(file.name);
      setRoiExtraction(null);
      setRoiOverlay(null);
      setRoiResult(null);
      setRoiError(null);
      setRoiImageStatus("loading");
    },
    [],
  );

  const handleRoiImageLoad = useCallback(() => {
    const image = roiImgRef.current;
    const canvas = roiProcessingCanvasRef.current;
    if (!image || !canvas) return;

    const drawn = drawImageToCanvas(image, canvas);
    if (!drawn) {
      setRoiError("ROI 검증용 캔버스를 초기화하지 못했습니다.");
      setRoiImageStatus("error");
      return;
    }

    redrawRoiPreviewCanvas(null);
    void loadFaceMeshAndExtract(canvas);
  }, [drawImageToCanvas, loadFaceMeshAndExtract, redrawRoiPreviewCanvas]);

  const analyzeRoi = useCallback(async () => {
    if (!roiExtraction) return;

    setRoiAnalyzing(true);
    setRoiError(null);

    try {
      const sampledSkinRegions = roiExtraction.skinRegions
        ? downsampleSkinRegions(
            roiExtraction.skinRegions,
            ROI_MAX_REGION_ANALYSIS_PIXELS,
          )
        : null;
      const pixels = sampledSkinRegions
        ? downsamplePixels(
            flattenSkinRegionPixels(sampledSkinRegions),
            ROI_MAX_ANALYSIS_PIXELS,
          )
        : downsamplePixels(roiExtraction.combinedPixels, ROI_MAX_ANALYSIS_PIXELS);

      const response = await apiPost<AnalysisResponse>("/analyze", {
        skin_pixels_rgb: pixels,
        skin_regions_rgb: sampledSkinRegions,
        top_n: 5,
      });
      setRoiResult(response);
    } catch (error: any) {
      setRoiError(error.message || "ROI 분석 중 오류가 발생했습니다.");
    } finally {
      setRoiAnalyzing(false);
    }
  }, [roiExtraction]);

  const closeRoiPanel = useCallback(() => {
    setActivePanel("none");
  }, [setActivePanel]);

  return {
    roiFileName,
    roiPreview,
    roiOverlay,
    roiResult,
    roiError,
    roiImageStatus,
    roiExtractionReady: roiExtraction !== null,
    roiAnalyzing,
    roiImgRef,
    roiPreviewCanvasRef,
    roiProcessingCanvasRef,
    handleRoiUpload,
    handleRoiImageLoad,
    analyzeRoi,
    resetRoiState,
    closeRoiPanel,
  };
}
