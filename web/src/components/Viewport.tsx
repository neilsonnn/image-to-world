import { NewImagePrompt } from "./NewImagePrompt";
import { useWorldbashClient, useWorkspaceData } from "../lib/client";
import { NodeIcon } from "./NodeIcon";
import { ViewportPathActions } from "./ViewportPathActions";
import { clipboardAssetIds, type RequestPlacement } from "./ImageImport";
import { generationInput } from "../../../core/generation";
import { cameraNode, sceneCamera, selectedPath } from "../../../core/captures";
import { collectionDragPayload, endCollectionDrag } from "../lib/drag";
import { SparkRenderer } from "@sparkjsdev/spark";
import {
  Camera as CameraIcon,
  Crosshair,
  ImageSquare,
  Globe,
  Cube,
  BoundingBox,
  CrosshairSimple,
  SlidersHorizontal,
} from "@phosphor-icons/react";
import {
  Button,
  DropdownMenu,
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
  WebGLRenderer,
} from "three";
import { FlyControls } from "../lib/fly";
import { CameraTransition } from "../lib/camera-transition";

import { selectedNodes, selectedRoots } from "../../../core/scene";
import { transformCapabilities } from "../../../core/node-capabilities";
import { CombinedTransformControls } from "../lib/combined-transform";
import {
  selectionPivot,
  type PivotPlacement,
  type GizmoSpace,
} from "../../../core/gizmo";
import { cameraMatrix, transformNodes } from "../../../core/cameras";
import {
  type Camera,
  type Workspace,
  type SceneNode,
} from "../../../core/schema";
import { SceneGraph } from "../lib/scene";
import { registerViewportCamera } from "../lib/viewport-camera";
import { usePaneShortcuts } from "../lib/shortcuts";

export type ViewportProps = {
  previewNodes?: SceneNode[] | null;
  onPreviewNodes: (nodes: SceneNode[] | null) => void;
  previewCamera?: Camera | null;
  onPreviewCamera: (camera: Camera | null) => void;
  requestPlacement: RequestPlacement;
};

type Runtime = {
  scene: Scene;
  renderer: WebGLRenderer;
  camera: PerspectiveCamera;
  cameraTransition: CameraTransition;
  fly: FlyControls;
  transform: CombinedTransformControls;
  spark: SparkRenderer;
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
};

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function applyCamera(camera: PerspectiveCamera, value: Camera) {
  cameraMatrix(value).decompose(
    camera.position,
    camera.quaternion,
    camera.scale,
  );
  camera.fov =
    (2 * Math.atan(value.intrinsics.height / (2 * value.intrinsics.fy)) * 180) /
    Math.PI;
  camera.updateProjectionMatrix();
}

function cameraValue(
  camera: PerspectiveCamera,
  width: number,
  height: number,
): Camera {
  const fy = height / (2 * Math.tan((camera.fov * Math.PI) / 360));
  return {
    extrinsics: {
      position: camera.position.toArray(),
      quaternion: camera.quaternion.clone().normalize().toArray(),
      coordinateSystem: "rub",
    },
    intrinsics: { fx: fy, fy, cx: width / 2, cy: height / 2, width, height },
  };
}

function applyCalibratedProjection(camera: PerspectiveCamera, value: Camera) {
  const { fx, fy, cx, cy, width, height } = value.intrinsics;
  const near = camera.near;
  camera.aspect = width / height;
  camera.projectionMatrix.makePerspective(
    (-cx / fx) * near,
    ((width - cx) / fx) * near,
    (cy / fy) * near,
    (-(height - cy) / fy) * near,
    near,
    camera.far,
  );
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}

function viewportProjection(
  camera: PerspectiveCamera,
  width: number,
  height: number,
  calibrated?: Camera,
) {
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  if (!calibrated) return;
  const c = calibrated.intrinsics;
  const scale = Math.min(width / c.width, height / c.height);
  applyCalibratedProjection(camera, {
    ...calibrated,
    intrinsics: {
      width,
      height,
      fx: c.fx * scale,
      fy: c.fy * scale,
      cx: c.cx * scale + (width - c.width * scale) / 2,
      cy: c.cy * scale + (height - c.height * scale) / 2,
    },
  });
}

function cameraWithIntrinsics(
  camera: PerspectiveCamera,
  intrinsics: Camera["intrinsics"],
): Camera {
  return {
    extrinsics: {
      position: camera.position.toArray(),
      quaternion: camera.quaternion.clone().normalize().toArray(),
      coordinateSystem: "rub",
    },
    intrinsics: { ...intrinsics },
  };
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
  previewNodes,
  onPreviewNodes,
  previewCamera,
  onPreviewCamera,
  requestPlacement,
}: ViewportProps) {
  const { command, upload, setError: onError } = useWorldbashClient();
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
      "viewingCameraId",
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
  const [syncTick, setSyncTick] = useState(0);
  const [pivotPlacement, setPivotPlacement] =
    useState<PivotPlacement>("center");
  const [gizmoSpace, setGizmoSpace] = useState<GizmoSpace>("world");
  const [draggingFiles, setDraggingFiles] = useState(false);
  useEffect(
    () =>
      registerViewportCamera(() => {
        const runtime = runtimeRef.current;
        const { width, height } =
          workspaceRef.current.settings.viewportCamera.intrinsics;
        return runtime ? cameraValue(runtime.camera, width, height) : null;
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
        const intrinsics =
          workspaceRef.current.settings.viewportCamera.intrinsics;
        const camera = runtime
          ? cameraValue(runtime.camera, intrinsics.width, intrinsics.height)
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
    const renderer = new WebGLRenderer({
      antialias: false,
      alpha: false,
      preserveDrawingBuffer: true,
    });
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
    const spark = new SparkRenderer({ renderer });
    scene.add(spark);
    const graph = new SceneGraph(
      scene,
      (value) => errorRef.current(value),
      color("helper"),
    );
    const fly = new FlyControls(
      camera,
      renderer.domElement,
      () =>
        !runtime.dragging && !runtime.capturing && !previewCameraRef.current,
      () => persistCamera(),
    );
    const runtime: Runtime = {
      scene,
      renderer,
      camera,
      cameraTransition: new CameraTransition(camera),
      fly,
      transform,
      spark,
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

    const persistCamera = () => {
      const intrinsics =
        workspaceRef.current.settings.viewportCamera.intrinsics;
      const value = cameraValue(camera, intrinsics.width, intrinsics.height);
      runtime.lastCamera = JSON.stringify(value);
      void commandRef
        .current({
          type: "workspace.update",
          settings: {
            viewportCamera: value,
            viewingCameraId: null,
            freeCamera: null,
          },
        })
        .catch((error) => errorRef.current(message(error)))
        .finally(() => setSyncTick((value) => value + 1));
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

    let pointerDown: Vector2 | undefined;
    const onPointerDown = (event: PointerEvent) => {
      renderer.domElement.focus({ preventScroll: true });
      pointerDown = new Vector2(event.clientX, event.clientY);
    };
    const onPointerUp = (event: PointerEvent) => {
      if (
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
      if (runtime.dragging || runtime.capturing) return;
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
      runtime.fly.stop();
      const target = camera.clone();
      target.position.copy(sphere.center).addScaledVector(direction, -distance);
      const intrinsics =
        workspaceRef.current.settings.viewportCamera.intrinsics;
      onPreviewCamera(null);
      void commandRef
        .current({
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
        })
        .catch((error) => errorRef.current(message(error)));
    };
    focusRef.current = focus;

    const resize = () => {
      runtime.cameraTransition.finish();
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height, false);
      const state = workspaceRef.current;
      const calibrated =
        previewCameraRef.current ??
        (state.settings.viewingCameraId
          ? sceneCamera(state, state.settings.viewingCameraId)
          : undefined);
      viewportProjection(camera, width, height, calibrated ?? undefined);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    let animation = 0;
    let lastFrame = performance.now();
    let spatialVersion = graph.spatialVersion;
    const render = () => {
      const now = performance.now();
      const seconds = (now - lastFrame) / 1000;
      lastFrame = now;
      animation = requestAnimationFrame(render);
      if (runtime.capturing) return;
      if (runtime.fly.active && runtime.cameraTransition.active) {
        runtime.cameraTransition.cancel();
        viewportProjection(camera, host.clientWidth, host.clientHeight);
        // Save the interrupted pose when the fly gesture ends, even without a drag.
        runtime.fly.markChanged();
      }
      runtime.cameraTransition.update(now);
      runtime.fly.update(seconds);
      graph.update();
      if (
        graph.spatialVersion !== spatialVersion &&
        !runtime.dragging &&
        !runtime.fly.active
      ) {
        spatialVersion = graph.spatialVersion;
        setSyncTick((value) => value + 1);
      }
      renderer.render(scene, camera);
    };
    render();

    return () => {
      cancelAnimationFrame(animation);
      for (const controller of captureControllers.current.values())
        controller.abort();
      captureControllers.current.clear();
      observer.disconnect();
      focusRef.current = () => undefined;
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("dblclick", onDoubleClick);
      runtime.fly.dispose();
      transform.detach();
      transform.dispose();
      transform.getHelper().removeFromParent();
      spark.autoUpdate = false;
      clearTimeout(spark.updateTimeoutId);
      clearTimeout(spark.sortTimeoutId);
      spark.sortDirty = false;
      renderer.domElement.remove();
      // Spark disposal must wait for captures and in-flight GPU readback.
      const disposeRenderer = async () => {
        await captureQueue.current;
        while (spark.sorting)
          await new Promise((resolve) => setTimeout(resolve, 16));
        graph.dispose();
        spark.dispose();
        grid.geometry.dispose();
        grid.material.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
      };
      void disposeRenderer().catch((error) => errorRef.current(message(error)));
      runtimeRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    if (runtime.dragging || runtime.capturing) {
      runtime.pendingSync = true;
      return;
    }
    runtime.pendingSync = false;
    runtime.graph.sync(workspace);
    runtime.grid.visible = workspace.settings.grid;
    runtime.spark.falloff =
      workspace.settings.display.pointStyle === "gaussian" ? 1 : 0;
    runtime.spark.minPixelRadius = 0;
    runtime.spark.maxPixelRadius = workspace.settings.pointSize;

    if (runtime.fly.active) {
      runtime.pendingSync = true;
      return;
    }

    const value =
      previewCamera ??
      (workspace.settings.viewingCameraId
        ? sceneCamera(workspace, workspace.settings.viewingCameraId)
        : undefined) ??
      workspace.settings.viewportCamera;
    const incomingCamera = JSON.stringify(value);
    if (incomingCamera !== runtime.lastCamera && !runtime.dragging) {
      const target = runtime.camera.clone();
      applyCamera(target, value);
      viewportProjection(
        target,
        runtime.renderer.domElement.clientWidth,
        runtime.renderer.domElement.clientHeight,
        workspace.settings.viewingCameraId || previewCamera ? value : undefined,
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
    syncTick,
    previewCamera,
    pivotPlacement,
    gizmoSpace,
  ]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const now = Date.now();
    let nextRetry = Number.POSITIVE_INFINITY;
    for (const job of Object.values(workspace.jobs)) {
      if (job.input.kind !== "capture" && job.input.kind !== "inspect")
        continue;
      if (job.status !== "queued" && job.status !== "running") {
        captureAttempts.current.delete(job.id);
        continue;
      }
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
            `/api/viewport-jobs/${encodeURIComponent(job.id)}/claim`,
            {
              method: "POST",
              headers: { "X-Worldbash-Client": "web" },
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
              `/api/viewport-jobs/${encodeURIComponent(job.id)}`,
              {
                method: "POST",
                headers: { "X-Worldbash-Client": "web" },
                body: form,
                signal: controller.signal,
              },
            );
            if (!response.ok)
              throw new Error(`Inspection upload failed (${response.status})`);
            return;
          }
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
            applyCamera(captureCamera, captureInput.camera);
            applyCalibratedProjection(captureCamera, captureInput.camera);
          }
          const gridVisible = runtime.grid.visible;
          const transformHelper = runtime.transform.getHelper();
          const transformVisible = transformHelper.visible;
          const transformParent = transformHelper.parent;
          transformHelper.removeFromParent();
          const restoreHelpers = runtime.graph.hideCaptureHelpers();
          runtime.grid.visible = false;
          transformHelper.visible = false;
          runtime.fly.stop();
          runtime.capturing = true;
          const autoUpdate = runtime.spark.autoUpdate;
          runtime.spark.autoUpdate = false;
          const waitForSort = async () => {
            const deadline = performance.now() + 30000;
            while (runtime.spark.sorting || runtime.spark.sortDirty) {
              if (controller.signal.aborted)
                throw new DOMException("Aborted", "AbortError");
              if (performance.now() > deadline)
                throw new Error("Splat sorting timed out during capture");
              await new Promise<void>((resolve) =>
                requestAnimationFrame(() => resolve()),
              );
            }
          };
          let blob: Blob;
          try {
            // Spark update can return early while an earlier sort is in flight.
            await waitForSort();
            runtime.graph.update();
            await runtime.spark.update({
              scene: runtime.scene,
              camera: captureCamera,
            });
            await waitForSort();
            if (controller.signal.aborted)
              throw new DOMException("Aborted", "AbortError");
            runtime.renderer.render(runtime.scene, captureCamera);
            blob = await new Promise<Blob>((resolve, reject) => {
              runtime.renderer.domElement.toBlob(
                (value) =>
                  value
                    ? resolve(value)
                    : reject(new Error("PNG capture failed")),
                "image/png",
              );
            });
          } finally {
            runtime.capturing = false;
            if (runtimeRef.current === runtime) {
              runtime.spark.autoUpdate = autoUpdate;
              runtime.grid.visible = gridVisible;
              transformHelper.visible = transformVisible;
              transformParent?.add(transformHelper);
              restoreHelpers();
              if (captureInput.camera) {
                runtime.renderer.setPixelRatio(originalPixelRatio);
                runtime.renderer.setSize(originalSize.x, originalSize.y, false);
                runtime.camera.aspect = originalSize.x / originalSize.y;
                runtime.camera.updateProjectionMatrix();
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
            `/api/viewport-jobs/${encodeURIComponent(job.id)}`,
            {
              method: "POST",
              headers: { "X-Worldbash-Client": "web" },
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
              `/api/viewport-jobs/${encodeURIComponent(job.id)}/fail`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-Worldbash-Client": "web",
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
  }, [workspace.jobs, captureTick]);

  const placementCamera = () => {
    const runtime = runtimeRef.current;
    const current = workspaceRef.current;
    return runtime
      ? cameraValue(
          runtime.camera,
          current.settings.viewportCamera.intrinsics.width,
          current.settings.viewportCamera.intrinsics.height,
        )
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
        settings: { display: { ...display, ...patch } },
      })
      .catch((error) => errorRef.current(message(error)));
  const updateSetting = (
    patch: Partial<Pick<Workspace["settings"], "grid" | "pointSize">>,
  ) =>
    void commandRef
      .current({ type: "workspace.update", settings: patch })
      .catch((error) => errorRef.current(message(error)));

  const selectedCameraIds = [
    ...new Set(
      selectedNodes(workspace).flatMap(
        (node) => cameraNode(workspace, node.id)?.id ?? [],
      ),
    ),
  ];
  let splatCount = 0;
  let splatError: string | undefined;
  try {
    const splatInput = generationInput(workspace, { kind: "splats" });
    splatCount = splatInput.kind === "splats" ? splatInput.nodeIds.length : 0;
  } catch (error) {
    splatError = message(error);
  }
  const submitSplats = (refine: boolean) =>
    void commandRef
      .current({
        type: "generation.submit",
        request: {
          kind: "splats",
          contextPathId: selectedPath(workspace)?.id,
          refine,
        },
      })
      .catch((error) => errorRef.current(message(error)));
  const selection = workspace.selection
    .map((id) => workspace.nodes[id] ?? workspace.assets[id])
    .filter(Boolean);
  const selectedObject = selection.length === 1 ? selection[0] : undefined;
  const selectionLabel =
    selectedObject?.name ??
    (selection.length ? `${selection.length} objects selected` : "0 objects");
  const controlsHint =
    "WASD / QE fly · Right-drag look · F focus · Shift-click select · C place camera";
  const empty = Object.keys(workspace.nodes).length === 0;
  return (
    <div
      {...paneHandlers}
      ref={(value) => {
        assignRef(paneRef, value);
      }}
      onDragOver={(event) => {
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
      onDrop={drop}
      onPaste={(event) => void paste(event)}
      className="viewport-panel"
    >
      <div className="viewport-overlay">
        <div
          className="viewport-tools"
          role="toolbar"
          aria-label="Transform tools"
        >
          <Tooltip
            delayDuration={0}
            content="Center: combined bounds. Origin: average of selected object origins."
          >
            <label className="gizmo-select">
              {pivotPlacement === "center" ? (
                <BoundingBox />
              ) : (
                <CrosshairSimple />
              )}
              <select
                aria-label="Gizmo placement"
                value={pivotPlacement}
                onChange={(e) =>
                  setPivotPlacement(e.target.value as PivotPlacement)
                }
              >
                <option value="center">Center</option>
                <option value="origin">Origin</option>
              </select>
            </label>
          </Tooltip>
          <Tooltip
            delayDuration={0}
            content="World axes or the primary selected object's axes."
          >
            <label className="gizmo-select">
              {gizmoSpace === "world" ? <Globe /> : <Cube />}
              <select
                aria-label="Gizmo space"
                value={gizmoSpace}
                onChange={(e) => setGizmoSpace(e.target.value as GizmoSpace)}
              >
                <option value="world">World</option>
                <option value="object">Object</option>
              </select>
            </label>
          </Tooltip>
        </div>
        <NewImagePrompt camera={placementCamera} />
        <div className="viewport-tools" role="toolbar" aria-label="View">
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
          <Popover.Root>
            <Tooltip delayDuration={0} content="Camera controls">
              <Popover.Trigger>
                <IconButton
                  size="1"
                  variant="surface"
                  color="gray"
                  aria-label="Camera controls"
                >
                  <CameraIcon />
                </IconButton>
              </Popover.Trigger>
            </Tooltip>
            <Popover.Content size="1" width="190px">
              <Flex direction="column" gap="2">
                <Text size="1" color="gray">
                  Hover: WASD move, Q/E down/up. Right-drag to look. Shift
                  speeds up. Two-finger swipe looks around; pinch changes field
                  of view. Double-click a camera to view it. Left-click selects.
                  Escape deselects; H hides or shows the selection. C places a
                  camera without interrupting flight.
                </Text>
                <Button
                  size="1"
                  variant="surface"
                  color="gray"
                  onClick={() => focusRef.current()}
                >
                  Frame selection
                </Button>
              </Flex>
            </Popover.Content>
          </Popover.Root>
        </div>
        <div
          className="viewport-tools"
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
                        runtimeRef.current.spark.maxPixelRadius = pointSize;
                    }}
                    onCommit={(pointSize) => updateSetting({ pointSize })}
                  />
                </Flex>
                <Flex justify="between" align="center">
                  <Text size="1">Frustums</Text>
                  <Tooltip delayDuration={0} content="Frustums">
                    <Switch
                      size="1"
                      aria-label="Frustums"
                      checked={display.showFrustums}
                      onCheckedChange={(showFrustums) =>
                        updateDisplay({ showFrustums })
                      }
                    />
                  </Tooltip>
                </Flex>
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
              </Flex>
            </Popover.Content>
          </Popover.Root>
        </div>
      </div>
      <div className="viewport-footer">
        <Tooltip delayDuration={0} content={selectionLabel}>
          <div className="viewport-selection" aria-label={selectionLabel}>
            {selectedObject && <NodeIcon kind={selectedObject.kind} />}
            <span className="viewport-selection-name">{selectionLabel}</span>
          </div>
        </Tooltip>
        <div
          className="viewport-selection-tools"
          role="toolbar"
          aria-label="Selection actions"
        >
          <Tooltip
            delayDuration={0}
            content="Place a camera at this view and extend camera selection (C)"
          >
            <Button
              size="1"
              variant="surface"
              color="gray"
              onClick={() => {
                onPreviewCamera(null);
                void command({
                  type: "camera.place",
                  camera: placementCamera(),
                }).catch((error) => onError(message(error)));
              }}
            >
              <CameraIcon /> Camera · C
            </Button>
          </Tooltip>
          <ViewportPathActions
            workspace={workspace}
            command={command}
            onError={onError}
            onPreviewCamera={onPreviewCamera}
          />
          <DropdownMenu.Root>
            <Tooltip
              delayDuration={0}
              content={
                splatError ??
                (splatCount < 2
                  ? "Splats need at least two posed captures in the Atlas context"
                  : `Reconstruct Gaussian splats from the ${splatCount} posed captures in the Atlas context`)
              }
            >
              <DropdownMenu.Trigger disabled={splatCount < 2}>
                <Button size="1" variant="surface" color="gray">
                  Make splats
                </Button>
              </DropdownMenu.Trigger>
            </Tooltip>
            <DropdownMenu.Content size="1">
              <DropdownMenu.Item
                disabled={splatCount > 32}
                onSelect={() => submitSplats(false)}
              >
                Draft: 500 credits, up to 32 captures
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => submitSplats(true)}>
                Refined: 5,000 credits, 15 to 25 minutes
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
          {selectedCameraIds.length > 1 && (
            <Tooltip
              delayDuration={0}
              content="Create a camera path in selection order"
            >
              <Button
                size="1"
                variant="surface"
                color="gray"
                onClick={() =>
                  void commandRef
                    .current({
                      type: "path.fromCameras",
                      nodeIds: selectedCameraIds,
                      targetFrameCount: workspace.settings.targetFrameCount,
                    })
                    .catch((error) => errorRef.current(message(error)))
                }
              >
                Create path · {selectedCameraIds.length} cameras
              </Button>
            </Tooltip>
          )}
        </div>
        <Tooltip delayDuration={0} content={controlsHint}>
          <div className="viewport-hint">{controlsHint}</div>
        </Tooltip>
      </div>
      <div ref={hostRef} className="viewport-canvas">
        {empty && (
          <div className="viewport-empty">
            Import an image or splat to begin
            <br />
            <span>Drop files here or use Assets</span>
          </div>
        )}
        {draggingFiles && <div className="viewport-drop">Drop to import</div>}
      </div>
    </div>
  );
}
