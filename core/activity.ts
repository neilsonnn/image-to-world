import type { Command, JobInput } from "./schema";
export type Operation = { name: string; at: number };
export const jobNames: Record<JobInput["kind"], string> = {
  image: "Create image",
  nano: "Edit image",
  pose: "Pose images",
  reconstruct: "Reconstruct depth",
  atlas: "Render view",
  video: "Render video",
  splats: "Reconstruct splats",
  fal: "Run image model",
  capture: "Capture viewport",
  inspect: "Inspect scene",
  contactSheet: "Create contact sheet",
};
const commandNames: Partial<Record<Command["type"], string>> = {
  "nodes.put": "Edit scene objects",
  "nodes.remove": "Delete scene objects",
  "nodes.move": "Move scene objects",
  "nodes.reparent": "Reparent scene objects",
  "nodes.duplicate": "Duplicate scene objects",
  "selection.set": "Change selection",
  "selection.visibility": "Toggle visibility",
  "camera.place": "Place camera",
  "camera.aim": "Aim camera",
  "camera.view": "View camera",
  "camera.release": "Leave camera view",
  "assets.place": "Place assets",
  "assets.update": "Edit asset",
  "assets.trash": "Trash assets",
  "assets.restore": "Restore assets",
  "assets.reveal": "Reveal asset",
  "history.undo": "Undo",
  "history.redo": "Redo",
  "image.draft": "Edit image annotations",
  "image.activate": "Activate image version",
  "path.fromCameras": "Create camera path",
  "path.keyframe": "Edit path keyframe",
  "path.update": "Edit camera path",
  "environment.configure": "Configure environment",
  "caption.clear": "Clear enhanced caption",
  "frames.integrate": "Integrate frames",
  "jobs.cancel": "Cancel job",
  "jobs.retry": "Retry job",
};
export function operationName(command: Command): string {
  if (command.type === "jobs.submit") return jobNames[command.input.kind];
  if (command.type === "generation.submit")
    return {
      ...jobNames,
      "image.create": jobNames.image,
      "image.edit": jobNames.nano,
      view: jobNames.atlas,
    }[command.request.kind];
  if (command.type === "edit.batch")
    return [...new Set(command.commands.map(operationName))].join(" · ");
  if (command.type === "workspace.update") {
    if (command.settings?.viewportCamera) return "Move viewport";
    if (command.settings?.editor2d) return "Update image editor";
    if (command.settings?.prompt !== undefined) return "Describe scene";
    return "Update workspace settings";
  }
  return commandNames[command.type] ?? command.type;
}
