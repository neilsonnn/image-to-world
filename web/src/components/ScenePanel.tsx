import { ToolbarMenu } from "./ui";
import { useWorldbashClient, useWorkspaceData } from "../lib/client";
import { NodeIcon, nodePresentation } from "./NodeIcon";
import { sceneCamera } from "../../../core/captures";
import { cameraNodeData } from "../../../core/cameras";
import { DropdownMenu } from "@radix-ui/themes";
import {
  CaretDown,
  CaretRight,
  Eye,
  EyeSlash,
  MagnifyingGlass,
  Plus,
  Stack,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { collectionTreeRows } from "../../../core/collections";
import {
  inactiveNodeIds,
  orderedChildren,
  selectedRoots,
} from "../../../core/scene";
import { identity, type SceneNode } from "../../../core/schema";
import type { SelectionState } from "../../../core/selection";
import {
  collectionDragPayload,
  startCollectionDrag,
  endCollectionDrag,
} from "../lib/drag";
import { useCollection } from "../lib/useCollection";
import type { SharedProps } from "./panelShared";
import { uid } from "./panelShared";
import { CollectionActions } from "./CollectionActions";
import { CollectionSearch, useCollectionSearch } from "./CollectionSearch";
import { Hint, PanelHeader } from "./ui";

const NEW_NODES = (["group", "clip", "camera", "path"] as const).map(
  (kind) => ({ kind, ...nodePresentation[kind] }),
);

type Position = "before" | "inside" | "after";
type Target = { id: string; position: Position; valid: boolean };

function dropPosition(event: DragEvent): Position {
  const rect = event.currentTarget.getBoundingClientRect();
  const ratio = (event.clientY - rect.top) / rect.height;
  return ratio < 0.28 ? "before" : ratio > 0.72 ? "after" : "inside";
}

export function ScenePanel({
  requestPlacement,
}: Pick<SharedProps, "requestPlacement">) {
  const {
    setHoveredNode,
    command,
    safeCommand,
    upload,
    getWorkspace,
    setError: onError,
  } = useWorldbashClient();
  const workspace = useWorkspaceData(
    ["nodes", "assets", "selection", "primaryId", "selectionAnchor"],
    ["collections"],
  );
  const expanded = new Set(workspace.settings.collections.expandedNodeIds);
  const [searchOpen, setSearchOpen] = useState(false);
  const [sceneSearch, setSceneSearch] = useCollectionSearch(
    workspace.settings.collections.sceneSearch,
    (value) =>
      safeCommand({
        type: "workspace.update",
        settings: { collections: { sceneSearch: value } },
      }),
  );
  const [rename, setRename] = useState<{ id: string; value: string } | null>(
    null,
  );
  const [target, setTarget] = useState<Target | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rows = useMemo(
    () =>
      collectionTreeRows(
        workspace.nodes,
        workspace.settings.collections.expandedNodeIds,
        sceneSearch,
      ),
    [
      workspace.nodes,
      workspace.settings.collections.expandedNodeIds,
      sceneSearch,
    ],
  );
  const visibleIds = rows.map(({ node }) => node.id);
  const setSelection = (next: SelectionState) =>
    safeCommand({
      type: "selection.set",
      ids: next.ids,
      primaryId: next.primaryId,
      anchorId: next.anchorId,
    });
  const setExpanded = (next: Set<string>) =>
    void safeCommand({
      type: "workspace.update",
      settings: {
        collections: {
          expandedNodeIds: [...next],
        },
      },
    });
  const toggle = (id: string, open = false) => {
    const next = new Set(expanded);
    if (open || !next.has(id)) next.add(id);
    else next.delete(id);
    setExpanded(next);
  };
  const selectedNodeIds = () =>
    workspace.selection.filter((id) => visibleIds.includes(id));
  const nodeIdsForRow = (id: string) =>
    workspace.selection.includes(id) ? selectedNodeIds() : [id];
  const removeNodes = (ids: string[]) =>
    void safeCommand({
      type: "nodes.remove",
      ids: selectedRoots(workspace.nodes, ids),
    });
  const collection = useCollection({
    id: "scene",
    visibleIds,
    selection: {
      ids: workspace.selection,
      primaryId: workspace.primaryId,
      anchorId: workspace.selectionAnchor,
    },
    onSelectionChange: setSelection,
    onUndo: () => void safeCommand({ type: "history.undo" }),
    onRedo: () => void safeCommand({ type: "history.redo" }),
    onDuplicate: () => {
      const ids = selectedNodeIds();
      if (ids.length) void safeCommand({ type: "nodes.duplicate", ids });
    },
    onOpen: (id) => {
      if (sceneCamera(workspace, id)) {
        void safeCommand({ type: "camera.view", nodeId: id });
        return;
      }
      const assetId = workspace.nodes[id]?.assetId;
      if (assetId && workspace.assets[assetId]?.kind === "image")
        void safeCommand({
          type: "workspace.update",
          settings: {
            editor2d: {
              ...getWorkspace().settings.editor2d,
              activeAssetId: assetId,
            },
          },
        });
    },
    onDelete: () => {
      const ids = selectedNodeIds();
      if (ids.length) removeNodes(ids);
    },
    onMoveToParent: () => {
      const ids = selectedNodeIds();
      const node = workspace.primaryId
        ? workspace.nodes[workspace.primaryId]
        : undefined;
      if (ids.length && node?.parentId)
        void safeCommand({
          type: "nodes.move",
          ids,
          parentId: workspace.nodes[node.parentId]?.parentId ?? null,
        });
    },
    onRename: (id) => setRename({ id, value: workspace.nodes[id].name }),
    onLeft: (id) => {
      if (
        !sceneSearch.trim() &&
        orderedChildren(workspace.nodes, id).length &&
        expanded.has(id)
      ) {
        toggle(id);
        return;
      }
      return workspace.nodes[id]?.parentId;
    },
    onRight: (id) => {
      const children = orderedChildren(workspace.nodes, id);
      if (!children.length) return;
      if (!sceneSearch.trim() && !expanded.has(id)) {
        toggle(id);
        return;
      }
      return children.find((child) => visibleIds.includes(child.id))?.id;
    },
    onEscape: () => {
      setRename(null);
      clearDrag();
    },
  });
  const create = async (kind: "group" | "clip" | "camera" | "path") => {
    const id = uid(kind);
    const clipParent = selectedNodeIds()
      .map((nodeId) => workspace.nodes[nodeId])
      .find(Boolean);
    const base = {
      id,
      name: kind[0].toUpperCase() + kind.slice(1),
      kind,
      parentId: kind === "clip" && clipParent ? clipParent.id : null,
      visible: true,
      transform: identity(),
    } as SceneNode;
    const node: SceneNode =
      kind === "camera"
        ? { ...base, ...cameraNodeData(getWorkspace().settings.viewportCamera) }
        : kind === "path"
          ? { ...base, keyframes: [] }
          : kind === "clip"
            ? {
                ...base,
                clip: {
                  scope: clipParent ? "local" : "global",
                  invert: false,
                  softness: 0,
                },
              }
            : base;
    try {
      await command({
        type: "edit.batch",
        commands: [
          { type: "nodes.put", nodes: [node] },
          ...(kind === "group" && selectedNodeIds().length
            ? [
                {
                  type: "nodes.move" as const,
                  ids: selectedRoots(workspace.nodes, selectedNodeIds()),
                  parentId: id,
                },
              ]
            : []),
        ],
      });
      await command({
        type: "selection.set",
        ids: [id],
        primaryId: id,
        anchorId: id,
      });
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const place = (node: SceneNode, position: Position) => {
    if (position === "inside") return { parentId: node.id, beforeId: null };
    const siblings = orderedChildren(workspace.nodes, node.parentId);
    const index = siblings.findIndex(({ id }) => id === node.id);
    return {
      parentId: node.parentId,
      beforeId:
        position === "before" ? node.id : (siblings[index + 1]?.id ?? null),
    };
  };
  const valid = (ids: string[], node: SceneNode, position: Position) => {
    const roots = new Set(selectedRoots(workspace.nodes, ids));
    const destination = place(node, position);
    if (destination.beforeId && roots.has(destination.beforeId)) return false;
    let parentId = destination.parentId;
    while (parentId) {
      if (roots.has(parentId)) return false;
      parentId = workspace.nodes[parentId]?.parentId ?? null;
    }
    return position !== "inside" || !roots.has(node.id);
  };
  const clearDrag = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setTarget(null);
    endCollectionDrag();
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      endCollectionDrag();
    },
    [],
  );
  const drop = async (
    event: DragEvent,
    node?: SceneNode,
    position: Position = "inside",
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const camera = getWorkspace().settings.viewportCamera;
    const files = Array.from(event.dataTransfer.files);
    const data = collectionDragPayload(event);
    clearDrag();
    const destination = node
      ? place(node, position)
      : { parentId: null, beforeId: null };
    if (!data) {
      if (!files.length) return;
      try {
        requestPlacement(await upload(files), camera, destination);
      } catch (cause) {
        onError(cause instanceof Error ? cause.message : String(cause));
      }
      return;
    }
    if (data.kind === "nodes") {
      if (!node || valid(data.ids, node, position))
        await safeCommand({
          type: "nodes.move",
          ids: data.ids,
          ...destination,
        });
      return;
    }
    const assets = data.ids.map((id) => workspace.assets[id]);
    const missingId = data.ids.find((_, index) => !assets[index]);
    if (missingId) {
      onError(`Asset ${missingId} is unavailable`);
      return;
    }
    requestPlacement(
      assets.filter((asset) => asset !== undefined),
      camera,
      destination,
    );
  };
  const searching = searchOpen || sceneSearch !== "";
  const inactive = inactiveNodeIds(workspace.nodes);
  return (
    <>
      <PanelHeader title="Outline">
        <Hint label="Search the outline">
          <button
            className={`icon-button${searching ? " active" : ""}`}
            aria-label="Search the outline"
            aria-pressed={searching}
            onClick={() => {
              if (searching) setSceneSearch("");
              setSearchOpen(!searching);
            }}
          >
            <MagnifyingGlass />
          </button>
        </Hint>
        <ToolbarMenu>
          <Hint label="Add to the scene">
            <DropdownMenu.Trigger>
              <button className="icon-button" aria-label="Add to the scene">
                <Plus />
              </button>
            </DropdownMenu.Trigger>
          </Hint>
          <DropdownMenu.Content size="1" align="end">
            {NEW_NODES.map(({ kind, label, icon: Icon }) => (
              <DropdownMenu.Item key={kind} onSelect={() => void create(kind)}>
                <Icon /> {label}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </ToolbarMenu>
      </PanelHeader>
      <div
        className="panel-body scene-panel"
        {...collection.paneProps}
        onPointerLeave={() => setHoveredNode(null)}
      >
        {searching && (
          <CollectionSearch
            label="Search scene outline"
            value={sceneSearch}
            onChange={setSceneSearch}
            autoFocus
            onEscape={() => {
              setSceneSearch("");
              setSearchOpen(false);
            }}
          />
        )}
        <div
          className="tree"
          role="tree"
          aria-label="Scene outline"
          aria-multiselectable="true"
          onDragOverCapture={(event) => {
            event.preventDefault();
            const rect = event.currentTarget.getBoundingClientRect();
            if (event.clientY < rect.top + 28)
              event.currentTarget.scrollTop -= 12;
            if (event.clientY > rect.bottom - 28)
              event.currentTarget.scrollTop += 12;
          }}
          onDrop={(event) => void drop(event)}
        >
          {rows.length ? (
            rows.map(({ node, depth, expanded: rowExpanded }) => {
              const children = orderedChildren(workspace.nodes, node.id);
              const dropClass =
                target?.id === node.id
                  ? ` drop-${target.position}${target.valid ? "" : " invalid"}`
                  : "";
              return (
                <div
                  key={node.id}
                  className={`tree-row${workspace.selection.includes(node.id) ? " selected" : ""}${inactive.has(node.id) ? " is-inactive" : ""}${dropClass}`}
                  style={{ paddingLeft: depth * 14 }}
                  draggable={rename?.id !== node.id}
                  onDragStart={(event) => {
                    const ids = workspace.selection.includes(node.id)
                      ? selectedNodeIds()
                      : [node.id];
                    startCollectionDrag(event, {
                      kind: "nodes",
                      ids: selectedRoots(workspace.nodes, ids),
                    });
                  }}
                  onPointerEnter={() => setHoveredNode(node.id)}
                  onPointerLeave={() => setHoveredNode(null)}
                  onDragEnd={clearDrag}
                  onDragLeave={() => {
                    if (timer.current) clearTimeout(timer.current);
                    timer.current = null;
                  }}
                  onDragOver={(event) => {
                    const data = collectionDragPayload(event);
                    const files = event.dataTransfer.types.includes("Files");
                    if (!data && !files) return;
                    event.dataTransfer.dropEffect =
                      data?.kind === "nodes" ? "move" : "copy";
                    event.preventDefault();
                    event.stopPropagation();
                    const position = dropPosition(event);
                    setTarget({
                      id: node.id,
                      position,
                      valid:
                        files ||
                        data?.kind === "assets" ||
                        valid(data?.ids ?? [], node, position),
                    });
                    if (
                      position === "inside" &&
                      children.length &&
                      !sceneSearch.trim() &&
                      !expanded.has(node.id) &&
                      !timer.current
                    )
                      timer.current = setTimeout(() => {
                        toggle(node.id, true);
                        timer.current = null;
                      }, 650);
                  }}
                  onDrop={(event) => {
                    const data = collectionDragPayload(event);
                    const position = dropPosition(event);
                    if (
                      event.dataTransfer.files.length ||
                      data?.kind === "assets" ||
                      (data?.kind === "nodes" &&
                        valid(data.ids, node, position))
                    )
                      void drop(event, node, position);
                    else {
                      event.preventDefault();
                      event.stopPropagation();
                      clearDrag();
                    }
                  }}
                >
                  <Hint
                    label={
                      children.length
                        ? sceneSearch
                          ? "Clear search to change expansion"
                          : `${!rowExpanded ? "Expand" : "Collapse"} ${node.name}`
                        : `${node.name} has no children`
                    }
                  >
                    <button
                      className="icon-button disclosure"
                      disabled={!children.length || Boolean(sceneSearch)}
                      aria-label={`${!rowExpanded ? "Expand" : "Collapse"} ${node.name}`}
                      onClick={() => toggle(node.id)}
                    >
                      {children.length ? (
                        !rowExpanded ? (
                          <CaretRight />
                        ) : (
                          <CaretDown />
                        )
                      ) : null}
                    </button>
                  </Hint>
                  {rename?.id === node.id ? (
                    <input
                      className="tree-rename"
                      autoFocus
                      value={rename.value}
                      onChange={(event) =>
                        setRename({ ...rename, value: event.target.value })
                      }
                      onBlur={() => setRename(null)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setRename(null);
                        if (event.key === "Enter" && rename.value.trim()) {
                          void safeCommand({
                            type: "nodes.put",
                            nodes: [{ ...node, name: rename.value.trim() }],
                          });
                          setRename(null);
                        }
                      }}
                    />
                  ) : (
                    <button
                      className="tree-label"
                      data-node-kind={node.kind}
                      role="treeitem"
                      aria-level={depth + 1}
                      aria-expanded={children.length ? rowExpanded : undefined}
                      {...collection.getItemProps(node.id)}
                      onClick={(event) => collection.select(node.id, event)}
                      onDoubleClick={() => {
                        if (sceneCamera(workspace, node.id))
                          void safeCommand({
                            type: "camera.view",
                            nodeId: node.id,
                          });
                      }}
                    >
                      <NodeIcon kind={node.kind} />
                      <span>{node.name}</span>
                    </button>
                  )}
                  <CollectionActions
                    name={node.name}
                    deleteLabel={`Remove ${node.name} from scene`}
                    onDelete={() => removeNodes(nodeIdsForRow(node.id))}
                  >
                    <Hint label={node.visible ? "Hide" : "Show"}>
                      <button
                        type="button"
                        className="collection-row-action"
                        aria-label={
                          node.visible
                            ? `Hide ${node.name}`
                            : `Show ${node.name}`
                        }
                        aria-pressed={!node.visible}
                        onClick={() =>
                          void safeCommand({
                            type: "nodes.put",
                            nodes: [{ ...node, visible: !node.visible }],
                          })
                        }
                      >
                        {node.visible ? <Eye /> : <EyeSlash />}
                      </button>
                    </Hint>
                  </CollectionActions>
                </div>
              );
            })
          ) : (
            <div className="empty-state">
              <Stack size={24} />
              <strong>
                {sceneSearch ? "No matching objects" : "No scene objects"}
              </strong>
              <span>
                {sceneSearch
                  ? "Try a different name or kind."
                  : "Add a group or import an asset into the viewport."}
              </span>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
