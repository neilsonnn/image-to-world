import { EXRExporter } from "three/examples/jsm/exporters/EXRExporter.js";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { DataTexture, FloatType, RGBAFormat } from "three";
import { atlasCamera } from "../../../core/cameras";
import { captureFrame } from "../../../core/captures";
import { sessionFormat } from "../../../core/formats";
import {
  depthIntrinsics,
  linearDepth,
  type DepthGrid,
} from "../../../core/depth";
import type { Asset, Workspace } from "../../../core/schema";
import type { WorkspaceStore } from "./store";

export async function readDepth(
  store: WorkspaceStore,
  asset: Asset,
): Promise<DepthGrid> {
  const { file } = await store.assetFile(asset.depthAssetId!);
  if (asset.depthEncoding?.type !== "log")
    return linearDepth(await Bun.file(file).arrayBuffer());
  const image = await loadImage(file);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
  const data = new Float32Array(image.width * image.height);
  const a = Math.log(asset.depthEncoding.zMin),
    b = Math.log(asset.depthEncoding.zMax);
  for (let i = 0; i < data.length; i++)
    data[i] = Math.exp(b + (pixels[i * 4] / 255) * (a - b));
  return { data, width: image.width, height: image.height, stride: 1 };
}

export async function prepareContext(
  store: WorkspaceStore,
  workspace: Workspace,
  id: string,
  signal: AbortSignal,
) {
  const frame = captureFrame(workspace, id);
  if (!frame)
    throw new Error("Context requires aligned camera, image, and depth");
  const depth = await readDepth(store, frame.asset);
  const { width: W, height: H } = sessionFormat(workspace);
  const camera = atlasCamera(frame.camera, { width: W, height: H }),
    c = frame.asset.camera.intrinsics;
  const scale = camera.intrinsics.fx / c.fx;
  const { file } = await store.assetFile(frame.asset.id);
  const image = await loadImage(file);
  const calibrated = createCanvas(c.width, c.height),
    calibration = calibrated.getContext("2d");
  const cover = Math.max(c.width / image.width, c.height / image.height);
  calibration.drawImage(
    image,
    (c.width - image.width * cover) / 2,
    (c.height - image.height * cover) / 2,
    image.width * cover,
    image.height * cover,
  );
  const output = createCanvas(W, H),
    outputContext = output.getContext("2d");
  outputContext.drawImage(
    calibrated,
    W / 2 - c.cx * scale,
    H / 2 - c.cy * scale,
    c.width * scale,
    c.height * scale,
  );
  const data = new Float32Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    if (y % 32 === 0) {
      signal.throwIfAborted();
      await Bun.sleep(0);
    }
    for (let x = 0; x < W; x++) {
      const sx = Math.floor(
        (((x + 0.5 - W / 2) / scale + c.cx) * depth.width) / c.width,
      );
      const sy = Math.floor(
        (((y + 0.5 - H / 2) / scale + c.cy) * depth.height) / c.height,
      );
      const source = sy * depth.width + sx;
      const valid = sx >= 0 && sx < depth.width && sy >= 0 && sy < depth.height;
      const z = valid ? depth.data[source * depth.stride] * frame.scale : 0;
      const at = ((H - 1 - y) * W + x) * 4;
      data[at] =
        data[at + 1] =
        data[at + 2] =
          Number.isFinite(z) && z > 0 ? z : 0;
      data[at + 3] = 1;
    }
  }
  const texture = new DataTexture(data, W, H, RGBAFormat, FloatType);
  try {
    return {
      camera,
      image: new Blob([new Uint8Array(await output.encode("png"))], {
        type: "image/png",
      }),
      depth: new Blob(
        [
          new Uint8Array(
            await new EXRExporter().parse(texture, { type: FloatType }),
          ),
        ],
        { type: "image/x-exr" },
      ),
    };
  } finally {
    texture.dispose();
  }
}

export async function encodeDepth(grid: DepthGrid, scale = 1): Promise<Blob> {
  const data = new Float32Array(grid.width * grid.height * 4);
  for (let y = 0; y < grid.height; y++)
    for (let x = 0; x < grid.width; x++) {
      const value = grid.data[(y * grid.width + x) * grid.stride] * scale;
      const offset = ((grid.height - 1 - y) * grid.width + x) * 4;
      data[offset] =
        data[offset + 1] =
        data[offset + 2] =
          Number.isFinite(value) && value > 0 ? value : 0;
      data[offset + 3] = 1;
    }
  const texture = new DataTexture(
    data,
    grid.width,
    grid.height,
    RGBAFormat,
    FloatType,
  );
  try {
    return new Blob(
      [
        new Uint8Array(
          await new EXRExporter().parse(texture, { type: FloatType }),
        ),
      ],
      { type: "image/x-exr" },
    );
  } finally {
    texture.dispose();
  }
}
