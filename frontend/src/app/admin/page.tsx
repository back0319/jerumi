"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  apiGet,
  apiFormPost,
  apiPost,
  apiAuthPost,
  apiAuthPut,
  apiAuthDelete,
  apiAuthPostFormData,
} from "@/lib/api";
import {
  buildRegionPolygons,
  extractSkinPixelsByRegion,
  flattenSkinRegionPixels,
  SKIN_REGIONS,
  type FaceRegionPolygon,
  type SkinRegionPixels,
} from "@/lib/facemesh";
import {
  COLORCHECKER_REFERENCE,
  type MeasuredPatch,
  buildCheckerPatches,
} from "@/lib/colorChecker";
import type {
  AnalysisResponse,
  Foundation,
  FoundationAnalysisResult,
} from "@/types";

function createDefaultManualForm() {
  return {
    brand: "",
    shade_name: "",
    shade_code: "",
    product_name: "",
    L_value: 0,
    a_value: 0,
    b_value: 0,
    hex_color: "#000000",
    undertone: "",
  };
}

function createDefaultPhotoMeta() {
  return {
    brand: "",
    product_name: "",
    shade_name: "",
    shade_code: "",
  };
}

function sortFoundations(items: readonly Foundation[]) {
  return [...items].sort((left, right) => {
    const byBrand = left.brand.localeCompare(right.brand, "ko");
    if (byBrand !== 0) {
      return byBrand;
    }

    return left.shade_name.localeCompare(right.shade_name, "ko");
  });
}

function buildBrandList(items: readonly Foundation[]) {
  return Array.from(new Set(items.map((item) => item.brand))).sort(
    (left, right) => left.localeCompare(right, "ko"),
  );
}

type RoiOverlayMode = "facemesh" | "fallback";
type RoiRegionKey = keyof SkinRegionPixels;

type RoiExtraction = {
  combinedPixels: number[][];
  skinRegions: SkinRegionPixels | null;
};

type RoiOverlay = {
  mode: RoiOverlayMode;
  pixelCount: number;
  polygons: FaceRegionPolygon[];
  regionPixelCounts: Partial<Record<RoiRegionKey, number>>;
  fallbackRect?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

const ROI_FALLBACK_FILL = "rgba(59, 130, 246, 0.18)";
const ROI_FALLBACK_STROKE = "#2563eb";
const ROI_REGION_STYLES: Record<RoiRegionKey, { fill: string; stroke: string }> =
  {
    lower_left_cheek: {
      fill: "rgba(244, 63, 94, 0.18)",
      stroke: "#e11d48",
    },
    lower_right_cheek: {
      fill: "rgba(249, 115, 22, 0.18)",
      stroke: "#ea580c",
    },
    below_lips: {
      fill: "rgba(16, 185, 129, 0.18)",
      stroke: "#059669",
    },
    chin: {
      fill: "rgba(59, 130, 246, 0.18)",
      stroke: "#2563eb",
    },
  };

const ROI_REGION_LABELS: Record<RoiRegionKey, string> = {
  lower_left_cheek: "왼쪽 하부 볼",
  lower_right_cheek: "오른쪽 하부 볼",
  below_lips: "입 아래",
  chin: "턱",
};

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
  return `#${Math.round(r / count)
    .toString(16)
    .padStart(2, "0")}${Math.round(g / count)
    .toString(16)
    .padStart(2, "0")}${Math.round(b / count)
    .toString(16)
    .padStart(2, "0")}`;
}

function downsamplePixels(pixels: number[][], maxCount: number): number[][] {
  if (pixels.length <= maxCount) return pixels;

  const step = Math.ceil(pixels.length / maxCount);
  return pixels.filter((_, index) => index % step === 0);
}

function downsampleSkinRegions(
  skinRegions: SkinRegionPixels,
  maxPerRegion: number,
): SkinRegionPixels {
  return {
    lower_left_cheek: downsamplePixels(
      skinRegions.lower_left_cheek,
      maxPerRegion,
    ),
    lower_right_cheek: downsamplePixels(
      skinRegions.lower_right_cheek,
      maxPerRegion,
    ),
    below_lips: downsamplePixels(skinRegions.below_lips, maxPerRegion),
    chin: downsamplePixels(skinRegions.chin, maxPerRegion),
  };
}

function getRoiRegionPixelCounts(
  skinRegions: SkinRegionPixels | null,
): Partial<Record<RoiRegionKey, number>> {
  if (!skinRegions) return {};

  return {
    lower_left_cheek: skinRegions.lower_left_cheek.length,
    lower_right_cheek: skinRegions.lower_right_cheek.length,
    below_lips: skinRegions.below_lips.length,
    chin: skinRegions.chin.length,
  };
}

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

export default function AdminPage() {
  const ROI_FACE_MESH_TIMEOUT_MS = 8000;
  const ROI_MAX_ANALYSIS_PIXELS = 10000;
  const ROI_MAX_REGION_ANALYSIS_PIXELS = 2500;
  const [token, setToken] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [allFoundations, setAllFoundations] = useState<Foundation[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [listError, setListError] = useState("");
  const [isSavingManual, setIsSavingManual] = useState(false);
  const [isSavingPhoto, setIsSavingPhoto] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [filterBrand, setFilterBrand] = useState<string>("");

  // New foundation form (manual)
  const [showForm, setShowForm] = useState(false);
  const [editingFoundationId, setEditingFoundationId] = useState<number | null>(
    null,
  );
  const [form, setForm] = useState(createDefaultManualForm);

  // Photo analysis form
  const [showPhotoForm, setShowPhotoForm] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoMeta, setPhotoMeta] = useState(createDefaultPhotoMeta);
  const [analysisResult, setAnalysisResult] =
    useState<FoundationAnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [showRoiTool, setShowRoiTool] = useState(false);
  const [roiFileName, setRoiFileName] = useState<string | null>(null);
  const [roiPreview, setRoiPreview] = useState<string | null>(null);
  const [roiExtraction, setRoiExtraction] = useState<RoiExtraction | null>(
    null,
  );
  const [roiOverlay, setRoiOverlay] = useState<RoiOverlay | null>(null);
  const [roiResult, setRoiResult] = useState<AnalysisResponse | null>(null);
  const [roiError, setRoiError] = useState<string | null>(null);
  const [roiImageStatus, setRoiImageStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [roiAnalyzing, setRoiAnalyzing] = useState(false);

  // ColorChecker for photo analysis
  const [checkerPatches, setCheckerPatches] = useState<MeasuredPatch[]>([]);
  const [selectingPatch, setSelectingPatch] = useState<number | null>(null);
  const photoCanvasRef = useRef<HTMLCanvasElement>(null);
  const photoImgRef = useRef<HTMLImageElement>(null);
  const roiProcessingCanvasRef = useRef<HTMLCanvasElement>(null);
  const roiPreviewCanvasRef = useRef<HTMLCanvasElement>(null);
  const roiImgRef = useRef<HTMLImageElement>(null);
  const roiDetectionTimeoutRef = useRef<number | null>(null);
  const roiDetectionCompletedRef = useRef(false);
  const brands = buildBrandList(allFoundations);
  const foundations = filterBrand
    ? allFoundations.filter((foundation) => foundation.brand === filterBrand)
    : allFoundations;

  const resetPhotoState = useCallback(() => {
    setPhotoFile(null);
    setPhotoPreview((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }
      return null;
    });
    setAnalysisResult(null);
    setCheckerPatches([]);
    setSelectingPatch(null);
    setPhotoMeta(createDefaultPhotoMeta());
    setPhotoError(null);
  }, []);

  const resetRoiState = useCallback(() => {
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

  const redrawRoiPreviewCanvas = useCallback((overlay: RoiOverlay | null) => {
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
        overlay.mode === "facemesh" &&
        polygon.name in ROI_REGION_STYLES
          ? ROI_REGION_STYLES[polygon.name as RoiRegionKey]
          : null;
      ctx.fillStyle = regionStyle?.fill ?? ROI_FALLBACK_FILL;
      ctx.strokeStyle = regionStyle?.stroke ?? ROI_FALLBACK_STROKE;

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
      ctx.fillStyle = ROI_FALLBACK_FILL;
      ctx.strokeStyle = ROI_FALLBACK_STROKE;
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

  const clearRoiDetectionTimeout = useCallback(() => {
    if (roiDetectionTimeoutRef.current === null) return;
    window.clearTimeout(roiDetectionTimeoutRef.current);
    roiDetectionTimeoutRef.current = null;
  }, []);

  const loadFoundations = useCallback(async () => {
    setIsLoadingData(true);
    setListError("");

    try {
      const foundationList = await apiGet<Foundation[]>("/foundations");
      startTransition(() => {
        setAllFoundations(sortFoundations(foundationList));
      });
    } catch {
      setListError(
        "파운데이션 목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.",
      );
    } finally {
      setIsLoadingData(false);
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    setIsLoggingIn(true);

    try {
      const data = await apiFormPost<{ access_token: string }>(
        "/auth/login",
        new URLSearchParams({ username, password }),
      );
      setToken(data.access_token);
    } catch {
      setLoginError("아이디 또는 비밀번호가 올바르지 않습니다.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  useEffect(() => {
    if (token) {
      void loadFoundations();
    }
  }, [token, loadFoundations]);

  useEffect(() => {
    if (
      filterBrand &&
      !allFoundations.some((foundation) => foundation.brand === filterBrand)
    ) {
      setFilterBrand("");
    }
  }, [allFoundations, filterBrand]);

  useEffect(() => {
    return () => {
      if (photoPreview) {
        URL.revokeObjectURL(photoPreview);
      }
    };
  }, [photoPreview]);

  useEffect(() => {
    return () => {
      clearRoiDetectionTimeout();
      if (roiPreview) {
        URL.revokeObjectURL(roiPreview);
      }
    };
  }, [clearRoiDetectionTimeout, roiPreview]);

  const openCreateForm = useCallback(() => {
    setEditingFoundationId(null);
    setForm(createDefaultManualForm());
    setShowPhotoForm(false);
    setShowForm(true);
  }, []);

  const openEditForm = useCallback((foundation: Foundation) => {
    setEditingFoundationId(foundation.id);
    setForm({
      brand: foundation.brand,
      shade_name: foundation.shade_name,
      shade_code: foundation.shade_code,
      product_name: foundation.product_name,
      L_value: foundation.L_value,
      a_value: foundation.a_value,
      b_value: foundation.b_value,
      hex_color: foundation.hex_color,
      undertone: foundation.undertone ?? "",
    });
    setShowPhotoForm(false);
    setShowForm(true);
  }, []);

  const closeManualForm = useCallback(() => {
    setShowForm(false);
    setEditingFoundationId(null);
    setForm(createDefaultManualForm());
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setIsSavingManual(true);
    setListError("");

    const payload = {
      ...form,
      undertone: form.undertone || null,
    };

    try {
      if (editingFoundationId === null) {
        const created = await apiAuthPost<Foundation>(
          "/foundations",
          payload,
          token,
        );
        startTransition(() => {
          setAllFoundations((prev) => sortFoundations([...prev, created]));
          closeManualForm();
          if (filterBrand && filterBrand !== created.brand) {
            setFilterBrand(created.brand);
          }
        });
      } else {
        const updated = await apiAuthPut<Foundation>(
          `/foundations/${editingFoundationId}`,
          payload,
          token,
        );
        startTransition(() => {
          setAllFoundations((prev) =>
            sortFoundations(
              prev.map((foundation) =>
                foundation.id === editingFoundationId ? updated : foundation,
              ),
            ),
          );
          closeManualForm();
          if (filterBrand && filterBrand !== updated.brand) {
            setFilterBrand(updated.brand);
          }
        });
      }
    } catch {
      setListError(
        editingFoundationId === null
          ? "파운데이션을 저장하지 못했습니다. 다시 시도해주세요."
          : "파운데이션을 수정하지 못했습니다. 다시 시도해주세요.",
      );
    } finally {
      setIsSavingManual(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!token || !confirm("정말 삭제하시겠습니까?")) return;
    setDeletingId(id);
    setListError("");

    try {
      await apiAuthDelete(`/foundations/${id}`, token);
      const nextFoundations = allFoundations.filter(
        (foundation) => foundation.id !== id,
      );
      startTransition(() => {
        setAllFoundations(nextFoundations);
        if (editingFoundationId === id) {
          closeManualForm();
        }
      });
    } catch {
      setListError("데이터를 삭제하지 못했습니다. 다시 시도해주세요.");
    } finally {
      setDeletingId(null);
    }
  };

  // Photo analysis handlers
  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      setPhotoError("파일 크기는 20MB 이하여야 합니다.");
      return;
    }
    setPhotoError(null);
    setPhotoFile(file);
    setPhotoPreview((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }
      return URL.createObjectURL(file);
    });
    setAnalysisResult(null);
    setCheckerPatches([]);
    setSelectingPatch(null);
  };

  const handlePhotoImageLoad = () => {
    const img = photoImgRef.current;
    const canvas = photoCanvasRef.current;
    if (!img || !canvas) return;
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0);
  };

  const completeRoiExtraction = useCallback(
    (
      extracted: RoiExtraction,
      overlay: RoiOverlay,
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

  const loadFaceMeshAndExtractForAdmin = useCallback(
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
              regionPixelCounts: getRoiRegionPixelCounts(skinRegions),
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
      ROI_FACE_MESH_TIMEOUT_MS,
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

      setRoiPreview((current) => {
        if (current) URL.revokeObjectURL(current);
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
    void loadFaceMeshAndExtractForAdmin(canvas);
  }, [drawImageToCanvas, loadFaceMeshAndExtractForAdmin, redrawRoiPreviewCanvas]);

  const handleAnalyzeRoi = useCallback(async () => {
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

  const handlePhotoCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (selectingPatch === null) return;
      const canvas = photoCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
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

  const handleAnalyzeSwatch = async () => {
    if (!photoFile || !token) return;
    setAnalyzing(true);
    setPhotoError(null);

    try {
      const formData = new FormData();
      formData.append("image", photoFile);

      if (checkerPatches.length >= 3) {
        const patches = buildCheckerPatches(checkerPatches);
        formData.append("checker_patches", JSON.stringify(patches));
      }

      const result = await apiAuthPostFormData<FoundationAnalysisResult>(
        "/foundations/analyze-swatch",
        formData,
        token,
      );
      setAnalysisResult(result);
    } catch (err: any) {
      setPhotoError(err.message || "분석 중 오류가 발생했습니다.");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSaveFromPhoto = async () => {
    if (!photoFile || !token || !analysisResult) return;
    if (!photoMeta.brand || !photoMeta.shade_name) {
      setPhotoError("브랜드와 색상명은 필수 입력 항목입니다.");
      return;
    }
    setPhotoError(null);
    setIsSavingPhoto(true);
    setListError("");

    try {
      const formData = new FormData();
      formData.append("image", photoFile);
      formData.append("brand", photoMeta.brand);
      formData.append("product_name", photoMeta.product_name);
      formData.append("shade_name", photoMeta.shade_name);
      formData.append("shade_code", photoMeta.shade_code);

      if (checkerPatches.length >= 3) {
        const patches = buildCheckerPatches(checkerPatches);
        formData.append("checker_patches", JSON.stringify(patches));
      }

      const created = await apiAuthPostFormData<Foundation>(
        "/foundations/from-photo",
        formData,
        token,
      );

      startTransition(() => {
        setAllFoundations((prev) => sortFoundations([...prev, created]));
        setShowPhotoForm(false);
        resetPhotoState();
        if (filterBrand && filterBrand !== created.brand) {
          setFilterBrand(created.brand);
        }
      });
    } catch (err: any) {
      setPhotoError(err.message || "저장 중 오류가 발생했습니다.");
    } finally {
      setIsSavingPhoto(false);
    }
  };

  if (!token) {
    return (
      <div className="mx-auto mt-16 max-w-sm rounded-xl bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-xl font-bold mb-2">관리자 로그인</h1>
        <p className="mb-6 text-sm text-gray-500">
          등록, 수정, 삭제를 위해 로그인하세요.
        </p>
        {loginError && (
          <p className="text-red-600 text-sm mb-4">{loginError}</p>
        )}
        <form onSubmit={handleLogin} className="space-y-4">
          <input
            type="text"
            placeholder="아이디"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full border rounded px-3 py-2"
          />
          <input
            type="password"
            placeholder="비밀번호"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border rounded px-3 py-2"
          />
          <button
            disabled={isLoggingIn}
            className="w-full bg-rose-600 text-white py-2 rounded hover:bg-rose-700 disabled:opacity-50"
          >
            {isLoggingIn ? "로그인 중..." : "로그인"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-3 py-4 sm:px-4 sm:py-5">
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
            onChange={(e) => setFilterBrand(e.target.value)}
            disabled={isLoadingData}
            className="rounded border px-3 py-1.5 text-sm"
          >
            <option value="">전체 브랜드</option>
            {brands.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <button
            onClick={() => void loadFoundations()}
            disabled={isLoadingData}
            className="rounded border border-gray-200 bg-white px-4 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            {isLoadingData ? "동기화 중..." : "새로고침"}
          </button>
          <button
            onClick={() => {
              setShowRoiTool((current) => !current);
              setShowPhotoForm(false);
              closeManualForm();
            }}
            className="rounded border border-gray-200 bg-white px-4 py-1.5 text-sm hover:bg-gray-50"
          >
            ROI 검증
          </button>
          <button
            onClick={() => {
              setShowPhotoForm(!showPhotoForm);
              setShowRoiTool(false);
              closeManualForm();
            }}
            className="rounded bg-indigo-600 px-4 py-1.5 text-sm text-white hover:bg-indigo-700"
          >
            사진 등록
          </button>
          <button
            onClick={() => {
              if (showForm && editingFoundationId === null) {
                closeManualForm();
              } else {
                openCreateForm();
              }
              setShowRoiTool(false);
            }}
            className="rounded bg-rose-600 px-4 py-1.5 text-sm text-white hover:bg-rose-700"
          >
            + 직접 등록
          </button>
        </div>
      </div>

      {listError && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {listError}
        </div>
      )}

      {showRoiTool && (
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
              onClick={() => {
                setShowRoiTool(false);
                resetRoiState();
              }}
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
                onChange={handleRoiUpload}
              />
              <span className="text-gray-500 text-sm">
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
                    onLoad={handleRoiImageLoad}
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
                    onClick={resetRoiState}
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
                      {roiOverlay?.mode === "facemesh" ? "FaceMesh" : roiOverlay ? "Fallback" : "-"}
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
                    {(Object.keys(ROI_REGION_LABELS) as RoiRegionKey[]).map(
                      (regionName) => (
                        <div
                          key={regionName}
                          className="rounded-lg bg-white px-3 py-2"
                        >
                          <p className="text-[11px] font-semibold text-gray-700">
                            {ROI_REGION_LABELS[regionName]}
                          </p>
                          <p className="mt-1 text-sm text-gray-600">
                            {(roiOverlay.regionPixelCounts[regionName] ?? 0).toLocaleString()} px
                          </p>
                        </div>
                      ),
                    )}
                  </div>
                )}

                <button
                  onClick={() => void handleAnalyzeRoi()}
                  disabled={!roiExtraction || roiImageStatus !== "ready" || roiAnalyzing}
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
                          L*={roiResult.skin_lab[0]} a*={roiResult.skin_lab[1]} b*={roiResult.skin_lab[2]}
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
      )}

      {/* Photo Analysis Form */}
      {showPhotoForm && (
        <div className="mb-6 rounded-xl bg-white p-4 shadow-sm sm:p-5">
          <h2 className="mb-3 text-lg font-semibold">사진으로 색상 추출</h2>
          <p className="mb-4 text-sm text-gray-500">
            흰 종이에 바른 파운데이션과 컬러체커가 함께 보이도록 촬영한 사진을
            올리세요.
          </p>

          {photoError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4 text-sm">
              {photoError}
            </div>
          )}

          {/* Product metadata */}
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <input
              placeholder="브랜드 *"
              value={photoMeta.brand}
              onChange={(e) =>
                setPhotoMeta({ ...photoMeta, brand: e.target.value })
              }
              className="border rounded px-3 py-2 text-sm"
              required
            />
            <input
              placeholder="제품명"
              value={photoMeta.product_name}
              onChange={(e) =>
                setPhotoMeta({ ...photoMeta, product_name: e.target.value })
              }
              className="border rounded px-3 py-2 text-sm"
            />
            <input
              placeholder="색상명 *"
              value={photoMeta.shade_name}
              onChange={(e) =>
                setPhotoMeta({ ...photoMeta, shade_name: e.target.value })
              }
              className="border rounded px-3 py-2 text-sm"
              required
            />
            <input
              placeholder="호수 (예: 21호)"
              value={photoMeta.shade_code}
              onChange={(e) =>
                setPhotoMeta({ ...photoMeta, shade_code: e.target.value })
              }
              className="border rounded px-3 py-2 text-sm"
            />
          </div>

          {/* Image upload */}
          {!photoPreview && (
            <label className="mb-4 block cursor-pointer rounded-lg border-2 border-dashed border-gray-300 p-6 text-center transition hover:border-indigo-400 sm:p-8">
              <input
                type="file"
                accept="image/jpeg,image/png"
                className="hidden"
                onChange={handlePhotoUpload}
              />
              <span className="text-gray-500 text-sm">
                사진 선택 (JPEG/PNG, 최대 20MB)
              </span>
            </label>
          )}

          {/* Image preview + ColorChecker calibration */}
          {photoPreview && (
            <div className="grid lg:grid-cols-2 gap-4 mb-4">
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">
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
                  onLoad={handlePhotoImageLoad}
                />
                <canvas
                  ref={photoCanvasRef}
                  className="max-w-full border rounded cursor-crosshair"
                  style={{ maxHeight: "320px" }}
                  onClick={handlePhotoCanvasClick}
                />
                <button
                  onClick={() => {
                    resetPhotoState();
                  }}
                  className="text-xs text-gray-400 hover:text-gray-600 mt-1"
                >
                  다른 사진 선택
                </button>
              </div>

              {/* ColorChecker patch grid */}
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">
                  참조 패치 ({checkerPatches.length}/24)
                </p>
                <div className="grid grid-cols-6 gap-1.5 max-h-64 overflow-y-auto">
                  {COLORCHECKER_REFERENCE.map((patch, idx) => {
                    const measured = checkerPatches.find(
                      (p) => p.patchIndex === idx,
                    );
                    return (
                      <button
                        key={idx}
                        onClick={() => setSelectingPatch(idx)}
                        className={`p-1.5 rounded text-xs border transition ${
                          selectingPatch === idx
                            ? "border-indigo-500 bg-indigo-50"
                            : measured
                              ? "border-green-500 bg-green-50"
                              : "border-gray-200 hover:border-gray-400"
                        }`}
                        title={patch.name}
                      >
                        <div className="text-center truncate text-[10px]">
                          {patch.name}
                        </div>
                        {measured && (
                          <div
                            className="w-5 h-5 rounded mx-auto mt-0.5"
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
                  <p className="text-xs text-amber-600 mt-2">
                    색 보정을 적용하려면 패치를 3개 이상 선택하세요.
                  </p>
                )}
                {checkerPatches.length >= 3 && (
                  <p className="text-xs text-green-600 mt-2">
                    패치 {checkerPatches.length}개 선택됨. 색 보정이 적용됩니다.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Analysis result preview */}
          {analysisResult && (
            <div className="bg-gray-50 rounded-lg p-4 mb-4">
              <h3 className="text-sm font-semibold mb-3">추출 결과</h3>
              <div className="flex items-center gap-4">
                <div
                  className="w-16 h-16 rounded-lg shadow-inner border"
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

          {/* Action buttons */}
          <div className="flex gap-3">
            {photoFile && !analysisResult && (
              <button
                onClick={handleAnalyzeSwatch}
                disabled={analyzing}
                className="bg-indigo-600 text-white px-5 py-2 rounded text-sm hover:bg-indigo-700 disabled:opacity-50"
              >
                {analyzing ? "추출 중..." : "색상 추출"}
              </button>
            )}
            {analysisResult && (
              <>
                <button
                  onClick={handleSaveFromPhoto}
                  disabled={isSavingPhoto}
                  className="bg-green-600 text-white px-5 py-2 rounded text-sm hover:bg-green-700"
                >
                  {isSavingPhoto ? "저장 중..." : "DB에 저장"}
                </button>
                <button
                  onClick={handleAnalyzeSwatch}
                  disabled={analyzing}
                  className="bg-gray-200 text-gray-700 px-5 py-2 rounded text-sm hover:bg-gray-300 disabled:opacity-50"
                >
                  {analyzing ? "분석 중..." : "다시 분석"}
                </button>
              </>
            )}
            <button
              onClick={() => {
                setShowPhotoForm(false);
                resetPhotoState();
              }}
              className="text-gray-500 hover:text-gray-700 px-4 py-2 text-sm"
            >
              닫기
            </button>
          </div>
        </div>
      )}

      {/* Manual Form */}
      {showForm && (
        <div className="bg-white rounded-xl p-6 shadow-sm mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">
              {editingFoundationId === null ? "직접 입력" : "파운데이션 수정"}
            </h2>
            <button
              type="button"
              onClick={closeManualForm}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              닫기
            </button>
          </div>
          <form
            onSubmit={handleCreate}
            className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
          >
            <input
              placeholder="브랜드"
              value={form.brand}
              onChange={(e) => setForm({ ...form, brand: e.target.value })}
              className="border rounded px-3 py-2"
              required
            />
            <input
              placeholder="색상명"
              value={form.shade_name}
              onChange={(e) => setForm({ ...form, shade_name: e.target.value })}
              className="border rounded px-3 py-2"
              required
            />
            <input
              placeholder="호수 (예: 21호)"
              value={form.shade_code}
              onChange={(e) => setForm({ ...form, shade_code: e.target.value })}
              className="border rounded px-3 py-2"
            />
            <input
              placeholder="L* 값"
              type="number"
              step="0.01"
              value={form.L_value}
              onChange={(e) =>
                setForm({ ...form, L_value: parseFloat(e.target.value) || 0 })
              }
              className="border rounded px-3 py-2"
            />
            <input
              placeholder="a* 값"
              type="number"
              step="0.01"
              value={form.a_value}
              onChange={(e) =>
                setForm({ ...form, a_value: parseFloat(e.target.value) || 0 })
              }
              className="border rounded px-3 py-2"
            />
            <input
              placeholder="b* 값"
              type="number"
              step="0.01"
              value={form.b_value}
              onChange={(e) =>
                setForm({ ...form, b_value: parseFloat(e.target.value) || 0 })
              }
              className="border rounded px-3 py-2"
            />
            <input
              placeholder="HEX (#ff0000)"
              value={form.hex_color}
              onChange={(e) => setForm({ ...form, hex_color: e.target.value })}
              className="border rounded px-3 py-2"
            />
            <select
              value={form.undertone}
              onChange={(e) => setForm({ ...form, undertone: e.target.value })}
              className="border rounded px-3 py-2"
            >
              <option value="">비워두기</option>
              <option value="WARM">Warm</option>
              <option value="COOL">Cool</option>
              <option value="NEUTRAL">Neutral</option>
            </select>
            <button
              disabled={isSavingManual}
              className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:opacity-50"
            >
              {isSavingManual
                ? editingFoundationId === null
                  ? "저장 중..."
                  : "수정 중..."
                : editingFoundationId === null
                  ? "저장"
                  : "수정 저장"}
            </button>
          </form>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between border-b px-4 py-3 text-sm text-gray-500">
          <p>
            {filterBrand ? `"${filterBrand}" ` : ""}파운데이션{" "}
            {foundations.length}개
          </p>
          {isLoadingData && <p>최신 목록을 불러오는 중입니다...</p>}
        </div>
        <div className="divide-y lg:hidden">
          {foundations.map((f) => (
            <div key={f.id} className="space-y-3 px-4 py-4">
              <div className="flex items-start gap-3">
                <div
                  className="h-10 w-10 shrink-0 rounded-lg border"
                  style={{ backgroundColor: f.hex_color }}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-gray-900">
                    {f.brand}
                  </p>
                  <p className="truncate text-sm text-gray-700">
                    {f.shade_name}
                    {f.shade_code && (
                      <span className="ml-1 text-gray-400">
                        ({f.shade_code})
                      </span>
                    )}
                  </p>
                  {f.product_name && (
                    <p className="truncate text-xs text-gray-400">
                      {f.product_name}
                    </p>
                  )}
                </div>
                <span className="rounded-full bg-gray-100 px-2 py-1 text-[11px] text-gray-600">
                  {f.undertone || "-"}
                </span>
              </div>
              <div className="rounded-lg bg-gray-50 px-3 py-2 font-mono text-[11px] text-gray-600">
                L* {f.L_value} / a* {f.a_value} / b* {f.b_value}
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono text-gray-400">{f.hex_color}</span>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => openEditForm(f)}
                    className="text-blue-600 hover:text-blue-800"
                  >
                    수정
                  </button>
                  <button
                    onClick={() => handleDelete(f.id)}
                    disabled={deletingId === f.id}
                    className="text-red-500 hover:text-red-700 disabled:opacity-50"
                  >
                    {deletingId === f.id ? "삭제 중..." : "삭제"}
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
                <th className="w-24 px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {foundations.map((f) => (
                <tr key={f.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div
                      className="h-8 w-8 rounded border"
                      style={{ backgroundColor: f.hex_color }}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <p className="truncate font-medium text-gray-900">
                      {f.brand}
                    </p>
                    <p className="truncate text-gray-700">
                      {f.shade_name}
                      {f.shade_code && (
                        <span className="ml-1 text-gray-400">
                          ({f.shade_code})
                        </span>
                      )}
                    </p>
                    {f.product_name && (
                      <p className="truncate text-xs text-gray-400">
                        {f.product_name}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">
                    L* {f.L_value} / a* {f.a_value} / b* {f.b_value}
                  </td>
                  <td className="px-4 py-3">{f.undertone || "-"}</td>
                  <td className="px-4 py-3 font-mono text-xs">{f.hex_color}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <button
                      onClick={() => openEditForm(f)}
                      className="mr-3 text-xs text-blue-600 hover:text-blue-800"
                    >
                      수정
                    </button>
                    <button
                      onClick={() => handleDelete(f.id)}
                      disabled={deletingId === f.id}
                      className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                    >
                      {deletingId === f.id ? "삭제 중..." : "삭제"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!isLoadingData && foundations.length === 0 && (
          <p className="text-center text-gray-400 py-8">
            등록된 파운데이션이 없습니다.
          </p>
        )}
      </div>
    </div>
  );
}
