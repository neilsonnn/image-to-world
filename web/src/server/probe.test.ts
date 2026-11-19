import { expect, test } from "bun:test";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { Quaternion, Vector3 } from "three";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { defaultCamera, identity, type Job } from "../../../core/schema";
import { defaultLighting } from "../../../core/lighting";
import { WorkspaceStore } from "./store";
import { captureEnvironment } from "./probe";

test("six camera renders form one correctly oriented, seamless equirectangular environment", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "probe-test-"));
  const store = await new WorkspaceStore(root).init();
  try {
    const snapshot = store.snapshot();
    snapshot.nodes.camera = {
      kind: "camera",
      id: "camera",
      name: "Lookout",
      parentId: null,
      visible: true,
      transform: { ...identity(), position: [8, 2, -4] },
      projection: defaultCamera().intrinsics,
    };
    snapshot.settings.lighting = {
      ...defaultLighting,
      environmentAssetId: "previous-map",
    };
    const job: Job = {
      id: "probe",
      input: { kind: "probe", nodeId: "camera", width: 128 },
      contextSnapshot: {
        nodes: snapshot.nodes,
        settings: snapshot.settings,
        assets: {},
      },
      status: "running",
      message: "Rendering",
      applyRoots: [],
      appliedTargets: [],
      createdAt: 0,
      updatedAt: 0,
      outputAssetIds: [],
    };
    let count = 0;
    const result = await captureEnvironment(
      store,
      {
        capture: async (face) => {
          if (face.input.kind !== "render") throw new Error("Expected render");
          expect(
            face.contextSnapshot!.settings.lighting!.environmentAssetId,
          ).toBeNull();
          const camera = face.input.camera;
          expect(camera.extrinsics.position).toEqual([8, 2, -4]);
          expect(face.input.lightingViewId).toBe("camera");
          const { width, height, fx, fy, cx, cy } = camera.intrinsics;
          const rotation = new Quaternion(...camera.extrinsics.quaternion);
          const canvas = createCanvas(width, height),
            ctx = canvas.getContext("2d");
          const image = ctx.createImageData(width, height);
          const ray = new Vector3();
          for (let row = 0; row < height; row++)
            for (let col = 0; col < width; col++) {
              ray
                .set((col + 0.5 - cx) / fx, (cy - row - 0.5) / fy, -1)
                .normalize()
                .applyQuaternion(rotation);
              image.data.set(
                [
                  127.5 * (1 + ray.x),
                  127.5 * (1 + ray.y),
                  127.5 * (1 + ray.z),
                  255,
                ],
                (row * width + col) * 4,
              );
            }
          ctx.putImageData(image, 0, 0);
          count++;
          return {
            outputs: { color: (await canvas.encode("png")).toString("base64") },
            report: {},
            ids: {},
            camera,
            near: 0.01,
            far: 10000,
            revision: 0,
          };
        },
      },
      job,
      new AbortController().signal,
    );
    expect(count).toBe(6);
    expect(Object.keys(store.snapshot().assets)).toEqual([result.id]);
    expect(snapshot.settings.lighting.environmentAssetId).toBe("previous-map");
    const png = await loadImage((await store.assetFile(result.id)).file);
    expect([png.width, png.height]).toEqual([128, 64]);
    const ctx = createCanvas(128, 64).getContext("2d");
    ctx.drawImage(png, 0, 0);
    const data = ctx.getImageData(0, 0, 128, 64).data;
    // Compare every pixel, including the longitude seam, poles and cube face joins.
    let maxError = 0;
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 128; x++) {
        const longitude = ((x + 0.5) / 128 - 0.5) * 2 * Math.PI,
          latitude = (0.5 - (y + 0.5) / 64) * Math.PI;
        const expected = [
          Math.cos(latitude) * Math.cos(longitude),
          Math.sin(latitude),
          Math.cos(latitude) * Math.sin(longitude),
        ];
        expected.forEach((channel, i) => {
          maxError = Math.max(
            maxError,
            Math.abs(data[4 * (y * 128 + x) + i] - 127.5 * (channel + 1)),
          );
        });
      }
    expect(maxError).toBeLessThan(3);
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});
