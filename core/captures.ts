import { nodeImageAsset } from "./images";
import { Euler, Quaternion, Vector3 } from "three";
import {
  cameraMatrix,
  cameraFromWorld,
  matrixTransform,
  transformCamera,
  uniformScale,
  worldMatrix,
} from "./cameras";
import {
  identity,
  type Asset,
  type Camera,
  type SceneNode,
  type Workspace,
} from "./schema";
import { inactiveNodeIds, orderedChildren } from "./scene";

export function selectedPath(
  workspace: Pick<Workspace, "nodes" | "selection" | "primaryId">,
) {
  const primary = workspace.primaryId && workspace.nodes[workspace.primaryId];
  if (primary && primary.kind === "path") return primary;
  return workspace.selection
    .map((id) => workspace.nodes[id])
    .find((node) => node?.kind === "path");
}

export function captureRoot(
  workspace: Pick<Workspace, "nodes">,
  id: string,
): SceneNode | undefined {
  let node: SceneNode | undefined = workspace.nodes[id];
  while (node) {
    if (node.kind === "capture") return node;
    node = node.parentId ? workspace.nodes[node.parentId] : undefined;
  }
}

export function captureNodes(workspace: Pick<Workspace, "nodes">, id: string) {
  const root = captureRoot(workspace, id);
  if (!root) throw new Error("Posed-image parent is missing");
  const one = (parent: SceneNode, kind: SceneNode["kind"]) => {
    const matches = orderedChildren(workspace.nodes, parent.id).filter(
      (node) => node.kind === kind,
    );
    if (matches.length !== 1)
      throw new Error(
        `${root.name}: ${matches.length ? "ambiguous" : "missing"} ${kind} child`,
      );
    return matches[0];
  };
  const camera = one(root, "camera");
  return {
    root,
    camera,
    image: one(camera, "image"),
    points: one(root, "points"),
  };
}

export function cameraNode(workspace: Pick<Workspace, "nodes">, id: string) {
  const node = workspace.nodes[id];
  if (node?.projection) return node;
  const capture = captureRoot(workspace, id);
  if (!capture) return;
  const cameras = orderedChildren(workspace.nodes, capture.id).filter(
    (child) => child.kind === "camera",
  );
  return cameras.length === 1 ? cameras[0] : undefined;
}

export function sceneCamera(
  workspace: Pick<Workspace, "nodes">,
  id: string,
): Camera | undefined {
  const node = cameraNode(workspace, id);
  return (
    node?.projection &&
    cameraFromWorld(node.projection, worldMatrix(node, workspace.nodes))
  );
}

export function isVisible(
  workspace: Pick<Workspace, "nodes">,
  node: SceneNode,
): boolean {
  return (
    node.visible &&
    (!node.parentId || !inactiveNodeIds(workspace.nodes).has(node.parentId))
  );
}

export function captureFrame(
  workspace: Pick<Workspace, "nodes" | "assets">,
  id: string,
) {
  const { root: capture, camera, image, points } = captureNodes(workspace, id);
  const fail = (reason: string): never => {
    throw new Error(`${capture.name}: ${reason}`);
  };
  const asset = nodeImageAsset(workspace, points);
  if (!asset?.depthAssetId || !asset.camera || asset.missing)
    return fail("points need available posed depth");
  if (!camera.projection)
    return fail("camera is missing projection intrinsics");
  if (
    !workspace.assets[asset.depthAssetId] ||
    workspace.assets[asset.depthAssetId].missing
  )
    return fail("depth asset is unavailable");
  if (image.assetId !== points.assetId)
    return fail("image and points use different RGB versions");
  if (
    !image.projection ||
    Object.entries(camera.projection).some(
      ([key, value]) =>
        image.projection![key as keyof typeof image.projection] !== value,
    )
  )
    return fail("image and camera projections disagree");
  const imageWorld = worldMatrix(image, workspace.nodes);
  const cameraWorld = worldMatrix(camera, workspace.nodes);
  if (
    imageWorld.elements.some(
      (value, index) => Math.abs(value - cameraWorld.elements[index]) > 1e-4,
    )
  )
    return fail("image is not aligned with its camera");
  const source = asset.camera.intrinsics,
    current = camera.projection;
  if (
    [
      source.fx / source.width - current.fx / current.width,
      source.fy / source.height - current.fy / current.height,
      source.cx / source.width - current.cx / current.width,
      source.cy / source.height - current.cy / current.height,
    ].some((delta) => Math.abs(delta) > 1e-5)
  )
    return fail("camera calibration does not match the points");
  const matrix = worldMatrix(points, workspace.nodes);
  // Depth is measured in the source camera's basis; independently moved children no longer describe one RGBD frame.
  if (
    matrix.elements.some(
      (value, index) => Math.abs(value - cameraWorld.elements[index]) > 1e-4,
    )
  )
    return fail("points are not aligned with their camera");
  let scale: number;
  try {
    scale = uniformScale(matrix);
  } catch {
    return fail("RGBD input requires uniform scale without shear");
  }
  return {
    node: capture,
    points,
    asset: { ...asset, depthAssetId: asset.depthAssetId, camera: asset.camera },
    camera: cameraFromWorld(camera.projection, cameraWorld),
    scale,
  };
}

export function captureFrameStatus(
  workspace: Pick<Workspace, "nodes" | "assets">,
  id: string,
) {
  try {
    return { frame: captureFrame(workspace, id), error: undefined };
  } catch (error) {
    return {
      frame: undefined,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function contextSettings(
  workspace: Pick<Workspace, "nodes"> & {
    settings: Pick<Workspace["settings"], "atlas">;
  },
  pathId?: string | null,
) {
  return (
    (pathId && workspace.nodes[pathId]?.context) || workspace.settings.atlas
  );
}

export function orderedCaptures(
  workspace: Pick<Workspace, "nodes"> & {
    settings: Pick<Workspace["settings"], "atlas">;
  },
  pathId?: string | null,
) {
  const order = contextSettings(workspace, pathId).order;
  return Object.values(workspace.nodes)
    .filter((node) => node.kind === "capture")
    .sort((a, b) => {
      const ai = order.indexOf(a.id),
        bi = order.indexOf(b.id);
      return (
        (ai < 0 ? Infinity : ai) - (bi < 0 ? Infinity : bi) ||
        (a.order ?? 0) - (b.order ?? 0) ||
        a.id.localeCompare(b.id)
      );
    });
}

export function atlasContextNodes(
  workspace: Pick<Workspace, "nodes" | "assets"> & {
    settings: Pick<Workspace["settings"], "atlas">;
  },
  ids?: string[],
  pathId?: string | null,
) {
  const selected =
    ids && new Set(ids.flatMap((id) => captureRoot(workspace, id)?.id ?? []));
  const settings = contextSettings(workspace, pathId);
  return orderedCaptures(workspace, pathId).filter((node) => {
    if (
      (selected && !selected.has(node.id)) ||
      !isVisible(workspace, node) ||
      settings.excludedIds.includes(node.id) ||
      (settings.soloIds.length && !settings.soloIds.includes(node.id))
    )
      return false;
    return true;
  });
}

/** Average current vertical camera FOVs of the active context, in degrees. */
export function spatialContextFieldOfView(
  workspace: Parameters<typeof atlasContextNodes>[0],
  pathId?: string | null,
): number | null {
  const values = atlasContextNodes(workspace, undefined, pathId).flatMap(
    (node) => {
      const camera = sceneCamera(workspace, node.id);
      if (!camera) return [];
      return [
        (2 *
          Math.atan(camera.intrinsics.height / (2 * camera.intrinsics.fy)) *
          180) /
          Math.PI,
      ];
    },
  );
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

export function atlasContext(...args: Parameters<typeof atlasContextNodes>) {
  return atlasContextNodes(...args).map((node) =>
    captureFrame(args[0], node.id),
  );
}

export function createCapture(
  asset: Pick<Asset, "name" | "camera" | "depthAssetId"> & { id?: string },
  id: string,
  placement?: Camera,
  jobId?: string,
  origin?: [number, number, number],
): SceneNode[] {
  const solved = asset.camera
    ? matrixTransform(cameraMatrix(asset.camera))
    : { ...identity(), position: [0, 1.5, 0] as [number, number, number] };
  const transform = identity();
  if (placement) {
    const matrix = cameraMatrix(placement);
    const rotation = new Euler().setFromRotationMatrix(matrix, "YXZ");
    transform.position = [
      placement.extrinsics.position[0],
      0,
      placement.extrinsics.position[2],
    ];
    transform.quaternion = new Quaternion()
      .setFromAxisAngle(new Vector3(0, 1, 0), rotation.y)
      .toArray();
    solved.position = [0, solved.position[1], 0];
  } else {
    transform.position = [solved.position[0], 0, solved.position[2]];
    solved.position = [0, solved.position[1], 0];
  }
  if (origin && asset.camera) {
    const position = asset.camera.extrinsics.position;
    solved.position = [
      position[0] - origin[0],
      position[1],
      position[2] - origin[2],
    ];
  }
  const projection = asset.camera?.intrinsics ??
    placement?.intrinsics ?? {
      fx: 850,
      fy: 850,
      cx: 640,
      cy: 360,
      width: 1280,
      height: 720,
    };
  const base = { visible: true, locked: true };
  return [
    {
      id,
      name: asset.name,
      kind: "capture",
      parentId: null,
      visible: true,
      transform,
      assetId: asset.id,
      geometryAssetId: asset.depthAssetId ? asset.id : undefined,
      jobId,
    },
    {
      ...base,
      id: `${id}_camera`,
      name: "Camera",
      kind: "camera",
      parentId: id,
      transform: solved,
      projection,
    },
    {
      ...base,
      id: `${id}_image`,
      name: "Image",
      kind: "image",
      parentId: `${id}_camera`,
      transform: identity(),
      assetId: asset.id,
      projection,
    },
    {
      ...base,
      id: `${id}_points`,
      name: "Points",
      kind: "points",
      parentId: id,
      transform: structuredClone(solved),
      assetId: asset.id,
    },
  ];
}

export function completeCapture(
  workspace: Workspace,
  id: string,
  asset: Asset,
  placement?: Camera,
  origin?: [number, number, number],
) {
  const { root, camera, image, points } = captureNodes(workspace, id);
  const generated = createCapture(asset, id, placement, root.jobId, origin);
  const previous = [root, camera, image, points];
  generated.forEach((node, index) => {
    const old = previous[index];
    if (!old) return;
    workspace.nodes[old.id] =
      index === 0
        ? {
            ...old,
            assetId: asset.id,
            geometryAssetId: asset.depthAssetId ? asset.id : undefined,
          }
        : {
            ...old,
            assetId: node.assetId,
            geometryAssetId:
              node.assetId && asset.depthAssetId ? asset.id : undefined,
            projection: node.projection,
            transform: node.transform,
          };
  });
}

export function pathFromCameras(
  workspace: Workspace,
  ids: string[],
  targetFrameCount: number,
): SceneNode {
  const cameras = ids.map((id) => sceneCamera(workspace, id));
  if (cameras.some((camera) => !camera))
    throw new Error("Choose camera nodes or posed captures");
  const resolution = cameras[0]!.intrinsics;
  return {
    id: `node_${crypto.randomUUID()}`,
    name: "Camera path",
    targetFrameCount,
    fov:
      (2 * Math.atan(resolution.height / (2 * resolution.fy)) * 180) / Math.PI,
    kind: "path",
    parentId: null,
    visible: true,
    transform: identity(),
    keyframes: cameras.map((camera) => {
      const intrinsics = camera!.intrinsics;
      const sx = resolution.width / intrinsics.width,
        sy = resolution.height / intrinsics.height;
      return {
        id: crypto.randomUUID(),
        camera: {
          ...camera!,
          intrinsics: {
            ...intrinsics,
            width: resolution.width,
            height: resolution.height,
            fx: intrinsics.fx * sx,
            cx: intrinsics.cx * sx,
            fy: intrinsics.fy * sy,
            cy: intrinsics.cy * sy,
          },
        },
      };
    }),
  };
}

/** Follow image provenance so posed generated images keep their generated origin. */
export function captureOrigin(
  workspace: Pick<Workspace, "assets" | "jobs" | "nodes">,
  id: string,
): "imported" | "generated" {
  const node = workspace.nodes[id];
  const kind = node?.jobId ? workspace.jobs[node.jobId]?.input.kind : undefined;
  if (kind === "atlas" || kind === "video" || kind === "image")
    return "generated";
  let assetId = node?.assetId;
  const seen = new Set<string>();
  while (assetId && !seen.has(assetId)) {
    seen.add(assetId);
    const asset = workspace.assets[assetId];
    const kind = asset?.jobId
      ? workspace.jobs[asset.jobId]?.input.kind
      : undefined;
    if (kind === "atlas" || kind === "video" || kind === "image")
      return "generated";
    assetId = asset?.parentAssetId;
  }
  return "imported";
}

/** Imported (and frozen) Frames first, preserving scene-tree order inside each group. */
export function spatialContextFrames(
  workspace: Pick<Workspace, "nodes" | "assets" | "jobs">,
) {
  const frames: SceneNode[] = [];
  const visit = (parentId: string | null) => {
    for (const node of orderedChildren(workspace.nodes, parentId)) {
      if (node.kind === "capture") frames.push(node);
      visit(node.id);
    }
  };
  visit(null);
  const generated = (node: SceneNode) =>
    !node.contextFrozen && captureOrigin(workspace, node.id) === "generated";
  return [
    ...frames.filter((node) => !generated(node)),
    ...frames.filter(generated),
  ];
}
