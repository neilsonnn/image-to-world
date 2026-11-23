import type { Command, JobInput } from "./schema";
import { z } from "zod";
export const activitySchema = z.object({
  id: z.string(),
  sequence: z.number().int(),
  at: z.number(),
  actorId: z.string(),
  requestId: z.string().optional(),
  jobId: z.string().optional(),
  operation: z.string(),
  name: z.string(),
  phase: z.enum([
    "started",
    "queued",
    "running",
    "succeeded",
    "failed",
    "cancelled",
  ]),
  severity: z.enum(["info", "warning", "error"]),
  detail: z.enum(["summary", "actions", "trace"]),
  nodeIds: z.array(z.string()).default([]),
  assetIds: z.array(z.string()).default([]),
  model: z.string().optional(),
  message: z.string().optional(),
  sceneChange: z
    .object({
      nodeIds: z.array(z.string()),
      position: z.tuple([z.number(), z.number(), z.number()]),
      major: z.boolean(),
    })
    .optional(),
  camera: z
    .object({
      position: z.tuple([z.number(), z.number(), z.number()]),
      quaternion: z.tuple([z.number(), z.number(), z.number(), z.number()]),
      fov: z.number().optional(),
      aspect: z.number().optional(),
    })
    .optional(),
});
export type Activity = z.infer<typeof activitySchema>;
export type ActivityInput = Omit<
  Activity,
  "id" | "sequence" | "at" | "nodeIds" | "assetIds"
> &
  Partial<Pick<Activity, "nodeIds" | "assetIds">>;
export const activityDetails = {
  summary: "Summary",
  actions: "Actions",
  trace: "Trace",
} as const;
export const activitySeverities = {
  info: "Info",
  warning: "Warnings",
  error: "Errors",
} as const;

export function actorColor(actor: string) {
  let hash = 0;
  for (const c of actor) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360} 65% 65%)`;
}

export function activityTargets(command: Command) {
  const nodeIds = new Set<string>(),
    assetIds = new Set<string>();
  const walk = (value: unknown, key = "") => {
    if (typeof value === "string") {
      if (/asset/i.test(key) || value.startsWith("asset_")) assetIds.add(value);
      else if (/node/i.test(key) || value.startsWith("node_"))
        nodeIds.add(value);
    } else if (Array.isArray(value)) value.forEach((v) => walk(v, key));
    else if (value && typeof value === "object")
      for (const [k, v] of Object.entries(value)) {
        if (["prompt", "input", "values", "draft", "settings"].includes(k))
          continue;
        walk(v, k);
      }
  };
  walk(command);
  return { nodeIds: [...nodeIds], assetIds: [...assetIds] };
}
export type Operation = { name: string; at: number };
export const jobNames: Record<JobInput["kind"], string> = {
  render: "Render scene",
  probe: "Capture environment panorama",
  mask: "Compose masks",
  observe: "Observe image region",
  fit: "Fit object to observation",
  image: "Create image",
  nano: "Edit image",
  pose: "Pose images",
  reconstruct: "Reconstruct depth",
  atlas: "Render view",
  video: "Render video",
  splats: "Reconstruct splats",
  fal: "Run model",
  capture: "Capture viewport",
  inspect: "Inspect scene",
  contactSheet: "Create contact sheet",
};
const commandNames: Partial<Record<Command["type"], string>> = {
  "nodes.put": "Edit scene objects",
  "nodes.patch": "Edit object properties",
  "nodes.transform": "Transform scene objects",
  "history.revert": "Revert edit",
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
  "frame.work": "Update Frame activity",
  "atlas.review": "Review Atlas views",
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
      "view.pair": "Generate two Atlas views",
      model: jobNames.fal,
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

/** Collapse lifecycle events before applying expiry, so old running stages cannot reappear. */
export function latestActivities(events: Activity[]) {
  const requests = new Map<string, string>();
  for (const event of events)
    if (event.requestId && event.jobId && !requests.has(event.requestId))
      requests.set(event.requestId, event.jobId);
  const latest = new Map<string, Activity>();
  for (const event of events)
    latest.set(
      event.jobId ??
        (event.requestId &&
        ["generation.submit", "jobs.submit"].includes(event.operation)
          ? requests.get(event.requestId)
          : undefined) ??
        event.requestId ??
        event.id,
      event,
    );
  return [...latest.values()].sort((a, b) => a.sequence - b.sequence);
}
export function recentActivities(
  events: Activity[],
  now = Date.now(),
  age = 60000,
) {
  return latestActivities(events).filter(
    (event) =>
      now - event.at < age || ["queued", "running"].includes(event.phase),
  );
}

export function isAgentActivity(event: Activity) {
  return event.actorId !== "You" && event.actorId !== "System";
}

export function activeAgents(events: Activity[], now: number) {
  const actors = new Map<string, { latest: Activity; anchor?: Activity }>();
  for (const event of recentActivities(events, now)) {
    if (isAgentActivity(event)) actors.set(event.actorId, { latest: event });
  }
  for (const event of events) {
    const actor = actors.get(event.actorId);
    if (actor && event.sceneChange && event.phase === "succeeded")
      actor.anchor = event;
  }
  return actors;
}
