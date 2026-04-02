"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiPost } from "@/lib/api";
import {
  extractSkinPixels,
  SKIN_REGIONS,
} from "@/lib/facemesh";
import {
  COLORCHECKER_REFERENCE,
  type MeasuredPatch,
  buildCheckerPatches,
} from "@/lib/colorChecker";
import type { AnalysisResponse } from "@/types";
import CameraCapture from "@/components/CameraCapture";

type Step = "upload" | "camera" | "checker" | "analyzing" | "done";
type CheckerImageStatus = "idle" | "loading" | "ready" | "error";

export default function ScanPage() {
  const [step, setStep] = useState<Step>("upload");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skinPixels, setSkinPixels] = useState<number[][] | null>(null);
  const [checkerPatches, setCheckerPatches] = useState<MeasuredPatch[]>([]);
  const [selectingPatch, setSelectingPatch] = useState<number | null>(null);
  const [checkerImageStatus, setCheckerImageStatus] =
    useState<CheckerImageStatus>("idle");
  const [checkerImageError, setCheckerImageError] = useState<string | null>(
    null
  );
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const checkerImgRef = useRef<HTMLImageElement>(null);
  const uploadedObjectUrlRef = useRef<string | null>(null);

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
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      return true;
    },
    []
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
      const url = URL.createObjectURL(file);
      uploadedObjectUrlRef.current = url;
      setImageUrl(url);
    },
    [revokeUploadedObjectUrl]
  );

  const processImageOnCanvas = useCallback((canvas: HTMLCanvasElement) => {
    loadFaceMeshAndExtract(canvas);
  }, []);

  const handleImageLoad = useCallback(() => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;

    const drawn = drawImageToCanvas(img, canvas);
    if (!drawn) return;

    processImageOnCanvas(canvas);
  }, [drawImageToCanvas, processImageOnCanvas]);

  const handleCameraCapture = useCallback(
    (dataUrl: string) => {
      revokeUploadedObjectUrl();
      setError(null);
      setImageUrl(dataUrl);
      setStep("upload");
    },
    [revokeUploadedObjectUrl]
  );

  const handleCheckerImageLoad = useCallback(() => {
    const img = checkerImgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;

    const drawn = drawImageToCanvas(img, canvas);
    if (!drawn) {
      setCheckerImageStatus("error");
      setCheckerImageError("캔버스를 초기화하지 못했습니다. 다시 시도해주세요.");
      return;
    }

    setCheckerImageStatus("ready");
    setCheckerImageError(null);
  }, [drawImageToCanvas]);

  const handleCheckerImageError = useCallback(() => {
    setCheckerImageStatus("error");
    setCheckerImageError("사진을 불러오지 못했습니다. 다른 사진으로 다시 시도해주세요.");
  }, []);

  const loadFaceMeshAndExtract = async (canvas: HTMLCanvasElement) => {
    try {
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
        if (
          !results.multiFaceLandmarks ||
          results.multiFaceLandmarks.length === 0
        ) {
          setError("얼굴을 감지하지 못했습니다. 정면 얼굴 사진을 사용해주세요.");
          return;
        }

        const landmarks = results.multiFaceLandmarks[0];
        const pixels = extractSkinPixels(canvas, landmarks, SKIN_REGIONS);

        if (pixels.length < 100) {
          setError("피부 영역 픽셀이 너무 적습니다. 더 가까이서 촬영해주세요.");
          return;
        }

        setSkinPixels(pixels);
        setStep("checker");
      });

      await faceMesh.send({ image: canvas });
    } catch (err) {
      console.warn("MediaPipe Face Mesh 로딩 실패, 전체 이미지 중앙 영역 사용:", err);
      fallbackExtract(canvas);
    }
  };

  const fallbackExtract = (canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
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
    setSkinPixels(pixels);
    setStep("checker");
  };

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (selectingPatch === null) return;
      const canvas = canvasRef.current;
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
        size * 2
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
    [selectingPatch]
  );

  const handleAnalyze = async () => {
    if (!skinPixels) return;
    setStep("analyzing");
    setError(null);

    try {
      const patches =
        checkerPatches.length >= 3 ? buildCheckerPatches(checkerPatches) : null;

      let pixels = skinPixels;
      if (pixels.length > 10000) {
        const step = Math.ceil(pixels.length / 10000);
        pixels = pixels.filter((_, i) => i % step === 0);
      }

      const response = await apiPost<AnalysisResponse>("/api/analyze", {
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
    setCheckerPatches([]);
    setSelectingPatch(null);
    setCheckerImageStatus("idle");
    setCheckerImageError(null);
    setError(null);
  }, [revokeUploadedObjectUrl]);

  const resetAll = () => {
    revokeUploadedObjectUrl();
    setStep("upload");
    setImageUrl(null);
    setSkinPixels(null);
    setCheckerPatches([]);
    setSelectingPatch(null);
    setResult(null);
    setError(null);
    setCheckerImageStatus("idle");
    setCheckerImageError(null);
  };

  useEffect(() => {
    setCheckerPatches([]);
    setSelectingPatch(null);
    setCheckerImageStatus("idle");
    setCheckerImageError(null);
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
    return () => {
      revokeUploadedObjectUrl();
    };
  }, [revokeUploadedObjectUrl]);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">피부톤 분석</h1>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {/* Step 1: Upload or Camera */}
      {step === "upload" && !imageUrl && (
        <div className="bg-white rounded-xl p-8 shadow-sm">
          <h2 className="text-lg font-semibold mb-4">
            컬러체커와 함께 촬영한 얼굴 사진을 업로드하세요
          </h2>
          <p className="text-sm text-gray-500 mb-6">
            통제된 조명 환경에서 컬러체커를 들고 촬영한 정면 얼굴 사진을 사용하면
            가장 정확한 결과를 얻을 수 있습니다.
          </p>

          <div className="grid md:grid-cols-2 gap-4">
            {/* Upload option */}
            <label className="block border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-rose-400 transition">
              <input
                type="file"
                accept="image/jpeg,image/png"
                className="hidden"
                onChange={handleImageUpload}
              />
              <div className="text-4xl mb-3">📁</div>
              <span className="text-gray-700 font-medium block mb-1">사진 업로드</span>
              <span className="text-gray-400 text-sm">
                JPEG/PNG, 최대 10MB
              </span>
            </label>

            {/* Camera option */}
            <button
              onClick={() => setStep("camera")}
              className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-rose-400 transition"
            >
              <div className="text-4xl mb-3">📷</div>
              <span className="text-gray-700 font-medium block mb-1">카메라 촬영</span>
              <span className="text-gray-400 text-sm">
                카메라로 직접 촬영
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Upload preview (loading face mesh) */}
      {step === "upload" && imageUrl && (
        <div className="bg-white rounded-xl p-8 shadow-sm">
          <div className="text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imgRef}
              src={imageUrl}
              alt="업로드된 얼굴"
              className="max-w-full max-h-96 mx-auto rounded"
              onLoad={handleImageLoad}
            />
            <canvas ref={canvasRef} className="hidden" />
            <div className="mt-4">
              <div className="animate-spin w-8 h-8 border-4 border-rose-200 border-t-rose-600 rounded-full mx-auto mb-2" />
              <p className="text-sm text-gray-500">얼굴을 인식하고 있습니다...</p>
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
          <canvas ref={canvasRef} className="hidden" />
        </>
      )}

      {/* Step 2: Color Checker Calibration */}
      {step === "checker" && (
        <div className="bg-white rounded-xl p-8 shadow-sm">
          <h2 className="text-lg font-semibold mb-4">
            컬러체커 보정 (선택사항)
          </h2>
          <p className="text-sm text-gray-500 mb-4">
            사진 속 컬러체커 패치를 클릭하여 보정 데이터를 입력하세요.
            최소 3개 이상의 패치를 선택하면 색 보정이 적용됩니다.
            건너뛰어도 분석은 가능합니다.
          </p>

          <div className="grid lg:grid-cols-2 gap-6">
            {/* Canvas for clicking */}
            <div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={checkerImgRef}
                src={imageUrl ?? ""}
                alt="컬러체커 보정 원본"
                className="hidden"
                onLoad={handleCheckerImageLoad}
                onError={handleCheckerImageError}
              />
              <canvas
                ref={canvasRef}
                className="max-w-full border rounded cursor-crosshair"
                style={{ maxHeight: "400px" }}
                onClick={handleCanvasClick}
              />
              {checkerImageStatus === "loading" && (
                <p className="text-sm text-gray-500 mt-2">
                  보정용 사진을 불러오고 있습니다...
                </p>
              )}
              {checkerImageStatus === "error" && (
                <p className="text-sm text-red-600 mt-2">{checkerImageError}</p>
              )}
              {selectingPatch !== null && (
                <p className="text-sm text-rose-600 mt-2">
                  &quot;{COLORCHECKER_REFERENCE[selectingPatch].name}&quot;
                  패치를 사진에서 클릭하세요
                </p>
              )}
            </div>

            {/* Checker patch selection */}
            <div className="max-h-96 overflow-y-auto">
              <div className="grid grid-cols-4 gap-2">
                {COLORCHECKER_REFERENCE.map((patch, idx) => {
                  const measured = checkerPatches.find(
                    (p) => p.patchIndex === idx
                  );
                  return (
                    <button
                      key={idx}
                      onClick={() => setSelectingPatch(idx)}
                      className={`p-2 rounded text-xs border transition ${
                        selectingPatch === idx
                          ? "border-rose-500 bg-rose-50"
                          : measured
                          ? "border-green-500 bg-green-50"
                          : "border-gray-200 hover:border-gray-400"
                      }`}
                    >
                      <div className="text-center truncate">{patch.name}</div>
                      {measured && (
                        <div
                          className="w-6 h-6 rounded mx-auto mt-1"
                          style={{
                            backgroundColor: `rgb(${measured.measuredRgb.join(",")})`,
                          }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex gap-4 mt-6">
            <button
              onClick={handleAnalyze}
              disabled={checkerImageStatus !== "ready"}
              title={
                checkerImageStatus !== "ready"
                  ? "보정용 사진 로딩이 완료된 후 분석할 수 있습니다."
                  : undefined
              }
              className={`px-6 py-2 rounded-lg transition ${
                checkerImageStatus === "ready"
                  ? "bg-rose-600 text-white hover:bg-rose-700"
                  : "bg-gray-200 text-gray-500 cursor-not-allowed"
              }`}
            >
              {checkerPatches.length >= 3
                ? `보정 적용 후 분석 (${checkerPatches.length}개 패치)`
                : "보정 없이 분석"}
            </button>
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

          <p className="text-xs text-gray-400 mt-2">
            피부 영역 픽셀 수: {skinPixels?.length?.toLocaleString() || 0}
          </p>
        </div>
      )}

      {/* Step 3: Analyzing */}
      {step === "analyzing" && (
        <div className="bg-white rounded-xl p-16 shadow-sm text-center">
          <div className="animate-spin w-12 h-12 border-4 border-rose-200 border-t-rose-600 rounded-full mx-auto mb-4" />
          <p className="text-gray-600">피부톤을 분석하고 있습니다...</p>
        </div>
      )}

      {/* Step 4: Results */}
      {step === "done" && result && (
        <div>
          {/* Skin color summary */}
          <div className="bg-white rounded-xl p-6 shadow-sm mb-6">
            <h2 className="text-lg font-semibold mb-4">내 피부톤 분석 결과</h2>
            <div className="flex items-center gap-6">
              <div
                className="w-24 h-24 rounded-xl shadow-inner border"
                style={{ backgroundColor: result.skin_hex }}
              />
              <div>
                <p className="text-sm text-gray-500">CIELAB 값</p>
                <p className="font-mono text-lg">
                  L*={result.skin_lab[0]} a*={result.skin_lab[1]} b*=
                  {result.skin_lab[2]}
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  HEX: {result.skin_hex}
                </p>
              </div>
            </div>
          </div>

          {/* Recommendations */}
          <h2 className="text-lg font-semibold mb-4">추천 파운데이션</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {result.recommendations.map((rec, i) => (
              <div
                key={rec.id}
                className="bg-white rounded-xl p-5 shadow-sm border hover:shadow-md transition"
              >
                <div className="flex items-start justify-between mb-3">
                  <span className="text-xs font-medium text-rose-600 bg-rose-50 px-2 py-0.5 rounded">
                    {i + 1}위
                  </span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${
                      rec.delta_e <= 1
                        ? "bg-green-100 text-green-700"
                        : rec.delta_e <= 3.5
                        ? "bg-yellow-100 text-yellow-700"
                        : "bg-orange-100 text-orange-700"
                    }`}
                  >
                    {rec.delta_e <= 1
                      ? "거의 동일"
                      : rec.delta_e <= 2
                      ? "매우 유사"
                      : rec.delta_e <= 3.5
                      ? "유사"
                      : "차이 있음"}
                  </span>
                </div>

                {/* Color comparison */}
                <div className="flex gap-2 mb-3">
                  <div className="flex-1 text-center">
                    <div
                      className="h-16 rounded-lg shadow-inner border"
                      style={{ backgroundColor: result.skin_hex }}
                    />
                    <p className="text-xs text-gray-400 mt-1">내 피부</p>
                  </div>
                  <div className="flex-1 text-center">
                    <div
                      className="h-16 rounded-lg shadow-inner border"
                      style={{ backgroundColor: rec.hex_color }}
                    />
                    <p className="text-xs text-gray-400 mt-1">추천색</p>
                  </div>
                </div>

                <h3 className="font-semibold text-sm">{rec.shade_name}</h3>
                <p className="text-xs text-gray-500">{rec.brand}</p>
                {rec.shade_code && (
                  <p className="text-xs text-gray-400">{rec.shade_code}</p>
                )}
                <div className="mt-2 text-xs text-gray-500 font-mono">
                  <span>
                    ΔE={rec.delta_e} | L*={rec.lab[0]} a*={rec.lab[1]} b*=
                    {rec.lab[2]}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 text-center">
            <button
              onClick={resetAll}
              className="text-rose-600 hover:text-rose-700 font-medium"
            >
              다시 분석하기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
