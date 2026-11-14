import type { SceneNode } from "./schema";

export type TransformCapabilities = {
  translate: boolean;
  rotate: boolean;
  scale: boolean;
  uniformScale?: boolean;
};

const transformOverrides: Partial<
  Record<SceneNode["kind"], Partial<TransformCapabilities>>
> = {
  camera: { scale: false },
  capture: { scale: false },
  light: { scale: false },
  splat: { uniformScale: true },
  procedural: { uniformScale: true },
};

export function transformCapabilities(nodes: readonly SceneNode[]) {
  const supported: TransformCapabilities = {
    translate: true,
    rotate: true,
    scale: true,
  };
  for (const node of nodes) {
    const overrides = transformOverrides[node.kind];
    if (overrides?.uniformScale) supported.uniformScale = true;
    for (const mode of ["translate", "rotate", "scale"] as const)
      supported[mode] &&=
        (overrides?.[mode] ?? true) &&
        (node.transformPermissions?.[mode] ?? true);
  }
  return supported;
}
