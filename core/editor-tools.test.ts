import { expect, test } from "bun:test";
import { Box3, Matrix4, Quaternion, Vector3 } from "three";
import { applyCommand } from "./commands";
import { transformNodes, worldMatrix } from "./cameras";
import { createCapture, sceneCamera } from "./captures";
import { selectionPivot } from "./gizmo";
import { selectedImageOperation } from "./image-operation";
import { transformCapabilities } from "./node-capabilities";
import { assetSchema, emptyWorkspace, jobSchema, nodeSchema } from "./schema";

function fixture() {
  const state = emptyWorkspace();
  for (const node of createCapture({ name: "Pending Frame" }, "frame"))
    state.nodes[node.id] = node;
  state.selection = ["frame"];
  state.primaryId = "frame";
  state.jobs.image = jobSchema.parse({
    id: "image",
    input: {
      kind: "image",
      prompt: "Lab",
      placement: state.settings.viewportCamera,
    },
    status: "queued",
    createdAt: 1,
    updatedAt: 1,
    message: "Generating image",
    outputAssetIds: [],
  });
  state.resultOwners["node:frame"] = "image";
  return state;
}

test("selected Frame follows current ownership through image and posing, binding changes, failures and cancellation", () => {
  const state = fixture();
  expect(selectedImageOperation(state)).toMatchObject({
    id: "frame",
    assetId: null,
    pending: true,
    jobId: "image",
  });
  state.jobs.image.status = "succeeded";
  state.jobs.image.childJobId = "pose";
  state.jobs.pose = jobSchema.parse({
    id: "pose",
    input: { kind: "pose", assetIds: ["rgb"] },
    status: "running",
    createdAt: 2,
    updatedAt: 2,
    message: "Posing image",
    outputAssetIds: [],
    resultOwnerId: "image",
  });
  state.assets.rgb = assetSchema.parse({
    id: "rgb",
    name: "Image",
    path: "image.png",
    kind: "image",
    mimeType: "image/png",
    size: 1,
    modifiedAt: 1,
  });
  // Only the participating image's binding is authoritative.
  state.nodes.frame_image.assetId = "rgb";
  state.primaryId = "frame_camera";
  expect(selectedImageOperation(state)).toMatchObject({
    assetId: "rgb",
    pending: true,
    jobId: "pose",
  });
  state.jobs.pose.status = "failed";
  state.jobs.pose.error = "Depth failed";
  expect(selectedImageOperation(state)).toMatchObject({
    pending: false,
    error: "Depth failed",
  });
  state.jobs.pose.status = "cancelled";
  expect(selectedImageOperation(state)?.pending).toBe(false);
  state.jobs.newer = {
    ...state.jobs.image,
    id: "newer",
    status: "running",
    childJobId: undefined,
  };
  state.resultOwners["node:frame"] = "newer";
  expect(selectedImageOperation(state)).toMatchObject({
    jobId: "newer",
    pending: true,
  });
  state.jobs.newer.status = "succeeded";
  expect(selectedImageOperation(state)?.pending).toBe(false);
  delete state.nodes.frame_image;
  expect(selectedImageOperation(state)?.assetId).toBeNull();
  expect(selectedImageOperation(state)?.error).toBeTruthy();
  state.selection = [];
  state.primaryId = null;
  expect(selectedImageOperation(state)).toBeNull();
});

test("Frame scale restrictions and per-node permissions agree with commands and preserve reparenting", () => {
  const state = fixture();
  const frame = state.nodes.frame;
  expect(transformCapabilities([frame]).scale).toBe(false);
  const other = nodeSchema.parse({
    id: "other",
    name: "Other",
    kind: "group",
    transformPermissions: { rotate: false },
  });
  applyCommand(state, { type: "nodes.put", nodes: [other] });
  expect(transformCapabilities([frame, other])).toEqual({
    translate: true,
    rotate: false,
    scale: false,
  });
  expect(() =>
    applyCommand(state, {
      type: "nodes.put",
      nodes: [
        { ...frame, transform: { ...frame.transform, scale: [2, 2, 2] } },
      ],
    }),
  ).toThrow("does not support scaling");
  expect(() =>
    applyCommand(state, {
      type: "nodes.put",
      nodes: [
        {
          ...other,
          transform: { ...other.transform, quaternion: [0, 1, 0, 0] },
        },
      ],
    }),
  ).toThrow("does not support rotation");
  const cameraBefore = sceneCamera(state, "frame")!;
  applyCommand(state, {
    type: "nodes.put",
    nodes: [
      nodeSchema.parse({
        id: "parent",
        name: "Parent",
        kind: "group",
        transform: {
          position: [4, 2, 1],
          quaternion: [0, 0, 0, 1],
          scale: [2, 2, 2],
        },
      }),
    ],
  });
  applyCommand(state, {
    type: "nodes.move",
    ids: ["frame"],
    parentId: "parent",
  });
  expect(state.nodes.frame.transform.scale).toEqual([0.5, 0.5, 0.5]);
  expect(sceneCamera(state, "frame")!.extrinsics.position).toEqual(
    cameraBefore.extrinsics.position,
  );
});

test("center/origin and world/object pivots use shared world transforms under scaled rotated parents", () => {
  const state = emptyWorkspace();
  state.nodes.parent = nodeSchema.parse({
    id: "parent",
    name: "Parent",
    kind: "group",
    transform: {
      position: [4, 2, -3],
      quaternion: new Quaternion()
        .setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 3)
        .toArray(),
      scale: [2, 2, 2],
    },
  });
  for (const [id, x] of [
    ["a", -2],
    ["b", 4],
  ] as const)
    state.nodes[id] = nodeSchema.parse({
      id,
      name: id,
      kind: "group",
      parentId: "parent",
      transform: {
        position: [x, 1, 0],
        quaternion: [0, 0, 0, 1],
        scale: [1, 1, 1],
      },
    });
  const ids = ["a", "b"];
  const bounds = new Box3(new Vector3(-8, -2, -4), new Vector3(2, 6, 8));
  const center = selectionPivot(
    state.nodes,
    ids,
    "b",
    "center",
    "world",
    bounds,
  );
  expect(center.position.toArray()).toEqual([-3, 2, 2]);
  expect(center.quaternion.toArray()).toEqual([0, 0, 0, 1]);
  const origin = selectionPivot(
    state.nodes,
    ids,
    "b",
    "origin",
    "object",
    bounds,
  );
  const average = new Vector3()
    .setFromMatrixPosition(worldMatrix(state.nodes.a, state.nodes))
    .add(
      new Vector3().setFromMatrixPosition(
        worldMatrix(state.nodes.b, state.nodes),
      ),
    )
    .multiplyScalar(0.5);
  expect(origin.position.distanceTo(average)).toBeLessThan(1e-8);
  expect(
    origin.quaternion.angleTo(
      new Quaternion().fromArray(state.nodes.parent.transform.quaternion),
    ),
  ).toBeLessThan(1e-7);
  // Rotate a multi-selection around its shared bounds center, retaining local/world agreement.
  const start = new Matrix4().compose(
    center.position,
    center.quaternion,
    new Vector3(1, 1, 1),
  );
  const end = new Matrix4().compose(
    center.position,
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.4),
    new Vector3(1, 1, 1),
  );
  const delta = end.multiply(start.invert());
  const before = structuredClone(state.nodes);
  applyCommand(state, {
    type: "nodes.put",
    nodes: transformNodes(state.nodes, ids, delta),
  });
  for (const id of ids) {
    const expected = delta.clone().multiply(worldMatrix(before[id], before));
    worldMatrix(state.nodes[id], state.nodes).elements.forEach((value, i) =>
      expect(value).toBeCloseTo(expected.elements[i]),
    );
  }
  applyCommand(state, { type: "history.undo" });
  expect(state.nodes).toEqual(before);
  applyCommand(state, { type: "history.redo" });
  expect(state.nodes.a.transform).not.toEqual(before.a.transform);
});
