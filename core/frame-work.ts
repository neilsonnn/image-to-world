import type { SceneNode, Workspace } from "./schema";
import { jobNames } from "./activity";

export function availableSlug(name: string, used: Set<string>) {
  const words =
    name
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/, "")
      .match(/[a-z][a-z0-9]*/g)
      ?.slice(0, 3)
      .map((word) => word.slice(0, 22)) ?? [];
  if (!words.length) words.push("image");
  if (words.length === 1) words.push("frame");
  const base = words.join("-");
  let slug = base;
  const suffixes = ["amber", "birch", "cedar", "dawn", "elm", "fern"];
  for (let i = 0; used.has(slug); i++) {
    const suffix =
      suffixes[i % suffixes.length] +
      (i < suffixes.length ? "" : Math.floor(i / suffixes.length));
    slug = words.slice(0, 2).join("-") + "-" + suffix;
  }
  return slug;
}
export function frameSlugs(nodes: Record<string, SceneNode>) {
  const frames = Object.values(nodes).filter((n) => n.kind === "capture");
  const used = new Set(frames.flatMap((n) => n.frameSlug ?? []));
  const result = new Map<string, string>();
  for (const frame of frames) {
    const slug = frame.frameSlug ?? availableSlug(frame.name, used);
    result.set(frame.id, slug);
    used.add(slug);
  }
  return result;
}
export function frameTasks(frame: SceneNode, jobs: Workspace["jobs"]) {
  const tasks = (frame.frameWorkers ?? []).map((w) => w.description);
  for (const job of Object.values(jobs)) {
    if (job.status !== "queued" && job.status !== "running") continue;
    if (
      job.id === frame.jobId ||
      job.applyTargets?.some((t) => t.nodeId === frame.id)
    )
      tasks.push(jobNames[job.input.kind]);
  }
  return [...new Set(tasks)];
}
