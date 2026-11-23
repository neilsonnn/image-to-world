import {
  atomicJson,
  optionalJson,
  sessionData,
  projectData,
  diffWorkspace,
  sessionPatch,
  JobFiles,
} from "./project-files";
import {
  checkPreconditions,
  type CommandContext,
} from "../../../core/command-context";
import type { Command } from "../../../core/schema";
import type { FieldPatch } from "../../../core/workspace-delta";
import { validateGlb } from "../../../core/mesh";
import type { Operation } from "../../../core/activity";
import {
  activitySchema,
  type Activity,
  type ActivityInput,
} from "../../../core/activity";
import { createHash, randomUUID } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import {
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Job } from "../../../core/schema";
import { navigate, validateScene } from "../../../core/commands";
import {
  emptyWorkspace,
  workspaceSchema,
  jobSchema,
  jobSummarySchema,
  type JobSummary,
  type Asset,
  type Workspace,
} from "../../../core/schema";

const formats: Record<string, [Asset["kind"], string]> = {
  ".glb": ["mesh", "model/gltf-binary"],
  ".png": ["image", "image/png"],
  ".jpg": ["image", "image/jpeg"],
  ".jpeg": ["image", "image/jpeg"],
  ".webp": ["image", "image/webp"],
  ".exr": ["depth", "image/x-exr"],
  ".spz": ["splat", "application/octet-stream"],
  ".ply": ["splat", "application/octet-stream"],
  ".splat": ["splat", "application/octet-stream"],
  ".sog": ["splat", "application/octet-stream"],
  ".mp4": ["video", "video/mp4"],
  ".webm": ["video", "video/webm"],
  ".mov": ["video", "video/quicktime"],
};
export class WorkspaceStore {
  private jobAssets = new AsyncLocalStorage<Job>();
  withJobAssets<T>(job: Job, work: () => Promise<T>) {
    return this.jobAssets.run(job, work);
  }
  async pinAssets(snapshot: Workspace, inputs: unknown) {
    const ids = new Set<string>();
    const walk = (value: unknown): void => {
      if (
        typeof value === "string" &&
        snapshot.assets[value] &&
        !ids.has(value)
      ) {
        ids.add(value);
        const a = snapshot.assets[value];
        for (const key of [
          "depthAssetId",
          "confidenceAssetId",
          "maskAssetId",
          "geometrySourceAssetId",
        ] as const)
          walk(a[key]);
      } else if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object")
        Object.values(value).forEach(walk);
    };
    walk(inputs);
    const pins: NonNullable<Job["pinnedAssets"]> = {};
    await mkdir(path.join(this.assetsPath, ".snapshots"), { recursive: true });
    for (const id of ids) {
      const inherited = this.jobAssets.getStore()?.pinnedAssets?.[id];
      if (inherited) {
        pins[id] = inherited;
        continue;
      }
      const { file } = await this.assetFile(id);
      const before = await stat(file);
      const expected = snapshot.assets[id];
      if (
        before.size !== expected.size ||
        before.mtimeMs !== expected.modifiedAt
      )
        throw new Error(`Asset changed before snapshot: ${id}`);
      const bytes = await readFile(file);
      const after = await stat(file);
      if (after.size !== before.size || after.mtimeMs !== before.mtimeMs)
        throw new Error(`Asset changed while snapshotting: ${id}`);
      const hash = createHash("sha256").update(bytes).digest("hex");
      const relative = `.snapshots/${hash}`;
      const dest = path.join(this.assetsPath, relative);
      if (!(await Bun.file(dest).exists())) {
        const temporary = `${dest}.${randomUUID()}.tmp`;
        await Bun.write(temporary, bytes);
        await rename(temporary, dest);
      }
      pins[id] = { path: relative, hash };
    }
    return pins;
  }
  private activity: Activity[] = [];
  private activityTail: Promise<unknown> = Promise.resolve();
  activitySnapshot(after = 0) {
    return {
      events: this.activity.filter((e) => e.sequence > after),
      cursor: this.activity.at(-1)?.sequence ?? 0,
      gap: after > 0 && after < (this.activity[0]?.sequence ?? 1) - 1,
    };
  }
  recordActivity(input: ActivityInput) {
    const scrub = (value: string) =>
      value.replace(/https?:\/\/\S+/g, "[URL]").slice(0, 2000);
    const event = activitySchema.parse({
      ...input,
      message: input.message ? scrub(input.message) : undefined,
      id: randomUUID(),
      sequence: (this.activity.at(-1)?.sequence ?? 0) + 1,
      at: Date.now(),
    });
    this.activity = [...this.activity, event].slice(-1000);
    this.emit("activity", event);
    const snapshot = JSON.stringify(this.activity);
    this.activityTail = this.activityTail
      .catch(() => {})
      .then(async () => {
        const temporary = path.join(this.root, ".activity.tmp");
        await Bun.write(temporary, snapshot);
        await rename(temporary, path.join(this.root, ".activity.json"));
      })
      .catch(() => {});
    return event;
  }
  lastOperation: Operation | null = null;
  reportOperation(name: string) {
    this.lastOperation = { name, at: Date.now() };
    this.emit("operation", this.lastOperation);
  }

  readonly root: string;
  readonly assetsPath: string;
  private state = emptyWorkspace();
  readonly streamId = randomUUID();
  private files: JobFiles;
  private sessionTimer?: ReturnType<typeof setTimeout>;
  private sessionTail: Promise<void> = Promise.resolve();
  private sessionDirty = false;
  private navigationReceipts: Workspace["receipts"] = {};
  // Job command receipts live beside job history. Index filenames on open so
  // normal navigation never reads a historical request.
  private jobReceiptKeys = new Set<string>();
  private receiptKey(id: string) {
    return createHash("sha256").update(id).digest("hex");
  }
  async commandReceipt(id: string) {
    const key = this.receiptKey(id);
    return (
      this.state.receipts[id] ??
      this.navigationReceipts[id] ??
      (this.jobReceiptKeys.has(key)
        ? await optionalJson(path.join(this.root, "jobs", ".requests", key))
        : undefined)
    );
  }
  async saveJobReceipt(id: string, receipt: Workspace["receipts"][string]) {
    const key = this.receiptKey(id);
    await atomicJson(path.join(this.root, "jobs", ".requests", key), receipt);
    this.jobReceiptKeys.add(key);
  }
  private needsRecovery = false;
  private sessionFile() {
    return path.join(this.root, "session.json");
  }
  private flushSession() {
    clearTimeout(this.sessionTimer);
    if (this.sessionDirty) {
      this.sessionDirty = false;
      const data = {
        revision: this.state.revision,
        ...sessionData(this.state),
        receipts: this.navigationReceipts,
      };
      this.sessionTail = this.sessionTail
        .catch(() => {})
        .then(() => atomicJson(this.sessionFile(), data));
    }
    return this.sessionTail;
  }
  private scheduleSession() {
    this.sessionDirty = true;
    clearTimeout(this.sessionTimer);
    this.sessionTimer = setTimeout(
      () =>
        void this.flushSession().catch((e) => {
          this.sessionDirty = true;
          this.emit("error", { message: String(e) });
        }),
      150,
    );
  }
  async loadJob(id: string) {
    const job = this.state.jobs[id];
    if (!job) throw new Error("Unknown job " + id);
    return this.files.load(job);
  }
  private publish(next: Workspace, patches: FieldPatch[]) {
    const base = this.state.revision;
    const visible = patches
      .filter((p) => p.field !== "receipts" && p.field !== "resultApplications")
      .map((p) => {
        if (p.field !== "undo" && p.field !== "redo") return p;
        const old = this.state[p.field].map(liveEdit),
          edits = next[p.field].map(liveEdit);
        if ([...old, ...edits].some((edit) => !edit.id))
          return { ...p, value: edits };
        const ids = new Set(edits.map((edit) => edit.id));
        const kept = old.filter((edit) => ids.has(edit.id));
        if (
          kept.some(
            (edit, i) => JSON.stringify(edit) !== JSON.stringify(edits[i]),
          )
        )
          return { ...p, value: edits };
        return {
          ...p,
          removeEdits: old
            .filter((edit) => !ids.has(edit.id))
            .map((edit) => edit.id),
          value: edits.slice(kept.length),
        };
      });
    this.state = next;
    if (patches.some(sessionPatch)) this.scheduleSession();
    this.emit("change", {
      stream: this.streamId,
      base,
      revision: next.revision,
      patches: visible,
    });
  }
  navigate(command: Command, context: CommandContext, body: string) {
    const task = this.tail.then(() => {
      if (this.closed || this.needsRecovery)
        throw new Error("Workspace unavailable");
      const id = context.requestId!;
      if (this.jobReceiptKeys.has(this.receiptKey(id)))
        throw new Error("Conflicting request ID");
      const old = this.navigationReceipts[id] ?? this.state.receipts[id];
      if (old) {
        if (old.body !== body || !old.result)
          throw new Error("Conflicting request ID");
        return old.result;
      }
      checkPreconditions(this.state, context);
      const next = navigate(this.state, command);
      next.revision++;
      const result = { revision: next.revision };
      this.navigationReceipts = Object.fromEntries([
        ...Object.entries(this.navigationReceipts).slice(-127),
        [id, { body, result }],
      ]);
      this.publish(next, diffWorkspace(this.state, next));
      this.scheduleSession();
      return result;
    });
    this.tail = task.catch(() => {});
    return task;
  }

  private tail: Promise<unknown> = Promise.resolve();
  private watchers: FSWatcher[] = [];
  private listeners = new Set<(event: string, data: unknown) => void>();
  private scanTimer?: ReturnType<typeof setTimeout>;
  private lockToken = randomUUID();
  private closed = false;
  /** mtime of the workspace.json this store last wrote, to ignore its own watch events. */
  private writtenAt = 0;
  constructor(root: string) {
    this.root = path.resolve(root);
    this.files = new JobFiles(this.root);
    this.assetsPath = path.join(this.root, "assets");
  }
  async init() {
    await mkdir(this.assetsPath, { recursive: true });
    const lockPath = path.join(this.root, ".lock");
    try {
      await this.lock(lockPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const lock = JSON.parse(await readFile(lockPath, "utf8"));
      let alive = true;
      try {
        process.kill(lock.pid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") alive = false;
      }
      if (alive)
        throw new Error(`Workspace is already open by process ${lock.pid}`);
      await rm(lockPath);
      await this.lock(lockPath);
    }
    try {
      try {
        this.state = await this.read();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          throw new Error(
            `Cannot read workspace.json. Fix it or restore workspace.json.bak: ${error}`,
          );
        await this.write(this.state);
      }
      const journal = await optionalJson(
        path.join(this.root, ".job-commit.json"),
      );
      if (journal) {
        if (journal.revision === this.state.revision)
          for (const record of journal.jobs) await this.files.save(record);
        await rm(path.join(this.root, ".job-commit.json"));
      }
      const session = await optionalJson(this.sessionFile());
      if (session) {
        const { selection, primaryId, selectionAnchor, settings } = session;
        this.state = workspaceSchema.parse({
          ...this.state,
          selection,
          primaryId,
          selectionAnchor,
          settings: { ...this.state.settings, ...settings },
          revision: Math.max(this.state.revision, session.revision),
        });
        this.navigationReceipts = session.receipts ?? {};
        this.normalizeSession(this.state);
      }
      this.state.jobs = await this.files.summaries();
      const receiptDir = path.join(this.root, "jobs", ".requests");
      await mkdir(receiptDir, { recursive: true });
      this.jobReceiptKeys = new Set(await readdir(receiptDir));
      try {
        this.activity = JSON.parse(
          await readFile(path.join(this.root, ".activity.json"), "utf8"),
        )
          .map((e: unknown) => activitySchema.parse(e))
          .slice(-1000);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          this.activity = [];
      }
      await this.syncAssets();
      this.watchers.push(
        watch(this.assetsPath, { recursive: true }, () => this.scheduleSync()),
      );
      this.watchers.push(
        watch(this.root, (_, name) => {
          if (name !== "workspace.json") return;
          void stat(path.join(this.root, "workspace.json")).then(
            (info) => {
              if (info.mtimeMs !== this.writtenAt) this.scheduleSync();
            },
            () => this.scheduleSync(),
          );
        }),
      );
      return this;
    } catch (error) {
      await this.close();
      throw error;
    }
  }
  private async lock(file: string) {
    const handle = await open(file, "wx");
    try {
      await handle.writeFile(
        JSON.stringify({ pid: process.pid, token: this.lockToken }),
      );
    } finally {
      await handle.close();
    }
  }
  private async read() {
    const doc = JSON.parse(
      await readFile(path.join(this.root, "workspace.json"), "utf8"),
    );
    if (doc.version !== 8 || "jobs" in doc)
      throw new Error("Expected project schema 8");
    const session = sessionData(this.state);
    const state = workspaceSchema.parse({
      ...doc,
      ...session,
      settings: { ...doc.settings, ...session.settings },
      jobs: {},
    });
    validateScene(state.nodes);
    this.normalizeSession(state);
    return state;
  }
  private normalizeSession(state: Workspace) {
    if (
      state.settings.viewingCameraId &&
      !state.nodes[state.settings.viewingCameraId]
    ) {
      state.settings.viewingCameraId = null;
      state.settings.freeCamera = null;
    }
    state.selection = state.selection.filter(
      (id) => state.nodes[id] || state.assets[id],
    );
    if (!state.primaryId || !state.selection.includes(state.primaryId))
      state.primaryId = state.selection.at(-1) ?? null;
    if (
      !state.selectionAnchor ||
      (!state.nodes[state.selectionAnchor] &&
        !state.assets[state.selectionAnchor])
    )
      state.selectionAnchor = state.primaryId;
  }
  private async write(state: Workspace) {
    const file = path.join(this.root, "workspace.json");
    const temporary = `${file}.${randomUUID()}.tmp`;
    const handle = await open(temporary, "wx");
    try {
      await handle.writeFile(
        JSON.stringify(projectData(state), null, 2) + "\n",
      );
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await copyFile(file, `${file}.bak`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await rename(temporary, file);
    this.writtenAt = (await stat(file)).mtimeMs;
  }
  // Published records are immutable between commits. Call snapshot() for a mutable copy.
  get current(): Readonly<Workspace> {
    return this.state;
  }
  get revision() {
    return this.state.revision;
  }
  liveSnapshot(): Workspace {
    return {
      ...this.state,
      resultApplications: {},
      receipts: {},
      undo: this.state.undo.map(liveEdit),
      redo: this.state.redo.map(liveEdit),
    };
  }
  snapshot(): Workspace {
    return structuredClone(this.state);
  }
  subscribe(listener: (event: string, data: unknown) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit(event: string, data: unknown) {
    for (const listener of this.listeners) listener(event, data);
  }
  updateScene<T>(fn: (state: Workspace) => T | Promise<T>) {
    return this.update(fn, undefined, "scene");
  }
  updateSceneAndJob<T>(
    jobId: string,
    fn: (state: Workspace) => T | Promise<T>,
  ) {
    return this.updateSceneAndJobs([jobId], fn);
  }
  updateSceneAndJobs<T>(
    jobIds: string[],
    fn: (state: Workspace) => T | Promise<T>,
  ) {
    return this.update(fn, undefined, { jobIds, scene: true });
  }
  updateJob(id: string, fn: (job: JobSummary) => void) {
    return this.update((state) => fn(state.jobs[id]), undefined, {
      jobIds: [id],
    });
  }
  update<T>(
    fn: (state: Workspace) => T | Promise<T>,
    rollback?: () => Promise<void>,
    scope?: "scene" | { jobIds: string[]; scene?: boolean },
  ): Promise<T> {
    const result = this.tail.then(async () => {
      let committed = false;
      try {
        if (this.closed) throw new Error("Workspace is closed");
        if (this.needsRecovery)
          throw new Error("Reopen project to finish job commit");
        await this.reloadExternal();
        const before = this.state;
        const editingScene = scope === "scene" || scope?.scene;
        const state = !scope
          ? structuredClone(before)
          : editingScene
            ? { ...structuredClone({ ...before, jobs: {} }), jobs: before.jobs }
            : { ...before };
        if (scope && scope !== "scene") {
          state.jobs = { ...before.jobs };
          for (const id of scope.jobIds)
            if (before.jobs[id])
              state.jobs[id] = structuredClone(before.jobs[id]);
        }
        const value = await fn(state);
        state.revision = before.revision + 1;
        const patches = diffWorkspace(
          before,
          state,
          scope && scope !== "scene" ? scope.jobIds : undefined,
        );
        if (patches.some((p) => p.field === "nodes"))
          validateScene(state.nodes);
        const jobs: JobSummary[] = [];
        for (const p of patches.filter((p) => p.field === "jobs")) {
          const id = p.key!,
            job = state.jobs[id];
          if (!job) throw new Error("Removing job history is unsupported");
          if (!before.jobs[id]) {
            const full = jobSchema.parse(job);
            await this.files.manifest(full);
          }
          if ("request" in job && job.request !== undefined)
            await this.files.request(id, job.request);
          state.jobs[id] = jobSummarySchema.parse(job);
          p.value = state.jobs[id];
          jobs.push(state.jobs[id]);
        }
        const authored = patches.some(
          (p) => p.field !== "jobs" && !sessionPatch(p),
        );
        const journal = path.join(this.root, ".job-commit.json");
        if (authored && jobs.length) {
          await atomicJson(journal, { revision: state.revision, jobs });
        }
        if (authored) {
          try {
            await this.write(state);
          } catch (error) {
            // Recovery checks the committed scene revision before replaying a journal.
            if (jobs.length) this.needsRecovery = true;
            throw error;
          }
        }
        committed = true;
        try {
          for (const job of jobs) await this.files.save(job);
          if (authored && jobs.length) await rm(journal);
        } catch (e) {
          this.needsRecovery = true;
          throw e;
        }
        this.publish(state, patches);
        return value;
      } catch (error) {
        if (!committed) await rollback?.();
        throw error;
      }
    });
    this.tail = result.catch(() => {});
    return result;
  }
  private async reloadExternal() {
    const info = await stat(path.join(this.root, "workspace.json"));
    if (info.mtimeMs === this.writtenAt) return;
    const next = await this.read();
    next.jobs = this.state.jobs;
    this.writtenAt = info.mtimeMs;
    const patches = diffWorkspace(this.state, next);
    if (patches.length) {
      next.revision = Math.max(this.state.revision + 1, next.revision);
      this.publish(next, patches);
    }
  }
  private scheduleSync() {
    clearTimeout(this.scanTimer);
    this.scanTimer = setTimeout(
      () =>
        void this.syncAssets().catch((error) =>
          this.emit("error", { message: String(error) }),
        ),
      200,
    );
  }
  async syncAssets() {
    const found = new Map<string, { size: number; modifiedAt: number }>();
    const scan = async (relative = "") => {
      for (const entry of await readdir(path.join(this.assetsPath, relative), {
        withFileTypes: true,
      })) {
        if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
        const child = path.join(relative, entry.name);
        if (entry.isDirectory()) await scan(child);
        else if (entry.isFile()) {
          const info = await stat(path.join(this.assetsPath, child));
          found.set(child.split(path.sep).join("/"), {
            size: info.size,
            modifiedAt: info.mtimeMs,
          });
        }
      }
    };
    const result = this.tail.then(async () => {
      if (this.closed || this.needsRecovery) return;
      await scan();
      await this.reloadExternal();
      const state = {
        ...this.state,
        assets: structuredClone(this.state.assets),
      };
      const byPath = new Map<string, Asset>();
      for (const asset of Object.values(state.assets)) {
        asset.missing = asset.trashedAt !== undefined || !found.has(asset.path);
        if (!byPath.has(asset.path)) byPath.set(asset.path, asset);
      }
      const referenced = referencedIds(state);
      for (const asset of Object.values(state.assets))
        if (
          !found.has(asset.path) &&
          asset.trashedAt === undefined &&
          !referenced.has(asset.id)
        )
          delete state.assets[asset.id];
      for (const [file, info] of found) {
        const asset = byPath.get(file);
        if (asset && asset.trashedAt === undefined)
          Object.assign(asset, info, { missing: false });
        else if (asset) continue;
        else {
          const id = `asset_${createHash("sha256").update(file).digest("hex").slice(0, 20)}`;
          state.assets[id] = this.fileAsset(id, file, info);
        }
      }
      const patches = diffWorkspace(this.state, state);
      if (patches.length) {
        state.revision++;
        await this.write(state);
        this.publish(state, patches);
      }
    });
    this.tail = result.catch(() => {});
    await result;
  }
  private fileAsset(
    id: string,
    file: string,
    info: { size: number; modifiedAt: number },
  ): Asset {
    const [kind, mimeType] = formats[path.extname(file).toLowerCase()] ?? [
      "file",
      "application/octet-stream",
    ];
    return {
      id,
      path: file,
      name: path.basename(file),
      kind,
      mimeType,
      ...info,
      missing: false,
    };
  }
  async importFile(file: Blob, name: string, metadata: Partial<Asset> = {}) {
    if (path.extname(name).toLowerCase() === ".glb")
      validateGlb(await file.arrayBuffer());
    return this.updateScene(async (state) => {
      const safeName =
        path
          .basename(name)
          .replace(/[^a-zA-Z0-9._-]/g, "_")
          .replace(/^\.+/, "") || "asset";
      const relative = `${randomUUID()}-${safeName}`;
      const temporary = path.join(this.assetsPath, `.${relative}.tmp`);
      await Bun.write(temporary, file);
      await rename(temporary, path.join(this.assetsPath, relative));
      const info = await stat(path.join(this.assetsPath, relative));
      const id = `asset_${createHash("sha256").update(relative).digest("hex").slice(0, 20)}`;
      const asset = {
        ...this.fileAsset(id, relative, {
          size: info.size,
          modifiedAt: info.mtimeMs,
        }),
        name: safeName,
        ...metadata,
        id,
        path: relative,
        size: info.size,
        modifiedAt: info.mtimeMs,
        contentHash: createHash("sha256")
          .update(new Uint8Array(await file.arrayBuffer()))
          .digest("hex"),
        role: metadata.role ?? (safeName.endsWith(".glb") ? "mesh" : undefined),
      };
      state.assets[id] = asset;
      return asset;
    });
  }
  async assetFile(
    id: string,
    options: { state?: Workspace; includeTrashed?: boolean } = {},
  ) {
    const job = this.jobAssets.getStore();
    const pinned = job?.pinnedAssets?.[id];
    if (pinned) {
      const asset = job.contextSnapshot?.assets[id];
      if (!asset) throw new Error(`Pinned asset metadata missing: ${id}`);
      if (
        !/^\.snapshots\/[a-f0-9]{64}$/.test(pinned.path) ||
        pinned.path !== `.snapshots/${pinned.hash}`
      )
        throw new Error("Invalid pinned asset path");
      return { asset, file: path.join(this.assetsPath, pinned.path) };
    }
    const asset = (options.state ?? this.state).assets[id];
    if (asset?.trashedAt !== undefined && !options.includeTrashed)
      throw new Error("Restore this asset from Trash before using it");
    if (!asset || (asset.missing && asset.trashedAt === undefined))
      throw new Error(`Asset ${id} is missing`);
    const root = await realpath(this.assetsPath);
    const base =
      asset.trashedAt === undefined
        ? this.assetsPath
        : path.join(this.assetsPath, ".trash");
    const file = await realpath(path.resolve(base, asset.path));
    if (!file.startsWith(root + path.sep))
      throw new Error("Asset path escapes workspace");
    return { asset, file };
  }
  async close() {
    this.closed = true;
    clearTimeout(this.scanTimer);
    for (const watcher of this.watchers) watcher.close();
    await this.tail;
    await this.activityTail;
    await this.flushSession();
    const file = path.join(this.root, ".lock");
    try {
      const lock = JSON.parse(await readFile(file, "utf8"));
      if (lock.token === this.lockToken) await rm(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

/**
 * Every string in the workspace except asset records' own IDs. A missing file's
 * asset whose ID is not in this set describes nothing the project still uses.
 */
function referencedIds(state: Workspace) {
  const ids = new Set<string>();
  const walk = (value: unknown): void => {
    if (typeof value === "string") ids.add(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object")
      for (const child of Object.values(value)) walk(child);
  };
  for (const [key, value] of Object.entries(state))
    if (key !== "assets") walk(value);
  for (const asset of Object.values(state.assets)) {
    const { id: _id, ...fields } = asset;
    walk(fields);
  }
  return ids;
}

function liveEdit({
  changes,
  selection,
  ...metadata
}: Workspace["undo"][number]) {
  return { ...metadata, changes: [] };
}
