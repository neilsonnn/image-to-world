import {
  Aperture,
  ArrowClockwise,
  Eye,
  EyeSlash,
  Gear,
  ImageSquare,
  Lightning,
  SpinnerGap,
  Trash,
  UploadSimple,
  X,
} from "@phosphor-icons/react";
import {
  Button,
  Flex,
  SegmentedControl,
  Switch,
  Text,
  Tooltip,
} from "@radix-ui/themes";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import {
  atlasContextNodes,
  captureFrameStatus,
  captureOrigin,
  isVisible,
  orderedCaptures,
  selectedPath,
} from "../../../core/captures";
import {
  closestFormat,
  lockedFormat,
  sessionFormat,
} from "../../../core/formats";
import { generationInput } from "../../../core/generation";
import { assetUrl, type Job, type Workspace } from "../../../core/schema";
import type { SelectionState } from "../../../core/selection";
import { useWorldbashClient, useWorkspaceData } from "../lib/client";
import { useGlobalShortcuts } from "../lib/shortcuts";
import { useCollection } from "../lib/useCollection";
import { liveViewportCamera } from "../lib/viewport-camera";
import type { RequestPlacement } from "./ImageImport";
import { NumericInput } from "./NumericInput";
import { Hint, PanelHeader, PromptButton, ToolbarPopover } from "./ui";
import "../atlas.css";

/** Atlas accepts at most this many context views per request. */
const MAX_CONTEXT_FRAMES = 64;
/** Published atlasGenerate credits for one target view, with and without depth. */
const RENDER_CREDITS = { depth: 50, rgb: 40 };

type DockWorkspace = ReturnType<typeof useDockWorkspace>;

function useDockWorkspace() {
  return useWorkspaceData(
    [
      "nodes",
      "assets",
      "jobs",
      "selection",
      "primaryId",
      "selectionAnchor",
      "imageDrafts",
      "imageVersions",
    ],
    [
      "atlas",
      "atlasPanel",
      "prompt",
      "seed",
      "seedMode",
      "enhancePrompt",
      "atlasReturnDepth",
      "format",
      "viewingCameraId",
      "viewportCamera",
      "editor2d",
      "fps",
      "targetFrameCount",
    ],
  );
}

/** Keep proportions subtle so portrait and landscape tiles share a row. */
function thumbnailAspect({ width, height }: { width: number; height: number }) {
  return Math.max(0.85, Math.min(1.4, Math.sqrt(width / height)));
}

const isActive = (job: Job | undefined) =>
  job?.status === "queued" || job?.status === "running";

export function AtlasDock({
  requestPlacement,
}: {
  requestPlacement: RequestPlacement;
}) {
  const workspace = useDockWorkspace();
  return (
    <SpatialContext
      workspace={workspace}
      requestPlacement={requestPlacement}
      settings={
        <ToolbarPopover
          label="Frame generation settings"
          icon={<Gear />}
          width={240}
        >
          <PanelHeader title="Frame generation" />
          <GenerationSettings workspace={workspace} />
        </ToolbarPopover>
      }
    >
      <NewFrames workspace={workspace} />
    </SpatialContext>
  );
}

function SpatialContext({
  workspace,
  requestPlacement,
  settings,
  children,
}: {
  workspace: DockWorkspace;
  requestPlacement: RequestPlacement;
  /** Header control for generation settings, after import. */
  settings: ReactNode;
  /** Generation controls at the right end of the strip. */
  children: ReactNode;
}) {
  const { safeCommand, upload, setError } = useWorldbashClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const path = selectedPath(workspace);
  const captures = orderedCaptures(workspace, path?.id);
  const captureIds = captures.map(({ id }) => id);
  const context = atlasContextNodes(workspace, undefined, path?.id);
  const generating = Object.values(workspace.jobs)
    .filter((job) => job.input.kind === "atlas" && isActive(job))
    .sort((a, b) => a.createdAt - b.createdAt);
  const posing = captures.filter(
    (node) => node.jobId && isActive(workspace.jobs[node.jobId]),
  ).length;
  const inputCount = context.length + posing;
  const locked = lockedFormat(workspace);
  const full = inputCount >= MAX_CONTEXT_FRAMES;

  const collection = useCollection({
    id: "spatial-context",
    visibleIds: captureIds,
    layout: "grid",
    selection: {
      ids: workspace.selection,
      primaryId: workspace.primaryId,
      anchorId: workspace.selectionAnchor,
    },
    onSelectionChange: (next: SelectionState) =>
      safeCommand({
        type: "selection.set",
        ids: next.ids,
        primaryId: next.primaryId,
        anchorId: next.anchorId,
      }),
    onNavigate: (id) => void safeCommand({ type: "camera.view", nodeId: id }),
    onOpen: (id) => void safeCommand({ type: "camera.view", nodeId: id }),
    onDelete: () => {
      const ids = workspace.selection.filter((id) => captureIds.includes(id));
      if (ids.length) void safeCommand({ type: "nodes.remove", ids });
    },
    onUndo: () => void safeCommand({ type: "history.undo" }),
    onRedo: () => void safeCommand({ type: "history.redo" }),
  });

  const itemKey = [...captureIds, ...generating.map((job) => job.id)].join();
  const seen = useRef(new Set<string>());
  useEffect(() => {
    const before = seen.current;
    seen.current = new Set(itemKey.split(","));
    if ([...seen.current].some((id) => id && !before.has(id)))
      strip.current?.scrollTo({ left: strip.current.scrollWidth });
  }, [itemKey]);

  const importFiles = (files: File[]) =>
    void upload(files)
      .then((assets) =>
        requestPlacement(assets, liveViewportCamera() ?? undefined),
      )
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      );

  return (
    <section
      className="shell-pane spatial-context-pane"
      aria-label="Spatial context"
      {...collection.paneProps}
      style={
        {
          "--context-thumbnail-aspect": thumbnailAspect(
            sessionFormat(workspace),
          ),
        } as CSSProperties
      }
    >
      <PanelHeader
        title={
          <span className="spatial-context-title">
            <ImageSquare size={14} weight="fill" />
            <strong>
              {path ? `Spatial context · ${path.name}` : "Spatial context"}
            </strong>
            <span className="quiet">
              {inputCount} of {MAX_CONTEXT_FRAMES}
            </span>
          </span>
        }
      >
        <Hint
          label={
            locked
              ? "Aspect ratio and image size, fixed across all images"
              : "Aspect ratio and image size, chosen on first import"
          }
        >
          <span className="format-chip">
            {locked
              ? `${closestFormat(locked).aspectRatio} · ${locked.width} × ${locked.height}`
              : "Format set on first import"}
          </span>
        </Hint>
        <Hint
          label={
            full
              ? `Input is limited to ${MAX_CONTEXT_FRAMES} images`
              : "Import images"
          }
        >
          <button
            className="icon-button"
            aria-label="Import images"
            disabled={full}
            onClick={() => fileInput.current?.click()}
          >
            <UploadSimple />
          </button>
        </Hint>
        <input
          ref={fileInput}
          hidden
          multiple
          type="file"
          accept="image/*"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (files.length) importFiles(files);
          }}
        />
        {settings}
      </PanelHeader>
      <div className="atlas-dock-body">
        <div
          ref={strip}
          className="spatial-context-strip"
          role="listbox"
          aria-label="Spatial context captures"
          aria-multiselectable="true"
          onWheel={(event) => {
            if (Math.abs(event.deltaY) > Math.abs(event.deltaX))
              event.currentTarget.scrollLeft += event.deltaY;
          }}
        >
          {captures.map((node) => (
            <CaptureTile
              key={node.id}
              id={node.id}
              workspace={workspace}
              inContext={context.some((item) => item.id === node.id)}
              itemProps={collection.getItemProps(node.id)}
              onSelect={(event) => collection.select(node.id, event)}
            />
          ))}
          {generating.map((job) => (
            <GeneratingTile key={job.id} job={job} />
          ))}
          {!captures.length && !generating.length && (
            <div className="spatial-context-empty">
              <ImageSquare size={18} />
              <span>
                Drop images on the viewport or import them to build context.
              </span>
            </div>
          )}
        </div>
        {children}
      </div>
    </section>
  );
}

function CaptureTile({
  id,
  workspace,
  inContext,
  itemProps,
  onSelect,
}: {
  id: string;
  workspace: DockWorkspace;
  inContext: boolean;
  itemProps: ReturnType<ReturnType<typeof useCollection>["getItemProps"]>;
  onSelect: (event: React.MouseEvent) => void;
}) {
  const { safeCommand } = useWorldbashClient();
  const node = workspace.nodes[id];
  const asset = node.assetId ? workspace.assets[node.assetId] : undefined;
  const job = node.jobId ? workspace.jobs[node.jobId] : undefined;
  const pending = isActive(job) ? job : undefined;
  const failed = job?.status === "failed" && !asset?.camera ? job : undefined;
  const visible = isVisible(workspace, node);
  const generated = captureOrigin(workspace, id) === "generated";
  const { error } = captureFrameStatus(workspace, id);
  const status = failed
    ? (failed.error ?? "Posing failed")
    : pending
      ? pending.status === "queued"
        ? "Queued"
        : pending.message || "Posing"
      : !visible
        ? "Hidden from the context"
        : !inContext
          ? (error ?? "Excluded from the context")
          : node.name;
  const camera = asset?.camera?.intrinsics;
  return (
    <article
      className={`context-tile${workspace.selection.includes(id) ? " selected" : ""}${inContext && !pending ? "" : " is-muted"}`}
      style={camera ? { aspectRatio: thumbnailAspect(camera) } : undefined}
    >
      <Tooltip content={status} delayDuration={0}>
        <div
          className="context-tile-select"
          role="option"
          aria-label={node.name}
          {...itemProps}
          onClick={(event) => {
            onSelect(event);
            if (!event.metaKey && !event.ctrlKey && !event.shiftKey)
              void safeCommand({ type: "camera.view", nodeId: id });
          }}
        >
          {asset?.kind === "image" && !asset.missing ? (
            <img src={assetUrl(asset)} alt="" draggable={false} />
          ) : (
            <ImageSquare size={18} />
          )}
          {pending && (
            <span className="context-tile-status">
              <SpinnerGap className="spin" />
            </span>
          )}
        </div>
      </Tooltip>
      {generated && (
        <Hint label="Generated view">
          <span className="context-tile-tag" aria-label="Generated view">
            <Aperture weight="fill" />
          </span>
        </Hint>
      )}
      <div className={`context-tile-actions${failed ? " is-pinned" : ""}`}>
        {failed && (
          <Hint label="Retry posing">
            <button
              aria-label={`Retry ${node.name}`}
              onClick={() =>
                void safeCommand({ type: "jobs.retry", id: failed.id })
              }
            >
              <ArrowClockwise />
            </button>
          </Hint>
        )}
        {!pending && !failed && (
          <Hint
            label={visible ? "Hide from the context" : "Show in the context"}
          >
            <button
              aria-label={
                visible
                  ? `Hide ${node.name} from the context`
                  : `Show ${node.name} in the context`
              }
              onClick={() =>
                void safeCommand({
                  type: "nodes.put",
                  nodes: [{ ...node, visible: !node.visible }],
                })
              }
            >
              {visible ? <Eye /> : <EyeSlash />}
            </button>
          </Hint>
        )}
        <Hint label={pending || failed ? "Remove image" : "Delete capture"}>
          <button
            aria-label={`Remove ${node.name}`}
            onClick={() => {
              if (pending)
                void safeCommand({ type: "jobs.cancel", id: pending.id });
              void safeCommand({ type: "nodes.remove", ids: [id] });
            }}
          >
            {pending || failed ? <X /> : <Trash />}
          </button>
        </Hint>
      </div>
    </article>
  );
}

function GeneratingTile({ job }: { job: Job }) {
  const { safeCommand } = useWorldbashClient();
  const status =
    job.status === "queued" ? "Queued" : job.message || "Generating";
  return (
    <article className="context-tile is-generating">
      <Tooltip content={status} delayDuration={0}>
        <div className="context-tile-select" aria-label={`New view, ${status}`}>
          <span className="context-tile-status">
            <SpinnerGap className="spin" />
          </span>
        </div>
      </Tooltip>
      <div className="context-tile-actions">
        <Hint label="Cancel this view">
          <button
            aria-label="Cancel this view"
            onClick={() =>
              void safeCommand({ type: "jobs.cancel", id: job.id })
            }
          >
            <X />
          </button>
        </Hint>
      </div>
    </article>
  );
}

function NewFrames({ workspace }: { workspace: DockWorkspace }) {
  const { safeCommand } = useWorldbashClient();
  const path = selectedPath(workspace);
  let blocked: string | null = null;
  try {
    const input = generationInput(workspace, { kind: "view" });
    if (input.kind === "atlas" && !input.nodeIds.length)
      blocked = "Add posed images to the spatial context first";
  } catch (cause) {
    blocked = cause instanceof Error ? cause.message : String(cause);
  }
  const render = () => {
    if (blocked) return;
    void safeCommand({
      type: "generation.submit",
      request: {
        kind: "view",
        contextPathId: path?.id ?? null,
        camera: liveViewportCamera() ?? undefined,
      },
    });
  };
  useGlobalShortcuts((event) => {
    if (event.key !== "Enter" || !event.shiftKey) return;
    if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
    const target = event.target instanceof Element ? event.target : null;
    if (
      target?.closest(
        "input, textarea, select, [contenteditable], [role='dialog']",
      )
    )
      return;
    event.preventDefault();
    render();
  });
  const credits = workspace.settings.atlasReturnDepth
    ? RENDER_CREDITS.depth
    : RENDER_CREDITS.rgb;
  return (
    <section className="new-frames" aria-label="New frames">
      <PromptButton
        label="Describe the scene"
        hint="Describe the scene for Atlas and splats"
        placeholder="Add details that are not obvious in the photos, such as a 3D CGI scene with hand-painted textures"
        note="Sent with every render and splat reconstruction."
        value={workspace.settings.prompt}
        onChange={(prompt) =>
          void safeCommand({ type: "workspace.update", settings: { prompt } })
        }
      />
      <Hint label={blocked ?? "Render the current view (Shift+Enter)"}>
        <Button
          size="1"
          variant="surface"
          color="gray"
          className="new-frames-render"
          aria-keyshortcuts="Shift+Enter"
          disabled={blocked !== null}
          onClick={(event) => {
            if (event.detail > 0) event.currentTarget.blur();
            render();
          }}
        >
          Render
          <span className="credit-chip">
            <Lightning weight="fill" />
            {credits}
          </span>
        </Button>
      </Hint>
    </section>
  );
}

function GenerationSettings({ workspace }: { workspace: DockWorkspace }) {
  const { safeCommand } = useWorldbashClient();
  const { seed, seedMode, enhancePrompt, atlasReturnDepth } =
    workspace.settings;
  const update = (settings: Partial<Workspace["settings"]>) =>
    void safeCommand({ type: "workspace.update", settings });
  return (
    <div className="settings-popover">
      <Flex direction="column" gap="1">
        <Text size="1" color="gray">
          {seedMode === "auto" ? "Next seed" : "Seed"}
        </Text>
        <Flex gap="2" align="center">
          <NumericInput
            label="Seed"
            value={seed}
            min={0}
            step={1}
            onCommit={(value) => update({ seed: Math.round(value) })}
          />
          <SegmentedControl.Root
            size="1"
            value={seedMode}
            onValueChange={(value) =>
              update({ seedMode: value as "auto" | "locked" })
            }
          >
            <SegmentedControl.Item value="auto">Auto</SegmentedControl.Item>
            <SegmentedControl.Item value="locked">Lock</SegmentedControl.Item>
          </SegmentedControl.Root>
        </Flex>
        <Text size="1" color="gray">
          {seedMode === "auto"
            ? "Each render uses the next seed."
            : "Every render reuses this seed."}
        </Text>
      </Flex>
      <Flex justify="between" align="center">
        <Text size="1">Enhance prompt</Text>
        <Tooltip
          delayDuration={0}
          content="Let Atlas improve the scene description"
        >
          <Switch
            size="1"
            aria-label="Enhance prompt"
            checked={enhancePrompt}
            onCheckedChange={(value) => update({ enhancePrompt: value })}
          />
        </Tooltip>
      </Flex>
      <Flex justify="between" align="center">
        <Text size="1">Generate depth</Text>
        <Tooltip
          delayDuration={0}
          content="Return depth so new frames can join the context; requires camera translation"
        >
          <Switch
            size="1"
            aria-label="Generate depth"
            checked={atlasReturnDepth}
            onCheckedChange={(value) => update({ atlasReturnDepth: value })}
          />
        </Tooltip>
      </Flex>
    </div>
  );
}
