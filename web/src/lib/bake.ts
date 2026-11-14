import {
  Group,
  Mesh,
  ShaderMaterial,
  Quaternion,
  Vector3,
  type Object3D,
} from "three";
import { SplatMesh } from "@sparkjsdev/spark";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { uniformScale } from "../../../core/cameras";
import type { SceneGraph } from "./scene";

function base64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
/** Bake evaluated content at a fixed time; code remains available in project exports. */
export async function bakeScene(graph: SceneGraph) {
  const meshes = new Group(),
    rows: number[][] = [],
    omitted: Array<{ nodeId: string; reason: string }> = [];
  graph.scene.updateMatrixWorld(true);
  for (const [id, entry] of graph.entries) {
    if (!entry.content || !entry.content.visible) continue;
    let visible = true;
    for (
      let parent: Object3D | null = entry.root;
      parent;
      parent = parent.parent
    )
      if (!parent.visible) visible = false;
    if (
      !visible ||
      ["clip", "path", "camera"].includes(entry.node.kind) ||
      (entry.node.kind === "image" &&
        (!entry.node.imageSurface ||
          entry.node.imageSurface.mode === "reference"))
    )
      continue;
    const removed: Array<{
      object: Object3D;
      parent: Object3D;
      index: number;
    }> = [];
    let meshCount = 0;
    const splats: SplatMesh[] = [];
    entry.content.traverse((object) => {
      if (object instanceof SplatMesh) splats.push(object);
    });
    for (const object of splats) {
      try {
        const scale = uniformScale(object.matrixWorld),
          rotation = new Quaternion();
        object.matrixWorld.decompose(new Vector3(), rotation, new Vector3());
        if (object.objectModifier || object.worldModifier)
          throw new Error("Splat shader modifiers require the live runtime");
        object.forEachSplat(
          (_index, center, sizes, orientation, opacity, color) => {
            const p = center.clone().applyMatrix4(object.matrixWorld),
              q = rotation.clone().multiply(orientation),
              s = sizes.clone().multiplyScalar(scale);
            const sh = 0.28209479177387814,
              alpha = Math.max(1e-6, Math.min(1 - 1e-6, opacity));
            rows.push([
              p.x,
              p.y,
              p.z,
              0,
              0,
              0,
              (color.r - 0.5) / sh,
              (color.g - 0.5) / sh,
              (color.b - 0.5) / sh,
              Math.log(alpha / (1 - alpha)),
              Math.log(Math.max(1e-9, s.x)),
              Math.log(Math.max(1e-9, s.y)),
              Math.log(Math.max(1e-9, s.z)),
              q.w,
              q.x,
              q.y,
              q.z,
            ]);
          },
        );
      } catch (error) {
        omitted.push({ nodeId: id, reason: String(error) });
      }
      if (object.parent) {
        removed.push({
          object,
          parent: object.parent,
          index: object.parent.children.indexOf(object),
        });
        object.removeFromParent();
      }
    }
    try {
      if (entry.content instanceof SplatMesh) continue;
      const copy = clone(entry.content);
      copy.traverse((object) => {
        if (object instanceof Mesh) {
          const materials = Array.isArray(object.material)
            ? object.material
            : [object.material];
          if (materials.some((m) => m instanceof ShaderMaterial)) {
            object.visible = false;
            omitted.push({
              nodeId: id,
              reason: "Custom shader material needs the live runtime",
            });
          } else meshCount++;
        }
      });
      if (meshCount) {
        copy.updateMatrix();
        copy.matrix.premultiply(entry.root.matrixWorld);
        copy.matrixAutoUpdate = false;
        copy.name = entry.node.name;
        meshes.add(copy);
      }
    } finally {
      for (const { object, parent, index } of removed) {
        parent.add(object);
        const at = parent.children.indexOf(object);
        parent.children.splice(at, 1);
        parent.children.splice(index, 0, object);
      }
    }
  }
  const outputs: Record<string, string> = {};
  if (meshes.children.length) {
    const result = await new GLTFExporter().parseAsync(meshes, {
      binary: true,
      onlyVisible: true,
    });
    if (!(result instanceof ArrayBuffer)) throw new Error("GLB export failed");
    outputs.mesh = base64(new Uint8Array(result));
  }
  if (rows.length) {
    const fields = [
      "x",
      "y",
      "z",
      "nx",
      "ny",
      "nz",
      "f_dc_0",
      "f_dc_1",
      "f_dc_2",
      "opacity",
      "scale_0",
      "scale_1",
      "scale_2",
      "rot_0",
      "rot_1",
      "rot_2",
      "rot_3",
    ];
    const header = new TextEncoder().encode(
      `ply\nformat binary_little_endian 1.0\nelement vertex ${rows.length}\n${fields.map((f) => `property float ${f}`).join("\n")}\nend_header\n`,
    );
    const bytes = new Uint8Array(
      header.length + rows.length * fields.length * 4,
    );
    bytes.set(header);
    const view = new DataView(bytes.buffer);
    let offset = header.length;
    for (const row of rows)
      for (const value of row) {
        view.setFloat32(offset, value, true);
        offset += 4;
      }
    outputs.splats = base64(bytes);
  }
  return {
    outputs,
    omitted,
    splatCount: rows.length,
    meshObjects: meshes.children.length,
  };
}
