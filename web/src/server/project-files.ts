import { open, rename, mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { recordFields, type FieldPatch } from "../../../core/workspace-delta";
import {
  jobSchema,
  jobSummarySchema,
  type JobSummary,
  type Job,
  type Workspace,
} from "../../../core/schema";

export async function atomicJson(file: string, value: unknown) {
  const tmp = file + "." + randomUUID() + ".tmp";
  try {
    const handle = await open(tmp, "wx");
    try {
      await handle.writeFile(JSON.stringify(value, null, 2) + "\n");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, file);
  } finally {
    await rm(tmp, { force: true });
  }
}
export async function optionalJson(file: string) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}
export function sessionData(s: Workspace) {
  const { selection, primaryId, selectionAnchor } = s;
  const { viewportCamera, viewingCameraId, freeCamera } = s.settings;
  return {
    selection,
    primaryId,
    selectionAnchor,
    settings: { viewportCamera, viewingCameraId, freeCamera },
  };
}
export function projectData(s: Workspace) {
  const { selection, primaryId, selectionAnchor, jobs, settings, ...rest } = s;
  const { viewportCamera, viewingCameraId, freeCamera, ...authored } = settings;
  return { ...rest, settings: authored };
}
export function diffWorkspace(
  a: Workspace,
  b: Workspace,
  jobIds?: string[],
): FieldPatch[] {
  const patches: FieldPatch[] = [];
  for (const field of Object.keys(b) as (keyof Workspace)[]) {
    if (field === "revision" || a[field] === b[field]) continue;
    if (recordFields.has(field)) {
      const old = a[field] as Record<string, unknown>,
        next = b[field] as Record<string, unknown>;
      const keys =
        field === "jobs" && jobIds
          ? jobIds
          : new Set([...Object.keys(old), ...Object.keys(next)]);
      for (const key of keys) {
        if (!isDeepStrictEqual(old[key], next[key]))
          patches.push({ field, key, value: next[key] });
      }
    } else if (!isDeepStrictEqual(a[field], b[field]))
      patches.push({ field, value: b[field] });
  }
  return patches;
}
export function sessionPatch(p: FieldPatch) {
  return (
    ["selection", "primaryId", "selectionAnchor"].includes(p.field) ||
    (p.field === "settings" &&
      ["viewportCamera", "viewingCameraId", "freeCamera"].includes(p.key!))
  );
}

export class JobFiles {
  constructor(private root: string) {}
  dir(id: string) {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Invalid job ID");
    return path.join(this.root, "jobs", id);
  }
  async summaries() {
    const dir = path.join(this.root, "jobs");
    await mkdir(dir, { recursive: true });
    const entries = await readdir(dir, { withFileTypes: true });
    const jobs: Workspace["jobs"] = {};
    for (let i = 0; i < entries.length; i += 48) {
      await Promise.all(
        entries
          .slice(i, i + 48)
          .filter((e) => e.isDirectory() && !e.name.startsWith("."))
          .map(async (e) => {
            const record = await optionalJson(
              path.join(this.dir(e.name), "job.json"),
            );
            if (record) {
              const job = jobSummarySchema.parse(record);
              if (job.id !== e.name) throw new Error("Mismatched job ID");
              jobs[e.name] = job;
            }
          }),
      );
    }
    return jobs;
  }
  async manifest(job: Job) {
    const dir = this.dir(job.id);
    await mkdir(dir, { recursive: true });
    await atomicJson(path.join(dir, "input.json"), {
      input: job.input,
      cameras: job.cameras,
      pinnedAssets: job.pinnedAssets,
      contextSnapshot: job.contextSnapshot,
      previewItems: job.previewItems,
    });
  }
  async load(summary: JobSummary): Promise<Job> {
    const data = JSON.parse(
      await readFile(path.join(this.dir(summary.id), "input.json"), "utf8"),
    );
    const request = await optionalJson(
      path.join(this.dir(summary.id), "request.json"),
    );
    return jobSchema.parse({
      ...data,
      ...summary,
      input: data.input,
      request,
    });
  }
  async request(id: string, value: unknown) {
    await atomicJson(path.join(this.dir(id), "request.json"), value);
  }
  async save(job: JobSummary) {
    await atomicJson(path.join(this.dir(job.id), "job.json"), job);
  }
}
