import { moduleEngine } from "../../../core/module-engine";
import { assetUrl, type SceneNode, type Asset } from "../../../core/schema";
import type {
  ModuleGPU,
  SceneModule,
  SceneModuleInstance,
} from "../../../core/module-contract";
import type { ComputeNode, WebGPURenderer } from "three/webgpu";
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

type ComputeRenderer = Pick<
  WebGPURenderer,
  "initialized" | "coordinateSystem" | "compute"
>;
export type ModuleRenderer = () => ComputeRenderer | Promise<ComputeRenderer>;

function moduleGPU(renderer: ComputeRenderer | undefined, signal: AbortSignal) {
  const kernels = new Set<ComputeNode>();
  let active = true;
  const dispose = () => {
    active = false;
    signal.removeEventListener("abort", dispose);
    for (const kernel of kernels) kernel.dispose();
    kernels.clear();
  };
  signal.addEventListener("abort", dispose, { once: true });
  const gpu: ModuleGPU = {
    backend: !renderer
      ? null
      : renderer.coordinateSystem === moduleEngine.THREE.WebGPUCoordinateSystem
        ? "webgpu"
        : "webgl2",
    compute(nodes, dispatchSize) {
      signal.throwIfAborted();
      if (!active || !renderer?.initialized)
        throw new Error(
          "Module compute needs its active, initialized renderer",
        );
      const list = Array.isArray(nodes) ? nodes : [nodes];
      if (
        !list.length ||
        list.some((node) => !(node instanceof moduleEngine.webgpu.ComputeNode))
      )
        throw new Error(
          "Module compute expects one or more host TSL compute nodes",
        );
      for (const node of list) kernels.add(node);
      // On an initialized Three renderer dispatch is synchronous; failures
      // propagate through the existing create/sample error handlers.
      renderer.compute(nodes, dispatchSize);
    },
  };
  return { gpu, dispose };
}

// Project-authored modules run as trusted browser code, sharing the host engine.
export async function createProcedural(
  node: SceneNode,
  assets: Record<string, Asset>,
  signal: AbortSignal,
  renderer?: ModuleRenderer,
  locateAsset: (asset: Asset) => string = assetUrl,
) {
  const p = node.procedural;
  if (!p?.enabled) return;
  const bundle = assets[p.bundleAssetId];
  if (!bundle || bundle.missing)
    throw new Error("Procedural bundle is unavailable");
  const response = await fetch(locateAsset(bundle), { signal });
  if (!response.ok) throw new Error("Could not load procedural bundle");
  const url = URL.createObjectURL(
    new Blob([await response.text()], { type: "text/javascript" }),
  );
  Object.assign(globalThis, { __imageToWorldModuleHost: moduleEngine });
  let definition: SceneModule;
  try {
    definition = (await import(/* @vite-ignore */ url)).default;
  } finally {
    URL.revokeObjectURL(url);
  }
  const readyRenderer = await renderer?.();
  signal.throwIfAborted();
  if (!definition || typeof definition.create !== "function")
    throw new Error("Module must default-export { create(context) }");
  const scope = moduleGPU(readyRenderer, signal);
  let instance: SceneModuleInstance;
  try {
    instance = await definition.create({
      ...moduleEngine,
      gpu: scope.gpu,
      params: structuredClone(p.parameters),
      signal,
      random: randomSource(p.seed),
      assetUrl(id) {
        if (!p.assetIds.includes(id))
          throw new Error(`Declare module asset dependency ${id}`);
        const asset = assets[id];
        if (!asset || asset.missing)
          throw new Error(`Module asset unavailable: ${id}`);
        return locateAsset(asset);
      },
    });
    if (!(instance?.object instanceof moduleEngine.THREE.Object3D))
      throw new Error(
        "Module must return a host THREE.Object3D (use context.THREE)",
      );
  } catch (error) {
    scope.dispose();
    throw error;
  }
  if (signal.aborted) {
    try {
      instance.dispose?.();
    } finally {
      disposeObject(instance.object);
    }
    signal.throwIfAborted();
  }
  instance.object.traverse((child) => {
    if (child instanceof moduleEngine.spark.SplatMesh)
      child.userData.localBounds = () => child.getBoundingBox();
  });
  const spatial: NodeSpatial = instance.bounds
    ? { object: instance.object, getBounds: () => instance.bounds!() }
    : geometrySpatial(instance.object);
  return {
    ...instance,
    spatial,
    dispose() {
      try {
        instance.dispose?.();
      } finally {
        scope.dispose();
      }
    },
  };
}
