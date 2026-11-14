import { disposeObject } from "./resources";
import {
  makePrimitive,
  makeSurface,
  makeLight,
  createProcedural,
  declareSplatBounds,
} from "./authored";
import {
  AnimationMixer,
  LoopOnce,
  LoopRepeat,
  NearestFilter,
  type WebGLRenderer,
  type Camera as RuntimeCamera,
} from "three";
import type { ParameterField } from "../../../core/creation";
import { validateGlb } from "../../../core/mesh";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { inspectScene } from "../../../core/inspection";
import { isVisible } from "../../../core/captures";
import { nodeImageAsset } from "../../../core/images";
import {
  PackedSplats,
  SplatEdit,
  SplatEditSdf,
  SplatEditSdfType,
  SplatMesh,
} from "@sparkjsdev/spark";
import {
  Box3,
  AmbientLight,
  DirectionalLight,
  BoxGeometry,
  BufferGeometry,
  Color,
  DoubleSide,
  EdgesGeometry,
  Group,
  Line,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  Vector2,
  Vector3,
  VideoTexture,
} from "three";
import { cameraMatrix } from "../../../core/cameras";
import {
  captureRoot,
  contextSettings,
  selectedPath,
} from "../../../core/captures";
import {
  assetUrl,
  type Asset,
  type Projection,
  type SceneNode,
  type Workspace,
} from "../../../core/schema";
import { clipAppliesToNode } from "../../../core/clips";
import { loadDepthPoints } from "./depth";
import { geometrySpatial, type NodeSpatial } from "./spatial";

type Entry = {
  node: SceneNode;
  root: Group;
  pickProxy: Mesh;
  getSelectionTarget?: () => string;
  resourceKey: string;
  generation: number;
  abort?: AbortController;
  content?: Object3D;
  imagePlane?: Mesh;
  pointCloud?: SplatMesh;
  frustum?: Object3D;
  clipEdits?: Map<SplatMesh | null, { edit: SplatEdit; sdf: SplatEditSdf }>;
  bounds?: Box3;
  spatial?: NodeSpatial;
  error?: string;
  sample?: (time: number, camera?: RuntimeCamera) => void;
  cleanup?: () => void;
  moduleFields?: Record<string, ParameterField>;
  animationClips?: string[];
};

type SceneWorkspace = Pick<
  Workspace,
  "revision" | "nodes" | "assets" | "selection" | "primaryId"
> & {
  settings: Pick<Workspace["settings"], "display" | "atlas"> &
    Partial<Pick<Workspace["settings"], "art">>;
};

type DisplaySettings = Workspace["settings"]["display"];

function applyMatrix(object: Object3D, matrix: Matrix4) {
  matrix.decompose(object.position, object.quaternion, object.scale);
  object.updateMatrix();
}

function applyTransform(object: Object3D, node: SceneNode) {
  object.position.fromArray(node.transform.position);
  object.quaternion.fromArray(node.transform.quaternion);
  object.scale.fromArray(node.transform.scale);
  object.visible = node.visible;
  object.updateMatrix();
}

function tagPickables(object: Object3D, nodeId: string) {
  object.traverse((child) => {
    child.userData.nodeId = nodeId;
  });
}

function effectivelyVisible(object: Object3D) {
  let current: Object3D | null = object;
  while (current) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return true;
}

function resourceKey(node: SceneNode, workspace: SceneWorkspace) {
  if (["primitive", "light", "procedural"].includes(node.kind))
    return JSON.stringify([
      node.kind,
      node.primitive,
      node.surface,
      node.light,
      node.procedural,
      [
        node.surface?.textureAssetId,
        node.procedural?.bundleAssetId,
        ...(node.procedural?.assetIds ?? []),
      ].map((id) =>
        id
          ? [
              id,
              workspace.assets[id]?.modifiedAt,
              workspace.assets[id]?.missing,
            ]
          : null,
      ),
    ]);
  const asset = nodeImageAsset(workspace, node);
  const depth = asset?.depthAssetId
    ? workspace.assets[asset.depthAssetId]
    : undefined;
  const confidence = asset?.confidenceAssetId
    ? workspace.assets[asset.confidenceAssetId]
    : undefined;
  if (node.kind === "points") {
    return JSON.stringify([
      node.kind,
      node.imageSurface,
      node.surface,
      node.animation,
      node.surface?.textureAssetId
        ? workspace.assets[node.surface.textureAssetId]?.modifiedAt
        : null,
      asset?.id,
      asset?.modifiedAt,
      asset?.missing,
      asset?.camera,
      asset?.depthEncoding,
      depth?.id,
      depth?.modifiedAt,
      depth?.missing,
      depth?.depthEncoding,
      confidence?.id,
      confidence?.modifiedAt,
      confidence?.missing,
    ]);
  }
  if (node.kind === "image")
    return JSON.stringify([
      node.kind,
      node.projection,
      node.imageSurface,
      node.surface,
      node.animation,
      node.surface?.textureAssetId
        ? workspace.assets[node.surface.textureAssetId]?.modifiedAt
        : null,
      asset?.id,
      asset?.modifiedAt,
      asset?.missing,
    ]);
  if (node.kind === "splat" || node.kind === "mesh" || node.kind === "video")
    return JSON.stringify([
      node.kind,
      node.imageSurface,
      node.surface,
      node.animation,
      node.surface?.textureAssetId
        ? workspace.assets[node.surface.textureAssetId]?.modifiedAt
        : null,
      asset?.id,
      asset?.modifiedAt,
      asset?.missing,
    ]);
  if (node.kind === "camera")
    return JSON.stringify([node.kind, node.projection]);
  if (node.kind === "path") return JSON.stringify([node.kind, node.keyframes]);
  return node.kind;
}

function makePickProxy(nodeId: string) {
  const material = new MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  material.colorWrite = false;
  material.visible = false;
  const proxy = new Mesh(new SphereGeometry(0.12, 8, 6), material);
  proxy.userData.nodeId = nodeId;
  proxy.userData.pickProxy = true;
  return proxy;
}

function frustumGeometry(projection: Projection) {
  const { fx, fy, cx, cy, width, height } = projection;
  const depth = 1;
  const at = (x: number, y: number) =>
    new Vector3(((x - cx) / fx) * depth, -((y - cy) / fy) * depth, -depth);
  const corners = [at(0, 0), at(width, 0), at(width, height), at(0, height)];
  const origin = new Vector3();
  const points: Vector3[] = [];
  for (const corner of corners) points.push(origin, corner);
  for (let index = 0; index < 4; index += 1)
    points.push(corners[index], corners[(index + 1) % 4]);
  return new BufferGeometry().setFromPoints(points);
}

function makeFrustum(projection: Projection, color: string) {
  const wrapper = new Group();
  wrapper.add(
    new LineSegments(
      frustumGeometry(projection),
      new LineBasicMaterial({ color }),
    ),
  );
  return wrapper;
}

async function textureFromAsset(
  asset: Asset,
  signal: AbortSignal,
  projection?: Projection,
) {
  const response = await fetch(assetUrl(asset), { signal });
  if (!response.ok)
    throw new Error(`Failed to load ${asset.name} (${response.status})`);
  const bitmap = await createImageBitmap(await response.blob());
  const texture = new Texture(bitmap);
  texture.colorSpace = SRGBColorSpace;
  if (projection) {
    const ratio = projection.width / projection.height;
    const actual = bitmap.width / bitmap.height;
    texture.repeat.set(
      Math.min(1, ratio / actual),
      Math.min(1, actual / ratio),
    );
    texture.offset.set((1 - texture.repeat.x) / 2, (1 - texture.repeat.y) / 2);
  }
  texture.needsUpdate = true;
  return { texture, width: bitmap.width, height: bitmap.height };
}

function imagePlane(
  texture: Texture,
  width: number,
  height: number,
  projection?: Projection,
  distance = 1,
) {
  let planeWidth = width / height;
  let planeHeight = 1;
  let depth = 0;
  if (projection) {
    depth = distance;
    planeWidth = (projection.width / projection.fx) * distance;
    planeHeight = (projection.height / projection.fy) * distance;
  }
  const plane = new Mesh(
    new PlaneGeometry(planeWidth, planeHeight),
    new MeshBasicMaterial({
      map: texture,
      side: DoubleSide,
      toneMapped: false,
    }),
  );
  if (projection) {
    plane.position.x = (projection.width / 2 - projection.cx) / projection.fx;
    plane.position.y = -(projection.height / 2 - projection.cy) / projection.fy;
  }
  plane.position.z = -depth;
  plane.userData.calibratedPlane = Boolean(projection);
  return plane;
}

function makePath(node: SceneNode, color: string) {
  const group = new Group();
  const frames = node.keyframes ?? [];
  const positions = frames.map((frame) =>
    new Vector3().setFromMatrixPosition(cameraMatrix(frame.camera)),
  );
  if (positions.length > 1) {
    group.add(
      new Line(
        new BufferGeometry().setFromPoints(positions),
        new LineBasicMaterial({ color }),
      ),
    );
  }
  for (const frame of frames) {
    const marker = new Mesh(
      new SphereGeometry(0.055, 10, 8),
      new MeshBasicMaterial({ color, toneMapped: false }),
    );
    marker.position.setFromMatrixPosition(cameraMatrix(frame.camera));
    group.add(marker);
  }
  return group;
}

function makeClipEdit(entry: Entry) {
  const edit = new SplatEdit({
    name: entry.node.name,
    invert: entry.node.clip?.invert,
    softEdge: entry.node.clip?.softness,
  });
  const sdf = new SplatEditSdf({
    type: SplatEditSdfType.BOX,
    opacity: 0,
    color: new Color(1, 1, 1),
  });
  edit.add(sdf);
  return { edit, sdf };
}

function makeClip(entry: Entry, color: string) {
  const helper = new LineSegments(
    new EdgesGeometry(new BoxGeometry(2, 2, 2)),
    new LineBasicMaterial({ color, transparent: true, opacity: 0.8 }),
  );
  helper.userData.nodeId = entry.node.id;
  entry.root.add(helper);
  entry.content = helper;
  entry.spatial = geometrySpatial(helper);
  entry.pickProxy.visible = false;
  entry.clipEdits = new Map();
}

export class SceneGraph {
  private lights: Object3D[] = [];
  spatialVersion = 0;
  readonly entries = new Map<string, Entry>();
  readonly selectionOutline = new Group();
  private selection: string[] = [];
  private hoveredId: string | null = null;
  private disposed = false;
  private pending = new Set<Promise<void>>();
  private display?: DisplaySettings;
  private workspace?: SceneWorkspace;

  constructor(
    readonly scene: Scene,
    private readonly onError: (message: string) => void,
    private readonly helperColor: string,
    private readonly activeColor: string,
    private readonly renderer?: WebGLRenderer,
  ) {
    scene.add(this.selectionOutline);
    const ambient = new AmbientLight(0xffffff, 2);
    const sun = new DirectionalLight(0xffffff, 3);
    sun.position.set(4, 8, 5);
    scene.add(ambient, sun);
    this.lights = [ambient, sun];
  }

  private track(promise: Promise<void>) {
    let tracked: Promise<void>;
    tracked = promise.finally(() => this.pending.delete(tracked));
    this.pending.add(tracked);
  }

  async ready(signal: AbortSignal) {
    while (this.pending.size) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const pending = Promise.allSettled([...this.pending]);
      await new Promise<void>((resolve, reject) => {
        const abort = () => reject(new DOMException("Aborted", "AbortError"));
        signal.addEventListener("abort", abort, { once: true });
        void pending.then(() => {
          signal.removeEventListener("abort", abort);
          resolve();
        });
      });
    }
  }

  sync(workspace: SceneWorkspace) {
    this.workspace = workspace;
    if (workspace.settings.art) {
      const art = workspace.settings.art;
      (this.lights[0] as AmbientLight).intensity = art.ambient;
      const sun = this.lights[1] as DirectionalLight;
      sun.intensity = art.key;
      sun.castShadow = art.shadows;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.camera.left = -12;
      sun.shadow.camera.right = 12;
      sun.shadow.camera.top = 12;
      sun.shadow.camera.bottom = -12;
      sun.shadow.bias = -0.0005;
    }
    for (const [id, entry] of this.entries) {
      if (!workspace.nodes[id]) this.removeEntry(entry);
    }
    const soloIds = contextSettings(
      workspace,
      selectedPath(workspace)?.id,
    ).soloIds;
    for (const node of Object.values(workspace.nodes)) {
      let entry = this.entries.get(node.id);
      if (!entry) {
        const root = new Group();
        root.name = node.name;
        root.userData.nodeId = node.id;
        const pickProxy = makePickProxy(node.id);
        root.add(pickProxy);
        entry = { node, root, pickProxy, resourceKey: "", generation: 0 };
        this.entries.set(node.id, entry);
        this.scene.add(root);
      }
      entry.node = node;
      entry.root.name = node.name;
      applyTransform(entry.root, node);
      if (
        node.kind === "capture" &&
        soloIds.length &&
        !soloIds.includes(node.id)
      )
        entry.root.visible = false;
    }

    for (const entry of this.entries.values()) {
      const parent = entry.node.parentId
        ? this.entries.get(entry.node.parentId)?.root
        : undefined;
      const intendedParent =
        parent && parent !== entry.root ? parent : this.scene;
      if (entry.root.parent !== intendedParent) intendedParent.add(entry.root);
    }

    for (const entry of this.entries.values()) {
      const key = resourceKey(entry.node, workspace);
      if (entry.resourceKey !== key) {
        entry.resourceKey = key;
        this.loadEntry(entry, workspace);
      }
    }
    this.scene.updateMatrixWorld(true);
    this.setDisplay(workspace.settings.display);
    this.updateClips();
    this.setSelection(workspace.selection);
  }

  private loadEntry(entry: Entry, workspace: SceneWorkspace) {
    entry.generation += 1;
    entry.error = undefined;
    const generation = entry.generation;
    entry.abort?.abort();
    entry.abort = new AbortController();
    const signal = entry.abort.signal;
    entry.pickProxy.visible = true;
    entry.getSelectionTarget = undefined;
    if (entry.content && entry.node.kind !== "procedural") {
      entry.cleanup?.();
      entry.cleanup = undefined;
      entry.sample = undefined;
      entry.root.remove(entry.content);
      disposeObject(entry.content);
      entry.content = undefined;
      entry.bounds = undefined;
      entry.spatial = undefined;
      entry.imagePlane = undefined;
      entry.pointCloud = undefined;
      entry.frustum = undefined;
    }
    for (const { edit } of entry.clipEdits?.values() ?? [])
      edit.removeFromParent();
    entry.clipEdits = undefined;
    if (entry.node.kind === "clip") {
      makeClip(entry, this.helperColor);
      return;
    }
    if (entry.node.kind === "group" || entry.node.kind === "capture") return;

    const finish = (content: Object3D, spatial = geometrySpatial(content)) => {
      if (this.disposed || entry.generation !== generation) {
        disposeObject(content);
        return false;
      }
      if (entry.content && entry.content !== content) {
        entry.cleanup?.();
        entry.cleanup = undefined;
        entry.sample = undefined;
        entry.root.remove(entry.content);
        disposeObject(entry.content);
      }
      tagPickables(content, entry.node.id);
      entry.content = content;
      entry.spatial = spatial;
      this.spatialVersion++;
      entry.pickProxy.visible = false;
      entry.root.add(content);
      if (this.display) this.applyDisplay(entry, this.display);
      return true;
    };
    const fail = (error: unknown) => {
      if (
        entry.generation !== generation ||
        (error instanceof DOMException && error.name === "AbortError")
      )
        return;
      entry.error = error instanceof Error ? error.message : String(error);
      this.onError(entry.error);
    };

    if (entry.node.kind === "primitive") {
      this.track(
        makePrimitive(entry.node, workspace.assets)
          .then((object) => {
            finish(object);
          })
          .catch(fail),
      );
      return;
    }
    if (entry.node.kind === "light") {
      try {
        const light = makeLight(entry.node);
        finish(light, {
          object: light,
          getBounds: () => new Box3(new Vector3(), new Vector3()),
        });
      } catch (error) {
        fail(error);
      }
      return;
    }
    if (entry.node.kind === "procedural") {
      if (!entry.node.procedural?.enabled) {
        if (entry.content) {
          entry.cleanup?.();
          disposeObject(entry.content);
          entry.root.remove(entry.content);
        }
        entry.content = undefined;
        entry.spatial = undefined;
        entry.sample = undefined;
        entry.cleanup = undefined;
        return;
      }
      this.track(
        createProcedural(entry.node, workspace.assets, signal, this.renderer)
          .then((instance) => {
            if (!instance) return;
            if (!finish(instance.object, instance.spatial)) {
              instance.dispose?.();
              return;
            }
            entry.moduleFields = instance.fields;
            entry.cleanup = instance.dispose;
            entry.sample = (time, camera) => {
              instance.sample?.({ time, camera });
              declareSplatBounds(instance.object);
              tagPickables(instance.object, entry.node.id);
            };
            entry.sample(this.time);
          })
          .catch(fail),
      );
      return;
    }
    const asset = nodeImageAsset(workspace, entry.node);
    if (
      (entry.node.kind === "image" ||
        entry.node.kind === "points" ||
        entry.node.kind === "splat" ||
        entry.node.kind === "mesh" ||
        entry.node.kind === "video") &&
      !asset
    ) {
      // An unbound node has no geometry yet (for example a generation placeholder).
      // A binding to an unavailable asset is a real load error.
      if (entry.node.assetId || entry.node.geometryAssetId)
        fail(new Error(`${entry.node.name} references an unavailable asset`));
      return;
    }
    if (asset?.missing) {
      fail(new Error(`${asset.name} is missing`));
      return;
    }

    if (entry.node.kind === "mesh" && asset) {
      this.track(
        (async () => {
          const response = await fetch(assetUrl(asset), { signal });
          if (!response.ok) throw new Error(`Failed to load ${asset.name}`);
          const buffer = await response.arrayBuffer();
          validateGlb(buffer);
          const gltf = await new GLTFLoader().parseAsync(buffer, "");
          if (signal.aborted) {
            disposeObject(gltf.scene);
            return;
          }
          if (entry.node.surface) {
            const material = await makeSurface(entry.node, workspace.assets);
            gltf.scene.traverse((child) => {
              if (child instanceof Mesh) {
                for (const previous of Array.isArray(child.material)
                  ? child.material
                  : [child.material])
                  previous.dispose();
                child.material = material;
              }
            });
          }
          gltf.scene.traverse((child) => {
            if (child instanceof Mesh) {
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });
          if (!finish(gltf.scene)) return;
          entry.animationClips = gltf.animations.map((clip) => clip.name);
          if (entry.node.animation?.clip) {
            const settings = entry.node.animation;
            const clip = gltf.animations.find(
              (clip) => clip.name === settings.clip,
            );
            if (!clip)
              throw new Error(`Animation clip not found: ${settings.clip}`);
            const mixer = new AnimationMixer(gltf.scene),
              action = mixer.clipAction(clip);
            action.setLoop(
              settings.loop ? LoopRepeat : LoopOnce,
              settings.loop ? Infinity : 1,
            );
            action.clampWhenFinished = true;
            action.play();
            entry.sample = (time) =>
              mixer.setTime(
                Math.max(0, time * settings.speed + settings.offset),
              );
            entry.cleanup = () => {
              mixer.stopAllAction();
              mixer.uncacheRoot(gltf.scene);
            };
            entry.sample(this.time);
          }
        })().catch(fail),
      );
      return;
    }
    if (entry.node.kind === "splat" && asset) {
      const mesh = new SplatMesh({
        url: assetUrl(asset),
        fileName: asset.path || asset.name,
        editable: true,
        raycastable: true,
        lod: "quality",
      });
      entry.pointCloud = mesh;
      finish(mesh, {
        object: mesh,
        getBounds: () => entry.bounds?.clone() ?? new Box3(),
      });
      this.track(
        mesh.initialized
          .then(() => {
            if (entry.generation === generation)
              entry.bounds = mesh.getBoundingBox();
          })
          .catch(fail),
      );
      return;
    }
    if (entry.node.kind === "points" && asset) {
      entry.getSelectionTarget = () => this.captureChildTarget(entry);
      const depth = asset.depthAssetId
        ? workspace.assets[asset.depthAssetId]
        : undefined;
      const confidence = asset.confidenceAssetId
        ? workspace.assets[asset.confidenceAssetId]
        : undefined;
      if (!depth || !asset.camera) return;
      this.track(
        loadDepthPoints({
          depthUrl: assetUrl(depth),
          imageUrl: assetUrl(asset),
          confidenceUrl: confidence ? assetUrl(confidence) : undefined,
          confidenceMimeType: confidence?.mimeType,
          camera: asset.camera,
          depthEncoding: depth.depthEncoding ?? asset.depthEncoding,
          pointSize: 1,
          signal,
        })
          .then(async (points) => {
            if (!points.count)
              throw new Error(
                `${entry.node.name} depth contains no valid points`,
              );
            const packed = new PackedSplats({
              maxSplats: points.count,
              construct: (splats) => {
                const center = new Vector3();
                const scale = new Vector3();
                const quaternion = new Quaternion();
                const color = new Color();
                for (let index = 0; index < points.count; index += 1) {
                  center.fromArray(points.positions, index * 3);
                  const radius = points.radii[index];
                  scale.set(radius, radius, Math.max(radius * 0.12, 0.0001));
                  color.setRGB(
                    points.colors[index * 3] / 255,
                    points.colors[index * 3 + 1] / 255,
                    points.colors[index * 3 + 2] / 255,
                    SRGBColorSpace,
                  );
                  splats.pushSplat(center, scale, quaternion, 1, color);
                }
              },
            });
            const mesh = new SplatMesh({
              packedSplats: packed,
              editable: true,
              raycastable: true,
            });
            if (
              !finish(mesh, {
                object: mesh,
                getBounds: () => entry.bounds?.clone() ?? new Box3(),
              })
            )
              return;
            entry.pointCloud = mesh;
            if (this.display) this.applyDisplay(entry, this.display);
            await mesh.initialized;
            if (entry.generation !== generation) return;
            entry.bounds = mesh.getBoundingBox();
          })
          .catch(fail),
      );
      return;
    }
    if (entry.node.kind === "camera" && entry.node.projection) {
      const frustum = makeFrustum(entry.node.projection, this.helperColor);
      entry.frustum = frustum;
      entry.getSelectionTarget = () =>
        captureRoot(this.workspace!, entry.node.id)?.id ?? entry.node.id;
      finish(frustum, {
        ...geometrySpatial(frustum),
        getCenter: () => new Vector3(),
      });
      entry.pickProxy.visible = true;
      return;
    }
    if (entry.node.kind === "path") {
      finish(makePath(entry.node, this.helperColor));
      return;
    }
    if (entry.node.kind === "video" && asset) {
      const video = document.createElement("video");
      video.src = assetUrl(asset);
      video.crossOrigin = "anonymous";
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      void video.play().catch(() => undefined);
      const texture = new VideoTexture(video);
      texture.colorSpace = SRGBColorSpace;
      const plane = imagePlane(texture, 16, 9);
      entry.imagePlane = plane;
      plane.userData.video = video;
      finish(plane);
      this.track(
        new Promise<void>((resolve, reject) => {
          if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            resolve();
            return;
          }
          const loaded = () => done(resolve);
          const failed = () =>
            done(() => reject(new Error(`Failed to load ${asset.name}`)));
          const aborted = () =>
            done(() => reject(new DOMException("Aborted", "AbortError")));
          const done = (complete: () => void) => {
            video.removeEventListener("loadeddata", loaded);
            video.removeEventListener("error", failed);
            signal.removeEventListener("abort", aborted);
            complete();
          };
          video.addEventListener("loadeddata", loaded, { once: true });
          video.addEventListener("error", failed, { once: true });
          signal.addEventListener("abort", aborted, {
            once: true,
          });
        }).catch(fail),
      );
      return;
    }
    if (entry.node.kind === "image" && asset) {
      entry.getSelectionTarget = () => this.captureChildTarget(entry);
      this.track(
        textureFromAsset(asset, signal, entry.node.projection)
          .then(({ texture, width, height }) => {
            const plane = imagePlane(
              texture,
              width,
              height,
              entry.node.imageSurface &&
                entry.node.imageSurface.mode !== "reference"
                ? undefined
                : entry.node.projection,
            );
            if (!finish(plane)) return;
            entry.imagePlane = plane;
            if (entry.node.imageSurface) {
              const surface = entry.node.imageSurface;
              const size = geometrySpatial(plane)
                .getBounds()
                .getSize(new Vector3());
              plane.scale.multiplyScalar(
                surface.width / Math.max(size.x, 0.0001),
              );
              (plane.material as MeshBasicMaterial).alphaTest =
                surface.alphaTest;
              if (surface.mode === "sprite")
                entry.sample = (_time, camera) => {
                  if (!camera) return;
                  entry.root.updateWorldMatrix(true, false);
                  plane.quaternion.copy(
                    entry.root
                      .getWorldQuaternion(new Quaternion())
                      .invert()
                      .multiply(camera.getWorldQuaternion(new Quaternion())),
                  );
                };
              if (surface.nearest) {
                texture.magFilter = NearestFilter;
                texture.minFilter = NearestFilter;
                texture.generateMipmaps = false;
                texture.needsUpdate = true;
              }
            }
            if (this.display) this.applyDisplay(entry, this.display);
          })
          .catch(fail),
      );
    }
  }

  setDisplay(display: DisplaySettings) {
    this.display = display;
    for (const entry of this.entries.values())
      this.applyDisplay(entry, display);
  }

  private applyDisplay(entry: Entry, display: DisplaySettings) {
    if (
      entry.imagePlane &&
      (!entry.node.imageSurface || entry.node.imageSurface.mode === "reference")
    ) {
      entry.imagePlane.visible = display.showImages;
      const material = entry.imagePlane.material as MeshBasicMaterial;
      const transparent = display.imageOpacity < 1;
      if (material.transparent !== transparent) {
        material.transparent = transparent;
        material.needsUpdate = true;
      }
      material.opacity = display.imageOpacity;
      material.depthWrite = display.imageOpacity >= 1;
      if (entry.imagePlane.userData.calibratedPlane) {
        const previous = Math.abs(entry.imagePlane.position.z) || 1;
        const ratio = display.imageDistance / previous;
        entry.imagePlane.position.z = -display.imageDistance;
        entry.imagePlane.position.x *= ratio;
        entry.imagePlane.position.y *= ratio;
        entry.imagePlane.scale.x *= ratio;
        entry.imagePlane.scale.y *= ratio;
      }
    }
    if (entry.pointCloud) entry.pointCloud.visible = display.showPoints;
    if (entry.frustum) {
      this.applyCameraHighlight(entry);
      entry.frustum.scale.setScalar(display.imageDistance);
    }
  }

  setHovered(id: string | null) {
    if (this.hoveredId === id) return;
    this.hoveredId = id;
    for (const entry of this.entries.values()) this.applyCameraHighlight(entry);
  }

  private applyCameraHighlight(entry: Entry) {
    if (!entry.frustum) return;
    let current: SceneNode | undefined = entry.node;
    let highlighted = false;
    while (current) {
      if (
        this.selection.includes(current.id) ||
        this.hoveredId === current.id
      ) {
        highlighted = true;
        break;
      }
      current = current.parentId
        ? this.workspace?.nodes[current.parentId]
        : undefined;
    }
    const frame = this.workspace && captureRoot(this.workspace, entry.node.id);
    entry.frustum.visible =
      !!frame || !!this.display?.showFrustums || highlighted;
    const wire = entry.frustum.children[0] as LineSegments<
      BufferGeometry,
      LineBasicMaterial
    >;
    wire.material.color.set(highlighted ? this.activeColor : this.helperColor);
    wire.material.depthTest = !highlighted;
    wire.material.depthWrite = false;
    wire.renderOrder = highlighted ? 1001 : 0;
  }

  private localTargets(entry: Entry, workspace: SceneWorkspace) {
    if (!entry.node.parentId) return [];
    const targets: SplatMesh[] = [];
    for (const candidate of this.entries.values()) {
      if (!clipAppliesToNode(workspace, entry.node.id, candidate.node.id))
        continue;
      candidate.content?.traverse((object) => {
        if (object instanceof SplatMesh) targets.push(object);
      });
    }
    return targets;
  }

  private updateClips() {
    const workspace = this.workspace;
    if (!workspace) return;
    this.scene.updateMatrixWorld(true);
    for (const entry of this.entries.values()) {
      if (!entry.clipEdits) continue;
      const targets =
        entry.node.clip?.scope === "local"
          ? this.localTargets(entry, workspace)
          : [null];
      const active = new Set<SplatMesh | null>(targets);
      for (const [target, { edit }] of entry.clipEdits) {
        if (!active.has(target)) {
          edit.removeFromParent();
          entry.clipEdits.delete(target);
        }
      }
      for (const target of targets) {
        let clipEdit = entry.clipEdits.get(target);
        if (!clipEdit) {
          clipEdit = makeClipEdit(entry);
          entry.clipEdits.set(target, clipEdit);
        }
        const { edit } = clipEdit;
        edit.visible = isVisible(workspace, entry.node);
        edit.invert = entry.node.clip?.invert ?? false;
        edit.softEdge = entry.node.clip?.softness ?? 0;
        const parent = target ?? this.scene;
        if (edit.parent !== parent) parent.add(edit);
        parent.updateMatrixWorld(true);
        applyMatrix(
          edit,
          parent.matrixWorld.clone().invert().multiply(entry.root.matrixWorld),
        );
      }
    }
  }

  setSelection(ids: string[]) {
    if (
      ids.length === this.selection.length &&
      ids.every((id, index) => id === this.selection[index])
    )
      return;
    this.selection = [...ids];
    for (const entry of this.entries.values()) this.applyCameraHighlight(entry);
    disposeObject(this.selectionOutline);
    this.selectionOutline.clear();
    for (const id of ids) {
      const marker = new LineSegments(
        new EdgesGeometry(new BoxGeometry(1, 1, 1)),
        new LineBasicMaterial({
          color: this.helperColor,
          depthTest: false,
          transparent: true,
          opacity: 0.95,
        }),
      );
      marker.renderOrder = 1000;
      marker.matrixAutoUpdate = false;
      marker.userData.selectionId = id;
      this.selectionOutline.add(marker);
    }
  }

  private time = 0;
  sample(time: number, camera?: RuntimeCamera) {
    this.time = time;
    for (const entry of this.entries.values()) {
      try {
        entry.sample?.(time, camera);
      } catch (error) {
        entry.error = String(error);
        entry.sample = undefined;
        this.onError(entry.error);
      }
    }
    this.scene.updateMatrixWorld(true);
  }

  update() {
    this.updateClips();
    for (const marker of this.selectionOutline.children) {
      const id = marker.userData.selectionId as string;
      const entry = this.entries.get(id);
      marker.visible = Boolean(entry && effectivelyVisible(entry.root));
      if (!marker.visible || !entry) continue;
      const frame = entry.spatial?.object ?? entry.root;
      const bounds = this.bounds([id], frame);
      if (!bounds) continue;
      const size = bounds.getSize(new Vector3());
      bounds.getCenter(marker.position);
      marker.quaternion.identity();
      marker.scale.copy(size);
      marker.updateMatrix();
      marker.matrix.premultiply(frame.matrixWorld);
    }
  }

  private captureChildTarget(entry: Entry) {
    if (!this.workspace || !entry.node.locked) return entry.node.id;
    return captureRoot(this.workspace, entry.node.id)?.id ?? entry.node.id;
  }

  pick(raycaster: Raycaster, _pointer: Vector2) {
    raycaster.params.Line = { threshold: 0.08 };
    const objects = [...this.entries.values()].map((entry) => entry.root);
    for (const hit of raycaster.intersectObjects(objects, true)) {
      const nodeId = hit.object.userData.nodeId as string | undefined;
      const entry = nodeId ? this.entries.get(nodeId) : undefined;
      if (
        entry &&
        effectivelyVisible(entry.root) &&
        effectivelyVisible(hit.object)
      )
        return entry.getSelectionTarget?.() ?? entry.node.id;
    }
    return undefined;
  }

  inspect(nodeIds?: string[]) {
    if (!this.workspace) throw new Error("Scene is not loaded");
    const report = inspectScene(this.workspace, nodeIds, (ids) =>
      this.bounds(ids),
    );
    for (const node of report.nodes) {
      const error = this.entries.get(node.id)?.error;
      if (error) node.issues.push(`Renderer: ${error}`);
    }
    return report;
  }

  bounds(ids: string[], relativeTo?: Object3D) {
    const bounds = new Box3();
    let found = false;
    this.scene.updateMatrixWorld(true);
    const worldToBounds = relativeTo
      ? relativeTo.matrixWorld.clone().invert()
      : new Matrix4();
    for (const id of ids) {
      const entry = this.entries.get(id);
      if (!entry) continue;
      const candidate = new Box3();
      for (const nested of this.entries.values()) {
        if (!nested.spatial) continue;
        let ancestor: Object3D | null = nested.root;
        while (ancestor && ancestor !== entry.root) ancestor = ancestor.parent;
        if (ancestor === entry.root)
          candidate.union(
            nested.spatial
              .getBounds()
              .clone()
              .applyMatrix4(
                worldToBounds
                  .clone()
                  .multiply(nested.spatial.object.matrixWorld),
              ),
          );
      }
      if (candidate.isEmpty()) {
        const position = entry.root
          .getWorldPosition(new Vector3())
          .applyMatrix4(worldToBounds);
        candidate.setFromCenterAndSize(position, new Vector3(0.25, 0.25, 0.25));
      }
      bounds.union(candidate);
      found = true;
    }
    return found ? bounds : undefined;
  }

  center(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    this.scene.updateMatrixWorld(true);
    if (entry.spatial?.getCenter)
      return entry.spatial
        .getCenter()
        .clone()
        .applyMatrix4(entry.spatial.object.matrixWorld);
    return this.bounds([id], entry.root)!
      .getCenter(new Vector3())
      .applyMatrix4(entry.root.matrixWorld);
  }

  hideCaptureHelpers() {
    const states: Array<[Object3D, boolean]> = [];
    const hide = (object?: Object3D) => {
      if (!object) return;
      states.push([object, object.visible]);
      object.visible = false;
    };
    hide(this.selectionOutline);
    this.scene.children
      .filter((child) => child.userData.editorOverlay)
      .forEach(hide);
    for (const entry of this.entries.values()) {
      hide(entry.frustum);
      if (entry.node.kind === "clip" || entry.node.kind === "path")
        hide(entry.content);
    }
    return () => {
      for (const [object, visible] of states) object.visible = visible;
    };
  }

  private removeEntry(entry: Entry) {
    entry.abort?.abort();
    entry.generation += 1;
    for (const { edit } of entry.clipEdits?.values() ?? [])
      edit.removeFromParent();
    entry.cleanup?.();
    entry.root.removeFromParent();
    disposeObject(entry.root);
    this.entries.delete(entry.node.id);
  }

  dispose() {
    this.disposed = true;
    this.lights.forEach((light) => light.removeFromParent());
    for (const entry of [...this.entries.values()]) this.removeEntry(entry);
    this.selectionOutline.removeFromParent();
    disposeObject(this.selectionOutline);
  }
}
