import { FloatType } from "three";
import { EXRLoader } from "three/examples/jsm/loaders/EXRLoader.js";
import type { Camera } from "./schema";

export type DepthGrid = {
  data: Float32Array;
  width: number;
  height: number;
  stride: number;
};

export function linearDepth(buffer: ArrayBuffer): DepthGrid {
  const parsed = new EXRLoader().setDataType(FloatType).parse(buffer);
  const stride = parsed.data.length / (parsed.width * parsed.height);
  const row = parsed.width * stride;
  const data = new Float32Array(parsed.data.length);
  for (let y = 0; y < parsed.height; y++) {
    const offset = (parsed.height - y - 1) * row;
    data.set(parsed.data.subarray(offset, offset + row), y * row);
  }
  return { data, width: parsed.width, height: parsed.height, stride };
}

export function depthIntrinsics(camera: Camera, width: number, height: number) {
  const c = camera.intrinsics;
  return {
    fx: (c.fx * width) / c.width,
    fy: (c.fy * height) / c.height,
    cx: (c.cx * width) / c.width,
    cy: (c.cy * height) / c.height,
  };
}
