import {
  BoundingBox,
  CrosshairSimple,
  Cube,
  Globe,
} from "@phosphor-icons/react";
import { ToolbarSelect, type ToolbarSelectOption } from "./ui";
import type { GizmoSpace, PivotPlacement } from "../../../core/gizmo";

const placements: Record<PivotPlacement, ToolbarSelectOption> = {
  center: {
    label: "Center",
    icon: <BoundingBox size={14} />,
    hint: "Position the gizmo at the center of the selection's combined bounds.",
  },
  origin: {
    label: "Origin",
    icon: <CrosshairSimple size={14} />,
    hint: "Position the gizmo at the object's origin. For multiple objects, use the average of their origins.",
  },
};
const spaces: Record<GizmoSpace, ToolbarSelectOption> = {
  world: {
    label: "World",
    icon: <Globe size={14} />,
    hint: "Align the gizmo to world axes.",
  },
  object: {
    label: "Object",
    icon: <Cube size={14} />,
    hint: "Align the gizmo to the primary selected object's axes.",
  },
};

export function GizmoOptions({
  placement,
  space,
  onPlacement,
  onSpace,
}: {
  placement: PivotPlacement;
  space: GizmoSpace;
  onPlacement: (value: PivotPlacement) => void;
  onSpace: (value: GizmoSpace) => void;
}) {
  return (
    <>
      <ToolbarSelect
        label="Gizmo position"
        value={placement}
        options={placements}
        onChange={onPlacement}
      />
      <ToolbarSelect
        label="Gizmo axes"
        value={space}
        options={spaces}
        onChange={onSpace}
      />
    </>
  );
}
