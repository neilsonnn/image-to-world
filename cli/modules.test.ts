import { test, expect } from "bun:test";
import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { compileModule } from "./modules";

test("module compiler bundles local sources and addons while sharing the host Three instance", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "image-to-world-module-"));
  try {
    const file = path.join(folder, "entry.ts");
    await writeFile(path.join(folder, "shape.ts"), "export const size = 2;");
    await writeFile(
      file,
      `import { Mesh, BoxGeometry, MeshBasicMaterial } from 'three';
import { defineSceneModule } from 'image-to-world/runtime';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { size } from './shape';
export default defineSceneModule({create(){return {object: new Mesh(mergeGeometries([new BoxGeometry(size,size,size)]), new MeshBasicMaterial())}}});`,
    );
    const result = await compileModule(file);
    expect(
      result.sources.has(await realpath(path.join(folder, "shape.ts"))),
    ).toBe(true);
    const THREE = await import("three");
    Object.assign(globalThis, {
      __imageToWorldModuleHost: { THREE, spark: {} },
    });
    const output = path.join(folder, "built.mjs");
    await writeFile(output, result.code);
    const built = await import(output);
    const instance = built.default.create();
    expect(instance.object).toBeInstanceOf(THREE.Mesh);
    instance.object.geometry.computeBoundingBox();
    expect(instance.object.geometry.boundingBox.max.x).toBe(1);
    instance.object.geometry.dispose();
    instance.object.material.dispose();
  } finally {
    await rm(folder, { force: true, recursive: true });
  }
});
