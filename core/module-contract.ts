import type * as THREE from "three";
import type * as spark from "@sparkjsdev/spark";
import type { ParameterField } from "./creation";
export type SceneModuleContext = {
  THREE: typeof THREE;
  spark: typeof spark;
  params: Record<string, string | number | boolean>;
  signal: AbortSignal;
  random: () => number;
  assetUrl: (id: string) => string;
  renderer?: THREE.WebGLRenderer;
};
export type SceneModuleInstance = {
  object: THREE.Object3D;
  sample?: (input: { time: number; camera?: THREE.Camera }) => void;
  bounds?: () => THREE.Box3;
  dispose?: () => void;
};
export type SceneModule = {
  parameters?: Record<string, ParameterField>;
  create: (
    ctx: SceneModuleContext,
  ) => SceneModuleInstance | Promise<SceneModuleInstance>;
};
export const defineSceneModule = <T extends SceneModule>(definition: T) =>
  definition;
