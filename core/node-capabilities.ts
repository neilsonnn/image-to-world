import type { SceneNode } from "./schema";

export type TransformCapabilities = {
  translate: boolean;
  rotate: boolean;
  scale: boolean;
};

const transformOverrides: Partial<
  Record<SceneNode["kind"], Partial<TransformCapabilities>>
> = {
  camera: { scale: false },
  capture: { scale: false },
};

export function transformCapabilities(nodes: readonly SceneNode[]) {
  const supported: TransformCapabilities = {
    translate: true,
    rotate: true,
    scale: true,
  };
  for (const node of nodes) {
    const overrides = transformOverrides[node.kind];
    for (const mode of Object.keys(
      supported,
    ) as (keyof TransformCapabilities)[])
      supported[mode] &&=
        (overrides?.[mode] ?? true) &&
        (node.transformPermissions?.[mode] ?? true);
  }
  return supported;
}
