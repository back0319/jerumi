"use client";

import { useCallback, useRef, useState } from "react";
import Webcam from "react-webcam";

interface CameraCaptureProps {
  onCapture: (dataUrl: string) => void;
  onCancel: () => void;
}

export default function CameraCapture({
  onCapture,
  onCancel,
}: CameraCaptureProps) {
  const webcamRef = useRef<Webcam>(null);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [hasError, setHasError] = useState(false);

  const handleCapture = useCallback(() => {
    const screenshot = webcamRef.current?.getScreenshot();
    if (screenshot) {
      onCapture(screenshot);
    }
  }, [onCapture]);

  const toggleCamera = useCallback(() => {
    setFacingMode((prev) => (prev === "user" ? "environment" : "user"));
  }, []);

  if (hasError) {
    return (
      <div className="rounded-xl bg-white p-6 text-center shadow-sm">
        <p className="mb-4 text-red-600">카메라에 접근할 수 없습니다.</p>
        <p className="mb-6 text-sm text-gray-500">
          브라우저 설정에서 카메라 권한을 허용해주세요.
        </p>
        <button
          onClick={onCancel}
          className="text-gray-500 hover:text-gray-700"
        >
          돌아가기
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">카메라 촬영</h2>
          <p className="mt-1 text-sm text-gray-500">
            얼굴과 컬러체커가 함께 보이도록 바로 촬영하세요.
          </p>
        </div>
        <div className="rounded-full bg-gray-100 px-3 py-1 text-[11px] text-gray-600">
          PNG 캡처
        </div>
      </div>

      <div className="relative overflow-hidden rounded-xl bg-black">
        <Webcam
          ref={webcamRef}
          audio={false}
          screenshotFormat="image/png"
          videoConstraints={{
            facingMode,
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          }}
          onUserMediaError={() => setHasError(true)}
          className="w-full max-h-[56vh] object-cover sm:max-h-[64vh]"
        />

        {/* Guide overlay */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-black/55 px-3 py-1 text-[11px] text-white">
            얼굴과 컬러체커가 함께 보이게 맞춰주세요
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-center sm:gap-4">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700"
        >
          취소
        </button>
        <button
          onClick={handleCapture}
          className="rounded-full bg-rose-600 px-8 py-3 font-medium text-white transition hover:bg-rose-700"
        >
          촬영
        </button>
        <button
          onClick={toggleCamera}
          className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700"
        >
          카메라 전환
        </button>
      </div>
    </div>
  );
}
