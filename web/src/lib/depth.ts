import { linearDepth } from "../../../core/depth";
import type { Asset, Camera } from "../../../core/schema";

export type DepthPoints = {
  positions: Float32Array;
  radii: Float32Array;
  colors: Uint8Array;
  count: number;
};

type FloatImage = {
  data: Float32Array;
  width: number;
  height: number;
  stride: number;
};

async function loadFloatImage(
  url: string,
  signal: AbortSignal,
): Promise<FloatImage> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Failed to load EXR (${response.status})`);
  return linearDepth(await response.arrayBuffer());
}

async function loadColors(
  url: string,
  width: number,
  height: number,
  signal: AbortSignal,
): Promise<Uint8ClampedArray> {
  const response = await fetch(url, { signal });
  if (!response.ok)
    throw new Error(`Failed to load image (${response.status})`);
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas 2D context is unavailable");
    const scale = Math.max(width / bitmap.width, height / bitmap.height);
    const sw = width / scale,
      sh = height / scale;
    context.drawImage(
      bitmap,
      (bitmap.width - sw) / 2,
      (bitmap.height - sh) / 2,
      sw,
      sh,
      0,
      0,
      width,
      height,
    );
    return context.getImageData(0, 0, width, height).data;
  } finally {
    bitmap.close();
  }
}

async function loadLogDepth(
  url: string,
  encoding: Extract<NonNullable<Asset["depthEncoding"]>, { type: "log" }>,
  signal: AbortSignal,
): Promise<FloatImage> {
  const logMin = Math.log(encoding.zMin);
  const logMax = Math.log(encoding.zMax);
  return loadRasterChannel(url, "depth", signal, (value) =>
    Math.exp(logMax + value * (logMin - logMax)),
  );
}

async function loadRasterChannel(
  url: string,
  label: string,
  signal: AbortSignal,
  decode: (value: number) => number,
): Promise<FloatImage> {
  const response = await fetch(url, { signal });
  if (!response.ok)
    throw new Error(`Failed to load ${label} image (${response.status})`);
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas 2D context is unavailable");
    context.drawImage(bitmap, 0, 0);
    const rgba = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const data = new Float32Array(bitmap.width * bitmap.height);
    for (let index = 0; index < data.length; index += 1)
      data[index] = decode(rgba[index * 4] / 255);
    return { data, width: bitmap.width, height: bitmap.height, stride: 1 };
  } finally {
    bitmap.close();
  }
}

export async function loadDepthPoints({
  depthUrl,
  imageUrl,
  confidenceUrl,
  confidenceMimeType,
  camera,
  depthEncoding,
  pointSize,
  signal,
  maxPoints = 250_000,
}: {
  depthUrl: string;
  imageUrl: string;
  confidenceUrl?: string;
  confidenceMimeType?: string;
  camera: Camera;
  depthEncoding?: Asset["depthEncoding"];
  pointSize: number;
  signal: AbortSignal;
  maxPoints?: number;
}): Promise<DepthPoints> {
  const depth = await loadDepthGrid(depthUrl, depthEncoding, signal);
  const [colors, confidence] = await Promise.all([
    loadColors(imageUrl, depth.width, depth.height, signal),
    confidenceUrl
      ? confidenceMimeType?.toLowerCase().includes("exr")
        ? loadFloatImage(confidenceUrl, signal)
        : loadRasterChannel(
            confidenceUrl,
            "confidence",
            signal,
            (value) => value,
          )
      : Promise.resolve(undefined),
  ]);
  if (
    confidence &&
    (confidence.width !== depth.width || confidence.height !== depth.height)
  ) {
    throw new Error("Confidence and depth grids have different dimensions");
  }

  const sampleStep = Math.max(
    1,
    Math.ceil(Math.sqrt((depth.width * depth.height) / maxPoints)),
  );
  const fx = camera.intrinsics.fx * (depth.width / camera.intrinsics.width);
  const fy = camera.intrinsics.fy * (depth.height / camera.intrinsics.height);
  const cx = camera.intrinsics.cx * (depth.width / camera.intrinsics.width);
  const cy = camera.intrinsics.cy * (depth.height / camera.intrinsics.height);
  const capacity =
    Math.ceil(depth.width / sampleStep) * Math.ceil(depth.height / sampleStep);
  const positions = new Float32Array(capacity * 3);
  const radii = new Float32Array(capacity);
  const sampledColors = new Uint8Array(capacity * 3);
  let count = 0;
  for (let y = 0; y < depth.height; y += sampleStep) {
    for (let x = 0; x < depth.width; x += sampleStep) {
      const pixel = y * depth.width + x;
      const value = depth.data[pixel * depth.stride];
      const certainty = confidence?.data[pixel * confidence.stride];
      if (
        !Number.isFinite(value) ||
        value <= 0 ||
        (certainty !== undefined &&
          (!Number.isFinite(certainty) || certainty < 0.5))
      ) {
        continue;
      }
      const colorOffset = pixel * 4;
      const radius =
        Math.max(value / fx, value / fy) * sampleStep * 0.6 * pointSize;
      positions[count * 3] = ((x + 0.5 - cx) / fx) * value;
      positions[count * 3 + 1] = -((y + 0.5 - cy) / fy) * value;
      positions[count * 3 + 2] = -value;
      radii[count] = radius;
      sampledColors[count * 3] = colors[colorOffset];
      sampledColors[count * 3 + 1] = colors[colorOffset + 1];
      sampledColors[count * 3 + 2] = colors[colorOffset + 2];
      count += 1;
    }
  }
  return {
    positions: positions.slice(0, count * 3),
    radii: radii.slice(0, count),
    colors: sampledColors.slice(0, count * 3),
    count,
  };
}

export function loadDepthGrid(
  url: string,
  encoding: Asset["depthEncoding"],
  signal: AbortSignal,
) {
  return encoding?.type === "log"
    ? loadLogDepth(url, encoding, signal)
    : loadFloatImage(url, signal);
}
