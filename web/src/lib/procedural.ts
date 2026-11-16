import * as THREE from "three";
import * as spark from "@sparkjsdev/spark";
import { assetUrl, type SceneNode, type Asset } from "../../../core/schema";
import type { SceneModule } from "../../../core/module-contract";
import { disposeObject } from "./resources";
import { geometrySpatial, type NodeSpatial } from "./spatial";

export function randomSource(seed: number) {
  let value = seed | 0;
  return () => {
    value = (value + 0x6d2b79f5) | 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Project-authored modules run as trusted browser code, sharing the host engine.
export async function createProcedural(
  node: SceneNode,
  assets: Record<string, Asset>,
  signal: AbortSignal,
) {
  const p = node.procedural;
  if (!p?.enabled) return;
  const bundle = assets[p.bundleAssetId];
  if (!bundle || bundle.missing)
    throw new Error("Procedural bundle is unavailable");
  const response = await fetch(assetUrl(bundle), { signal });
  if (!response.ok) throw new Error("Could not load procedural bundle");
  const url = URL.createObjectURL(
    new Blob([await response.text()], { type: "text/javascript" }),
  );
  Object.assign(globalThis, { __imageToWorldModuleHost: { THREE, spark } });
  let definition: SceneModule;
  try {
    definition = (await import(/* @vite-ignore */ url)).default;
  } finally {
    URL.revokeObjectURL(url);
  }
  signal.throwIfAborted();
  if (!definition || typeof definition.create !== "function")
    throw new Error("Module must default-export { create(context) }");
  const instance = await definition.create({
    THREE,
    spark,
    params: { ...p.parameters },
    signal,
    random: randomSource(p.seed),
    assetUrl(id) {
      if (!p.assetIds.includes(id))
        throw new Error(`Declare module asset dependency ${id}`);
      const asset = assets[id];
      if (!asset || asset.missing)
        throw new Error(`Module asset unavailable: ${id}`);
      return assetUrl(asset);
    },
  });
  if (!(instance?.object instanceof THREE.Object3D))
    throw new Error(
      "Module must return a host THREE.Object3D (use context.THREE)",
    );
  if (signal.aborted) {
    try {
      instance.dispose?.();
    } finally {
      disposeObject(instance.object);
    }
    signal.throwIfAborted();
  }
  instance.object.traverse((child) => {
    if (child instanceof spark.SplatMesh)
      child.userData.localBounds = () => child.getBoundingBox();
  });
  const spatial: NodeSpatial = instance.bounds
    ? { object: instance.object, getBounds: () => instance.bounds!() }
    : geometrySpatial(instance.object);
  return { ...instance, spatial };
}
