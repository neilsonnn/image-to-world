import { link, mkdir, realpath, stat, unlink } from "node:fs/promises";
import path from "node:path";
import type { Workspace } from "../../../core/schema";
import type { WorkspaceStore } from "./store";

function containsId(value: unknown, ids: Set<string>): boolean {
  if (typeof value === "string") return ids.has(value);
  return value !== null && typeof value === "object"
    ? Object.values(value).some((value) => containsId(value, ids))
    : false;
}

function checkReferences(state: Workspace, ids: Set<string>) {
  const environmentId = state.settings.lighting?.environmentAssetId;
  if (environmentId && ids.has(environmentId))
    throw new Error("Remove this image from scene lighting before trashing it");
  for (const node of Object.values(state.nodes))
    if (
      ids.has(node.assetId ?? "") ||
      ids.has(node.geometryAssetId ?? "") ||
      node.observationAssetIds?.some((id) => ids.has(id))
    )
      throw new Error(
        `Remove "${node.name}" from the scene before trashing its asset`,
      );
  for (const asset of Object.values(state.assets)) {
    if (ids.has(asset.id) || asset.trashedAt !== undefined) continue;
    if (
      [
        asset.depthAssetId,
        asset.confidenceAssetId,
        asset.maskAssetId,
        asset.geometrySourceAssetId,
      ].some((id) => id && ids.has(id))
    )
      throw new Error(`"${asset.name}" still uses this asset for geometry`);
  }
  for (const [id, draft] of Object.entries(state.imageDrafts))
    if (!ids.has(id) && draft.layers.some((layer) => ids.has(layer.assetId)))
      throw new Error(
        `Remove the image layer from "${state.assets[id]?.name ?? id}" before trashing it`,
      );
  for (const job of Object.values(state.jobs)) {
    if (!["queued", "running"].includes(job.status)) continue;
    if (containsId(job.input, ids) || containsId(job.sourceFrameAssetIds, ids))
      throw new Error(
        `Wait for or cancel generation ${job.id} before trashing its inputs`,
      );
    if (job.input.kind === "atlas" || job.input.kind === "video") {
      const snapshot = job.contextSnapshot;
      for (const id of job.input.nodeIds) {
        const node = snapshot?.nodes[id];
        for (const assetId of [node?.assetId, node?.geometryAssetId]) {
          const asset = assetId ? snapshot?.assets[assetId] : undefined;
          if (
            [
              assetId,
              asset?.depthAssetId,
              asset?.confidenceAssetId,
              asset?.maskAssetId,
            ].some((id) => id && ids.has(id))
          )
            throw new Error(
              `Wait for or cancel generation ${job.id} before trashing its context`,
            );
        }
      }
    }
  }
}

export async function moveAssetsToTrash(
  store: WorkspaceStore,
  ids: string[],
  restore = false,
) {
  const moved: { from: string; to: string }[] = [];
  await store.update(
    async (state) => {
      const selected = new Set(ids);
      if (!restore) checkReferences(state, selected);
      const root = await realpath(store.assetsPath);
      const files = [];
      for (const id of selected) {
        const asset = state.assets[id];
        if (!asset) throw new Error(`Unknown asset ${id}`);
        if ((asset.trashedAt !== undefined) !== restore) continue;
        const { file } = await store.assetFile(id, {
          state,
          includeTrashed: restore,
        });
        const sourceBase = restore ? path.join(root, ".trash") : root;
        if (file !== path.resolve(sourceBase, asset.path))
          throw new Error("Cannot trash or restore through a symbolic link");
        const base = restore ? root : path.join(root, ".trash");
        const to = path.resolve(base, asset.path);
        if (!to.startsWith(root + path.sep))
          throw new Error("Asset path escapes workspace");
        let parent = root;
        for (const part of path
          .relative(root, path.dirname(to))
          .split(path.sep)
          .filter(Boolean)) {
          const next = path.join(parent, part);
          try {
            await mkdir(next);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          }
          parent = await realpath(next);
          if (!parent.startsWith(root + path.sep))
            throw new Error("Asset path escapes workspace");
        }
        if (await Bun.file(to).exists())
          throw new Error(
            `A file already exists at the destination for "${asset.name}"`,
          );
        files.push({ asset, from: file, to });
      }
      for (const { asset, from, to } of files) {
        // Hard-link creation refuses destination collisions; the rollback retains the bytes.
        await link(from, to);
        moved.push({ from, to });
        await unlink(from);
        asset.missing = !restore;
        if (restore) delete asset.trashedAt;
        else asset.trashedAt = Date.now();
      }
      if (!restore) {
        state.selection = state.selection.filter((id) => !selected.has(id));
        if (selected.has(state.primaryId ?? ""))
          state.primaryId = state.selection.at(-1) ?? null;
        if (selected.has(state.selectionAnchor ?? ""))
          state.selectionAnchor = state.primaryId;
      }
    },
    async () => {
      for (const { from, to } of moved.reverse()) {
        if (!(await Bun.file(from).exists())) await link(to, from);
        else if ((await stat(from)).ino !== (await stat(to)).ino)
          throw new Error(
            "Trash rollback found a replacement file; original bytes remain in project trash",
          );
        await unlink(to);
      }
    },
  );
}

export async function revealAsset(store: WorkspaceStore, id: string) {
  if (process.platform !== "darwin")
    throw new Error("Finder reveal is available on macOS");
  const { file } = await store.assetFile(id, { includeTrashed: true });
  const child = Bun.spawn(["/usr/bin/open", "-R", file], {
    stdout: "ignore",
    stderr: "pipe",
  });
  const [code, error] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);
  if (code !== 0)
    throw new Error(`Finder could not reveal this file: ${error.trim()}`);
}
