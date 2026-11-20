import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { compileModule } from "../../../cli/modules";
import { WorkspaceStore } from "./store";
import { JobRunner } from "./jobs";
import { CommandService } from "./commands";
import { nodeSchema } from "../../../core/schema";
import { linearDepth } from "../../../core/depth";
import { rendererExecutable } from "./render-worker";

test.skipIf(!rendererExecutable())(
  "compiled TSL renders from pinned code and conflicting agents cannot overwrite or revive nodes",
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), "procedural-workflow-"));
    const store = await new WorkspaceStore(root).init();
    const runner = new JobRunner(store);
    const commands = new CommandService(store, runner);
    try {
      const source = path.join(root, "panel.ts");
      await writeFile(
        source,
        `
        import { Mesh, PlaneGeometry } from "three";
        import { MeshBasicNodeMaterial } from "three/webgpu";
        import { mix, step, color, uv, vec4, positionGeometry, Fn, attributeArray, instanceIndex, uniform } from "three/tsl";
        export default { create({params, gpu}) {
          const offsets = attributeArray(4, "vec4");
          const clock = uniform(0);
          const place = Fn(() => {
            offsets.element(instanceIndex).assign(vec4(0, clock.add(0.4), 0.5, 0));
          })().compute(4);
          const material = new MeshBasicNodeMaterial({ alphaTest: 0.5 });
          material.positionNode = positionGeometry.add(offsets.toAttribute().xyz);
          material.opacityNode = step(0.25, uv().y);
          material.colorNode = mix(color(params.palette[0]), color(params.palette[1]), step(0.5, uv().x));
          return {
            object: new Mesh(new PlaneGeometry(1.4, 1), material),
            sample({time}) { clock.value = time; gpu.compute(place); }
          };
        }};
      `,
      );
      const compiled = await compileModule(source);
      const code = await store.importFile(
        new Blob([compiled.code], { type: "text/javascript" }),
        "module.js",
      );
      const node = nodeSchema.parse({
        id: "module",
        name: "Module",
        kind: "procedural",
        transform: {
          position: [0, 0, -3],
          quaternion: [0, 0, 0, 1],
          scale: [1, 1, 1],
        },
        procedural: {
          sourceAssetId: code.id,
          bundleAssetId: code.id,
          parameters: { palette: ["#ff0000", "#0000ff"] },
        },
      });
      await commands.execute({ type: "nodes.put", nodes: [node] });
      const guard = {
        preconditions: [
          {
            collection: "nodes" as const,
            id: node.id,
            field: "procedural",
            expected: node.procedural,
          },
        ],
      };
      await commands.execute(
        {
          type: "nodes.patch",
          id: node.id,
          patch: { procedural: { ...node.procedural!, seed: 2 } },
        },
        guard,
      );
      await expect(
        commands.execute(
          {
            type: "nodes.patch",
            id: node.id,
            patch: { procedural: { ...node.procedural!, seed: 3 } },
          },
          guard,
        ),
      ).rejects.toThrow("Command conflict");
      const width = 77,
        height = 61;
      const jobId = await runner.submit({
        kind: "render",
        camera: {
          extrinsics: {
            position: [0, 0, 0],
            quaternion: [0, 0, 0, 1],
            coordinateSystem: "rub",
          },
          intrinsics: { width, height, fx: 50, fy: 50, cx: 38, cy: 30 },
        },
        nodeIds: [node.id],
        passes: ["color", "mask", "depth", "ids"],
      });
      for (
        let i = 0;
        i < 600 &&
        !["failed", "succeeded"].includes(store.snapshot().jobs[jobId].status);
        i++
      )
        await Bun.sleep(100);
      const job = await store.loadJob(jobId);
      expect(job.error).toBeUndefined();
      expect(job.status).toBe("succeeded");
      expect(job.pinnedAssets?.[code.id]).toBeDefined();
      expect(job.outputAssetIds.length).toBeGreaterThanOrEqual(4);
      const assets = job.outputAssetIds.map(
        (id) => store.snapshot().assets[id],
      );
      const passFile = async (suffix: string) => {
        const asset = assets.find((asset) => asset.name.endsWith(suffix))!;
        return (await store.assetFile(asset.id)).file;
      };
      const raster = async (suffix: string) => {
        const pixels = createCanvas(width, height).getContext("2d");
        pixels.drawImage(await loadImage(await passFile(suffix)), 0, 0);
        return (x: number, y: number) => pixels.getImageData(x, y, 1, 1).data;
      };
      const color = await raster("-color.png");
      const left = color(32, 15),
        right = color(44, 15);
      expect(left[0]).toBeGreaterThan(235);
      expect(left[2]).toBeLessThan(20);
      expect(right[0]).toBeLessThan(20);
      expect(right[2]).toBeGreaterThan(235);
      // Displaced above the original center, with the lower quarter alpha-cut.
      const mask = await raster("-mask.png");
      expect([...mask(32, 15)]).toEqual([255, 255, 255, 255]);
      expect(mask(32, 30)[3]).toBe(0);
      expect(mask(32, 46)[3]).toBe(0);
      const ids = await raster("-ids.png");
      expect([...ids(32, 15)]).toEqual([1, 0, 0, 255]);
      expect(ids(32, 30)[3]).toBe(0);
      const grid = linearDepth(
        await Bun.file(await passFile("-depth.exr")).arrayBuffer(),
      );
      expect(grid.width).toBe(width);
      expect(grid.height).toBe(height);
      const depth = (x: number, y: number) =>
        grid.data[(y * width + x) * grid.stride];
      expect(depth(32, 15)).toBeCloseTo(2.5, 3);
      expect(depth(32, 30)).toBe(0);
      expect(depth(32, 46)).toBe(0);
      await commands.execute({ type: "nodes.remove", ids: [node.id] });
      await expect(
        commands.execute(
          {
            type: "nodes.patch",
            id: node.id,
            patch: { procedural: node.procedural },
          },
          guard,
        ),
      ).rejects.toThrow("Command conflict");
      expect(store.snapshot().nodes[node.id]).toBeUndefined();
    } finally {
      await runner.close();
      await store.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  90000,
);
