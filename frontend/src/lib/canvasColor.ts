export type SrgbCanvas2DContext = CanvasRenderingContext2D & {
  getImageData(
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    settings?: { colorSpace?: "srgb" },
  ): ImageData;
};

export function getSrgbCanvasContext(
  canvas: HTMLCanvasElement,
  options: CanvasRenderingContext2DSettings = {},
): SrgbCanvas2DContext | null {
  const contextOptions = {
    ...options,
    colorSpace: "srgb",
  } as CanvasRenderingContext2DSettings;

  return canvas.getContext("2d", contextOptions) as SrgbCanvas2DContext | null;
}

export function getSrgbImageData(
  context: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
): ImageData {
  try {
    return (context as SrgbCanvas2DContext).getImageData(sx, sy, sw, sh, {
      colorSpace: "srgb",
    });
  } catch {
    return context.getImageData(sx, sy, sw, sh);
  }
}
