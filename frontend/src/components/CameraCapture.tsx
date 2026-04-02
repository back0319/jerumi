"use client";

import { useCallback, useRef, useState } from "react";
import Webcam from "react-webcam";

interface CameraCaptureProps {
  onCapture: (dataUrl: string) => void;
  onCancel: () => void;
}

export default function CameraCapture({ onCapture, onCancel }: CameraCaptureProps) {
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
      <div className="bg-white rounded-xl p-8 shadow-sm text-center">
        <p className="text-red-600 mb-4">
          카메라에 접근할 수 없습니다.
        </p>
        <p className="text-sm text-gray-500 mb-6">
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
    <div className="bg-white rounded-xl p-6 shadow-sm">
      <h2 className="text-lg font-semibold mb-4">카메라 촬영</h2>
      <p className="text-sm text-gray-500 mb-4">
        컬러체커를 얼굴 옆에 들고 촬영하세요.
      </p>

      <div className="relative rounded-lg overflow-hidden bg-black">
        <Webcam
          ref={webcamRef}
          audio={false}
          screenshotFormat="image/jpeg"
          screenshotQuality={0.92}
          videoConstraints={{
            facingMode,
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          }}
          onUserMediaError={() => setHasError(true)}
          className="w-full"
        />

        {/* Guide overlay */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/50 text-white text-xs px-3 py-1 rounded-full">
            얼굴과 컬러체커가 모두 보이도록 촬영하세요
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center gap-4 mt-4">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-gray-500 hover:text-gray-700 text-sm"
        >
          취소
        </button>
        <button
          onClick={handleCapture}
          className="bg-rose-600 text-white px-8 py-3 rounded-full hover:bg-rose-700 transition font-medium"
        >
          촬영
        </button>
        <button
          onClick={toggleCamera}
          className="px-4 py-2 text-gray-500 hover:text-gray-700 text-sm"
        >
          카메라 전환
        </button>
      </div>
    </div>
  );
}
