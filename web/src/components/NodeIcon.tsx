import {
  Code,
  BoundingBox,
  Camera,
  Cube,
  DotsNine,
  File,
  FrameCorners,
  ImageSquare,
  Path,
  Stack,
  StackSimple,
  VideoCamera,
  type Icon,
} from "@phosphor-icons/react";
import type { Asset, SceneNode } from "../../../core/schema";
import { Hint } from "./ui";

type Kind = SceneNode["kind"] | Asset["kind"];
export const nodePresentation = {
  capture: { label: "Frame", icon: FrameCorners },
  camera: { label: "Camera", icon: Camera },
  points: { label: "Points", icon: DotsNine },
  clip: { label: "Clip", icon: BoundingBox },
  image: { label: "Image", icon: ImageSquare },
  mesh: { label: "Mesh", icon: Cube },
  splat: { label: "Splat", icon: Cube },
  path: { label: "Path", icon: Path },
  video: { label: "Video", icon: VideoCamera },
  procedural: { label: "Procedural code", icon: Code },
  group: { label: "Group", icon: Stack },
  depth: { label: "Depth", icon: StackSimple },
  file: { label: "File", icon: File },
} satisfies Record<Kind, { label: string; icon: Icon }>;

export function NodeIcon({ kind }: { kind: Kind }) {
  const { icon: Icon, label } = nodePresentation[kind];
  return (
    <Hint label={label}>
      <Icon aria-label={label} className="node-icon" data-node-kind={kind} />
    </Hint>
  );
}
