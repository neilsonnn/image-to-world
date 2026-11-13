import { imageReplacementCommands } from "./images";
import { expect, test } from "bun:test";
import { createCapture } from "./captures";
import { applyCommand } from "./commands";
import {
  applyJobResult,
  claimResultTargets,
  resultTarget,
} from "./result-targets";
import {
  assetSchema,
  emptyWorkspace,
  jobSchema,
  workspaceSchema,
  type Job,
  type Workspace,
} from "./schema";

function fixture() {
  const state = emptyWorkspace();
  state.assets.source = assetSchema.parse({
    id: "source",
    name: "Source",
    path: "source.png",
    kind: "image",
    mimeType: "image/png",
    size: 1,
    modifiedAt: 0,
  });
  for (const id of ["manual", "older", "newer"])
    state.assets[id] = { ...state.assets.source, id, parentAssetId: "source" };
  applyCommand(state, {
    type: "nodes.put",
    nodes: createCapture(state.assets.source, "view"),
  });
  const submit = (id: string, nodeIds = ["view"]) => {
    const job = jobSchema.parse({
      id,
      input: { kind: "nano", sourceAssetId: "source", prompt: id },
      status: "running",
      createdAt: 0,
      updatedAt: 0,
      message: "",
      outputAssetIds: [id],
      applyTargets: nodeIds.map((id) => resultTarget(state, id)),
      applyRoots: ["source"],
    });
    state.jobs[id] = job;
    claimResultTargets(state, job);
    return job;
  };
  return { state, submit };
}

function finish(state: Workspace, job: Job, assetId = job.id) {
  return applyJobResult(state, job, (targets, roots) =>
    imageReplacementCommands(
      state,
      assetId,
      targets.map((target) => target.nodeId),
      roots.includes("source"),
    ),
  );
}

test("newest submission overwrites manual history, old completions cannot win, and undo survives reload", () => {
  const { state, submit } = fixture();
  const older = submit("older");
  const newer = submit("newer");
  applyCommand(state, { type: "image.activate", assetId: "manual" });
  const reopened = workspaceSchema.parse(JSON.parse(JSON.stringify(state)));
  expect(finish(reopened, newer)).toBe(true);
  expect(finish(reopened, older)).toBe(false);
  expect(reopened.nodes.view_points.assetId).toBe("newer");
  expect(reopened.assets.older).toBeDefined();
  applyCommand(reopened, { type: "history.undo" });
  expect(reopened.nodes.view_points.assetId).toBe("manual");
  expect(finish(reopened, newer)).toBe(false);
  expect(reopened.nodes.view_points.assetId).toBe("manual");
  applyCommand(reopened, { type: "history.redo" });
  expect(reopened.nodes.view_points.assetId).toBe("newer");
});

for (const status of ["cancelled", "failed"] as const)
  test(`a ${status} newest job does not hand ownership back to an older job`, () => {
    const { state, submit } = fixture();
    const older = submit("older");
    const newer = submit("newer");
    state.jobs[newer.id].status = status;
    expect(finish(state, older)).toBe(false);
    expect(state.nodes.view.assetId).toBe("source");
  });

for (const replace of [false, true])
  test(`${replace ? "replacing" : "deleting"} a target child keeps outputs but reports an application error`, () => {
    const { state, submit } = fixture();
    const job = submit("newer");
    const points = state.nodes.view_points;
    applyCommand(state, { type: "nodes.remove", ids: [points.id] });
    if (replace)
      applyCommand(state, {
        type: "nodes.put",
        nodes: [{ ...points, id: "replacement" }],
      });
    const before = structuredClone(state.nodes);
    expect(finish(state, job)).toBe(true);
    expect(state.jobs[job.id].applicationError).toMatch(
      /missing points|components changed/,
    );
    expect(state.nodes).toEqual(before);
    expect(state.imageVersions.source).toBe("newer");
    expect(state.jobs[job.id].appliedTargets).toEqual([]);
    expect(state.assets.newer).toBeDefined();
  });

test("a reconstruction child cannot supersede a newer user submission", () => {
  const { state, submit } = fixture();
  const older = submit("older");
  finish(state, older);
  const newer = submit("newer");
  const child = jobSchema.parse({
    ...older,
    id: "depth-job",
    resultOwnerId: older.id,
    applied: false,
    appliedTargets: [],
  });
  state.jobs[child.id] = child;
  expect(finish(state, child, "older")).toBe(false);
  expect(state.resultOwners["node:view"]).toBe(newer.id);
});

test("newest results replace changed image bindings without redirecting to different children", () => {
  const { state, submit } = fixture();
  const job = submit("newer");
  state.assets.unrelated = { ...state.assets.source, id: "unrelated" };
  applyCommand(state, {
    type: "nodes.put",
    nodes: ["view", "view_image", "view_points"].map((id) => ({
      ...state.nodes[id],
      assetId: "unrelated",
    })),
  });
  expect(finish(state, job)).toBe(true);
  expect(state.nodes.view_points.assetId).toBe("newer");
  applyCommand(state, { type: "history.undo" });
  expect(state.nodes.view_points.assetId).toBe("unrelated");
});

test("a broken destination does not block healthy siblings or history activation, and the batch remains undoable", () => {
  const { state, submit } = fixture();
  applyCommand(state, {
    type: "nodes.put",
    nodes: createCapture(state.assets.source, "sibling"),
  });
  const job = submit("newer", ["view", "sibling"]);
  applyCommand(state, { type: "nodes.remove", ids: ["view_points"] });
  expect(finish(state, job)).toBe(true);
  expect(state.nodes.sibling_image.assetId).toBe("newer");
  expect(state.nodes.view_image.assetId).toBe("source");
  expect(state.nodes.view_points).toBeUndefined();
  expect(state.imageVersions.source).toBe("newer");
  expect(state.jobs.newer.appliedTargets).toEqual(["sibling"]);
  expect(state.jobs.newer.applicationError).toContain("view:");
  applyCommand(state, { type: "history.undo" });
  expect(state.nodes.sibling_image.assetId).toBe("source");
  expect(state.imageVersions.source).toBeUndefined();
  expect(state.nodes.view_points).toBeUndefined();
  expect(finish(state, job)).toBe(false);
  applyCommand(state, { type: "history.redo" });
  expect(state.nodes.sibling_image.assetId).toBe("newer");
});
