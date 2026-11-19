import { expect, test } from "bun:test";
import { createCapture } from "./captures";
import { referenceComparison, setRenderNodes } from "./reference-comparison";
import {
  assetSchema,
  defaultCamera,
  emptyWorkspace,
  nodeSchema,
} from "./schema";
import { worldMatrix } from "./cameras";

test("set renders isolate only Frame content and retain the world pose of authored descendants", () => {
  const w = emptyWorkspace();
  const image = assetSchema.parse({
    id: "source",
    kind: "image",
    name: "Ref",
    path: "r.png",
    mimeType: "image/png",
    size: 1,
    modifiedAt: 1,
    camera: defaultCamera(),
  });
  w.assets[image.id] = image;
  for (const f of ["a", "b"])
    for (const node of createCapture(image, f)) w.nodes[node.id] = node;
  w.nodes.other = nodeSchema.parse({
    kind: "group",
    id: "other",
    name: "Sibling",
    parentId: "b",
  });
  w.nodes.prefix = nodeSchema.parse({
    id: "prefix",
    kind: "procedural",
    name: "Enclosing scene",
    transform: {
      position: [7, 3, 2],
      scale: [2, 1, 1],
      quaternion: [0, 0, 0, 1],
    },
  });
  w.nodes.a.parentId = "prefix";
  w.nodes.prop = nodeSchema.parse({
    kind: "mesh",
    id: "prop",
    name: "Prop",
    parentId: "a_image",
  });
  w.nodes.a_image.visible = false;
  expect(referenceComparison(w, "a_camera")?.asset.id).toBe("source");
  const filtered = setRenderNodes(w, "a_camera");
  expect(Object.keys(filtered).sort()).toEqual(
    ["prefix", "a", "a_camera", "a_image", "a_points", "prop"].sort(),
  );
  expect(filtered.prefix.kind).toBe("group");
  expect(filtered.a_image.assetId).toBeUndefined();
  expect(filtered.a_points.kind).toBe("group");
  expect(filtered.prop.kind).toBe("mesh");
  expect(
    worldMatrix(w.nodes.prop, w.nodes).equals(
      worldMatrix(filtered.prop, filtered),
    ),
  ).toBe(true);
  expect(w.nodes.a_points.kind).toBe("points");
  expect(() => setRenderNodes(w, "a", ["other"])).toThrow("belong");
});
