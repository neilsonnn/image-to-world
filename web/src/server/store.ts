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
import { validateScene } from "../../../core/commands";
import {
  emptyWorkspace,
  workspaceSchema,
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
  async pinAssets(snapshot: Workspace, inputs: unknown, includeScene = false) {
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
    if (includeScene)
      for (const node of Object.values(snapshot.nodes)) {
        walk(node.assetId);
        walk(node.geometryAssetId);
      }
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
    const state = workspaceSchema.parse(
      JSON.parse(
        await readFile(path.join(this.root, "workspace.json"), "utf8"),
      ),
    );
    validateScene(state.nodes);
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
    return state;
  }
  private async write(state: Workspace) {
    const file = path.join(this.root, "workspace.json");
    const temporary = `${file}.${randomUUID()}.tmp`;
    const handle = await open(temporary, "wx");
    try {
      await handle.writeFile(JSON.stringify(state, null, 2) + "\n");
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
  update<T>(
    fn: (state: Workspace) => T | Promise<T>,
    rollback?: () => Promise<void>,
  ): Promise<T> {
    const result = this.tail.then(async () => {
      let committed = false;
      try {
        if (this.closed) throw new Error("Workspace is closed");
        const disk = await this.read();
        const state = structuredClone(disk);
        const value = await fn(state);
        state.revision = Math.max(disk.revision, this.state.revision) + 1;
        workspaceSchema.parse(state);
        validateScene(state.nodes);
        await this.write(state);
        committed = true;
        this.state = state;
        this.emit("change", { revision: state.revision });
        return value;
      } catch (error) {
        if (!committed) await rollback?.();
        throw error;
      }
    });
    this.tail = result.catch(() => {});
    return result;
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
      if (this.closed) return;
      await scan();
      const state = await this.read();
      const before = JSON.stringify(state);
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
      if (before !== JSON.stringify(state)) {
        state.revision = Math.max(state.revision, this.state.revision) + 1;
        await this.write(state);
      }
      if (JSON.stringify(this.state) !== JSON.stringify(state)) {
        this.state = state;
        this.emit("change", { revision: state.revision });
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
    return this.update(async (state) => {
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
