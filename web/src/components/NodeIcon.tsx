import { Camera, Cube, Path, Stack, VideoCamera } from "@phosphor-icons/react";
import type { Asset, SceneNode } from "../../../core/schema";

type Kind = SceneNode["kind"] | Asset["kind"];
const icons: Partial<Record<Kind, typeof Camera>> = {
  camera: Camera,
  path: Path,
  video: VideoCamera,
  group: Stack,
};

export function NodeIcon({ kind }: { kind: Kind }) {
  const Icon = icons[kind] ?? Cube;
  return <Icon className="node-icon" data-node-kind={kind} />;
}
