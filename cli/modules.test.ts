import { test, expect } from "bun:test";
import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { compileModule } from "./modules";
import { moduleEngine } from "../core/module-engine";

test("module compiler bundles local sources and addons while sharing the host Three instance", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "image-to-world-module-"));
  try {
    const file = path.join(folder, "entry.ts");
    await writeFile(path.join(folder, "shape.ts"), "export const size = 2;");
    await writeFile(
      file,
      `import { Mesh, BoxGeometry } from 'three';
import { MeshStandardNodeMaterial, TSL } from 'three/webgpu';
import { mix, color, positionLocal } from 'three/tsl';
import { defineSceneModule } from 'image-to-world/runtime';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { size } from './shape';
export default defineSceneModule({create(){
  const material = new MeshStandardNodeMaterial();
  material.colorNode = mix(color(0x602a16), color(0xf7c690), positionLocal.y);
  return {object: new Mesh(mergeGeometries([new BoxGeometry(size,size,size)]), material), importedNode: TSL.positionLocal};
}});`,
    );
    const result = await compileModule(file);
    expect(result.sources.size).toBe(2);
    expect(
      result.sources.has(await realpath(path.join(folder, "shape.ts"))),
    ).toBe(true);
    Object.assign(globalThis, {
      __imageToWorldModuleHost: moduleEngine,
    });
    const output = path.join(folder, "built.mjs");
    await writeFile(output, result.code);
    const built = await import(output);
    const instance = built.default.create();
    expect(instance.object).toBeInstanceOf(moduleEngine.THREE.Mesh);
    expect(instance.object.material).toBeInstanceOf(
      moduleEngine.webgpu.MeshStandardNodeMaterial,
    );
    expect(instance.object.material.colorNode).toBeInstanceOf(
      moduleEngine.webgpu.Node,
    );
    expect(instance.importedNode).toBe(moduleEngine.tsl.positionLocal);
    instance.object.geometry.computeBoundingBox();
    expect(instance.object.geometry.boundingBox.max.x).toBe(1);
    instance.object.geometry.dispose();
    instance.object.material.dispose();
  } finally {
    await rm(folder, { force: true, recursive: true });
  }
});
