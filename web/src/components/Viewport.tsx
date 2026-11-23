import { projectApi } from "../../../core/project-url";
import {
  frameSourceIds,
  referenceComparison,
} from "../../../core/reference-comparison";
import { ViewportFeed } from "./ViewportFeed";
import { AgentCursors } from "./AgentCursors";
import type { Activity } from "../../../core/activity";
import {
  AgentPresence,
  changeBounds,
  followCamera,
} from "../lib/agent-presence";
import {
  ViewportCameraTools,
  ViewportLensSettings,
  useSetViewportFov,
} from "./ViewportCameraTools";
import { sessionFormat } from "../../../core/formats";
import {
  applyCamera,
  cameraValue,
  applyCalibratedProjection,
  viewportProjection,
  cameraWithIntrinsics,
  cameraInViewfinder,
  viewfinderRect,
  viewfinderCamera,
} from "../lib/viewport-projection";
import { GizmoOptions } from "./GizmoOptions";
import { ToolbarPopover } from "./ui";
import { FrameLabel, FrameEdit, positionFrameLabels } from "./FrameLabels";
import { activeJobs, frameSlugs, frameTasks } from "../../../core/frame-work";
import { cameraNode } from "../../../core/captures";
import {
  useImageToWorldClient,
  useWorkspaceData,
  useClientState,
} from "../lib/client";
import { clipboardAssetIds, type RequestPlacement } from "./ImageImport";
import {
  sceneCamera,
  selectedPath,
  spatialContextFieldOfView,
} from "../../../core/captures";
import { collectionDragPayload, endCollectionDrag } from "../lib/drag";
import { SceneRenderer } from "../lib/scene-renderer";
import type { WebGPURenderer } from "three/webgpu";
import {
  Crosshair,
  Gear,
  VideoCamera,
  ListBullets,
  ImageSquare,
  SlidersHorizontal,
} from "@phosphor-icons/react";
import {
  Button,
  Flex,
  IconButton,
  Popover,
  SegmentedControl,
  Slider,
  Switch,
  Text,
  Tooltip,
} from "@radix-ui/themes";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent,
  type MutableRefObject,
  type Ref,
} from "react";
import {
  GridHelper,
  Group,
  Matrix4,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Sphere,
  Vector2,
  Vector3,
} from "three";
import { FlyControls } from "../lib/fly";
import { PlayPointer } from "../lib/play-pointer";
import type { startScenePlay } from "../lib/scene-play";
import { CameraTransition } from "../lib/camera-transition";

import { selectedNodes, selectedRoots } from "../../../core/scene";
import { transformCapabilities } from "../../../core/node-capabilities";
import { CombinedTransformControls } from "../lib/combined-transform";
import {
  selectionPivot,
  type PivotPlacement,
  type GizmoSpace,
} from "../../../core/gizmo";
import { transformNodes } from "../../../core/cameras";
import {
  assetUrl,
  type Camera,
  type Workspace,
  type SceneNode,
} from "../../../core/schema";
import { SceneGraph } from "../lib/scene";
import { registerViewportCamera } from "../lib/viewport-camera";
import { usePaneShortcuts } from "../lib/shortcuts";

export type ViewportProps = {
  playing: boolean;
  setPlaying: (value: boolean) => void;
  previewNodes?: SceneNode[] | null;
  onPreviewNodes: (nodes: SceneNode[] | null) => void;
  previewCamera?: Camera | null;
  onPreviewCamera: (camera: Camera | null) => void;
  requestPlacement: RequestPlacement;
};

type Runtime = {
  scene: Scene;
  renderer: WebGPURenderer;
  camera: PerspectiveCamera;
  cameraTransition: CameraTransition;
  fly: FlyControls;
  transform: CombinedTransformControls;
  surface: SceneRenderer;
  ready: Promise<void>;
  graph: SceneGraph;
  grid: GridHelper;
  pivot: Group;
  raycaster: Raycaster;
  selectedRoots: string[];
  startNodes: Workspace["nodes"];
  transformError?: string;
  pivotStart: Matrix4;
  dragging: boolean;
  capturing: boolean;
  pendingSync: boolean;
  transformPointer: boolean;
  lastCamera: string;
  releasedCameraId?: string;
  releasePromise?: Promise<unknown>;
  persistingCamera?: boolean;
  play?: {
    time: number;
    session?: Awaited<ReturnType<typeof startScenePlay>>;
    pointer?: PlayPointer;
  };
};

function readViewportCamera(
  runtime: Runtime,
  workspace: Parameters<typeof sessionFormat>[0],
) {
  const size = runtime.renderer.getSize(new Vector2());
  return cameraInViewfinder(
    runtime.camera,
    { width: size.x, height: size.y },
    sessionFormat(workspace),
  );
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) (ref as MutableRefObject<T | null>).current = value;
}

function DisplaySlider({
  label,
  value,
  min,
  max,
  step,
  onCommit,
  onPreview,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onCommit: (value: number) => void;
  onPreview: (value: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  const active = useRef(false);
  const canceled = useRef(false);
  useEffect(() => {
    if (!active.current) setDraft(value);
  }, [value]);
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape" && active.current) {
        canceled.current = true;
        active.current = false;
        setDraft(value);
        onPreview(value);
      }
    };
    window.addEventListener("keydown", cancel, true);
    return () => window.removeEventListener("keydown", cancel, true);
  });
  return (
    <Tooltip delayDuration={0} content={label}>
      <Slider
        role="group"
        aria-label={label}
        value={[draft]}
        min={min}
        max={max}
        step={step}
        onPointerDownCapture={() => {
          active.current = true;
          canceled.current = false;
        }}
        onKeyDownCapture={(event) => {
          if (event.key !== "Escape") canceled.current = false;
        }}
        onValueChange={([next]) => {
          setDraft(next);
          onPreview(next);
        }}
        onValueCommit={([next]) => {
          if (canceled.current) return;
          active.current = false;
          onCommit(next);
        }}
      />
    </Tooltip>
  );
}

export function Viewport({
  playing,
  setPlaying,
  previewNodes,
  onPreviewNodes,
  previewCamera,
  onPreviewCamera,
  requestPlacement,
}: ViewportProps) {
  const {
    store: clientStore,
    setViewportFeed,
    command,
    upload,
    setError: onError,
    setHoveredNode,
  } = useImageToWorldClient();
  const hoveredNodeId = useClientState((state) => state.hoveredNodeId);
  const source = useWorkspaceData(
    [
      "revision",
      "nodes",
      "assets",
      "jobs",
      "selection",
      "primaryId",
      "imageDrafts",
      "imageVersions",
    ],
    [
      "viewportCamera",
      "viewportOptions",
      "freeCamera",
      "format",
      "viewingCameraId",
      "lighting",
      "grid",
      "display",
      "pointSize",
      "atlas",
      "atlasPanel",
      "prompt",
      "fps",
      "targetFrameCount",
      "atlasReturnDepth",
      "editor2d",
      "seed",
      "enhancePrompt",
    ],
  );
  const workspace = useMemo(
    () =>
      previewNodes
        ? {
            ...source,
            nodes: {
              ...source.nodes,
              ...Object.fromEntries(
                previewNodes.map((node) => [node.id, node]),
              ),
            },
          }
        : source,
    [source, previewNodes],
  );
  const cursorLayer = useRef<HTMLDivElement>(null);
  const cursorAnchors = useRef(new Map<string, Activity>());
  const showFeed = useClientState((s) => s.showViewportFeed !== false);
  const goToActivity = useRef<(activity: Activity) => boolean>(() => false);
  const following = useClientState((s) => !!s.followAgentEdits);
  const labelsRef = useRef<HTMLDivElement>(null);
  const slugs = useMemo(() => frameSlugs(workspace.nodes), [workspace.nodes]);
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<Runtime | undefined>(undefined);
  const previewCameraRef = useRef(previewCamera);
  previewCameraRef.current = previewCamera;
  const workspaceRef = useRef(workspace);
  const commandRef = useRef(command);
  const uploadRef = useRef(upload);
  const requestPlacementRef = useRef(requestPlacement);
  const errorRef = useRef(onError);
  const captureControllers = useRef(new Map<string, AbortController>());
  const captureQueue = useRef(Promise.resolve());
  const captureAttempts = useRef(new Map<string, number>());
  const [captureTick, setCaptureTick] = useState(0);
  const [playReady, setPlayReady] = useState(false);
  const [syncTick, setSyncTick] = useState(0);
  const [showInput, setShowInput] = useState(true);
  const [inputOpacity, setInputOpacity] = useState(75);
  const viewingId = workspace.settings.viewingCameraId;
  const compared = useMemo(
    () =>
      previewCamera ? undefined : referenceComparison(workspace, viewingId),
    [workspace.assets, workspace.nodes, viewingId, previewCamera],
  );
  useEffect(() => {
    setShowInput(true);
  }, [viewingId]);
  const [pivotPlacement, setPivotPlacement] =
    useState<PivotPlacement>("center");
  const [gizmoSpace, setGizmoSpace] = useState<GizmoSpace>("world");
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [viewportSize, setViewportSize] = useState({ width: 1, height: 1 });
  useEffect(
    () =>
      registerViewportCamera(() => {
        const runtime = runtimeRef.current;
        return runtime
          ? readViewportCamera(runtime, workspaceRef.current)
          : null;
      }),
    [],
  );
  useEffect(() => {
    const clear = () => {
      setDraggingFiles(false);
      endCollectionDrag();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") clear();
    };
    const leaveWindow = (event: globalThis.DragEvent) => {
      if (!event.relatedTarget) setDraggingFiles(false);
    };
    window.addEventListener("dragend", clear);
    window.addEventListener("drop", clear);
    window.addEventListener("blur", clear);
    window.addEventListener("keydown", escape);
    window.addEventListener("dragleave", leaveWindow);
    return () => {
      window.removeEventListener("dragend", clear);
      window.removeEventListener("drop", clear);
      window.removeEventListener("blur", clear);
      window.removeEventListener("keydown", escape);
      window.removeEventListener("dragleave", leaveWindow);
    };
  }, []);
  const focusRef = useRef<() => void>(() => undefined);
  const pane = usePaneShortcuts(
    "viewport",
    (event) => {
      if (playing) {
        if (!event.ctrlKey && !event.metaKey && !event.altKey)
          runtimeRef.current?.fly.keyDown(event);
        return;
      }
      if (event.key === "Escape" && runtimeRef.current?.dragging) {
        event.preventDefault();
        const runtime = runtimeRef.current;
        runtime.transform.reset();
        runtime.dragging = false;
        runtime.transformPointer = false;
        onPreviewNodes(null);
        setSyncTick((value) => value + 1);
        return;
      }
      const runtime = runtimeRef.current;
      if (runtime?.dragging || runtime?.capturing) return;
      if (event.key === "Escape") {
        runtime?.fly.stop();
        onPreviewCamera(null);
        return;
      }
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && !event.altKey) {
        const type =
          key === "z"
            ? event.shiftKey
              ? "history.redo"
              : "history.undo"
            : key === "y"
              ? "history.redo"
              : key === "d"
                ? "nodes.duplicate"
                : undefined;
        if (type) {
          event.preventDefault();
          runtime?.fly.stop();
          const ids = selectedRoots(
            workspaceRef.current.nodes,
            selectedNodes(workspaceRef.current).map((node) => node.id),
          );
          void commandRef
            .current(type === "nodes.duplicate" ? { type, ids } : { type })
            .catch((error) => errorRef.current(message(error)));
        }
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (key === "backspace" || key === "delete") {
        event.preventDefault();
        runtime?.fly.stop();
        const ids = selectedRoots(
          workspaceRef.current.nodes,
          selectedNodes(workspaceRef.current).map((node) => node.id),
        );
        if (ids.length)
          void commandRef
            .current({ type: "nodes.remove", ids })
            .catch((error) => errorRef.current(message(error)));
        return;
      }
      if (key === "c") {
        event.preventDefault();
        if (event.repeat) return;
        const camera = runtime
          ? readViewportCamera(runtime, workspaceRef.current)
          : workspaceRef.current.settings.viewportCamera;
        onPreviewCamera(null);
        void commandRef
          .current({ type: "camera.place", camera })
          .catch((error) => errorRef.current(message(error)));
        return;
      }
      if (runtime?.fly.keyDown(event)) return;
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        focusRef.current();
      }
    },
    true,
  );
  const { ref: paneRef, ...paneHandlers } = pane;

  workspaceRef.current = workspace;
  commandRef.current = command;
  requestPlacementRef.current = requestPlacement;
  uploadRef.current = upload;
  errorRef.current = onError;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new Scene();
    const surface = new SceneRenderer(false, (detail) =>
      errorRef.current(detail),
    );
    const renderer = surface.renderer;
    const ready = surface.init();
    let mounted = true;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const theme = getComputedStyle(host);
    const color = (name: string) =>
      theme.getPropertyValue(`--viewport-${name}`).trim();
    renderer.setClearColor(color("background"), 1);
    renderer.domElement.tabIndex = 0;
    renderer.domElement.className = "viewport-webgl";
    host.appendChild(renderer.domElement);

    const camera = new PerspectiveCamera(50, 1, 0.01, 10_000);
    applyCamera(camera, workspaceRef.current.settings.viewportCamera);

    const transform = new CombinedTransformControls(
      camera,
      renderer.domElement,
    );
    transform.setSpace("world");
    transform.setColors(
      color("axis-x"),
      color("axis-y"),
      color("axis-z"),
      color("active"),
    );
    scene.add(transform.getHelper());
    const pivot = new Group();
    scene.add(pivot);

    const grid = new GridHelper(
      40,
      40,
      color("grid-major"),
      color("grid-minor"),
    );
    grid.material.transparent = true;
    grid.material.opacity = 0.72;
    scene.add(grid);
    const graph = new SceneGraph(
      scene,
      (value) => errorRef.current(value),
      color("helper"),
      color("active"),
      () => ready.then(() => renderer),
    );
    const presence = new AgentPresence();
    const followTransition = new CameraTransition(camera);
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let consumedChange = clientStore.getState().liveSceneChange;
    let nextShot = 0;
    let pendingSince = 0;
    let pending: Activity | undefined;
    const fly = new FlyControls(
      camera,
      renderer.domElement,
      () =>
        !runtime.dragging &&
        !runtime.capturing &&
        (runtime.play ? !!runtime.play.session : !previewCameraRef.current),
      () => {
        if (!runtime.play) persistCamera();
      },
      () => {
        if (!runtime.play) releaseForNavigation();
      },
      host,
    );
    const runtime: Runtime = {
      scene,
      renderer,
      camera,
      cameraTransition: new CameraTransition(camera),
      fly,
      transform,
      surface,
      ready,
      graph,
      grid,
      pivot,
      raycaster: new Raycaster(),
      selectedRoots: [],
      startNodes: {},
      pivotStart: new Matrix4(),
      dragging: false,
      capturing: false,
      pendingSync: false,
      transformPointer: false,
      lastCamera: JSON.stringify(workspaceRef.current.settings.viewportCamera),
    };
    runtimeRef.current = runtime;

    const releaseForNavigation = () => {
      const state = workspaceRef.current;
      const id = state.settings.viewingCameraId;
      if (!id || runtime.releasedCameraId === id) return;
      runtime.releasedCameraId = id;
      runtime.cameraTransition.cancel();
      const visible = readViewportCamera(runtime, state);
      runtime.lastCamera = JSON.stringify(visible);
      runtime.releasePromise = commandRef
        .current({ type: "camera.release", camera: visible })
        .catch((error) => errorRef.current(message(error)));
    };

    const persistCamera = () => {
      const value = readViewportCamera(runtime, workspaceRef.current);
      runtime.lastCamera = JSON.stringify(value);
      runtime.persistingCamera = true;
      void Promise.resolve(runtime.releasePromise)
        .then(() =>
          commandRef.current({
            type: "workspace.update",
            settings: {
              viewportCamera: value,
              viewingCameraId: null,
              freeCamera: null,
            },
          }),
        )
        .catch((error) => errorRef.current(message(error)))
        .finally(() => {
          runtime.persistingCamera = false;
          setSyncTick((value) => value + 1);
        });
    };

    transform.addEventListener("dragging-changed", (event) => {
      runtime.dragging = Boolean(event.value);
      if (runtime.dragging) runtime.fly.stop();
    });
    transform.addEventListener("cancel", () => {
      runtime.transformPointer = false;
      onPreviewNodes(null);
      setSyncTick((value) => value + 1);
    });
    transform.addEventListener("mouseDown", () => {
      runtime.transformPointer = true;
      scene.updateMatrixWorld(true);
      runtime.startNodes = structuredClone(workspaceRef.current.nodes);
      runtime.transformError = undefined;
      runtime.pivotStart.copy(pivot.matrixWorld);
    });
    const transformedNodes = () =>
      transformNodes(
        runtime.startNodes,
        runtime.selectedRoots,
        pivot.matrixWorld.clone().multiply(runtime.pivotStart.clone().invert()),
      );
    transform.addEventListener("objectChange", () => {
      if (!runtime.dragging) return;
      scene.updateMatrixWorld(true);
      try {
        const nodes = transformedNodes();
        onPreviewNodes(nodes);
        runtime.transformError = undefined;
        for (const node of nodes) {
          const root = graph.entries.get(node.id)?.root;
          if (!root) continue;
          root.position.fromArray(node.transform.position);
          root.quaternion.fromArray(node.transform.quaternion);
          root.scale.fromArray(node.transform.scale);
        }
      } catch (error) {
        runtime.transformError = message(error);
      }
    });
    transform.addEventListener("mouseUp", () => {
      const commit = async () => {
        if (runtime.transformError) throw new Error(runtime.transformError);
        scene.updateMatrixWorld(true);
        const nodes = transformedNodes().map((node) => {
          const current = workspaceRef.current.nodes[node.id];
          const start = runtime.startNodes[node.id];
          if (
            !current ||
            current.parentId !== start.parentId ||
            JSON.stringify(current.transform) !==
              JSON.stringify(start.transform)
          )
            throw new Error(
              "The selection changed externally during the drag. Try the transform again.",
            );
          return { ...current, transform: node.transform };
        });
        if (nodes.length)
          await commandRef.current({ type: "nodes.put", nodes });
      };
      void commit()
        .catch((error) => errorRef.current(message(error)))
        .finally(() => {
          onPreviewNodes(null);
          setSyncTick((value) => value + 1);
        });
      queueMicrotask(() => {
        runtime.transformPointer = false;
      });
    });

    let hoverPointer: Vector2 | null = null;
    let hoverDirty = false;
    const clearHover = () => {
      hoverPointer = null;
      hoverDirty = false;
      setHoveredNode(null);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (runtime.play) return;
      if (event.buttons || runtime.dragging || runtime.capturing) {
        clearHover();
        return;
      }
      const rect = renderer.domElement.getBoundingClientRect();
      hoverPointer = new Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      hoverDirty = true;
    };
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerleave", clearHover);
    let pointerDown: Vector2 | undefined;
    const onPointerDown = (event: PointerEvent) => {
      renderer.domElement.focus({ preventScroll: true });
      if (runtime.play) return;
      pointerDown = new Vector2(event.clientX, event.clientY);
    };
    const onPointerUp = (event: PointerEvent) => {
      if (
        runtime.play ||
        !pointerDown ||
        runtime.dragging ||
        runtime.transformPointer ||
        event.button !== 0
      )
        return;
      if (pointerDown.distanceTo(new Vector2(event.clientX, event.clientY)) > 4)
        return;
      const rect = renderer.domElement.getBoundingClientRect();
      const pointer = new Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      runtime.raycaster.setFromCamera(pointer, camera);
      const hit = graph.pick(runtime.raycaster, pointer);
      const current = workspaceRef.current.selection;
      let ids: string[];
      if ((event.shiftKey || event.metaKey || event.ctrlKey) && hit)
        ids = current.includes(hit)
          ? current.filter((id) => id !== hit)
          : [...current, hit];
      else ids = hit ? [hit] : [];
      void commandRef
        .current({ type: "selection.set", ids })
        .catch((error) => errorRef.current(message(error)));
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    const onDoubleClick = (event: MouseEvent) => {
      if (runtime.play || runtime.dragging || runtime.capturing) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const pointer = new Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      runtime.raycaster.setFromCamera(pointer, camera);
      const id = graph.pick(runtime.raycaster, pointer);
      if (id && sceneCamera(workspaceRef.current, id))
        void commandRef
          .current({ type: "camera.view", nodeId: id })
          .catch((error) => errorRef.current(message(error)));
    };
    renderer.domElement.addEventListener("dblclick", onDoubleClick);

    const visit = (target: PerspectiveCamera) => {
      releaseForNavigation();
      runtime.fly.stop();
      const intrinsics =
        workspaceRef.current.settings.viewportCamera.intrinsics;
      onPreviewCamera(null);
      void Promise.resolve(runtime.releasePromise)
        .then(() =>
          commandRef.current({
            type: "workspace.update",
            settings: {
              viewportCamera: cameraValue(
                target,
                intrinsics.width,
                intrinsics.height,
              ),
              viewingCameraId: null,
              freeCamera: null,
            },
          }),
        )
        .catch((error) => errorRef.current(message(error)));
    };
    const focus = () => {
      const ids = workspaceRef.current.selection.length
        ? workspaceRef.current.selection
        : Object.keys(workspaceRef.current.nodes);
      const bounds = graph.bounds(ids);
      if (!bounds) return;
      const sphere = bounds.getBoundingSphere(new Sphere());
      const direction = camera.getWorldDirection(new Vector3());
      const distance = Math.max(
        0.5,
        (sphere.radius / Math.sin((camera.fov * Math.PI) / 360)) * 1.2,
      );
      const target = camera.clone();
      target.position.copy(sphere.center).addScaledVector(direction, -distance);
      visit(target);
    };
    goToActivity.current = (activity) => {
      if (runtime.play || runtime.capturing || runtime.dragging) return false;
      const bounds = activity.sceneChange
        ? changeBounds(graph, activity.sceneChange)
        : graph.bounds(activity.nodeIds);
      if (bounds) visit(followCamera(camera, bounds));
      else if (activity.camera) {
        const target = camera.clone();
        target.position.fromArray(activity.camera.position);
        target.quaternion.fromArray(activity.camera.quaternion);
        if (activity.camera.fov) target.fov = activity.camera.fov;
        visit(target);
      } else return false;
      return true;
    };
    focusRef.current = focus;

    const resize = () => {
      runtime.cameraTransition.finish();
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      const state = workspaceRef.current;
      setViewportSize({ width, height });
      const calibrated =
        runtime.play || runtime.fly.moving || runtime.persistingCamera
          ? readViewportCamera(runtime, state)
          : (previewCameraRef.current ??
            (state.settings.viewingCameraId
              ? sceneCamera(state, state.settings.viewingCameraId)
              : undefined));
      renderer.setSize(width, height, false);
      viewportProjection(
        camera,
        width,
        height,
        viewfinderCamera(
          calibrated ?? state.settings.viewportCamera,
          sessionFormat(state),
        ),
      );
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    let animation = 0;
    let lastFrame = performance.now();
    let spatialVersion = graph.spatialVersion;
    let lastDrawError: string | undefined;
    const render = () => {
      const now = performance.now();
      const seconds = (now - lastFrame) / 1000;
      lastFrame = now;
      animation = requestAnimationFrame(render);
      const local = clientStore.getState();
      const canFollow =
        local.followAgentEdits &&
        !runtime.play &&
        !runtime.capturing &&
        !runtime.dragging &&
        !runtime.transformPointer &&
        !runtime.fly.active &&
        !runtime.persistingCamera &&
        !previewCameraRef.current &&
        !workspaceRef.current.settings.viewingCameraId &&
        !document.hidden;
      if (!canFollow || runtime.cameraTransition.active) {
        followTransition.cancel();
        pending = undefined;
      }
      if (local.liveSceneChange !== consumedChange) {
        consumedChange = local.liveSceneChange;
        if (
          canFollow &&
          consumedChange &&
          Date.now() - consumedChange.at < 5000
        ) {
          if (!pending) pendingSince = now;
          pending = consumedChange;
        }
      }
      if (
        canFollow &&
        pending?.sceneChange &&
        !runtime.cameraTransition.active &&
        now >= nextShot &&
        now - pendingSince >= 220 &&
        ((!graph.loadingGeometry &&
          pending.sceneChange.nodeIds.every((id) => graph.entries.has(id))) ||
          now - pendingSince >= 2400)
      ) {
        const bounds = changeBounds(graph, pending.sceneChange);
        followTransition.start(followCamera(camera, bounds), now, 850);
        if (motion.matches) followTransition.finish();
        nextShot = now + 1300;
        pending = undefined;
      }
      if (runtime.capturing) return;
      followTransition.update(now);
      if (runtime.fly.moving && runtime.cameraTransition.active) {
        runtime.cameraTransition.cancel();
        // Save the interrupted pose when the fly gesture ends, even without a drag.
        runtime.fly.markChanged();
      }
      runtime.cameraTransition.update(now);
      runtime.fly.update(seconds);
      if (
        hoverDirty &&
        hoverPointer &&
        !runtime.play &&
        !runtime.dragging &&
        !runtime.fly.active
      ) {
        hoverDirty = false;
        camera.updateMatrixWorld();
        runtime.raycaster.setFromCamera(hoverPointer, camera);
        setHoveredNode(graph.pick(runtime.raycaster, hoverPointer) ?? null);
      }
      if (runtime.play) {
        if (runtime.play.session) runtime.play.time += Math.min(0.1, seconds);
        graph.sample(runtime.play.time, camera);
        runtime.play.pointer?.update();
        runtime.play.session?.step(seconds);
      } else {
        graph.sample(now / 1000, camera);
        transform.update();
      }
      graph.update();
      if (labelsRef.current)
        positionFrameLabels(labelsRef.current, graph, camera);
      if (cursorLayer.current && !runtime.play)
        presence.update(
          cursorLayer.current,
          graph,
          camera,
          cursorAnchors.current,
          workspaceRef.current.nodes,
          seconds,
          motion.matches,
        );
      if (
        graph.spatialVersion !== spatialVersion &&
        !runtime.play &&
        !runtime.dragging &&
        !runtime.fly.active
      ) {
        spatialVersion = graph.spatialVersion;
        setSyncTick((value) => value + 1);
      }
      renderer.shadowMap.enabled = graph.keyShadows;
      try {
        surface.render(scene, camera);
        lastDrawError = undefined;
      } catch (error) {
        // Invalid authored shader graphs can throw synchronously while Three
        // builds the draw. Keep the editor responsive for the next module edit.
        const detail = message(error);
        if (detail !== lastDrawError) errorRef.current(detail);
        lastDrawError = detail;
      }
    };
    void ready
      .then(() => {
        if (!mounted) return;
        camera.coordinateSystem = renderer.coordinateSystem;
        setSyncTick((value) => value + 1);
        resize();
        render();
      })
      .catch((error) => {
        if (mounted) errorRef.current(message(error));
      });

    return () => {
      mounted = false;
      cancelAnimationFrame(animation);
      for (const controller of captureControllers.current.values())
        controller.abort();
      captureControllers.current.clear();
      observer.disconnect();
      goToActivity.current = () => false;
      focusRef.current = () => undefined;
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerleave", clearHover);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("dblclick", onDoubleClick);
      runtime.fly.dispose();
      transform.detach();
      transform.dispose();
      transform.getHelper().removeFromParent();
      renderer.domElement.remove();
      const disposeRenderer = async () => {
        await captureQueue.current;
        await ready.catch(() => {});
        await surface.dispose(() => {
          graph.dispose();
          grid.geometry.dispose();
          grid.material.dispose();
        });
      };
      void disposeRenderer().catch((error) => errorRef.current(message(error)));
      runtimeRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    if (!playing) runtimeRef.current?.graph.setHovered(hoveredNodeId);
  }, [hoveredNodeId, playing]);

  useLayoutEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    if (playing || runtime.dragging || runtime.capturing) {
      runtime.pendingSync = true;
      return;
    }
    runtime.pendingSync = false;
    // The overlay controls the viewed image, even if its scene plane is visible.
    runtime.graph.setReviewSources(compared ? [compared.imageId] : []);
    runtime.graph.sync(workspace);
    runtime.grid.visible = workspace.settings.grid;
    runtime.surface.falloff =
      workspace.settings.display.pointStyle === "gaussian" ? 1 : 0;
    runtime.surface.maxPixelRadius = workspace.settings.pointSize;
    const clippingChanged =
      runtime.camera.near !== workspace.settings.viewportOptions.near ||
      runtime.camera.far !== workspace.settings.viewportOptions.far;
    runtime.camera.near = workspace.settings.viewportOptions.near;
    runtime.camera.far = workspace.settings.viewportOptions.far;
    if (!workspace.settings.viewingCameraId)
      runtime.releasedCameraId = undefined;

    if (runtime.fly.active || runtime.persistingCamera) {
      runtime.pendingSync = true;
      return;
    }

    const value = viewfinderCamera(
      previewCamera ??
        (workspace.settings.viewingCameraId &&
        runtime.releasedCameraId !== workspace.settings.viewingCameraId
          ? sceneCamera(workspace, workspace.settings.viewingCameraId)
          : undefined) ??
        workspace.settings.viewportCamera,
      sessionFormat(workspace),
    );
    const incomingCamera = JSON.stringify(value);
    if (
      (incomingCamera !== runtime.lastCamera || clippingChanged) &&
      !runtime.dragging
    ) {
      const target = runtime.camera.clone();
      applyCamera(target, value);
      viewportProjection(
        target,
        runtime.renderer.domElement.clientWidth,
        runtime.renderer.domElement.clientHeight,
        value,
      );
      runtime.cameraTransition.start(target, performance.now());
      if (
        previewCamera ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      )
        runtime.cameraTransition.finish();
      runtime.lastCamera = incomingCamera;
    }

    runtime.transform.setSpace(gizmoSpace === "object" ? "local" : "world");
    runtime.transform.setCapabilities(
      transformCapabilities(selectedNodes(workspace)),
    );
    runtime.transform.detach();
    runtime.pivot.removeFromParent();
    const topLevel = selectedRoots(
      workspace.nodes,
      selectedNodes(workspace)
        .filter((node) => !node.locked)
        .map((node) => node.id),
    ).filter((id) => runtime.graph.entries.has(id));
    runtime.selectedRoots = topLevel;
    if (topLevel.length) {
      const pivot = selectionPivot(
        workspace.nodes,
        topLevel,
        workspace.primaryId,
        pivotPlacement,
        gizmoSpace,
        pivotPlacement === "center"
          ? runtime.graph.bounds(topLevel)
          : undefined,
      );
      runtime.pivot.position.copy(pivot.position);
      runtime.pivot.quaternion.copy(pivot.quaternion);
      runtime.pivot.scale.set(1, 1, 1);
      runtime.scene.add(runtime.pivot);
      runtime.pivot.updateMatrixWorld(true);
      runtime.transform.attach(runtime.pivot);
    }
  }, [
    playing,
    compared,
    workspace.nodes,
    workspace.assets,
    workspace.selection,
    workspace.primaryId,
    workspace.settings.atlas,
    workspace.settings.display,
    workspace.settings.grid,
    workspace.settings.pointSize,
    workspace.settings.viewportCamera,
    workspace.settings.viewingCameraId,
    workspace.settings.lighting,
    workspace.settings.freeCamera,
    workspace.settings.viewportOptions,
    workspace.settings.format,
    syncTick,
    previewCamera,
    pivotPlacement,
    gizmoSpace,
  ]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || playing) return;
    const now = Date.now();
    let nextRetry = Number.POSITIVE_INFINITY;
    for (const id of captureAttempts.current.keys()) {
      const status = workspace.jobs[id]?.status;
      if (status !== "queued" && status !== "running")
        captureAttempts.current.delete(id);
    }
    for (const job of activeJobs(workspace.jobs)) {
      if (job.input.kind !== "capture" && job.input.kind !== "inspect")
        continue;
      if (captureControllers.current.has(job.id)) {
        nextRetry = Math.min(nextRetry, 1_000);
        continue;
      }
      const leaseReadyAt =
        job.status === "queued" ? now : job.updatedAt + 60_000;
      const attemptReadyAt =
        (captureAttempts.current.get(job.id) ?? 0) + 60_000;
      const readyAt = Math.max(leaseReadyAt, attemptReadyAt);
      if (readyAt > now) {
        nextRetry = Math.min(nextRetry, readyAt - now);
        continue;
      }
      const captureInput = job.input;
      captureAttempts.current.set(job.id, now);
      nextRetry = Math.min(nextRetry, 60_000);
      const controller = new AbortController();
      captureControllers.current.set(job.id, controller);
      const capture = async () => {
        let claimed = false;
        try {
          const claimResponse = await fetch(
            projectApi(`viewport-jobs/${encodeURIComponent(job.id)}/claim`),
            {
              method: "POST",
              headers: { "X-Image-To-World-Client": "web" },
              signal: controller.signal,
            },
          );
          if (!claimResponse.ok)
            throw new Error(`Capture claim failed (${claimResponse.status})`);
          claimed = Boolean(
            ((await claimResponse.json()) as { claimed?: boolean }).claimed,
          );
          if (!claimed) return;

          if (captureInput.kind === "inspect") {
            if (runtime.dragging || runtime.fly.active)
              throw new Error(
                "Finish the viewport gesture and retry scene inspection",
              );
            runtime.graph.sync(workspaceRef.current);
            await runtime.graph.ready(controller.signal);
            const report = runtime.graph.inspect(captureInput.nodeIds);
            const form = new FormData();
            form.append(
              "files",
              new File([JSON.stringify(report, null, 2)], "inspection.json", {
                type: "application/json",
              }),
            );
            const response = await fetch(
              projectApi(`viewport-jobs/${encodeURIComponent(job.id)}`),
              {
                method: "POST",
                headers: { "X-Image-To-World-Client": "web" },
                body: form,
                signal: controller.signal,
              },
            );
            if (!response.ok)
              throw new Error(`Inspection upload failed (${response.status})`);
            return;
          }
          await runtime.ready;
          await runtime.graph.ready(controller.signal);
          const originalSize = runtime.renderer.getSize(new Vector2());
          const originalPixelRatio = runtime.renderer.getPixelRatio();
          let size = runtime.renderer.getDrawingBufferSize(new Vector2());
          let captureCamera = runtime.camera;
          if (captureInput.camera) {
            size = new Vector2(
              captureInput.camera.intrinsics.width,
              captureInput.camera.intrinsics.height,
            );
            runtime.renderer.setPixelRatio(1);
            runtime.renderer.setSize(size.x, size.y, false);
            captureCamera = new PerspectiveCamera(
              50,
              size.x / size.y,
              0.01,
              10_000,
            );
            captureCamera.coordinateSystem = runtime.renderer.coordinateSystem;
            applyCamera(captureCamera, captureInput.camera);
            applyCalibratedProjection(captureCamera, captureInput.camera);
          }
          const gridVisible = runtime.grid.visible;
          const transformHelper = runtime.transform.getHelper();
          const transformVisible = transformHelper.visible;
          const transformParent = transformHelper.parent;
          transformHelper.removeFromParent();
          const reviewSources = runtime.graph.setReviewSources([]);
          const restoreHelpers = runtime.graph.hideCaptureHelpers();
          runtime.grid.visible = false;
          transformHelper.visible = false;
          runtime.fly.stop();
          runtime.capturing = true;
          let blob: Blob;
          try {
            runtime.graph.update();
            await runtime.surface.settle(
              runtime.scene,
              captureCamera,
              controller.signal,
            );
            if (controller.signal.aborted)
              throw new DOMException("Aborted", "AbortError");
            runtime.renderer.shadowMap.enabled = runtime.graph.keyShadows;
            blob = await runtime.surface.checked(async () => {
              runtime.surface.render(runtime.scene, captureCamera);
              return new Promise<Blob>((resolve, reject) => {
                runtime.renderer.domElement.toBlob(
                  (value) =>
                    value
                      ? resolve(value)
                      : reject(new Error("PNG capture failed")),
                  "image/png",
                );
              });
            });
          } finally {
            runtime.capturing = false;
            if (runtimeRef.current === runtime) {
              runtime.grid.visible = gridVisible;
              transformHelper.visible = transformVisible;
              transformParent?.add(transformHelper);
              restoreHelpers();
              runtime.graph.setReviewSources(reviewSources);
              if (captureInput.camera) {
                runtime.renderer.setPixelRatio(originalPixelRatio);
                runtime.renderer.setSize(originalSize.x, originalSize.y, false);
              }
              if (runtime.pendingSync) setSyncTick((value) => value + 1);
            }
          }
          if (controller.signal.aborted) return;
          const capturedCamera = captureInput.camera
            ? cameraWithIntrinsics(
                captureCamera,
                captureInput.camera.intrinsics,
              )
            : cameraValue(
                captureCamera,
                Math.round(size.x),
                Math.round(size.y),
              );
          const form = new FormData();
          form.append(
            "files",
            new File([blob], "screenshot.png", { type: "image/png" }),
          );
          form.append("camera", JSON.stringify(capturedCamera));
          const uploadResponse = await fetch(
            projectApi(`viewport-jobs/${encodeURIComponent(job.id)}`),
            {
              method: "POST",
              headers: { "X-Image-To-World-Client": "web" },
              body: form,
              signal: controller.signal,
            },
          );
          if (!uploadResponse.ok)
            throw new Error(`Capture upload failed (${uploadResponse.status})`);
        } catch (error) {
          if (controller.signal.aborted) return;
          const detail = message(error);
          errorRef.current(detail);
          if (claimed) {
            await fetch(
              projectApi(`viewport-jobs/${encodeURIComponent(job.id)}/fail`),
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-Image-To-World-Client": "web",
                },
                body: JSON.stringify({ error: detail }),
                signal: controller.signal,
              },
            ).catch(() => undefined);
          }
        } finally {
          captureControllers.current.delete(job.id);
        }
      };
      captureQueue.current = captureQueue.current.then(capture, capture);
    }
    if (!Number.isFinite(nextRetry)) return;
    const timer = window.setTimeout(
      () => setCaptureTick((value) => value + 1),
      Math.max(250, nextRetry + 50),
    );
    return () => window.clearTimeout(timer);
  }, [workspace.jobs, captureTick, playing]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!playing || !runtime) return;
    const controller = new AbortController();
    const play: NonNullable<Runtime["play"]> = { time: 0 };
    runtime.fly.stop();
    runtime.cameraTransition.finish();
    if (runtime.dragging) runtime.transform.reset();
    runtime.transform.detach();
    runtime.play = play;
    const camera = runtime.camera.clone();
    const calibration = readViewportCamera(runtime, workspaceRef.current);
    let restoreHelpers: (() => void) | undefined;
    let previousSources: readonly string[] | undefined;
    setPlayReady(false);
    const start = async () => {
      // A claimed capture owns the current canvas until its pixels are read.
      await captureQueue.current;
      controller.signal.throwIfAborted();
      await runtime.ready;
      const { startScenePlay } = await import("../lib/scene-play");
      controller.signal.throwIfAborted();
      previousSources = runtime.graph.setReviewSources(
        frameSourceIds(workspaceRef.current),
      );
      const session = await startScenePlay(runtime.graph, controller.signal);
      if (controller.signal.aborted) {
        session.dispose();
        return;
      }
      runtime.grid.visible = false;
      restoreHelpers = runtime.graph.hideCaptureHelpers();
      play.session = session;
      play.pointer = new PlayPointer(
        runtime.renderer.domElement,
        runtime.camera,
        session,
      );
      setPlayReady(true);
    };
    void start().catch((error) => {
      if (controller.signal.aborted) return;
      errorRef.current(message(error));
      setPlaying(false);
    });
    return () => {
      controller.abort();
      runtime.fly.stop();
      play.pointer?.dispose();
      play.session?.dispose();
      restoreHelpers?.();
      if (previousSources) runtime.graph.setReviewSources(previousSources);
      runtime.play = undefined;
      runtime.camera.copy(camera);
      const size = runtime.renderer.getSize(new Vector2());
      viewportProjection(runtime.camera, size.x, size.y, calibration);
      runtime.camera.updateMatrixWorld();
    };
  }, [playing, setPlaying]);

  const placementCamera = () => {
    const runtime = runtimeRef.current;
    const current = workspaceRef.current;
    return runtime
      ? readViewportCamera(runtime, current)
      : current.settings.viewportCamera;
  };
  const drop = async (event: DragEvent) => {
    event.preventDefault();
    setDraggingFiles(false);
    const camera = placementCamera();
    const payload = collectionDragPayload(event);
    const files = [...event.dataTransfer.files];
    endCollectionDrag();
    try {
      const assets =
        payload?.kind === "assets"
          ? payload.ids.map((id) => {
              const asset = workspaceRef.current.assets[id];
              if (!asset) throw new Error(`Asset ${id} is unavailable`);
              return asset;
            })
          : await uploadRef.current(files);
      requestPlacementRef.current(assets, camera);
    } catch (error) {
      errorRef.current(message(error));
    }
  };
  const paste = async (event: ReactClipboardEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target : null;
    if (
      target?.closest(
        "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='dialog']",
      )
    )
      return;
    const camera = placementCamera();
    const ids = clipboardAssetIds(event.clipboardData);
    if (ids.length) {
      event.preventDefault();
      try {
        const assets = ids.map((id) => {
          const asset = workspaceRef.current.assets[id];
          if (!asset) throw new Error(`Asset ${id} is unavailable`);
          return asset;
        });
        requestPlacementRef.current(assets, camera);
      } catch (error) {
        errorRef.current(message(error));
      }
      return;
    }
    const files = Array.from(event.clipboardData.files).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (!files.length) return;
    event.preventDefault();
    try {
      requestPlacementRef.current(await uploadRef.current(files), camera);
    } catch (error) {
      errorRef.current(message(error));
    }
  };
  const display = workspace.settings.display;
  const updateDisplay = (patch: Partial<typeof display>) =>
    void commandRef
      .current({
        type: "workspace.update",
        settings: { display: patch },
      })
      .catch((error) => errorRef.current(message(error)));
  const updateSetting = (
    patch: Partial<Pick<Workspace["settings"], "grid" | "pointSize">>,
  ) =>
    void commandRef
      .current({ type: "workspace.update", settings: patch })
      .catch((error) => errorRef.current(message(error)));

  const empty = Object.keys(workspace.nodes).length === 0;
  const format = sessionFormat(workspace);
  const viewingNode = workspace.settings.viewingCameraId
    ? workspace.nodes[workspace.settings.viewingCameraId]
    : undefined;
  const viewCamera = viewfinderCamera(
    previewCamera ??
      (viewingNode ? sceneCamera(workspace, viewingNode.id) : undefined) ??
      workspace.settings.viewportCamera,
    format,
  );
  const overrideName =
    viewingNode?.name ?? (previewCamera ? "Path preview" : undefined);
  const setFov = useSetViewportFov(viewCamera, format, overrideName);
  const lens = { camera: viewCamera, overrideName, setFov };
  const frame = viewfinderRect(viewportSize, format);
  const referenceScale =
    compared &&
    Math.max(
      frame.width / compared.projection.width,
      frame.height / compared.projection.height,
    );
  return (
    <div
      {...paneHandlers}
      ref={(value) => {
        assignRef(paneRef, value);
      }}
      onDragOver={(event) => {
        if (playing) return;
        const valid =
          event.dataTransfer.types.includes("Files") ||
          collectionDragPayload(event)?.kind === "assets";
        if (!valid) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDraggingFiles(true);
      }}
      onDragLeave={(event) => {
        const next = event.relatedTarget;
        if (!(next instanceof Node) || !event.currentTarget.contains(next))
          setDraggingFiles(false);
      }}
      onDrop={playing ? undefined : drop}
      onPaste={playing ? undefined : (event) => void paste(event)}
      className={playing ? "viewport-panel is-playing" : "viewport-panel"}
    >
      <div className="viewport-overlay" hidden={playing}>
        <div
          className="viewport-tools floating-toolbar"
          role="toolbar"
          aria-label="Transform tools"
        >
          <GizmoOptions
            placement={pivotPlacement}
            space={gizmoSpace}
            onPlacement={setPivotPlacement}
            onSpace={setGizmoSpace}
          />
        </div>

        <div
          className="viewport-tools floating-toolbar"
          role="toolbar"
          aria-label="View"
        >
          <ViewportCameraTools
            {...lens}
            autoFov={spatialContextFieldOfView(
              workspace,
              selectedPath(workspace)?.id,
            )}
            onRelease={() => {
              runtimeRef.current?.fly.stop();
              onPreviewCamera(null);
              void commandRef
                .current({ type: "camera.release" })
                .catch((error) => errorRef.current(message(error)));
            }}
          />
          <Tooltip delayDuration={0} content="Focus selection (F)">
            <IconButton
              size="1"
              variant="surface"
              color="gray"
              aria-label="Focus selection"
              onClick={() => focusRef.current()}
            >
              <Crosshair />
            </IconButton>
          </Tooltip>
          <Tooltip delayDuration={0} content="Follow major agent edits">
            <Button
              size="1"
              color="gray"
              variant={following ? "solid" : "surface"}
              aria-label="Auto-follow agent edits"
              aria-pressed={following}
              onClick={() =>
                clientStore.setState({
                  followAgentEdits: !following,
                  liveSceneChange: undefined,
                })
              }
            >
              <VideoCamera /> <span className="toolbar-label">Auto</span>
            </Button>
          </Tooltip>
          <Tooltip delayDuration={0} content="Viewport activity feed">
            <IconButton
              size="1"
              color="gray"
              variant={showFeed ? "solid" : "surface"}
              aria-label="Viewport activity feed"
              aria-pressed={showFeed}
              onClick={() => setViewportFeed(!showFeed)}
            >
              <ListBullets />
            </IconButton>
          </Tooltip>
        </div>
        <div
          className="viewport-tools floating-toolbar"
          role="toolbar"
          aria-label="Viewport display"
        >
          <Popover.Root>
            <Tooltip delayDuration={0} content="Image display">
              <Popover.Trigger>
                <IconButton
                  size="1"
                  variant="surface"
                  color="gray"
                  aria-label="Image display"
                >
                  <ImageSquare />
                </IconButton>
              </Popover.Trigger>
            </Tooltip>
            <Popover.Content size="1" width="220px">
              <Flex direction="column" gap="3">
                <Flex justify="between" align="center">
                  <Text size="1">RGB planes</Text>
                  <Tooltip delayDuration={0} content="RGB planes">
                    <Switch
                      size="1"
                      aria-label="RGB planes"
                      checked={display.showImages}
                      onCheckedChange={(showImages) =>
                        updateDisplay({ showImages })
                      }
                    />
                  </Tooltip>
                </Flex>
                <Flex direction="column" gap="1">
                  <Text size="1" color="gray">
                    Opacity {Math.round(display.imageOpacity * 100)}%
                  </Text>
                  <DisplaySlider
                    label="Image opacity"
                    value={display.imageOpacity}
                    min={0}
                    max={1}
                    step={0.01}
                    onPreview={(imageOpacity) =>
                      runtimeRef.current?.graph.setDisplay({
                        ...display,
                        imageOpacity,
                      })
                    }
                    onCommit={(imageOpacity) => updateDisplay({ imageOpacity })}
                  />
                </Flex>
                <Flex direction="column" gap="1">
                  <Text size="1" color="gray">
                    Frustum depth {display.imageDistance.toFixed(2)}
                  </Text>
                  <DisplaySlider
                    label="Frustum and image depth"
                    value={display.imageDistance}
                    min={0.1}
                    max={10}
                    step={0.05}
                    onPreview={(imageDistance) =>
                      runtimeRef.current?.graph.setDisplay({
                        ...display,
                        imageDistance,
                      })
                    }
                    onCommit={(imageDistance) =>
                      updateDisplay({ imageDistance })
                    }
                  />
                </Flex>
              </Flex>
            </Popover.Content>
          </Popover.Root>

          <Popover.Root>
            <Tooltip delayDuration={0} content="Scene display">
              <Popover.Trigger>
                <IconButton
                  size="1"
                  variant="surface"
                  color="gray"
                  aria-label="Scene display"
                >
                  <SlidersHorizontal />
                </IconButton>
              </Popover.Trigger>
            </Tooltip>
            <Popover.Content size="1" width="230px">
              <Flex direction="column" gap="3">
                <Flex justify="between" align="center">
                  <Text size="1">Point clouds</Text>
                  <Tooltip delayDuration={0} content="Point clouds">
                    <Switch
                      size="1"
                      aria-label="Point clouds"
                      checked={display.showPoints}
                      onCheckedChange={(showPoints) =>
                        updateDisplay({ showPoints })
                      }
                    />
                  </Tooltip>
                </Flex>
                <SegmentedControl.Root
                  size="1"
                  value={display.pointStyle}
                  onValueChange={(pointStyle) =>
                    updateDisplay({
                      pointStyle: pointStyle as "gaussian" | "points",
                    })
                  }
                >
                  <SegmentedControl.Item value="gaussian">
                    Gaussian
                  </SegmentedControl.Item>
                  <SegmentedControl.Item value="points">
                    Points
                  </SegmentedControl.Item>
                </SegmentedControl.Root>
                <Flex direction="column" gap="1">
                  <Text size="1" color="gray">
                    Point size {workspace.settings.pointSize.toFixed(1)}
                  </Text>
                  <DisplaySlider
                    label="Point size"
                    value={workspace.settings.pointSize}
                    min={0.1}
                    max={20}
                    step={0.1}
                    onPreview={(pointSize) => {
                      if (runtimeRef.current)
                        runtimeRef.current.surface.maxPixelRadius = pointSize;
                    }}
                    onCommit={(pointSize) => updateSetting({ pointSize })}
                  />
                </Flex>
                <Flex justify="between" align="center">
                  <Text size="1">Standalone cameras</Text>
                  <Tooltip
                    delayDuration={0}
                    content="Show standalone camera frustums. Frame frustums are always shown."
                  >
                    <Switch
                      size="1"
                      aria-label="Standalone camera frustums"
                      checked={display.showFrustums}
                      onCheckedChange={(showFrustums) =>
                        updateDisplay({ showFrustums })
                      }
                    />
                  </Tooltip>
                </Flex>
                {(
                  [
                    ["passepartout", "Passepartout"],
                    ["frameThumbnails", "Frame thumbnails"],
                  ] as const
                ).map(([key, label]) => (
                  <Flex key={key} justify="between" align="center">
                    <Text size="1">{label}</Text>
                    <Switch
                      aria-label={label}
                      size="1"
                      checked={workspace.settings.viewportOptions[key] ?? true}
                      onCheckedChange={(value) =>
                        void commandRef
                          .current({
                            type: "workspace.update",
                            settings: {
                              viewportOptions: {
                                ...workspaceRef.current.settings
                                  .viewportOptions,
                                [key]: value,
                              },
                            },
                          })
                          .catch((e) => errorRef.current(message(e)))
                      }
                    />
                  </Flex>
                ))}
                <Text size="1" color="gray">
                  Mask opacity ·{" "}
                  {Math.round(
                    workspace.settings.viewportOptions.maskOpacity * 100,
                  )}
                  %
                </Text>
                <Slider
                  key={workspace.settings.viewportOptions.maskOpacity}
                  aria-label="Passepartout opacity"
                  defaultValue={[
                    workspace.settings.viewportOptions.maskOpacity,
                  ]}
                  min={0}
                  max={1}
                  step={0.05}
                  onValueCommit={([maskOpacity]) =>
                    void commandRef
                      .current({
                        type: "workspace.update",
                        settings: {
                          viewportOptions: {
                            ...workspaceRef.current.settings.viewportOptions,
                            maskOpacity,
                          },
                        },
                      })
                      .catch((e) => errorRef.current(message(e)))
                  }
                />
                <Flex justify="between" align="center">
                  <Text size="1">Grid</Text>
                  <Tooltip delayDuration={0} content="Ground grid">
                    <Switch
                      size="1"
                      aria-label="Ground grid"
                      checked={workspace.settings.grid}
                      onCheckedChange={(grid) => updateSetting({ grid })}
                    />
                  </Tooltip>
                </Flex>
                <ViewportLensSettings
                  {...lens}
                  options={workspace.settings.viewportOptions}
                />
              </Flex>
            </Popover.Content>
          </Popover.Root>
        </div>
      </div>
      {!playing && showFeed && (
        <ViewportFeed go={(event) => goToActivity.current(event)} />
      )}
      {!playing && compared && (
        <div className="view-frame-actions floating-toolbar">
          <FrameLabel
            slug={slugs.get(compared.frameId)!}
            tasks={frameTasks(
              workspace.nodes[compared.frameId],
              workspace.jobs,
            )}
            selected={workspace.selection.includes(compared.frameId)}
            onSelect={() =>
              void commandRef
                .current({ type: "selection.set", ids: [compared.frameId] })
                .catch((e) => errorRef.current(message(e)))
            }
          />
          <Button
            size="1"
            color="gray"
            variant="surface"
            aria-label="Input"
            aria-pressed={showInput}
            onClick={() => setShowInput(!showInput)}
          >
            <ImageSquare aria-hidden="true" />
            <span className="toolbar-label">Input</span>
          </Button>
          <FrameEdit
            key={compared.imageId + compared.asset.id}
            frameId={compared.frameId}
            asset={compared.asset}
          />
          <ToolbarPopover
            label="Reference image settings"
            icon={<Gear />}
            width={200}
            side="top"
          >
            <label className="settings-popover">
              <Flex as="span" justify="between" align="center">
                <Text size="1">Input opacity</Text>
                <Text size="1" color="gray">
                  {inputOpacity}%
                </Text>
              </Flex>
              <input
                className="frame-input-opacity"
                type="range"
                aria-label="Input opacity"
                aria-valuetext={`${inputOpacity}%`}
                min={0}
                max={100}
                step={1}
                value={inputOpacity}
                onChange={(event) =>
                  setInputOpacity(event.currentTarget.valueAsNumber)
                }
              />
            </label>
          </ToolbarPopover>
        </div>
      )}
      <div ref={hostRef} className="viewport-canvas">
        {!playing && (
          <AgentCursors layer={cursorLayer} anchors={cursorAnchors} />
        )}
        {!playing && (
          <div className="frame-label-layer" ref={labelsRef}>
            {[...slugs].map(([id, slug]) => {
              if (id === compared?.frameId) return null;
              const node = workspace.nodes[id],
                cam = cameraNode(workspace, id);
              const ref = referenceComparison(workspace, id);
              return (
                <div
                  key={id}
                  className="projected-frame"
                  data-frame={id}
                  data-anchor={cam?.id ?? id}
                  hidden
                >
                  <FrameLabel
                    slug={slug}
                    tasks={frameTasks(node, workspace.jobs)}
                    selected={workspace.selection.includes(id)}
                    onSelect={() =>
                      void commandRef
                        .current({ type: "selection.set", ids: [id] })
                        .catch((e) => errorRef.current(message(e)))
                    }
                    thumbnail={
                      workspace.settings.viewportOptions.frameThumbnails !==
                      false
                        ? ref?.asset
                        : undefined
                    }
                  />
                </div>
              );
            })}
          </div>
        )}
        {playing && (
          <div className="play-instructions" role="status">
            {playReady
              ? "Drag to grab · Right-drag to look · WASD to fly · Esc to stop"
              : "Preparing physics…"}
          </div>
        )}
        {!playing && compared && showInput && referenceScale && (
          <div
            className="viewport-reference-image"
            style={{
              opacity: inputOpacity / 100,
              left: frame.left,
              top: frame.top,
              width: frame.width,
              height: frame.height,
            }}
          >
            <img
              src={assetUrl(compared.asset)}
              alt={`Reference: ${compared.asset.name}`}
              style={{
                width: compared.projection.width * referenceScale,
                height: compared.projection.height * referenceScale,
              }}
            />
          </div>
        )}
        {!playing && workspace.settings.viewportOptions.passepartout && (
          <div
            className="viewport-passepartout"
            aria-hidden="true"
            style={
              {
                left: frame.left,
                top: frame.top,
                width: frame.width,
                height: frame.height,
                "--passepartout-opacity":
                  workspace.settings.viewportOptions.maskOpacity,
              } as React.CSSProperties
            }
          />
        )}
        {!playing && empty && (
          <div className="viewport-empty">
            Drop a reference image to start a set
            <br />
            <span>Paste an image or place an asset from the library</span>
          </div>
        )}
        {!playing && draggingFiles && (
          <div className="viewport-drop">Drop to import</div>
        )}
      </div>
    </div>
  );
}
