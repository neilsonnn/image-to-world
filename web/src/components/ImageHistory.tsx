import { useWorkspaceData } from "../lib/client";
import {
  ArrowBendDownRight,
  ArrowClockwise,
  CheckCircle,
  WarningCircle,
} from "@phosphor-icons/react";
import { imageIndex } from "../../../core/images";
import { assetUrl, type Asset, type Job } from "../../../core/schema";
import type { SelectionState } from "../../../core/selection";
import { useCollection } from "../lib/useCollection";
import type { SharedProps } from "./panelShared";
import { Hint } from "./ui";

type NanoJob = Job & { input: Extract<Job["input"], { kind: "nano" }> };
export type ImageHistoryProps = {
  safeCommand: SharedProps["safeCommand"];
  activeAssetId: string | null;
  onSelect: (assetId: string) => void;
  onReuse: (job: NanoJob) => void;
  onRetry: (jobId: string) => void;
};

function jobForAsset(asset: Asset, jobs: Record<string, Job>) {
  const job = asset.jobId ? jobs[asset.jobId] : undefined;
  return job?.input.kind === "nano" ? (job as NanoJob) : undefined;
}

export function ImageHistory({
  safeCommand,
  activeAssetId,
  onSelect,
  onReuse,
  onRetry,
}: ImageHistoryProps) {
  const workspace = useWorkspaceData(
    [
      "assets",
      "nodes",
      "jobs",
      "selection",
      "primaryId",
      "selectionAnchor",
      "imageVersions",
    ],
    ["collections"],
  );
  const { assets, jobs } = workspace;
  const index = imageIndex(workspace);
  const activeRootId = activeAssetId
    ? index.roots.get(activeAssetId)
    : undefined;
  const images = Object.values(assets).filter(
    (asset) =>
      asset.kind === "image" &&
      (!activeRootId || index.roots.get(asset.id) === activeRootId),
  );
  const imageIds = new Set(images.map(({ id }) => id));
  const children = new Map<string, Asset[]>();
  images.forEach((asset) => {
    if (!asset.parentAssetId || !imageIds.has(asset.parentAssetId)) return;
    children.set(asset.parentAssetId, [
      ...(children.get(asset.parentAssetId) ?? []),
      asset,
    ]);
  });
  children.forEach((list) => list.sort((a, b) => a.modifiedAt - b.modifiedAt));
  const roots = images
    .filter(
      (asset) =>
        asset.id === index.roots.get(asset.id) ||
        !asset.parentAssetId ||
        !imageIds.has(asset.parentAssetId),
    )
    .sort((a, b) =>
      a.id === activeRootId
        ? -1
        : b.id === activeRootId
          ? 1
          : b.modifiedAt - a.modifiedAt,
    );
  // Lineage order: each image is followed by the edits made from it.
  const rows: Asset[] = [];
  const walk = (asset: Asset, seen: Set<string>) => {
    if (seen.has(asset.id)) return;
    rows.push(asset);
    const next = new Set(seen).add(asset.id);
    (children.get(asset.id) ?? []).forEach((child) => walk(child, next));
  };
  roots.forEach((root) => walk(root, new Set()));
  const setSelection = (next: SelectionState) => {
    const pending = safeCommand({
      type: "selection.set",
      ids: next.ids,
      primaryId: next.primaryId,
      anchorId: next.anchorId,
    });
    if (
      next.primaryId &&
      assets[next.primaryId]?.kind === "image" &&
      next.primaryId !== activeAssetId
    )
      onSelect(next.primaryId);
    return pending;
  };
  const collection = useCollection({
    id: "image-history",
    visibleIds: rows.map((asset) => asset.id),
    selection: {
      ids: workspace.selection,
      primaryId: workspace.primaryId,
      anchorId: workspace.selectionAnchor,
    },
    onSelectionChange: setSelection,
    onUndo: () =>
      void safeCommand({
        type: "history.undo",
        assetId: activeAssetId ?? undefined,
      }),
    onRedo: () =>
      void safeCommand({
        type: "history.redo",
        assetId: activeAssetId ?? undefined,
      }),
    onOpen: onSelect,
    onLeft: (id) => {
      const parentId = assets[id]?.parentAssetId;
      return parentId && imageIds.has(parentId) ? parentId : null;
    },
    onRight: (id) => children.get(id)?.[0]?.id ?? null,
  });
  const activeLineage = new Set<string>();
  let ancestor = activeAssetId ? assets[activeAssetId] : undefined;
  while (ancestor && !activeLineage.has(ancestor.id)) {
    activeLineage.add(ancestor.id);
    ancestor = ancestor.parentAssetId
      ? assets[ancestor.parentAssetId]
      : undefined;
  }
  const liveJobs = Object.values(jobs).filter(
    (job): job is NanoJob =>
      job.input.kind === "nano" &&
      ["queued", "running", "failed"].includes(job.status),
  );
  const bySource = new Map<string, NanoJob[]>();
  liveJobs.forEach((job) =>
    bySource.set(job.input.sourceAssetId, [
      ...(bySource.get(job.input.sourceAssetId) ?? []),
      job,
    ]),
  );
  if (!rows.length && !liveJobs.length)
    return (
      <div className="ie-history-empty">
        <ArrowBendDownRight size={14} />
        No edits yet
      </div>
    );
  return (
    <div
      className="ie-history-track"
      role="listbox"
      aria-label="Image generation history"
      aria-multiselectable="true"
      {...collection.paneProps}
    >
      {rows.flatMap((asset) => {
        const job = jobForAsset(asset, jobs);
        const activeCaptures = index.capturesByAsset.get(asset.id) ?? [];
        const rootId = index.roots.get(asset.id);
        const rootCaptureCount = rootId
          ? (index.capturesByRoot.get(rootId)?.length ?? 0)
          : 0;
        const activeVersion = rootId
          ? workspace.imageVersions[rootId] === asset.id
          : false;
        const activeEverywhere =
          activeVersion && activeCaptures.length === rootCaptureCount;
        const item = (
          <div
            className={`ie-history-item${asset.id === activeAssetId ? " is-active" : ""}${workspace.selection.includes(asset.id) ? " selected" : ""}${activeLineage.has(asset.id) ? " is-lineage" : ""}`}
            key={asset.id}
          >
            <Hint
              label={historyLabel(
                asset,
                job,
                activeCaptures.length,
                rootCaptureCount,
              )}
            >
              <button
                className="ie-history-thumb"
                aria-label={asset.name}
                role="option"
                {...collection.getItemProps(asset.id)}
                onClick={(event) => collection.select(asset.id, event)}
              >
                <img src={assetUrl(asset)} alt="" />
                {(activeCaptures.length > 0 || activeVersion) && (
                  <span className="ie-active-dot" aria-hidden />
                )}
              </button>
            </Hint>
            <span className="ie-history-name">{asset.name}</span>
            <div className="ie-history-actions">
              {job && (
                <Hint label="Reuse this edit's prompt and settings">
                  <button
                    className="icon-button"
                    aria-label="Reuse settings"
                    onClick={() => onReuse(job)}
                  >
                    <ArrowClockwise />
                  </button>
                </Hint>
              )}
              <Hint
                label={
                  activeEverywhere
                    ? "Active in every linked capture"
                    : "Make active for this history and its scene captures"
                }
              >
                <button
                  className={`icon-button${activeEverywhere ? " active" : ""}`}
                  aria-label="Make active"
                  disabled={activeEverywhere}
                  onClick={() =>
                    void safeCommand({
                      type: "image.activate",
                      assetId: asset.id,
                    })
                  }
                >
                  <CheckCircle weight={activeEverywhere ? "fill" : "regular"} />
                </button>
              </Hint>
            </div>
          </div>
        );
        const pending = (bySource.get(asset.id) ?? []).map((liveJob) => (
          <div
            className={`ie-history-item ie-job-card is-${liveJob.status}`}
            role="status"
            key={liveJob.id}
          >
            <Hint
              label={`${liveJob.status === "failed" ? "Edit failed" : liveJob.status === "queued" ? "Waiting" : "Generating"}: ${liveJob.error ?? liveJob.input.prompt}`}
            >
              <span className="ie-history-thumb ie-job-preview">
                {liveJob.status === "failed" ? (
                  <WarningCircle size={16} />
                ) : (
                  <span className="ie-job-pulse" />
                )}
              </span>
            </Hint>
            <div className="ie-history-actions is-pinned">
              {liveJob.status === "failed" && (
                <Hint label="Retry edit">
                  <button
                    className="icon-button"
                    aria-label="Retry edit"
                    onClick={() => onRetry(liveJob.id)}
                  >
                    <ArrowClockwise />
                  </button>
                </Hint>
              )}
            </div>
          </div>
        ));
        return [item, ...pending];
      })}
    </div>
  );
}

function historyLabel(
  asset: Asset,
  job: ReturnType<typeof jobForAsset>,
  active: number,
  linked: number,
) {
  const time = new Date(job?.createdAt ?? asset.modifiedAt).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return [
    asset.name,
    job
      ? `${job.input.settings.model.includes("pro") ? "Nano Banana Pro" : "Nano Banana 2"} · ${job.input.settings.resolution} · ${time}`
      : time,
    job?.input.prompt,
    linked ? `Active in ${active} of ${linked} captures` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}
