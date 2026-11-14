import { createCanvas, loadImage } from "@napi-rs/canvas";
import { Matrix4, Quaternion, Vector3, Box3 } from "three";
import { captureFrame, captureNodes } from "../../../core/captures";
import {
  cameraMatrix,
  matrixTransform,
  worldMatrix,
} from "../../../core/cameras";
import { median } from "../../../core/registration";
import {
  checkPreconditions,
  commandContextSchema,
} from "../../../core/command-context";
import {
  jobInputSchema,
  type Asset,
  type Job,
  type Workspace,
} from "../../../core/schema";
import type { WorkspaceStore } from "./store";
import type { RenderWorker } from "./render-worker";
import { readDepth } from "./depth";

export async function observeRegion(
  store: WorkspaceStore,
  job: Job,
  signal: AbortSignal,
): Promise<Asset[]> {
  if (job.input.kind !== "observe") throw new Error("Expected observation");
  const input = job.input,
    w = { ...store.snapshot(), ...job.contextSnapshot } as Workspace;
  const frame = captureFrame(w, input.nodeId),
    c = frame.camera.intrinsics;
  const { x, y, width, height } = input.region;
  if (x + width > 1.000001 || y + height > 1.000001)
    throw new Error(
      "Region must fit inside the image; coordinates are normalized top-left pixels",
    );
  const { file } = await store.assetFile(frame.asset.id),
    source = await loadImage(file);
  const full = createCanvas(c.width, c.height),
    ctx = full.getContext("2d");
  ctx.drawImage(source, 0, 0, c.width, c.height);
  const mask = createCanvas(c.width, c.height),
    m = mask.getContext("2d");
  m.fillStyle = "black";
  m.fillRect(0, 0, c.width, c.height);
  if (input.maskAssetId) {
    const { file } = await store.assetFile(input.maskAssetId);
    const image = await loadImage(file);
    if (image.width !== c.width || image.height !== c.height)
      throw new Error("Mask dimensions must match calibrated source image");
    m.drawImage(image, 0, 0);
  } else if (input.polygon) {
    m.fillStyle = "white";
    m.beginPath();
    input.polygon.forEach(([x, y], i) =>
      i
        ? m.lineTo(x * c.width, y * c.height)
        : m.moveTo(x * c.width, y * c.height),
    );
    m.closePath();
    m.fill();
  } else {
    m.fillStyle = "white";
    m.fillRect(x * c.width, y * c.height, width * c.width, height * c.height);
  }
  const pixels = m.getImageData(0, 0, c.width, c.height);
  const inv = m.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const px = (i / 4) % c.width,
      py = Math.floor(i / 4 / c.width);
    const selected =
      px >= x * c.width &&
      px < (x + width) * c.width &&
      py >= y * c.height &&
      py < (y + height) * c.height &&
      pixels.data[i] > 127;
    for (let k = 0; k < 3; k++) {
      pixels.data[i + k] = selected ? 255 : 0;
      inv.data[i + k] = selected ? 0 : 255;
    }
    pixels.data[i + 3] = inv.data[i + 3] = 255;
  }
  m.putImageData(pixels, 0, 0);
  const unchanged = createCanvas(c.width, c.height);
  unchanged.getContext("2d").putImageData(inv, 0, 0);
  const depth = await readDepth(store, frame.asset),
    samples: number[] = [];
  const step = Math.max(1, Math.floor(Math.sqrt((c.width * c.height) / 12000)));
  for (
    let py = Math.floor(y * c.height);
    py < (y + height) * c.height;
    py += step
  ) {
    signal.throwIfAborted();
    for (
      let px = Math.floor(x * c.width);
      px < (x + width) * c.width;
      px += step
    ) {
      if (!pixels.data[(py * c.width + px) * 4]) continue;
      const dx = Math.min(
          depth.width - 1,
          Math.floor(((px + 0.5) * depth.width) / c.width),
        ),
        dy = Math.min(
          depth.height - 1,
          Math.floor(((py + 0.5) * depth.height) / c.height),
        );
      const z =
        depth.data[(dy * depth.width + dx) * depth.stride] * frame.scale;
      if (Number.isFinite(z) && z > 0) samples.push(z);
    }
  }
  if (samples.length < 16)
    throw new Error(
      "Region has fewer than 16 valid depth samples; enlarge the region or repair its depth",
    );
  const z = median(samples),
    spread = samples.map((v) => Math.abs(v - z)).sort((a, b) => a - b)[
      Math.floor(samples.length / 2)
    ];
  const center = new Vector3(
    (((x + width / 2) * c.width - c.cx) * z) / c.fx,
    (-((y + height / 2) * c.height - c.cy) * z) / c.fy,
    -z,
  ).applyMatrix4(cameraMatrix(frame.camera));
  const px = Math.floor(Math.max(0, x - width * input.padding) * c.width),
    py = Math.floor(Math.max(0, y - height * input.padding) * c.height);
  const right = Math.ceil(
      Math.min(1, x + width * (1 + input.padding)) * c.width,
    ),
    bottom = Math.ceil(
      Math.min(1, y + height * (1 + input.padding)) * c.height,
    );
  const crop = createCanvas(right - px, bottom - py);
  crop
    .getContext("2d")
    .drawImage(
      full,
      px,
      py,
      crop.width,
      crop.height,
      0,
      0,
      crop.width,
      crop.height,
    );
  const outputs: Asset[] = [];
  for (const [name, canvas, role] of [
    ["crop", crop, "image"],
    ["mask", mask, "mask"],
    ["unchanged", unchanged, "mask"],
  ] as const)
    outputs.push(
      await store.importFile(
        new Blob([new Uint8Array(await canvas.encode("png"))], {
          type: "image/png",
        }),
        `${job.id}-${name}.png`,
        { jobId: job.id, role, sourceAssetIds: [frame.asset.id] },
      ),
    );
  const observedIds = new Set<string>();
  for (const id of Object.values(captureNodes(w, input.nodeId)).map(
    (n) => n.id,
  )) {
    let current: string | null = id;
    while (current) {
      observedIds.add(current);
      current = w.nodes[current].parentId;
    }
  }
  const manifest = {
    version: 1,
    nodeId: frame.node.id,
    revision: job.snapshotRevision ?? w.revision,
    sourceAssetId: frame.asset.id,
    geometryAssetId: frame.points.geometryAssetId ?? frame.points.assetId,
    camera: frame.camera,
    region: input.region,
    crop: {
      x: px,
      y: py,
      width: crop.width,
      height: crop.height,
      assetId: outputs[0].id,
    },
    maskAssetId: outputs[1].id,
    unchangedMaskAssetId: outputs[2].id,
    depth: { median: z, mad: spread, samples: samples.length },
    worldCenter: center.toArray(),
    sizeAtDepth: [(width * c.width * z) / c.fx, (height * c.height * z) / c.fy],
    preconditions: [
      ...[...observedIds].map((id) => ({
        collection: "nodes",
        id,
        expected: w.nodes[id],
      })),
      ...[
        ...new Set([
          frame.asset.id,
          frame.points.geometryAssetId ?? frame.asset.id,
          frame.asset.depthAssetId,
        ]),
      ].map((id) => ({ collection: "assets", id, expected: w.assets[id] })),
    ],
    notes: [
      "Depth is scene-relative, not calibrated meters.",
      "Median depth and image bounds give an initial placement, not hidden shape or object orientation.",
      "Cropping and object completion can change framing; fit against this original observation.",
    ],
  };
  outputs.push(
    await store.importFile(
      new Blob([JSON.stringify(manifest, null, 2)], {
        type: "application/json",
      }),
      `${job.id}-observation.json`,
      {
        jobId: job.id,
        role: "observation",
        sourceAssetIds: [frame.asset.id, ...outputs.map((a) => a.id)],
      },
    ),
  );
  return outputs;
}

export async function fitObject(
  store: WorkspaceStore,
  renderer: RenderWorker,
  job: Job,
  signal: AbortSignal,
): Promise<Asset[]> {
  if (job.input.kind !== "fit") throw new Error("Expected fit request");
  const input = job.input,
    w = { ...store.snapshot(), ...job.contextSnapshot } as Workspace,
    node = w.nodes[input.nodeId];
  if (node?.kind !== "mesh") throw new Error("Fit requires a mesh node");
  const { file } = await store.assetFile(input.observationAssetId);
  const observation = await Bun.file(file).json();
  if (
    observation.version !== 1 ||
    !observation.worldCenter ||
    !observation.camera
  )
    throw new Error("Choose an observation manifest");
  checkPreconditions(
    w,
    commandContextSchema.parse({ preconditions: observation.preconditions }),
  );
  const q = new Quaternion(...(input.quaternion ?? [0, 0, 0, 1])).normalize();
  const parent = node.parentId
    ? worldMatrix(w.nodes[node.parentId], w.nodes)
    : new Matrix4();
  const world = new Matrix4().compose(new Vector3(), q, new Vector3(1, 1, 1));
  const local = matrixTransform(parent.clone().invert().multiply(world));
  const renderJob = {
    ...job,
    input: jobInputSchema.parse({
      kind: "render",
      camera: observation.camera,
      nodeIds: [node.id],
      overrides: { [node.id]: local },
    }),
  };
  const renders = await renderer.render(renderJob, signal);
  const manifest = renders.find((a) => a.role === "raw-result")!;
  const report = await Bun.file(
    (await store.assetFile(manifest.id)).file,
  ).json();
  const bounds = report.report.nodes.find(
    (n: { id: string }) => n.id === node.id,
  )?.bounds;
  if (!bounds) throw new Error("Mesh has no usable geometry bounds");
  const box = new Box3(new Vector3(...bounds.min), new Vector3(...bounds.max));
  const cameraBox = box
    .clone()
    .applyMatrix4(cameraMatrix(observation.camera).invert());
  const size = cameraBox.getSize(new Vector3());
  const scale = Math.min(
    observation.sizeAtDepth[0] / size.x,
    observation.sizeAtDepth[1] / size.y,
  );
  if (!Number.isFinite(scale) || scale <= 0)
    throw new Error("Degenerate mesh bounds");
  const position = new Vector3(...observation.worldCenter).sub(
    box.getCenter(new Vector3()).multiplyScalar(scale),
  );
  const transform = matrixTransform(
    parent
      .clone()
      .invert()
      .multiply(
        new Matrix4().compose(position, q, new Vector3(scale, scale, scale)),
      ),
  );
  const guards = [
    { collection: "nodes", id: node.id, expected: node },
    ...observation.preconditions,
  ];
  let ancestor = node.parentId;
  while (ancestor) {
    guards.push({
      collection: "nodes",
      id: ancestor,
      expected: w.nodes[ancestor],
    });
    ancestor = w.nodes[ancestor].parentId;
  }
  const proposal = {
    version: 1,
    nodeId: node.id,
    observationAssetId: input.observationAssetId,
    transform,
    command: { type: "nodes.transform", ids: [node.id], transform },
    preconditions: guards,
    notes: [
      "Read-only initial fit from conservative geometry bounds; review silhouette, occlusion and grounding with independent renders before applying.",
      "Orientation remains an explicit agent decision.",
    ],
  };
  return [
    ...renders,
    await store.importFile(
      new Blob([JSON.stringify(proposal, null, 2)], {
        type: "application/json",
      }),
      `${job.id}-fit.json`,
      {
        jobId: job.id,
        role: "observation",
        sourceAssetIds: [input.observationAssetId, node.assetId!],
      },
    ),
  ];
}

export async function composeMask(
  store: WorkspaceStore,
  job: Job,
  signal: AbortSignal,
): Promise<Asset[]> {
  if (job.input.kind !== "mask") throw new Error("Expected mask operation");
  const input = job.input;
  const images = await Promise.all(
    input.assetIds.map(async (id) =>
      loadImage((await store.assetFile(id)).file),
    ),
  );
  const { width, height } = images[0];
  if (width * height > 16_000_000)
    throw new Error("Masks are limited to 16 million pixels");
  if (images.some((image) => image.width !== width || image.height !== height))
    throw new Error("Mask dimensions must match");
  const canvas = createCanvas(width, height),
    ctx = canvas.getContext("2d");
  const bits = new Uint8Array(width * height);
  if (input.operation === "intersection") bits.fill(1);
  for (const image of images) {
    signal.throwIfAborted();
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, width, height).data;
    for (let i = 0; i < bits.length; i++) {
      const value = pixels[i * 4] >= 128 && pixels[i * 4 + 3] >= 128 ? 1 : 0;
      bits[i] =
        input.operation === "intersection" ? bits[i] & value : bits[i] | value;
    }
  }
  const horizontal = new Uint8Array(bits.length),
    expanded = new Uint8Array(bits.length);
  const r = input.dilate;
  for (let y = 0; y < height; y++) {
    signal.throwIfAborted();
    const prefix = new Uint32Array(width + 1);
    for (let x = 0; x < width; x++)
      prefix[x + 1] = prefix[x] + bits[y * width + x];
    for (let x = 0; x < width; x++)
      horizontal[y * width + x] =
        prefix[Math.min(width, x + r + 1)] > prefix[Math.max(0, x - r)] ? 1 : 0;
  }
  for (let x = 0; x < width; x++) {
    signal.throwIfAborted();
    const prefix = new Uint32Array(height + 1);
    for (let y = 0; y < height; y++)
      prefix[y + 1] = prefix[y] + horizontal[y * width + x];
    for (let y = 0; y < height; y++)
      expanded[y * width + x] =
        prefix[Math.min(height, y + r + 1)] > prefix[Math.max(0, y - r)]
          ? 1
          : 0;
  }
  let values = Float32Array.from(expanded, (v) => (input.invert ? 1 - v : v));
  if (input.feather) {
    const radius = input.feather,
      blurred = new Float32Array(values.length),
      vertical = new Float32Array(values.length);
    for (let y = 0; y < height; y++) {
      const prefix = new Float64Array(width + 1);
      for (let x = 0; x < width; x++)
        prefix[x + 1] = prefix[x] + values[y * width + x];
      for (let x = 0; x < width; x++) {
        const lo = Math.max(0, x - radius),
          hi = Math.min(width, x + radius + 1);
        blurred[y * width + x] = (prefix[hi] - prefix[lo]) / (hi - lo);
      }
    }
    for (let x = 0; x < width; x++) {
      const prefix = new Float64Array(height + 1);
      for (let y = 0; y < height; y++)
        prefix[y + 1] = prefix[y] + blurred[y * width + x];
      for (let y = 0; y < height; y++) {
        const lo = Math.max(0, y - radius),
          hi = Math.min(height, y + radius + 1);
        vertical[y * width + x] = (prefix[hi] - prefix[lo]) / (hi - lo);
      }
    }
    values = vertical;
  }
  const output = ctx.createImageData(width, height);
  for (let i = 0; i < values.length; i++) {
    const at = i * 4;
    output.data[at] =
      output.data[at + 1] =
      output.data[at + 2] =
        Math.round(values[i] * 255);
    output.data[at + 3] = 255;
  }
  ctx.putImageData(output, 0, 0);
  return [
    await store.importFile(
      new Blob([new Uint8Array(canvas.toBuffer("image/png"))], {
        type: "image/png",
      }),
      `${job.id}-mask.png`,
      { jobId: job.id, role: "mask", sourceAssetIds: input.assetIds },
    ),
  ];
}
