import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { objectInventory } from "../../../core/object-inventory";
import { CommandService } from "./commands";
import { JobRunner } from "./jobs";
import { WorkspaceStore } from "./store";

test("a shared design reserves one model request across workers and survives restart", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "shared-object-"));
  const oldKey = process.env.FAL_KEY;
  process.env.FAL_KEY = "fixture";
  let submits = 0;
  const network = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request =
          input instanceof Request ? input : new Request(input, init);
        if (
          request.url.startsWith("https://queue.fal.run/") &&
          request.method === "POST"
        ) {
          submits++;
          return Response.json({ request_id: "mock-design" });
        }
        if (request.url.includes("/status?"))
          return Response.json({ status: "COMPLETED" });
        if (request.url.includes("/requests/mock-design"))
          return Response.json({
            game_glb: { url: "https://fixture.example/mesh.bin" },
            another_copy: { url: "https://fixture.example/mesh.bin" },
          });
        if (request.url === "https://fixture.example/mesh.bin")
          return new Response("geometry fixture");
        throw new Error(`Unexpected URL ${request.url}`);
      },
      { preconnect: () => {} },
    ),
  );
  let store = await new WorkspaceStore(root).init();
  let runner = new JobRunner(store);
  try {
    let service = new CommandService(store, runner);
    const command = {
      type: "generation.submit",
      request: {
        kind: "model",
        model: "speridlabs/idol/max",
        buildKey: "attic-lamp",
        input: { image_url: "https://fixture.example/lamp.png" },
      },
    } as const;
    const [a, b] = await Promise.all(
      ["east-shot", "west-shot"].map((actorId) =>
        service.execute(command, { actorId }),
      ),
    );
    expect(a.jobId).toBe(b.jobId);
    await expect(
      service.execute({
        ...command,
        request: { ...command.request, input: { rig: true } },
      }),
    ).rejects.toThrow("different inputs");
    for (
      let attempt = 0;
      attempt < 100 &&
      ["queued", "running"].includes(store.snapshot().jobs[a.jobId!].status);
      attempt++
    )
      await Bun.sleep(30);
    expect(store.snapshot().jobs[a.jobId!].status).toBe("succeeded");
    expect(submits).toBe(1);
    expect(
      objectInventory(store.snapshot()).builds[0].outputs[0].paths,
    ).toEqual(["game_glb", "another_copy"]);
    await runner.close();
    await store.close();
    store = await new WorkspaceStore(root).init();
    runner = new JobRunner(store);
    service = new CommandService(store, runner);
    expect(
      (await service.execute(command, { actorId: "returning-worker" })).jobId,
    ).toBe(a.jobId);
    expect(submits).toBe(1);
  } finally {
    await runner.close();
    await store.close();
    network.mockRestore();
    if (oldKey === undefined) delete process.env.FAL_KEY;
    else process.env.FAL_KEY = oldKey;
    await rm(root, { recursive: true, force: true });
  }
});

test("two independent sets reuse a design but own their own transforms and sightings", async () => {
  const { createCapture } = await import("../../../core/captures");
  const { applyCommand } = await import("../../../core/commands");
  const { emptyWorkspace, identity } = await import("../../../core/schema");
  const state = emptyWorkspace();
  for (const [id, role] of [
    ["chair", "mesh"],
    ["seen-a", "observation"],
    ["seen-b", "observation"],
  ] as const) {
    state.assets[id] = {
      id,
      role,
      kind: role === "mesh" ? "mesh" : "file",
      name: id,
      path: id,
      size: 10,
      modifiedAt: 0,
      mimeType: "application/octet-stream",
      missing: false,
    };
  }
  for (const shot of ["a", "b"]) {
    applyCommand(state, {
      type: "nodes.put",
      nodes: [
        ...createCapture({ name: shot }, shot),
        {
          id: `chair-${shot}`,
          name: "Chair",
          kind: "mesh",
          assetId: "chair",
          parentId: shot,
          observationAssetIds: [`seen-${shot}`],
          visible: true,
          transform: identity(),
        },
      ],
    });
  }
  applyCommand(state, {
    type: "nodes.transform",
    ids: ["a"],
    transform: { position: [3, 0, -2] },
  });
  const { instances } = objectInventory(state);
  expect(
    instances.map((n) => [n.id, n.frameId, n.assetId, n.observationAssetIds]),
  ).toEqual([
    ["chair-a", "a", "chair", ["seen-a"]],
    ["chair-b", "b", "chair", ["seen-b"]],
  ]);
  expect(state.nodes["chair-a"].transform).toEqual(identity());
  expect(state.nodes.b.transform).toEqual(identity());
  expect(() =>
    applyCommand(state, {
      type: "nodes.patch",
      id: "chair-a",
      patch: { observationAssetIds: ["chair"] },
    }),
  ).toThrow("available observation");
});
