import { emptyWorkspace, type Job, type Workspace } from "../../../core/schema";
import type { WorkspaceStore } from "./store";

export async function exportSnapshot(store: WorkspaceStore, job: Job) {
  if (!job.contextSnapshot) throw new Error("Export needs a frozen scene");
  const source = job.contextSnapshot;
  const workspace: Workspace = {
    ...emptyWorkspace(),
    name: store.snapshot().name,
    revision: job.snapshotRevision ?? 0,
    nodes: source.nodes,
    assets: Object.fromEntries(
      Object.entries(source.assets)
        .filter(([id]) => job.pinnedAssets?.[id])
        .map(([id, asset]) => [id, { ...asset, path: `${id}/${asset.name}` }]),
    ),
    settings: { ...source.settings, falInput: "{}" },
  };
  // Jobs, receipts, credentials, machine-local settings and remote result payloads are not a web dependency.
  const asset = await store.importFile(
    new Blob(
      [
        JSON.stringify(
          {
            workspace,
            snapshotJobId: job.id,
            assets: Object.keys(workspace.assets),
            runtime: "scene-player.js",
            instructions:
              "Serve this directory over HTTP. Procedural nodes execute trusted project code.",
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    ),
    `${job.id}-project.json`,
    { jobId: job.id, role: "raw-result" },
  );
  return [asset];
}
