import { createCanvas, loadImage } from "@napi-rs/canvas";
import { Matrix4, Quaternion, Vector3 } from "three";
import { worldMatrix } from "../../../core/cameras";
import { sceneCamera } from "../../../core/captures";
import { renderInputSchema, type Camera, type Job } from "../../../core/schema";
import type { RenderWorker } from "./render-worker";
import type { WorkspaceStore } from "./store";

const directions = [
  new Vector3(1, 0, 0),
  new Vector3(-1, 0, 0),
  new Vector3(0, 1, 0),
  new Vector3(0, -1, 0),
  new Vector3(0, 0, 1),
  new Vector3(0, 0, -1),
];

const faces = directions.map((forward) => {
  const up =
    Math.abs(forward.y) === 1
      ? new Vector3(0, 0, -forward.y)
      : new Vector3(0, 1, 0);
  const right = forward.clone().cross(up);
  const rotation = new Matrix4().makeBasis(right, up, forward.clone().negate());
  return {
    right,
    up,
    quaternion: new Quaternion().setFromRotationMatrix(rotation).toArray(),
  };
});

// Three.js equirectUv uses atan2(z,x) for longitude. PNG row zero is the north pole.
function panoramaPixels(
  images: Uint8ClampedArray[],
  faceSize: number,
  width: number,
) {
  const height = width / 2;
  const output = new Uint8ClampedArray(width * height * 4);
  const angles = Array.from({ length: width }, (_, x) => {
    const longitude = ((x + 0.5) / width - 0.5) * 2 * Math.PI;
    return [Math.cos(longitude), Math.sin(longitude)] as const;
  });
  const clamp = (v: number) => Math.min(faceSize - 1, Math.max(0, v));
  for (let row = 0; row < height; row++) {
    const latitude = (0.5 - (row + 0.5) / height) * Math.PI;
    const y = Math.sin(latitude),
      radius = Math.cos(latitude);
    for (let column = 0; column < width; column++) {
      const [cos, sin] = angles[column];
      const x = radius * cos,
        z = radius * sin;
      const major = Math.max(Math.abs(x), Math.abs(y), Math.abs(z));
      let index: number;
      if (Math.abs(x) === major) index = x > 0 ? 0 : 1;
      else if (Math.abs(y) === major) index = y > 0 ? 2 : 3;
      else index = z > 0 ? 4 : 5;
      const { right, up } = faces[index];
      const px = clamp(
        (((right.x * x + right.y * y + right.z * z) / major + 1) * faceSize) /
          2 -
          0.5,
      );
      const py = clamp(
        ((1 - (up.x * x + up.y * y + up.z * z) / major) * faceSize) / 2 - 0.5,
      );
      const left = Math.floor(px),
        top = Math.floor(py);
      const dx = px - left,
        dy = py - top,
        data = images[index];
      const a = (top * faceSize + left) * 4,
        b = (top * faceSize + clamp(left + 1)) * 4;
      const c = (clamp(top + 1) * faceSize + left) * 4,
        d = (clamp(top + 1) * faceSize + clamp(left + 1)) * 4;
      const dst = (row * width + column) * 4;
      for (let channel = 0; channel < 3; channel++) {
        const upper = data[a + channel] * (1 - dx) + data[b + channel] * dx;
        const lower = data[c + channel] * (1 - dx) + data[d + channel] * dx;
        output[dst + channel] = upper * (1 - dy) + lower * dy;
      }
      output[dst + 3] = 255;
    }
  }
  return output;
}

export async function captureEnvironment(
  store: WorkspaceStore,
  renderer: Pick<RenderWorker, "capture">,
  job: Job,
  signal: AbortSignal,
) {
  if (job.input.kind !== "probe" || !job.contextSnapshot)
    throw new Error("Probe requires a scene snapshot");
  const input = job.input,
    snapshot = job.contextSnapshot;
  const node = snapshot.nodes[input.nodeId];
  const camera =
    node &&
    (node.kind === "camera" || node.kind === "capture") &&
    sceneCamera(snapshot, node.id);
  if (!camera)
    throw new Error(
      "Choose a camera or Frame with a usable camera for the environment probe",
    );
  if (input.nodeIds?.some((id) => !snapshot.nodes[id]))
    throw new Error("Unknown environment probe target");
  const lighting = snapshot.settings.lighting;
  // Re-baking a probe must never sample itself. All other shot lighting is preserved.
  const settings = lighting
    ? {
        ...snapshot.settings,
        lighting: { ...lighting, environmentAssetId: null },
      }
    : snapshot.settings;
  const position = input.position
    ? new Vector3(...input.position)
        .applyMatrix4(worldMatrix(node, snapshot.nodes))
        .toArray()
    : camera.extrinsics.position;
  const size = input.width / 4;
  const intrinsics = {
    width: size,
    height: size,
    fx: size / 2,
    fy: size / 2,
    cx: size / 2,
    cy: size / 2,
  };
  const pixels: Uint8ClampedArray[] = [];
  const faceCanvas = createCanvas(size, size).getContext("2d");
  for (const face of faces) {
    signal.throwIfAborted();
    const direction: Camera = {
      intrinsics,
      extrinsics: {
        position,
        quaternion: face.quaternion,
        coordinateSystem: "rub",
      },
    };
    const result = await renderer.capture(
      {
        ...job,
        contextSnapshot: { ...snapshot, settings },
        input: renderInputSchema.parse({
          kind: "render",
          camera: direction,
          lightingViewId: node.id,
          nodeIds: input.nodeIds,
        }),
      },
      signal,
    );
    const png = await loadImage(Buffer.from(result.outputs.color, "base64"));
    faceCanvas.clearRect(0, 0, size, size);
    faceCanvas.drawImage(png, 0, 0);
    pixels.push(faceCanvas.getImageData(0, 0, size, size).data);
  }
  signal.throwIfAborted();
  const canvas = createCanvas(input.width, input.width / 2);
  const ctx = canvas.getContext("2d");
  const panorama = ctx.createImageData(canvas.width, canvas.height);
  panorama.data.set(panoramaPixels(pixels, size, canvas.width));
  ctx.putImageData(panorama, 0, 0);
  const bytes = await canvas.encode("png");
  signal.throwIfAborted();
  return store.importFile(
    new Blob([new Uint8Array(bytes)], { type: "image/png" }),
    `${job.id}-environment.png`,
    { jobId: job.id, role: "render", name: `${node.name} · environment (LDR)` },
  );
}
