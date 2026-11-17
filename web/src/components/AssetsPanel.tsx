import { ActivityBadge } from "./ActivityFeed";
import { useImageToWorldClient, useWorkspaceData } from "../lib/client";
import { Button, Checkbox, Flex, Popover, Text } from "@radix-ui/themes";
import {
  Cube,
  FunnelSimple,
  FolderOpen,
  List,
  SquaresFour,
  Trash,
  UploadSimple,
  VideoCamera,
} from "@phosphor-icons/react";
import { memo, useRef, useState } from "react";
import { collectionMatches } from "../../../core/collections";
import { assetUrl, type Asset } from "../../../core/schema";
import type { SelectionState } from "../../../core/selection";
import { startCollectionDrag, endCollectionDrag } from "../lib/drag";
import { useCollection } from "../lib/useCollection";
import { openImage } from "./panelShared";
import { CollectionActions } from "./CollectionActions";
import { CollectionSearch, useCollectionSearch } from "./CollectionSearch";
import { Hint } from "./ui";

const ASSET_KINDS = [
  { kind: "image", label: "Images" },
  { kind: "depth", label: "Depth and confidence" },
  { kind: "mesh", label: "Meshes" },
  { kind: "splat", label: "Splats" },
  { kind: "video", label: "Videos" },
  { kind: "file", label: "Other files" },
] as const;

export function AssetsPanel() {
  const {
    command,
    safeCommand,
    upload,
    getWorkspace,
    setError: onError,
  } = useImageToWorldClient();
  const workspace = useWorkspaceData(
    ["assets", "selection", "primaryId", "selectionAnchor"],
    ["collections"],
  );
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [rename, setRename] = useState<{ id: string; value: string } | null>(
    null,
  );
  const { assetTrash, assetKinds } = workspace.settings.collections;
  const [assetSearch, setAssetSearch] = useCollectionSearch(
    workspace.settings.collections.assetSearch,
    (value) =>
      safeCommand({
        type: "workspace.update",
        settings: { collections: { assetSearch: value } },
      }),
  );
  const assets = Object.values(workspace.assets)
    .filter((asset) => (asset.trashedAt !== undefined) === assetTrash)
    .filter((asset) => assetKinds.includes(asset.kind))
    .filter((asset) =>
      collectionMatches(assetSearch, [asset.name, asset.kind, asset.path]),
    )
    .sort((a, b) => b.modifiedAt - a.modifiedAt);
  const visibleIds = assets.map(({ id }) => id);
  const selectedAsset = workspace.primaryId
    ? workspace.assets[workspace.primaryId]
    : undefined;
  const setSelection = (next: SelectionState) =>
    safeCommand({
      type: "selection.set",
      ids: next.ids,
      primaryId: next.primaryId,
      anchorId: next.anchorId,
    });
  const assetIdsForRow = (id: string) =>
    workspace.selection.includes(id)
      ? workspace.selection.filter((selectedId) =>
          visibleIds.includes(selectedId),
        )
      : [id];
  const trashAssets = (ids: string[]) =>
    void safeCommand({ type: "assets.trash", ids });
  const restoreAssets = (ids: string[]) =>
    void safeCommand({ type: "assets.restore", ids });
  const collection = useCollection({
    id: "assets",
    visibleIds,
    layout: workspace.settings.collections.assetView,
    selection: {
      ids: workspace.selection,
      primaryId: workspace.primaryId,
      anchorId: workspace.selectionAnchor,
    },
    onSelectionChange: setSelection,
    onUndo: () => void safeCommand({ type: "history.undo" }),
    onRedo: () => void safeCommand({ type: "history.redo" }),
    onOpen: assetTrash
      ? undefined
      : (id) => void openImage(getWorkspace(), safeCommand, id),
    onDelete: assetTrash
      ? undefined
      : () => {
          const ids = workspace.selection.filter((id) =>
            visibleIds.includes(id),
          );
          if (ids.length) trashAssets(ids);
        },
    onRename: (id) => setRename({ id, value: workspace.assets[id].name }),
    onEscape: () => {
      setRename(null);
      endCollectionDrag();
    },
  });
  // Rows read handlers through this ref so a selection change re-renders only
  // the rows whose own props changed, not all of a large library.
  const rowActions = useRef<RowActions>(null!);
  rowActions.current = {
    itemRef: (id, element) => collection.getItemProps(id).ref(element),
    select: (id, event) => collection.select(id, event),
    open: (id) => collection.getItemProps(id).onDoubleClick?.(),
    dragIds: (id) =>
      getWorkspace().selection.includes(id)
        ? getWorkspace().selection.filter((item) => getWorkspace().assets[item])
        : [id],
    setRename: (id, value) => setRename(id ? { id, value: value ?? "" } : null),
    rename: (id, name) =>
      void safeCommand({ type: "assets.update", id, patch: { name } }),
    reveal: (id) => void safeCommand({ type: "assets.reveal", id }),
    trash: (id) => trashAssets(assetIdsForRow(id)),
    restore: (id) => restoreAssets(assetIdsForRow(id)),
  };
  const setView = (assetView: "list" | "grid") =>
    void safeCommand({
      type: "workspace.update",
      settings: {
        collections: { assetView },
      },
    });
  const setCollections = (
    patch: Partial<typeof workspace.settings.collections>,
  ) =>
    void safeCommand({
      type: "workspace.update",
      settings: {
        collections: patch,
      },
    });
  async function add(files: File[]) {
    if (!files.length) return;
    try {
      const added = await upload(files);
      if (added.length) {
        await command({
          type: "selection.set",
          ids: added.map(({ id }) => id),
          primaryId: added[0].id,
          anchorId: added[0].id,
        });
      }
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  return (
    <div className="panel-body assets-panel" {...collection.paneProps}>
      <div className="panel-actions">
        <Hint label="Import files into project assets">
          <Button
            size="1"
            variant="surface"
            color="gray"
            className="collection-toolbar-button"
            aria-label="Import files"
            onClick={() => input.current?.click()}
          >
            <UploadSimple />
          </Button>
        </Hint>
        {!assetTrash && selectedAsset?.kind === "video" && (
          <Hint label="Sample video frames and reconstruct cameras and depth in the background">
            <Button
              size="1"
              variant="surface"
              color="gray"
              className="collection-toolbar-button"
              aria-label="Reconstruct video"
              onClick={() =>
                void safeCommand({
                  type: "generation.submit",
                  request: {
                    kind: "reconstruct",
                    videoAssetId: selectedAsset.id,
                  },
                })
              }
            >
              <VideoCamera />
            </Button>
          </Hint>
        )}
        <span className="quiet">
          {assets.length} {assets.length === 1 ? "asset" : "assets"}
        </span>
        <Popover.Root>
          <Hint label="Filter asset kinds">
            <Popover.Trigger>
              <button
                className={`icon-button${assetKinds.length < ASSET_KINDS.length ? " selected" : ""}`}
                aria-label="Filter asset kinds"
              >
                <FunnelSimple />
              </button>
            </Popover.Trigger>
          </Hint>
          <Popover.Content size="1" width="200px" align="end">
            <Flex direction="column" gap="2">
              <Text size="1" color="gray">
                Show
              </Text>
              {ASSET_KINDS.map(({ kind, label }) => (
                <Text as="label" size="1" key={kind}>
                  <Flex gap="2" align="center">
                    <Checkbox
                      size="1"
                      checked={assetKinds.includes(kind)}
                      onCheckedChange={(checked) =>
                        setCollections({
                          assetKinds: checked
                            ? [...assetKinds, kind]
                            : assetKinds.filter((item) => item !== kind),
                        })
                      }
                    />
                    {label}
                  </Flex>
                </Text>
              ))}
            </Flex>
          </Popover.Content>
        </Popover.Root>
        <Hint label={assetTrash ? "Show project assets" : "Show Trash"}>
          <button
            className={`icon-button${assetTrash ? " selected" : ""}`}
            aria-label={assetTrash ? "Show project assets" : "Show Trash"}
            onClick={() => setCollections({ assetTrash: !assetTrash })}
          >
            <Trash />
          </button>
        </Hint>
        <Hint label="List view">
          <button
            className={`icon-button${workspace.settings.collections.assetView === "list" ? " selected" : ""}`}
            aria-label="List view"
            onClick={() => setView("list")}
          >
            <List />
          </button>
        </Hint>
        <Hint label="Grid view">
          <button
            className={`icon-button${workspace.settings.collections.assetView === "grid" ? " selected" : ""}`}
            aria-label="Grid view"
            onClick={() => setView("grid")}
          >
            <SquaresFour />
          </button>
        </Hint>
        <input
          ref={input}
          hidden
          multiple
          type="file"
          accept="image/*,video/*,.ply,.splat,.spz,.glb,.gltf"
          onChange={(event) => {
            void add(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
      </div>
      <CollectionSearch
        label="Search project assets"
        value={assetSearch}
        onChange={setAssetSearch}
      />
      <div
        className={`drop-zone asset-${workspace.settings.collections.assetView}`}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          if (!event.dataTransfer.files.length) return;
          event.preventDefault();
          setDragging(false);
          void add(Array.from(event.dataTransfer.files));
        }}
      >
        {!assets.length ? (
          <div className="empty-state">
            <FolderOpen size={24} />
            <strong>
              {assetSearch
                ? "No matching assets"
                : assetTrash
                  ? "Trash is empty"
                  : "Bring in source media"}
            </strong>
            <span>
              {assetSearch
                ? "Try a different name, kind, or path."
                : assetTrash
                  ? "Assets moved to Trash appear here."
                  : "Drop images, video, splats, or depth maps here."}
            </span>
          </div>
        ) : (
          <div
            className={`asset-grid${workspace.settings.collections.assetView === "list" ? " is-list" : ""}${dragging ? " dragging" : ""}`}
            role="listbox"
            aria-label="Project assets"
            aria-multiselectable="true"
          >
            {assets.map((asset) => (
              <AssetRow
                key={asset.id}
                asset={asset}
                selected={workspace.selection.includes(asset.id)}
                tabbable={asset.id === (collection.currentId ?? visibleIds[0])}
                rename={rename?.id === asset.id ? rename.value : null}
                trash={assetTrash}
                actions={rowActions}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

type RowActions = {
  itemRef: (id: string, element: HTMLElement | null) => void;
  select: (id: string, event: React.MouseEvent) => void;
  open: (id: string) => void;
  dragIds: (id: string) => string[];
  setRename: (id: string | null, value?: string) => void;
  rename: (id: string, name: string) => void;
  reveal: (id: string) => void;
  trash: (id: string) => void;
  restore: (id: string) => void;
};

const AssetRow = memo(function AssetRow({
  asset,
  selected,
  tabbable,
  rename,
  trash,
  actions,
}: {
  asset: Asset;
  selected: boolean;
  tabbable: boolean;
  rename: string | null;
  trash: boolean;
  actions: { current: RowActions };
}) {
  const id = asset.id;
  return (
    <div
      className={`asset-card${selected ? " selected" : ""}`}
      draggable={!trash && rename === null}
      onDragEnd={endCollectionDrag}
      onDragStart={(event) =>
        startCollectionDrag(event, {
          kind: "assets",
          ids: actions.current.dragIds(id),
        })
      }
    >
      <div
        className="asset-card-select"
        role="option"
        ref={(element) => actions.current.itemRef(id, element)}
        tabIndex={tabbable ? 0 : -1}
        aria-selected={selected}
        onDoubleClick={() => actions.current.open(id)}
        onClick={(event) => actions.current.select(id, event)}
      >
        <span className="asset-thumb">
          {asset.kind === "image" ||
          (asset.kind === "depth" && asset.mimeType !== "image/x-exr") ? (
            <img src={assetUrl(asset)} alt="" loading="lazy" decoding="async" />
          ) : asset.kind === "video" ? (
            <video src={assetUrl(asset)} muted preload="none" />
          ) : (
            <Cube />
          )}
        </span>
        {rename !== null ? (
          <input
            className="asset-name-input"
            autoFocus
            value={rename}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) =>
              actions.current.setRename(id, event.target.value)
            }
            onBlur={() => actions.current.setRename(null)}
            onKeyDown={(event) => {
              if (event.key === "Escape") actions.current.setRename(null);
              if (event.key === "Enter" && rename.trim()) {
                actions.current.rename(id, rename.trim());
                actions.current.setRename(null);
              }
            }}
          />
        ) : (
          <span className="asset-name">
            {asset.name}
            <ActivityBadge id={asset.id} />
          </span>
        )}
        <span className="asset-kind">{asset.kind}</span>
      </div>
      <CollectionActions
        name={asset.name}
        onReveal={() => actions.current.reveal(id)}
        onDelete={trash ? undefined : () => actions.current.trash(id)}
        onRestore={trash ? () => actions.current.restore(id) : undefined}
      />
    </div>
  );
});
