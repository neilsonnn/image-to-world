import { applyCommand } from "../../../core/commands";
import { expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { identity, type Workspace } from "../../../core/schema";
import { applyDelta, type WorkspaceDelta } from "../../../core/workspace-delta";
import { createService } from "./http";
import { JobFiles } from "./project-files";

for (const count of [10, 10_000]) {
  test(`navigation and node edits with ${count} historical jobs`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "image-to-world-history-"));
    const loads = spyOn(JobFiles.prototype, "load");
    let service: Awaited<ReturnType<typeof createService>> | undefined;
    try {
      await mkdir(path.join(root, "jobs"));
      // Deliberately leave out input.json. Opening, navigation and editing can all
      // proceed with an offline archive of job manifests.
      for (let start = 0; start < count; start += 64) {
        await Promise.all(
          Array.from({ length: Math.min(64, count - start) }, async (_, i) => {
            const id = "job_" + (start + i),
              dir = path.join(root, "jobs", id);
            await mkdir(dir);
            await writeFile(
              path.join(dir, "job.json"),
              JSON.stringify({
                id,
                input: { kind: "render" },
                status: "succeeded",
                message: "Done",
                createdAt: 1,
                updatedAt: 1,
                outputAssetIds: [],
                applyRoots: [],
                appliedTargets: [],
              }),
            );
          }),
        );
      }
      service = await createService(root);
      const { store } = service;
      const handle = service.handle;
      const command = async (value: unknown) => {
        const response = await handle(
          new Request("http://localhost/api/commands", {
            method: "POST",
            headers: { "X-Image-To-World-Client": "web" },
            body: JSON.stringify(value),
          }),
        );
        expect(response.status).toBe(200);
        return response.json();
      };
      const projection = store.current.settings.viewportCamera.intrinsics;
      await command({
        type: "nodes.put",
        nodes: Array.from({ length: 10 }, (_, i) => ({
          id: "camera_" + i,
          name: "Camera " + i,
          kind: "camera",
          parentId: null,
          visible: true,
          transform: { ...identity(), position: [i, 0, 0] },
          projection,
        })),
      });
      let browser: Workspace = await (
        await handle(new Request("http://localhost/api/workspace"))
      ).json();
      expect(Object.keys(browser.jobs)).toHaveLength(count);
      const deltas: WorkspaceDelta[] = [];
      store.subscribe((event, data) => {
        if (event !== "change") return;
        const delta = JSON.parse(JSON.stringify(data)) as WorkspaceDelta;
        expect(delta.base).toBe(browser.revision);
        deltas.push(delta);
        browser = applyDelta(browser, delta);
      });
      const scene = path.join(root, "workspace.json");
      const before = await stat(scene);
      const writes = spyOn(
        store as unknown as { write(state: Workspace): Promise<void> },
        "write",
      );
      for (let i = 0; i < 10; i++) {
        const id = "camera_" + i;
        await command({ type: "selection.set", ids: [id] });
        await command({ type: "camera.view", nodeId: id });
      }
      expect(browser.settings.viewingCameraId).toBe("camera_9");
      expect(browser.settings.viewportCamera.extrinsics.position).toEqual([
        9, 0, 0,
      ]);
      expect(writes).toHaveBeenCalledTimes(0);
      expect((await stat(scene)).ino).toBe(before.ino);
      expect((await stat(scene)).mtimeMs).toBe(before.mtimeMs);
      const jobs = browser.jobs;
      deltas.length = 0;
      await command({
        type: "nodes.patch",
        id: "camera_4",
        patch: { name: "Moved camera" },
      });
      expect(writes).toHaveBeenCalledTimes(1);
      expect(deltas).toHaveLength(1);
      expect(
        deltas[0].patches.filter((p) => p.field === "nodes").map((p) => p.key),
      ).toEqual(["camera_4"]);
      expect(JSON.stringify(deltas[0]).length).toBeLessThan(1500);
      expect(browser.jobs).toBe(jobs);
      expect(browser.nodes.camera_4.name).toBe("Moved camera");
      expect(Object.keys(await Bun.file(scene).json())).not.toContain("jobs");
      expect(loads).toHaveBeenCalledTimes(0);
      await service.close();
      service = undefined;
      const session = await Bun.file(path.join(root, "session.json")).json();
      expect(session.settings.viewingCameraId).toBe("camera_9");
    } finally {
      loads.mockRestore();
      await service?.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 90_000);
}

test("restart completes the job summary after its authored scene save, and preserves undo", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "image-to-world-recover-"));
  let service: Awaited<ReturnType<typeof createService>> | undefined;
  try {
    service = await createService(root);
    const id = await service.jobs.submit({ kind: "capture" });
    const save = spyOn(JobFiles.prototype, "save").mockRejectedValueOnce(
      new Error("interrupted job write"),
    );
    try {
      await expect(
        service.store.update((s) => {
          applyCommand(s, {
            type: "nodes.put",
            nodes: [
              {
                id: "result",
                name: "Result",
                kind: "group",
                parentId: null,
                visible: true,
                transform: identity(),
              },
            ],
          });
          s.resultApplications[id] = ["complete"];
          s.jobs[id].applied = true;
          s.jobs[id].status = "succeeded";
        }),
      ).rejects.toThrow("interrupted job write");
    } finally {
      save.mockRestore();
    }
    await service.close();
    service = await createService(root);
    expect(service.store.current.nodes.result).toBeDefined();
    expect(service.store.current.jobs[id].applied).toBe(true);
    await service.store.updateScene((s) =>
      applyCommand(s, { type: "history.undo" }),
    );
    expect(service.store.current.nodes.result).toBeUndefined();
    expect(service.store.current.resultApplications[id]).toEqual(["complete"]);
  } finally {
    await service?.close();
    await rm(root, { recursive: true, force: true });
  }
});
