"use client";

import { useEffect, useRef } from "react";

import { prewarmApi } from "@/lib/api";

export function useApiPrewarm(path: string) {
  const hasPrewarmedRef = useRef(false);

  useEffect(() => {
    if (hasPrewarmedRef.current) return;
    hasPrewarmedRef.current = true;
    prewarmApi(path);
  }, [path]);
}
