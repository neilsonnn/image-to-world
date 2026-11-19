import type { Camera, Workspace } from "./schema";

/** Renderable scene and initial view. Asset paths resolve beside this JSON file. */
export type PlayerScene = Pick<
  Workspace,
  "name" | "revision" | "nodes" | "assets"
> & {
  version: 1;
  camera: Camera;
  settings: Pick<
    Workspace["settings"],
    "lighting" | "viewingCameraId" | "display" | "pointSize" | "viewportOptions"
  >;
};
