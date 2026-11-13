import { useWorldbashClient, useWorkspaceData } from "../lib/client";
import { Button } from "@radix-ui/themes";
import { Plus, SlidersHorizontal, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { Asset, Command, SceneNode } from "../../../core/schema";
import { usePaneShortcuts } from "../lib/shortcuts";
import { NumericInput } from "./NumericInput";
import { Field } from "./panelShared";
import { Hint } from "./ui";
import { transformCapabilities } from "../../../core/node-capabilities";

function common<T>(values: T[]): T | undefined {
  if (!values.length) return undefined;
  const first = JSON.stringify(values[0]);
  return values.every((value) => JSON.stringify(value) === first)
    ? values[0]
    : undefined;
}

function TextInput({
  value,
  onCommit,
}: {
  value?: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const editing = useRef(false);
  const starting = useRef(value ?? "");
  useEffect(() => {
    if (!editing.current) setDraft(value ?? "");
  }, [value]);
  const commit = () => {
    if (!editing.current) return;
    editing.current = false;
    if (draft.trim() && draft !== starting.current) onCommit(draft.trim());
    else setDraft(starting.current);
  };
  return (
    <input
      value={draft}
      placeholder={value === undefined ? "Mixed" : undefined}
      onFocus={() => {
        editing.current = true;
        starting.current = value ?? "";
      }}
      onChange={(event) => {
        if (!editing.current) {
          editing.current = true;
          starting.current = value ?? "";
        }
        setDraft(event.target.value);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
          event.currentTarget.select();
        } else if (event.key === "Escape") {
          event.preventDefault();
          editing.current = false;
          setDraft(starting.current);
          event.currentTarget.select();
        }
      }}
    />
  );
}

function MixedSwitch({
  value,
  onChange,
}: {
  value?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Hint label={value === undefined ? "Mixed values" : "Toggle setting"}>
      <button
        type="button"
        className={`toggle ${value === true ? "on" : ""} ${value === undefined ? "mixed" : ""}`}
        aria-pressed={value === undefined ? "mixed" : value}
        onClick={() => onChange(value !== true)}
      >
        <span />
      </button>
    </Hint>
  );
}

function TransformFields({
  nodes,
  update,
  preview,
}: {
  nodes: SceneNode[];
  update: (nodes: SceneNode[]) => void;
  preview: (nodes: SceneNode[] | null) => void;
}) {
  const capabilities = transformCapabilities(nodes);
  const withValue = (
    key: "position" | "quaternion" | "scale",
    index: number,
    value: number,
  ) => {
    return nodes.map((node) => {
      const vector = [...node.transform[key]];
      vector[index] = value;
      if (key === "quaternion") {
        const length = Math.hypot(...vector);
        if (!length) return node;
        for (let item = 0; item < vector.length; item += 1)
          vector[item] /= length;
      }
      return {
        ...node,
        transform: { ...node.transform, [key]: vector },
      } as SceneNode;
    });
  };
  const rows = [
    ["Position", "position", 3, 0.05, "translate"],
    ["Rotation", "quaternion", 4, 0.01, "rotate"],
    ["Scale", "scale", 3, 0.05, "scale"],
  ] as const;
  return (
    <section className="property-section">
      <h3>Transform</h3>
      {rows.map(([label, key, count, step, mode]) => (
        <div className="vector-field" key={key}>
          <span>{label}</span>
          <div>
            {Array.from({ length: count }, (_, index) => (
              <NumericInput
                key={index}
                label={
                  (key === "quaternion"
                    ? ["X", "Y", "Z", "W"]
                    : ["X", "Y", "Z"])[index]
                }
                value={common(nodes.map((node) => node.transform[key][index]))}
                disabled={!capabilities[mode]}
                step={step}
                min={key === "scale" ? 0.001 : undefined}
                onPreview={(value) =>
                  preview(
                    value === undefined ? null : withValue(key, index, value),
                  )
                }
                onCommit={(value) => update(withValue(key, index, value))}
              />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

export function InspectorPanel({
  onPreview,
}: {
  onPreview: (nodes: SceneNode[] | null) => void;
}) {
  const { safeCommand, setError: onError } = useWorldbashClient();
  const workspace = useWorkspaceData(
    ["nodes", "assets", "selection", "primaryId"],
    ["targetFrameCount", "viewportCamera"],
  );
  const pane = usePaneShortcuts("properties", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      void safeCommand({
        type: event.shiftKey ? "history.redo" : "history.undo",
      });
    }
  });
  const ids = workspace.selection;
  const nodes = ids.flatMap((id) =>
    workspace.nodes[id] ? [workspace.nodes[id]] : [],
  );
  const assets = ids.flatMap((id) =>
    workspace.assets[id] ? [workspace.assets[id]] : [],
  );
  const primaryId = workspace.primaryId ?? ids[0] ?? null;
  const primaryNode = primaryId ? workspace.nodes[primaryId] : undefined;
  const primaryAsset = primaryId ? workspace.assets[primaryId] : undefined;

  if (!nodes.length && !assets.length)
    return (
      <div className="panel-body inspector-panel" {...pane}>
        <div className="empty-state tall">
          <SlidersHorizontal size={24} />
          <strong>Nothing selected</strong>
          <span>Select an asset or scene object to edit its properties.</span>
        </div>
      </div>
    );

  const putNodes = (next: SceneNode[]) =>
    safeCommand({ type: "nodes.put", nodes: next });
  const patchNodes = (
    selected: SceneNode[],
    patch: (node: SceneNode) => SceneNode,
  ) => putNodes(selected.map(patch));
  const updateAssets = (
    selected: Asset[],
    patch: Extract<Command, { type: "assets.update" }>["patch"],
  ) =>
    safeCommand({
      type: "edit.batch",
      commands: selected.map((asset) => ({
        type: "assets.update",
        id: asset.id,
        patch,
      })),
    });
  const named = [...nodes, ...assets];
  const clipNodes = nodes.filter((node) => node.kind === "clip");
  const imageAssets = assets.filter((asset) => asset.kind === "image");
  const cameraAssets = assets.filter((asset) => asset.camera);

  const targetFrameCount =
    primaryNode?.targetFrameCount ?? workspace.settings.targetFrameCount;
  const addKeyframe = () => {
    if (primaryNode?.kind !== "path" || nodes.length !== 1) return;
    void safeCommand({
      type: "path.keyframe",
      pathId: primaryNode.id,
    });
  };

  return (
    <div className="panel-body inspector-panel" {...pane}>
      <div className="selection-summary">
        <span>{named.length} selected</span>
        {named.length > 1 && <em>Mixed values are shown per field</em>}
      </div>
      <Field label="Name">
        <TextInput
          value={common(named.map((item) => item.name))}
          onCommit={(name) => {
            void safeCommand({
              type: "edit.batch",
              commands: [
                ...(nodes.length
                  ? [
                      {
                        type: "nodes.put" as const,
                        nodes: nodes.map((node) => ({ ...node, name })),
                      },
                    ]
                  : []),
                ...assets.map((asset) => ({
                  type: "assets.update" as const,
                  id: asset.id,
                  patch: { name },
                })),
              ],
            });
          }}
        />
      </Field>

      {nodes.length > 0 && (
        <div className="inline-fields">
          <Field label="Visible">
            <MixedSwitch
              value={common(nodes.map((node) => node.visible))}
              onChange={(visible) =>
                void patchNodes(nodes, (node) => ({ ...node, visible }))
              }
            />
          </Field>
          <Field label="Parent">
            <select
              value={
                common(nodes.map((node) => node.parentId)) === undefined
                  ? "__mixed"
                  : (common(nodes.map((node) => node.parentId)) ?? "")
              }
              onChange={(event) => {
                if (event.target.value !== "__mixed")
                  void safeCommand({
                    type: "nodes.reparent",
                    ids: nodes.map((node) => node.id),
                    parentId: event.target.value || null,
                  });
              }}
            >
              {common(nodes.map((node) => node.parentId)) === undefined && (
                <option value="__mixed">Mixed</option>
              )}
              <option value="">Scene root</option>
              {Object.values(workspace.nodes)
                .filter((candidate) => {
                  let ancestor: SceneNode | undefined = candidate;
                  while (ancestor) {
                    if (nodes.some((node) => node.id === ancestor!.id))
                      return false;
                    ancestor = ancestor.parentId
                      ? workspace.nodes[ancestor.parentId]
                      : undefined;
                  }
                  return true;
                })
                .map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
            </select>
          </Field>
        </div>
      )}

      {nodes.length > 0 && (
        <Field label="Lock transforms">
          <input
            type="checkbox"
            checked={nodes.every((node) => node.locked)}
            onChange={(event) =>
              void patchNodes(nodes, (node) => ({
                ...node,
                locked: event.target.checked,
              }))
            }
          />
        </Field>
      )}
      {nodes.length > 0 && !nodes.some((node) => node.locked) && (
        <TransformFields
          nodes={nodes}
          preview={onPreview}
          update={(next) => {
            void putNodes(next).finally(() => onPreview(null));
          }}
        />
      )}

      {nodes.some((node) => node.assetId) && (
        <section className="property-section">
          <h3>Source asset</h3>
          <dl className="metadata">
            {nodes
              .filter((node) => node.assetId)
              .map((node) => (
                <div key={node.id}>
                  <dt>{node.name}</dt>
                  <dd>
                    {workspace.assets[node.assetId!]?.name ?? "Missing asset"}
                  </dd>
                </div>
              ))}
          </dl>
        </section>
      )}

      {clipNodes.length > 0 && (
        <section className="property-section">
          <h3>Clip volume</h3>
          <div className="inline-fields">
            <Field label="Scope">
              <select
                value={
                  common(clipNodes.map((node) => node.clip?.scope)) ?? "__mixed"
                }
                onChange={(event) => {
                  if (event.target.value === "__mixed") return;
                  const scope = event.target.value as "local" | "global";
                  void patchNodes(clipNodes, (node) => ({
                    ...node,
                    clip: {
                      ...(node.clip ?? { invert: false, softness: 0 }),
                      scope,
                    },
                  }));
                }}
              >
                {common(clipNodes.map((node) => node.clip?.scope)) ===
                  undefined && <option value="__mixed">Mixed</option>}
                <option value="global">Global</option>
                <option value="local">Parent object</option>
              </select>
            </Field>
            <Field label="Invert">
              <MixedSwitch
                value={common(
                  clipNodes.map((node) => node.clip?.invert ?? false),
                )}
                onChange={(invert) =>
                  void patchNodes(clipNodes, (node) => ({
                    ...node,
                    clip: {
                      ...(node.clip ?? { scope: "global", softness: 0 }),
                      invert,
                    },
                  }))
                }
              />
            </Field>
          </div>
          <Field label="Softness">
            <NumericInput
              value={common(clipNodes.map((node) => node.clip?.softness ?? 0))}
              min={0}
              step={0.01}
              onCommit={(softness) =>
                void patchNodes(clipNodes, (node) => ({
                  ...node,
                  clip: {
                    ...(node.clip ?? { scope: "global", invert: false }),
                    softness,
                  },
                }))
              }
            />
          </Field>
        </section>
      )}

      {primaryNode?.kind === "path" && nodes.length === 1 && (
        <section className="property-section path-editor">
          <div className="section-heading">
            <h3>Camera path</h3>
            <Button
              size="1"
              variant="surface"
              color="gray"
              className="button compact"
              onClick={addKeyframe}
            >
              <Plus /> Keyframe
            </Button>
          </div>
          <Field label="Field of view">
            <NumericInput
              label="Path field of view"
              value={
                primaryNode.fov ??
                (2 *
                  Math.atan(
                    (primaryNode.keyframes?.[0]?.camera.intrinsics.height ??
                      workspace.settings.viewportCamera.intrinsics.height) /
                      (2 *
                        (primaryNode.keyframes?.[0]?.camera.intrinsics.fy ??
                          workspace.settings.viewportCamera.intrinsics.fy)),
                  ) *
                  180) /
                  Math.PI
              }
              min={10}
              max={120}
              step={1}
              onCommit={(fov) =>
                void safeCommand({
                  type: "path.update",
                  pathId: primaryNode.id,
                  fov,
                })
              }
            />
          </Field>
          <Field label="Target frames">
            <NumericInput
              label="Target frames"
              value={targetFrameCount}
              min={2}
              max={600}
              step={1}
              onCommit={(targetFrameCount) =>
                void safeCommand({
                  type: "path.update",
                  pathId: primaryNode.id,
                  targetFrameCount,
                })
              }
            />
          </Field>
          {(primaryNode.keyframes ?? []).map((keyframe, index) => (
            <div className="keyframe" key={keyframe.id}>
              <NumericInput
                label={`Keyframe ${index + 1} order`}
                value={index + 1}
                min={1}
                max={primaryNode.keyframes!.length}
                step={1}
                onCommit={(position) =>
                  void safeCommand({
                    type: "path.keyframe",
                    pathId: primaryNode.id,
                    id: keyframe.id,
                    index: position - 1,
                  })
                }
              />
              <Hint label="Replace this keyframe from the current viewport">
                <Button
                  size="1"
                  variant="surface"
                  color="gray"
                  onClick={() =>
                    void safeCommand({
                      type: "path.keyframe",
                      pathId: primaryNode.id,
                      id: keyframe.id,
                    })
                  }
                >
                  Replace
                </Button>
              </Hint>
              <Hint label={`Delete keyframe ${index + 1}`}>
                <button
                  className="icon-button"
                  aria-label={`Delete keyframe ${index + 1}`}
                  onClick={() =>
                    void safeCommand({
                      type: "path.keyframe",
                      pathId: primaryNode.id,
                      id: keyframe.id,
                      remove: true,
                    })
                  }
                >
                  <X />
                </button>
              </Hint>
            </div>
          ))}
        </section>
      )}

      {assets.length > 0 && (
        <section className="property-section">
          <h3>Asset</h3>
          <dl className="metadata">
            <div>
              <dt>Type</dt>
              <dd>
                {common(assets.map((asset) => asset.mimeType || asset.kind)) ??
                  "Mixed"}
              </dd>
            </div>
            <div>
              <dt>Size</dt>
              <dd>
                {(
                  assets.reduce((sum, asset) => sum + asset.size, 0) / 1_048_576
                ).toFixed(2)}{" "}
                MB
              </dd>
            </div>
            {primaryAsset && (
              <div>
                <dt>Path</dt>
                <dd title={primaryAsset.path}>{primaryAsset.path}</dd>
              </div>
            )}
            {primaryAsset?.parentAssetId && (
              <div>
                <dt>Derived from</dt>
                <dd>
                  {workspace.assets[primaryAsset.parentAssetId]?.name ??
                    primaryAsset.parentAssetId}
                </dd>
              </div>
            )}
            {primaryAsset?.jobId && (
              <div>
                <dt>Job</dt>
                <dd>{primaryAsset.jobId}</dd>
              </div>
            )}
          </dl>
          {cameraAssets.length > 0 && (
            <div className="vector-field">
              <span>Camera</span>
              <div>
                {Array.from({ length: 3 }, (_, index) => (
                  <NumericInput
                    key={index}
                    value={common(
                      cameraAssets.map(
                        (asset) => asset.camera!.extrinsics.position[index],
                      ),
                    )}
                    onCommit={(value) => {
                      void safeCommand({
                        type: "edit.batch",
                        commands: cameraAssets.map((asset) => {
                          const position = [
                            ...asset.camera!.extrinsics.position,
                          ] as [number, number, number];
                          position[index] = value;
                          return {
                            type: "assets.update" as const,
                            id: asset.id,
                            patch: {
                              camera: {
                                ...asset.camera!,
                                extrinsics: {
                                  ...asset.camera!.extrinsics,
                                  position,
                                },
                              },
                            },
                          };
                        }),
                      });
                    }}
                  />
                ))}
              </div>
            </div>
          )}
          {imageAssets.length > 0 && (
            <Field label="Depth map">
              <select
                value={
                  common(
                    imageAssets.map((asset) => asset.depthAssetId ?? ""),
                  ) ?? "__mixed"
                }
                onChange={(event) => {
                  if (event.target.value !== "__mixed")
                    void updateAssets(imageAssets, {
                      depthAssetId: event.target.value || null,
                    });
                }}
              >
                {common(
                  imageAssets.map((asset) => asset.depthAssetId ?? ""),
                ) === undefined && <option value="__mixed">Mixed</option>}
                <option value="">None</option>
                {Object.values(workspace.assets)
                  .filter((asset) => asset.kind === "depth")
                  .map((asset) => (
                    <option value={asset.id} key={asset.id}>
                      {asset.name}
                    </option>
                  ))}
              </select>
            </Field>
          )}
        </section>
      )}
    </div>
  );
}
