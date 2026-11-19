import type * as THREE from "three";
import type { moduleEngine } from "./module-engine";
import type { ModulePhysics } from "./physics";
export type { ModulePhysics, PhysicsBody, PhysicsJoint } from "./physics";
import type { ModuleParameters } from "./procedural";
import type { WebGPURenderer } from "three/webgpu";
export type ModuleGPU = {
  readonly backend: "webgpu" | "webgl2" | null;
  /** Submit TSL kernels to the node's renderer before its next draw. */
  compute: (...args: Parameters<WebGPURenderer["compute"]>) => void;
};
export type SceneModuleContext = typeof moduleEngine & {
  gpu: ModuleGPU;
  params: ModuleParameters;
  signal: AbortSignal;
  random: () => number;
  assetUrl: (id: string) => string;
};
export type SceneModuleInstance = {
  object: THREE.Object3D;
  /** Play Mode bodies reference this instance's objects. Optional detached
   * shape trees supply collider geometry in their owning object's space. */
  physics?: ModulePhysics;
  sample?: (input: { time: number; camera?: THREE.Camera }) => void;
  bounds?: () => THREE.Box3;
  dispose?: () => void;
};
export type SceneModule = {
  create: (
    ctx: SceneModuleContext,
  ) => SceneModuleInstance | Promise<SceneModuleInstance>;
};
export const defineSceneModule = <T extends SceneModule>(definition: T) =>
  definition;
