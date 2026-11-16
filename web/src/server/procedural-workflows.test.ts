import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { WorkspaceStore } from "./store";
import { JobRunner } from "./jobs";
import { CommandService } from "./commands";
import { nodeSchema } from "../../../core/schema";
import { rendererExecutable } from "./render-worker";

test.skipIf(!rendererExecutable())(
  "procedural content renders from pinned code and conflicting agents cannot overwrite or revive nodes",
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), "procedural-workflow-"));
    const store = await new WorkspaceStore(root).init();
    const runner = new JobRunner(store);
    const commands = new CommandService(store, runner);
    try {
      const code = await store.importFile(
        new Blob(
          [
            `export default {create({THREE}) {return {object:new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial({color:0xff8833}))}}}`,
          ],
          { type: "text/javascript" },
        ),
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
        procedural: { sourceAssetId: code.id, bundleAssetId: code.id },
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
      const jobId = await runner.submit({
        kind: "render",
        camera: {
          extrinsics: {
            position: [0, 0, 0],
            quaternion: [0, 0, 0, 1],
            coordinateSystem: "rub",
          },
          intrinsics: { width: 64, height: 64, fx: 50, fy: 50, cx: 32, cy: 32 },
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
      const job = store.snapshot().jobs[jobId];
      expect(job.error).toBeUndefined();
      expect(job.status).toBe("succeeded");
      expect(job.pinnedAssets?.[code.id]).toBeDefined();
      expect(job.outputAssetIds.length).toBeGreaterThanOrEqual(4);
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
