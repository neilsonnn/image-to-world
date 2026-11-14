import { disposeObject } from "./resources";
import * as THREE from "three";
import * as spark from "@sparkjsdev/spark";
import {
  primitiveSchema,
  surfaceSchema,
  lightSchema,
  parameterField,
  resolveParameters,
  type ParameterField,
} from "../../../core/creation";
import { assetUrl, type SceneNode, type Asset } from "../../../core/schema";
import { geometrySpatial, type NodeSpatial } from "./spatial";

import type { SceneModule } from "../../../core/module-contract";
export function randomSource(seed: number) {
  let value = seed | 0;
  return () => {
    value |= 0;
    value = (value + 0x6d2b79f5) | 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export async function makeSurface(
  node: SceneNode,
  assets: Record<string, Asset>,
) {
  const s = surfaceSchema.parse(node.surface ?? {});
  const options = {
    color: s.color,
    opacity: s.opacity,
    transparent: s.opacity < 1,
    side: s.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
  };
  const material =
    s.shading === "unlit"
      ? new THREE.MeshBasicMaterial(options)
      : s.shading === "toon"
        ? new THREE.MeshToonMaterial({
            ...options,
            emissive: s.emissive,
            emissiveIntensity: s.emissiveIntensity,
          })
        : new THREE.MeshStandardMaterial({
            ...options,
            roughness: s.roughness,
            metalness: s.metalness,
            emissive: s.emissive,
            emissiveIntensity: s.emissiveIntensity,
          });
  if (s.textureAssetId) {
    const asset = assets[s.textureAssetId];
    if (!asset || asset.missing)
      throw new Error("Material texture is unavailable");
    material.map = await new THREE.TextureLoader().loadAsync(assetUrl(asset));
    material.map.colorSpace = THREE.SRGBColorSpace;
    if (s.nearest) {
      material.map.magFilter = THREE.NearestFilter;
      material.map.minFilter = THREE.NearestFilter;
      material.map.generateMipmaps = false;
    }
    material.needsUpdate = true;
  }
  return material;
}
export async function makePrimitive(
  node: SceneNode,
  assets: Record<string, Asset>,
) {
  const p = primitiveSchema.parse(node.primitive),
    [x, y, z] = p.size;
  const geometry =
    p.shape === "box"
      ? new THREE.BoxGeometry(x, y, z)
      : p.shape === "plane"
        ? new THREE.PlaneGeometry(x, y)
        : p.shape === "sphere"
          ? new THREE.SphereGeometry(0.5, p.segments, p.segments).scale(x, y, z)
          : p.shape === "cylinder"
            ? new THREE.CylinderGeometry(x / 2, x / 2, y, p.segments).scale(
                1,
                1,
                z / x,
              )
            : p.shape === "cone"
              ? new THREE.ConeGeometry(x / 2, y, p.segments).scale(1, 1, z / x)
              : new THREE.CapsuleGeometry(
                  x / 2,
                  Math.max(0, y - x),
                  8,
                  p.segments,
                ).scale(1, 1, z / x);
  const object = new THREE.Mesh(geometry, await makeSurface(node, assets));
  object.castShadow = true;
  object.receiveShadow = true;
  return object;
}
export function makeLight(node: SceneNode) {
  const l = lightSchema.parse(node.light);
  const light =
    l.type === "ambient"
      ? new THREE.AmbientLight(l.color, l.intensity)
      : l.type === "point"
        ? new THREE.PointLight(l.color, l.intensity, l.distance)
        : new THREE.DirectionalLight(l.color, l.intensity);
  if (!(light instanceof THREE.AmbientLight)) {
    light.castShadow = l.shadows;
    light.shadow.mapSize.set(1024, 1024);
    light.shadow.bias = -0.0005;
    if (light instanceof THREE.DirectionalLight) {
      light.target.position.set(0, 0, -1);
      light.add(light.target);
    }
  }
  return light;
}
export function declareSplatBounds(object: THREE.Object3D) {
  object.traverse((child) => {
    if (child instanceof spark.SplatMesh)
      child.userData.localBounds = () => child.getBoundingBox();
  });
}
export async function createProcedural(
  node: SceneNode,
  assets: Record<string, Asset>,
  signal: AbortSignal,
  renderer?: THREE.WebGLRenderer,
) {
  const p = node.procedural;
  if (!p || !p.enabled) return undefined;
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
    throw new Error(
      "Module must default-export { parameters?, create(context) }",
    );
  const fields = Object.fromEntries(
    Object.entries(definition.parameters ?? {}).map(([key, field]) => [
      key,
      parameterField.parse(field),
    ]),
  );
  const params = resolveParameters(fields, p.parameters);
  const allowed = new Set(p.assetIds);
  for (const [key, field] of Object.entries(fields))
    if (field.type === "asset" && typeof params[key] === "string")
      allowed.add(params[key] as string);
  const instance = await definition.create({
    THREE,
    spark,
    params,
    signal,
    renderer,
    random: randomSource(p.seed),
    assetUrl(id) {
      if (!allowed.has(id))
        throw new Error(`Declare module asset dependency ${id}`);
      const asset = assets[id];
      if (!asset || asset.missing)
        throw new Error(`Module asset unavailable: ${id}`);
      return assetUrl(asset);
    },
  });
  if (
    !instance?.object?.isObject3D ||
    !(instance.object instanceof THREE.Object3D)
  )
    throw new Error(
      "Module must return a host THREE.Object3D (use context.THREE)",
    );
  if (signal.aborted) {
    try {
      instance.dispose?.();
    } finally {
      disposeObject(instance.object);
    }
    throw new DOMException("Aborted", "AbortError");
  }
  declareSplatBounds(instance.object);
  const spatial: NodeSpatial = instance.bounds
    ? { object: instance.object, getBounds: instance.bounds }
    : geometrySpatial(instance.object);
  return { ...instance, spatial, fields, params };
}
