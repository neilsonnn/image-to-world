import { expect, test } from "bun:test";
import { AmbientLight, Color, DirectionalLight, Scene } from "three";
import { applyCommand } from "../../../core/commands";
import { lightRigSchema, projectLightSchema } from "../../../core/lighting";
import {
  defaultCamera,
  emptyWorkspace,
  nodeSchema,
} from "../../../core/schema";
import { SceneGraph } from "./scene";

test("view and independent render select the same moving Frame lighting, without changing free-view lighting", () => {
  const w = emptyWorkspace();
  const scene = new Scene();
  const graph = new SceneGraph(scene, () => {}, "#888", "#fff");
  const frame = nodeSchema.parse({
    kind: "capture",
    name: "Studio",
    id: "studio",
    transform: {
      position: [5, 1, -2],
      quaternion: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
      scale: [1, 1, 1],
    },
    lighting: lightRigSchema.parse({
      background: "#230608",
      keyColor: "#ff2211",
      azimuth: 0,
      elevation: 0,
    }),
  });
  const camera = nodeSchema.parse({
    kind: "camera",
    id: "shot",
    name: "Front",
    parentId: frame.id,
    projection: defaultCamera().intrinsics,
  });
  try {
    applyCommand(w, { type: "nodes.put", nodes: [frame, camera] });
    applyCommand(w, {
      type: "workspace.update",
      settings: {
        lighting: projectLightSchema.parse({
          fillIntensity: 0.25,
          background: "#212121",
        }),
      },
    });
    applyCommand(w, { type: "camera.view", nodeId: camera.id });
    graph.sync(w);
    const findKey = () =>
      scene.children.find(
        (child): child is DirectionalLight => child instanceof DirectionalLight,
      )!;
    expect(findKey().color.getHexString()).toBe("ff2211");
    expect((scene.background as Color).getHexString()).toBe("230608");
    expect(findKey().position.x).toBeCloseTo(1);
    expect(findKey().position.z).toBeCloseTo(0);

    graph.sync(w, null);
    expect((scene.background as Color).getHexString()).toBe("212121");
    expect(
      scene.children.find((c) => c instanceof AmbientLight)?.intensity,
    ).toBe(0.25);
    graph.sync(w, frame.id);
    expect(findKey().color.getHexString()).toBe("ff2211");
    expect(w.settings.viewingCameraId).toBe(camera.id);

    applyCommand(w, {
      type: "nodes.patch",
      id: frame.id,
      patch: { lighting: null },
    });
    graph.sync(w);
    expect((scene.background as Color).getHexString()).toBe("212121");
    applyCommand(w, { type: "history.undo" });
    graph.sync(w);
    expect((scene.background as Color).getHexString()).toBe("230608");

    // Match may be adjusted through nested hierarchy or parent rotation at any time.
    applyCommand(w, {
      type: "nodes.transform",
      ids: [frame.id],
      transform: { quaternion: [0, 0, 0, 1] },
    });
    graph.sync(w);
    expect(findKey().position.x).toBeCloseTo(0);
    expect(findKey().position.z).toBeCloseTo(1);
  } finally {
    graph.dispose();
  }
});
