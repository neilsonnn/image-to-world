import {
  imageModels,
  modelIds,
  imageEditRatios,
  imageEditResolutions,
} from "../../../core/models";
import { useImageToWorldClient, useWorkspaceData } from "../lib/client";
import { selectedImageOperation } from "../../../core/image-operation";
import { selectedCaptureMask } from "../lib/clip-mask";
import {
  ArrowCounterClockwise,
  ArrowElbowDownLeft,
  ArrowDown,
  ArrowsClockwise,
  ArrowUp,
  ArrowUUpLeft,
  ArrowUUpRight,
  Cube,
  DownloadSimple,
  Eraser,
  Eye,
  EyeSlash,
  Gear,
  Images,
  Plus,
  Palette,
  SelectionInverse,
  SpinnerGap,
  Stack,
  Trash,
  UploadSimple,
  Warning,
  X,
} from "@phosphor-icons/react";
import {
  Button,
  Flex,
  IconButton,
  Popover,
  Switch,
  Text,
  Tooltip,
  TextField,
} from "@radix-ui/themes";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  assetUrl,
  type Asset,
  type Command,
  type CommandResult,
  type ImageDraft,
  type Job,
  type Workspace,
  type SceneNode,
} from "../../../core/schema";
import "../image-editor.css";
import { ImageCanvas } from "./ImageCanvas";
import { ImageHistory } from "./ImageHistory";
import { ImageVersions } from "./ImageVersions";
import { Field } from "./panelShared";
import { Hint, PanelHeader } from "./ui";

type EditorSettings = Workspace["settings"]["editor2d"];
type NanoJob = Job & { input: Extract<Job["input"], { kind: "nano" }> };

const EMPTY_DRAFT: ImageDraft = { strokes: [], layers: [] };

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function ImageEditor({
  previewNodes,
}: {
  previewNodes: SceneNode[] | null;
}) {
  const {
    command,
    upload,
    getWorkspace,
    setError: onError,
  } = useImageToWorldClient();
  const workspace = useWorkspaceData(
    [
      "nodes",
      "jobs",
      "resultOwners",
      "assets",
      "selection",
      "primaryId",
      "imageDrafts",
      "undo",
      "redo",
    ],
    ["editor2d", "layout"],
  );
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const commandRef = useRef(command);
  const onErrorRef = useRef(onError);
  const workspaceRef = useRef(workspace);
  const settingsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [editor, setEditor] = useState<EditorSettings>(
    workspace.settings.editor2d,
  );
  const editorRef = useRef(editor);
  const pendingSettingsRef = useRef<{ json: string } | null>(null);
  const [draft, setDraft] = useState<ImageDraft>(EMPTY_DRAFT);
  const draftRef = useRef(draft);
  const pendingDraftsRef = useRef(
    new Map<string, { json: string; draft: ImageDraft }>(),
  );
  const draftWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const lastSelectionKeyRef = useRef<string | null>(null);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [layerPickerId, setLayerPickerId] = useState("");
  const [referencePickerId, setReferencePickerId] = useState("");
  const [compare, setCompare] = useState(false);
  const [showMask, setShowMask] = useState(true);
  const [fitNonce, setFitNonce] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const reconstruct = workspace.settings.editor2d.reconstruct;
  const setReconstruct = (reconstruct: boolean) =>
    updateEditor({ reconstruct });

  commandRef.current = command;
  onErrorRef.current = onError;
  workspaceRef.current = workspace;

  const selectedOperation = selectedImageOperation(workspace);
  const displayedAssetId = selectedOperation
    ? selectedOperation.assetId
    : editor.activeAssetId;
  const activeAsset = displayedAssetId
    ? workspace.assets[displayedAssetId]
    : undefined;
  const source = activeAsset?.kind === "image" ? activeAsset : null;
  const sourceId = source?.id;
  const maskState = useMemo(() => {
    if (selectedOperation?.pending || !sourceId)
      return { mask: null, error: undefined };
    try {
      return {
        mask: selectedCaptureMask(
          {
            ...workspace,
            nodes: previewNodes
              ? {
                  ...workspace.nodes,
                  ...Object.fromEntries(
                    previewNodes.map((node) => [node.id, node]),
                  ),
                }
              : workspace.nodes,
          },
          sourceId,
        ),
        error: undefined,
      };
    } catch (error) {
      return { mask: null, error: errorMessage(error) };
    }
  }, [
    workspace.nodes,
    workspace.assets,
    workspace.primaryId,
    workspace.selection,
    previewNodes,
    sourceId,
    selectedOperation?.pending,
  ]);
  const { mask, error: maskError } = maskState;
  const parent =
    source?.parentAssetId &&
    workspace.assets[source.parentAssetId]?.kind === "image"
      ? workspace.assets[source.parentAssetId]
      : null;
  const imageAssets = useMemo(
    () =>
      Object.values(workspace.assets).filter(
        (asset) => asset.kind === "image" && !asset.missing,
      ),
    [workspace.assets],
  );
  const selectedImage = selectedOperation?.assetId;
  const selectionKey = JSON.stringify([
    workspace.primaryId,
    workspace.selection,
    selectedImage,
  ]);
  const serverSettingsJson = JSON.stringify(workspace.settings.editor2d);
  const serverDraft = source
    ? (workspace.imageDrafts[source.id] ?? EMPTY_DRAFT)
    : EMPTY_DRAFT;
  const serverDraftJson = source ? JSON.stringify(serverDraft) : "";
  const selectedLayer =
    draft.layers.find((layer) => layer.id === selectedLayerId) ?? null;

  const reportCommand = useCallback(async (input: Command) => {
    try {
      return await commandRef.current(input);
    } catch (error) {
      onErrorRef.current(errorMessage(error));
      return undefined;
    }
  }, []);
  const safeCommand = useCallback(
    async (input: Command): Promise<CommandResult | undefined> =>
      reportCommand(input),
    [reportCommand],
  );

  const writeSettings = useCallback(
    async (next: EditorSettings) => {
      const json = JSON.stringify(next);
      pendingSettingsRef.current = { json };
      const write = () =>
        reportCommand({
          type: "workspace.update",
          settings: { editor2d: next },
        });
      const queued = settingsWriteQueueRef.current.then(write, write);
      settingsWriteQueueRef.current = queued.then(() => undefined);
      const result = await queued;
      if (!result && pendingSettingsRef.current?.json === json) {
        pendingSettingsRef.current = null;
        const serverSettings = workspaceRef.current.settings.editor2d;
        editorRef.current = serverSettings;
        setEditor(serverSettings);
      }
      return result;
    },
    [reportCommand],
  );

  const persistSettings = useCallback(
    (next: EditorSettings, immediate = false) => {
      editorRef.current = next;
      setEditor(next);
      pendingSettingsRef.current = {
        json: JSON.stringify(next),
      };
      if (settingsTimerRef.current) clearTimeout(settingsTimerRef.current);
      const save = () => {
        settingsTimerRef.current = null;
        void writeSettings(next);
      };
      if (immediate) save();
      else settingsTimerRef.current = setTimeout(save, 250);
    },
    [writeSettings],
  );

  const updateEditor = useCallback(
    (patch: Partial<EditorSettings>, immediate = false) => {
      persistSettings({ ...editorRef.current, ...patch }, immediate);
    },
    [persistSettings],
  );

  useEffect(() => {
    const serverSettings = workspace.settings.editor2d;
    const pending = pendingSettingsRef.current;
    if (pending) {
      if (pending.json === serverSettingsJson) {
        pendingSettingsRef.current = null;
        editorRef.current = serverSettings;
        setEditor(serverSettings);
      }
      return;
    }
    editorRef.current = serverSettings;
    setEditor(serverSettings);
  }, [serverSettingsJson]);

  useEffect(
    () => () => {
      if (settingsTimerRef.current) {
        clearTimeout(settingsTimerRef.current);
        void writeSettings(editorRef.current);
      }
    },
    [writeSettings],
  );

  useEffect(() => {
    if (lastSelectionKeyRef.current === selectionKey) return;
    lastSelectionKeyRef.current = selectionKey;
    if (selectedImage && selectedImage !== editorRef.current.activeAssetId) {
      updateEditor({ activeAssetId: selectedImage }, true);
    }
  }, [selectedImage, selectionKey, updateEditor]);

  useEffect(() => {
    const pending = source ? pendingDraftsRef.current.get(source.id) : null;
    if (pending && pending.json !== serverDraftJson) {
      draftRef.current = pending.draft;
      setDraft(pending.draft);
      return;
    }
    if (pending && source) pendingDraftsRef.current.delete(source.id);
    draftRef.current = serverDraft;
    setDraft(serverDraft);
  }, [sourceId, serverDraftJson]);

  useEffect(() => {
    setSelectedLayerId(null);
    setCompare(false);
  }, [source?.id]);

  const persistDraft = useCallback(
    (next: ImageDraft) => {
      if (!sourceId) return;
      const assetId = sourceId;
      const json = JSON.stringify(next);
      draftRef.current = next;
      setDraft(next);
      pendingDraftsRef.current.set(assetId, { json, draft: next });
      const write = async () => {
        const result = await reportCommand({
          type: "image.draft",
          assetId,
          draft: next,
        });
        if (!result && pendingDraftsRef.current.get(assetId)?.json === json) {
          pendingDraftsRef.current.delete(assetId);
          if (editorRef.current.activeAssetId === assetId) {
            const serverDraft =
              workspaceRef.current.imageDrafts[assetId] ?? EMPTY_DRAFT;
            draftRef.current = serverDraft;
            setDraft(serverDraft);
          }
        }
      };
      const queued = draftWriteQueueRef.current.then(write, write);
      draftWriteQueueRef.current = queued.then(() => undefined);
    },
    [reportCommand, sourceId],
  );

  const chooseSource = useCallback(
    (assetId: string) => {
      if (workspace.assets[assetId]?.kind !== "image") return;
      updateEditor({ activeAssetId: assetId }, true);
      void reportCommand({ type: "selection.set", ids: [assetId] });
    },
    [reportCommand, updateEditor, workspace.assets],
  );

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    try {
      const imported = (await upload(files)).filter(
        (asset) => asset.kind === "image",
      );
      if (!imported.length) return;
      const extraReferences = imported.slice(1).map((asset) => asset.id);
      persistSettings(
        {
          ...editorRef.current,
          activeAssetId: imported[0].id,
          referenceAssetIds: [
            ...new Set([
              ...editorRef.current.referenceAssetIds,
              ...extraReferences,
            ]),
          ],
        },
        true,
      );
      void reportCommand({ type: "selection.set", ids: [imported[0].id] });
    } catch (error) {
      onError(errorMessage(error));
    }
  };

  const addReference = (assetId: string) => {
    if (
      !assetId ||
      assetId === source?.id ||
      editor.referenceAssetIds.includes(assetId)
    )
      return;
    updateEditor(
      { referenceAssetIds: [...editor.referenceAssetIds, assetId] },
      true,
    );
    setReferencePickerId("");
  };

  const removeReference = (assetId: string) => {
    updateEditor(
      {
        referenceAssetIds: editor.referenceAssetIds.filter(
          (id) => id !== assetId,
        ),
      },
      true,
    );
  };

  const addLayer = (assetId: string) => {
    if (!source || workspace.assets[assetId]?.kind !== "image") return;
    const layer: ImageDraft["layers"][number] = {
      id: crypto.randomUUID(),
      assetId,
      x: 0.25,
      y: 0.25,
      width: 0.5,
      height: 0.5,
      opacity: 1,
      visible: true,
    };
    persistDraft({
      ...draftRef.current,
      layers: [...draftRef.current.layers, layer],
    });
    setSelectedLayerId(layer.id);
    setLayerPickerId("");
  };

  const patchLayer = (patch: Partial<ImageDraft["layers"][number]>) => {
    if (!selectedLayerId) return;
    persistDraft({
      ...draftRef.current,
      layers: draftRef.current.layers.map((layer) =>
        layer.id === selectedLayerId ? { ...layer, ...patch } : layer,
      ),
    });
  };

  const moveLayer = (direction: -1 | 1) => {
    const index = draftRef.current.layers.findIndex(
      (layer) => layer.id === selectedLayerId,
    );
    const nextIndex = index + direction;
    if (
      index < 0 ||
      nextIndex < 0 ||
      nextIndex >= draftRef.current.layers.length
    )
      return;
    const layers = [...draftRef.current.layers];
    [layers[index], layers[nextIndex]] = [layers[nextIndex], layers[index]];
    persistDraft({ ...draftRef.current, layers });
  };

  const removeLayer = () => {
    if (!selectedLayerId) return;
    persistDraft({
      ...draftRef.current,
      layers: draftRef.current.layers.filter(
        (layer) => layer.id !== selectedLayerId,
      ),
    });
    setSelectedLayerId(null);
  };

  const addStroke = (stroke: ImageDraft["strokes"][number]) => {
    persistDraft({
      ...draftRef.current,
      strokes: [...draftRef.current.strokes, stroke],
    });
  };

  const undoDraft = async () => {
    if (!sourceId) return;
    await draftWriteQueueRef.current;
    await reportCommand({ type: "history.undo", assetId: sourceId });
  };

  const redoDraft = async () => {
    if (!sourceId) return;
    await draftWriteQueueRef.current;
    await reportCommand({ type: "history.redo", assetId: sourceId });
  };

  const clearStrokes = () => {
    if (!draftRef.current.strokes.length) return;
    persistDraft({ ...draftRef.current, strokes: [] });
  };

  const submitGeneration = async () => {
    if (!source || !editor.prompt.trim()) return;
    setSubmitting(true);
    try {
      if (settingsTimerRef.current) clearTimeout(settingsTimerRef.current);
      settingsTimerRef.current = null;
      const settingsResult = await writeSettings(editorRef.current);
      if (!settingsResult) return;
      await reportCommand({
        type: "generation.submit",
        request: {
          kind: "image.edit",
          sourceAssetId: source.id,
          referenceAssetIds: editor.referenceAssetIds.filter(
            (id) => id !== source.id,
          ),
          prompt: editor.prompt.trim(),
          settings: editor.settings,
          draft: draftRef.current,
          applyToScene: true,
          reconstruct,
        },
      });
    } finally {
      setSubmitting(false);
    }
  };

  const reuseJob = (job: NanoJob) => {
    persistSettings(
      {
        ...editorRef.current,
        prompt: job.input.prompt,
        referenceAssetIds: job.input.referenceAssetIds.filter(
          (id) => workspace.assets[id]?.kind === "image",
        ),
        settings: job.input.settings,
      },
      true,
    );
  };

  const addToScene = async () => {
    if (!source) return;
    await reportCommand({
      type: "assets.place",
      assetIds: [source.id],
      camera: getWorkspace().settings.viewportCamera,
    });
  };

  const layerCandidates = imageAssets.filter(
    (asset) => asset.id !== source?.id,
  );
  const referenceCandidates = imageAssets.filter(
    (asset) =>
      asset.id !== source?.id && !editor.referenceAssetIds.includes(asset.id),
  );

  const setSetting = <K extends keyof EditorSettings["settings"]>(
    key: K,
    value: EditorSettings["settings"][K],
  ) => updateEditor({ settings: { ...editor.settings, [key]: value } }, true);
  const references = editor.referenceAssetIds
    .map((id) => workspace.assets[id])
    .filter((asset): asset is Asset => asset?.kind === "image");
  const canUndo =
    !!sourceId && workspace.undo.some((edit) => edit.scope === sourceId);
  const canRedo =
    !!sourceId && workspace.redo.some((edit) => edit.scope === sourceId);

  return (
    <div className="image-editor">
      <PanelHeader
        title={
          <span className="ie-title">
            <strong>Image</strong>
            {(selectedOperation || source) && (
              <Hint label={selectedOperation?.name ?? source!.name}>
                <span className="quiet">
                  {selectedOperation?.name ?? source!.name}
                </span>
              </Hint>
            )}
          </span>
        }
      >
        {maskError && (
          <Hint label={maskError}>
            <span className="ie-warning" role="status">
              <Warning />
            </span>
          </Hint>
        )}
        {mask && !compare && (
          <Hint
            label={
              showMask
                ? "Hide clipped-out shading"
                : "Shade regions the clip removes (preview only)"
            }
          >
            <button
              className={`icon-button${showMask ? " active" : ""}`}
              aria-label="Clip mask"
              aria-pressed={showMask}
              onClick={() => setShowMask((value) => !value)}
            >
              <SelectionInverse />
            </button>
          </Hint>
        )}
        {parent && (
          <Hint
            label={compare ? "Showing the parent image" : "Compare with parent"}
          >
            <button
              className={`icon-button${compare ? " active" : ""}`}
              aria-label="Compare with parent"
              aria-pressed={compare}
              onClick={() => setCompare((value) => !value)}
            >
              <ArrowCounterClockwise />
            </button>
          </Hint>
        )}
        {source && (
          <>
            <Hint label="Add to the scene">
              <button
                className="icon-button"
                aria-label="Add to the scene"
                onClick={() => void addToScene()}
              >
                <Cube />
              </button>
            </Hint>
            <Hint label="Reconstruct depth and update linked captures in place">
              <button
                className="icon-button"
                aria-label="Reconstruct depth"
                onClick={() =>
                  void reportCommand({
                    type: "generation.submit",
                    request: { kind: "reconstruct", assetIds: [source.id] },
                  })
                }
              >
                <ArrowsClockwise />
              </button>
            </Hint>
            <Hint label="Download image">
              <a
                className="icon-button"
                href={assetUrl(source)}
                download={source.name}
                aria-label="Download image"
              >
                <DownloadSimple />
              </a>
            </Hint>
          </>
        )}
        <Hint label="Import images">
          <button
            className="icon-button"
            aria-label="Import images"
            onClick={() => uploadInputRef.current?.click()}
          >
            <UploadSimple />
          </button>
        </Hint>
        <input
          ref={uploadInputRef}
          hidden
          type="file"
          accept="image/*"
          multiple
          onChange={handleUpload}
        />
      </PanelHeader>

      <div className="ie-workspace">
        <div className="ie-stage-column">
          <ImageCanvas
            source={source}
            operation={selectedOperation}
            parent={parent}
            assets={workspace.assets}
            draft={draft}
            tool={editor.tool}
            brushColor={editor.brushColor}
            brushSize={editor.brushSize}
            zoom={editor.zoom}
            compare={compare}
            mask={showMask && !compare ? mask : null}
            fitNonce={fitNonce}
            onToolChange={(tool) => updateEditor({ tool }, true)}
            onZoomChange={(zoom) => {
              if (zoom === 1) setFitNonce((value) => value + 1);
              updateEditor({ zoom }, true);
            }}
            onStroke={addStroke}
            onImport={() => uploadInputRef.current?.click()}
            onError={onError}
            annotationControls={
              source ? (
                <div
                  className="ie-brush-tools"
                  role="toolbar"
                  aria-label="Annotation tools"
                >
                  <Hint label="Brush color">
                    <label className="ie-color-control">
                      <Palette size={14} aria-hidden="true" />
                      <input
                        type="color"
                        aria-label="Brush color"
                        value={editor.brushColor}
                        onChange={(event) =>
                          updateEditor({ brushColor: event.target.value }, true)
                        }
                      />
                    </label>
                  </Hint>
                  <Hint label="Brush size">
                    <input
                      className="ie-brush-size"
                      type="range"
                      aria-label="Brush size"
                      min="0.001"
                      max="0.2"
                      step="0.001"
                      value={editor.brushSize}
                      onChange={(event) =>
                        updateEditor(
                          { brushSize: Number(event.target.value) },
                          true,
                        )
                      }
                    />
                  </Hint>
                  <span className="ie-toolbar-rule" />
                  <Hint label="Undo annotation">
                    <button
                      aria-label="Undo annotation"
                      disabled={!canUndo}
                      onClick={() => void undoDraft()}
                    >
                      <ArrowUUpLeft />
                    </button>
                  </Hint>
                  <Hint label="Redo annotation">
                    <button
                      aria-label="Redo annotation"
                      disabled={!canRedo}
                      onClick={() => void redoDraft()}
                    >
                      <ArrowUUpRight />
                    </button>
                  </Hint>
                  <Hint label="Clear annotations">
                    <button
                      aria-label="Clear annotations"
                      disabled={!draft.strokes.length}
                      onClick={clearStrokes}
                    >
                      <Trash />
                    </button>
                  </Hint>
                </div>
              ) : null
            }
          />
          <div className="ie-edit-box floating-toolbar">
            <ImageVersions assetId={source?.id ?? null} onSelect={chooseSource}>
              <ImageHistory
                safeCommand={safeCommand}
                activeAssetId={source?.id ?? null}
                onSelect={(activeAssetId) =>
                  updateEditor({ activeAssetId }, true)
                }
                onReuse={reuseJob}
                onRetry={(jobId) =>
                  void reportCommand({ type: "jobs.retry", id: jobId })
                }
              />
            </ImageVersions>
            <TextField.Root
              size="1"
              aria-label="Describe the edit"
              placeholder="Describe the edit…"
              value={editor.prompt}
              onChange={(event) => updateEditor({ prompt: event.target.value })}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  if (source && editor.prompt.trim() && !submitting)
                    void submitGeneration();
                }
              }}
            />
            <div className="ie-action-row">
              <ToolPopover
                label="References"
                icon={<Images />}
                count={references.length}
              >
                <Text size="1" color="gray">
                  Style or content guides sent with the source
                </Text>
                {references.length > 0 && (
                  <div className="ie-thumb-grid">
                    {references.map((asset) => (
                      <div className="ie-thumb" key={asset.id}>
                        <Hint label={asset.name}>
                          <img src={assetUrl(asset)} alt={asset.name} />
                        </Hint>
                        <Hint label={`Remove ${asset.name}`}>
                          <button
                            aria-label={`Remove ${asset.name}`}
                            onClick={() => removeReference(asset.id)}
                          >
                            <X />
                          </button>
                        </Hint>
                      </div>
                    ))}
                  </div>
                )}
                <ImagePicker
                  label="Add reference"
                  value={referencePickerId}
                  options={referenceCandidates}
                  onChange={setReferencePickerId}
                  onAdd={() => addReference(referencePickerId)}
                />
              </ToolPopover>
              <ToolPopover
                label="Composite layers"
                icon={<Stack />}
                count={draft.layers.length}
              >
                <ImagePicker
                  label="Add layer"
                  value={layerPickerId}
                  options={layerCandidates}
                  onChange={setLayerPickerId}
                  onAdd={() => addLayer(layerPickerId)}
                />
                {draft.layers.length > 0 && (
                  <div className="ie-layer-list" role="listbox">
                    {draft.layers.map((layer) => {
                      const asset = workspace.assets[layer.assetId];
                      return (
                        <Hint
                          label={asset?.name ?? "Missing image"}
                          key={layer.id}
                        >
                          <button
                            role="option"
                            aria-selected={layer.id === selectedLayerId}
                            className={`ie-layer${layer.id === selectedLayerId ? " is-active" : ""}${layer.visible ? "" : " is-hidden"}`}
                            onClick={() => setSelectedLayerId(layer.id)}
                          >
                            <img src={asset ? assetUrl(asset) : ""} alt="" />
                          </button>
                        </Hint>
                      );
                    })}
                  </div>
                )}
                {selectedLayer && (
                  <>
                    <div className="ie-icon-row">
                      <Hint
                        label={
                          selectedLayer.visible ? "Hide layer" : "Show layer"
                        }
                      >
                        <button
                          className="icon-button"
                          aria-label={
                            selectedLayer.visible ? "Hide layer" : "Show layer"
                          }
                          onClick={() =>
                            patchLayer({ visible: !selectedLayer.visible })
                          }
                        >
                          {selectedLayer.visible ? <Eye /> : <EyeSlash />}
                        </button>
                      </Hint>
                      <Hint label="Send backward">
                        <button
                          className="icon-button"
                          aria-label="Send backward"
                          onClick={() => moveLayer(-1)}
                        >
                          <ArrowDown />
                        </button>
                      </Hint>
                      <Hint label="Bring forward">
                        <button
                          className="icon-button"
                          aria-label="Bring forward"
                          onClick={() => moveLayer(1)}
                        >
                          <ArrowUp />
                        </button>
                      </Hint>
                      <Hint label="Remove layer">
                        <button
                          className="icon-button"
                          aria-label="Remove layer"
                          onClick={removeLayer}
                        >
                          <Trash />
                        </button>
                      </Hint>
                    </div>
                    <div className="ie-layer-fields">
                      {(["x", "y", "width", "height"] as const).map((key) => (
                        <Field
                          key={key}
                          label={
                            key === "width"
                              ? "W"
                              : key === "height"
                                ? "H"
                                : key.toUpperCase()
                          }
                        >
                          <input
                            type="number"
                            min={
                              key === "width" || key === "height" ? 0.001 : -2
                            }
                            max="3"
                            step="0.01"
                            value={Number(selectedLayer[key].toFixed(3))}
                            onChange={(event) =>
                              patchLayer({ [key]: Number(event.target.value) })
                            }
                          />
                        </Field>
                      ))}
                    </div>
                    <Hint
                      label={`Opacity ${Math.round(selectedLayer.opacity * 100)}%`}
                    >
                      <input
                        className="ie-range"
                        type="range"
                        aria-label="Layer opacity"
                        min="0"
                        max="1"
                        step="0.01"
                        value={selectedLayer.opacity}
                        onChange={(event) =>
                          patchLayer({ opacity: Number(event.target.value) })
                        }
                      />
                    </Hint>
                  </>
                )}
              </ToolPopover>
              <ToolPopover label="Edit settings" icon={<Gear />}>
                <div className="ie-settings-grid">
                  <Field label="Model">
                    <select
                      value={editor.settings.model}
                      onChange={(event) =>
                        setSetting(
                          "model",
                          event.target
                            .value as EditorSettings["settings"]["model"],
                        )
                      }
                    >
                      {modelIds("edit").map((id) => (
                        <option key={id} value={id}>
                          {imageModels[id].label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Resolution">
                    <select
                      value={editor.settings.resolution}
                      onChange={(event) =>
                        setSetting(
                          "resolution",
                          event.target
                            .value as EditorSettings["settings"]["resolution"],
                        )
                      }
                    >
                      {imageEditResolutions.map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Aspect ratio">
                    <select
                      value={editor.settings.aspectRatio}
                      onChange={(event) =>
                        setSetting(
                          "aspectRatio",
                          event.target
                            .value as EditorSettings["settings"]["aspectRatio"],
                        )
                      }
                    >
                      {imageEditRatios.map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Images">
                    <select
                      value={editor.settings.numImages}
                      onChange={(event) =>
                        setSetting("numImages", Number(event.target.value))
                      }
                    >
                      {[1, 2, 3, 4].map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Seed">
                    <input
                      type="number"
                      value={editor.settings.seed ?? ""}
                      placeholder="Random"
                      onChange={(event) =>
                        setSetting(
                          "seed",
                          event.target.value === ""
                            ? undefined
                            : Number(event.target.value),
                        )
                      }
                    />
                  </Field>
                </div>
                <Flex justify="between" align="center">
                  <Text size="1">Reconstruct geometry</Text>
                  <Tooltip
                    delayDuration={0}
                    content="Re-pose the result so linked captures get matching depth. Current geometry stays until it finishes."
                  >
                    <Switch
                      size="1"
                      aria-label="Reconstruct geometry"
                      checked={reconstruct}
                      onCheckedChange={setReconstruct}
                    />
                  </Tooltip>
                </Flex>
              </ToolPopover>
              <Hint
                label={
                  !source
                    ? "Choose an image to edit"
                    : !editor.prompt.trim()
                      ? "Describe the edit first"
                      : `Generate ${editor.settings.numImages === 1 ? "an edited image" : `${editor.settings.numImages} edited images`} with Nano Banana`
                }
              >
                <Button
                  size="1"
                  variant="surface"
                  color="gray"
                  className="ie-generate submit-action"
                  data-ready={!!source && !!editor.prompt.trim() && !submitting}
                  aria-label="Generate edited image"
                  disabled={!source || !editor.prompt.trim() || submitting}
                  onClick={submitGeneration}
                >
                  {submitting ? (
                    <SpinnerGap className="spin" />
                  ) : (
                    <ArrowElbowDownLeft />
                  )}
                </Button>
              </Hint>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** A square icon button that opens a popover of secondary edit inputs. */
function ToolPopover({
  label,
  icon,
  count,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <Popover.Root>
      <Hint label={count ? `${label} (${count})` : label}>
        <Popover.Trigger>
          <IconButton
            size="1"
            variant="ghost"
            color="gray"
            className="ie-tool-button"
            aria-label={label}
          >
            {icon}
            {count ? <span className="ie-count">{count}</span> : null}
          </IconButton>
        </Popover.Trigger>
      </Hint>
      <Popover.Content size="1" width="260px" side="top" align="end">
        <Flex direction="column" gap="2">
          <Text size="1" weight="medium">
            {label}
          </Text>
          {children}
        </Flex>
      </Popover.Content>
    </Popover.Root>
  );
}

function ImagePicker({
  label,
  value,
  options,
  onChange,
  onAdd,
}: {
  label: string;
  value: string;
  options: Asset[];
  onChange: (value: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="ie-picker">
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Choose an image…</option>
        {options.map((asset) => (
          <option key={asset.id} value={asset.id}>
            {asset.name}
          </option>
        ))}
      </select>
      <Hint label={label}>
        <button
          className="icon-button"
          aria-label={label}
          disabled={!value}
          onClick={onAdd}
        >
          <Plus />
        </button>
      </Hint>
    </div>
  );
}

export default ImageEditor;
