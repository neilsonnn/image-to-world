import { cameraAimSchema, type CameraAim } from "./schema";
import { Matrix4, Quaternion, Vector3 } from "three";
import type { Camera, Projection, SceneNode, Workspace } from "./schema";

/** Resolve an aim in world or a node's local coordinates into the ordinary camera contract. */
export function aimCamera(
  workspace: Pick<Workspace, "nodes">,
  input: CameraAim,
  projection: Projection,
): Camera {
  const aim = cameraAimSchema.parse(input);
  const frame = aim.frameId ? workspace.nodes[aim.frameId] : undefined;
  if (aim.frameId && !frame)
    throw new Error(`Coordinate frame does not exist: ${aim.frameId}`);
  const matrix = frame ? worldMatrix(frame, workspace.nodes) : new Matrix4();
  const position = new Vector3(...aim.position).applyMatrix4(matrix);
  const target = new Vector3(...aim.target).applyMatrix4(matrix);
  const up = new Vector3(...aim.up).transformDirection(matrix);
  const direction = target.clone().sub(position);
  if (direction.lengthSq() < 1e-12)
    throw new Error("Camera position and look-at target must differ");
  if (
    up.lengthSq() < 1e-12 ||
    direction.clone().normalize().cross(up).lengthSq() < 1e-10
  )
    throw new Error(
      "Camera up must be nonzero and not parallel to the viewing direction",
    );
  const rotation = new Matrix4().lookAt(position, target, up);
  const intrinsics = { ...(aim.projection ?? projection) };
  if (aim.fov !== undefined) {
    intrinsics.fx = intrinsics.fy =
      intrinsics.height / (2 * Math.tan((aim.fov * Math.PI) / 360));
    intrinsics.cx = intrinsics.width / 2;
    intrinsics.cy = intrinsics.height / 2;
  }
  return {
    extrinsics: {
      position: position.toArray(),
      quaternion: new Quaternion()
        .setFromRotationMatrix(rotation)
        .normalize()
        .toArray(),
      coordinateSystem: "rub",
    },
    intrinsics,
  };
}

export function cameraNodeData(camera: Camera) {
  return {
    transform: matrixTransform(cameraMatrix(camera)),
    projection: { ...camera.intrinsics },
  };
}

export function cameraFromWorld(
  projection: Projection,
  matrix: Matrix4,
): Camera {
  const position = new Vector3(),
    rotation = new Quaternion(),
    scale = new Vector3();
  matrix.decompose(position, rotation, scale);
  return {
    intrinsics: { ...projection },
    extrinsics: {
      position: position.toArray(),
      quaternion: rotation.normalize().toArray(),
      coordinateSystem: "rub",
    },
  };
}

export function cameraMatrix(camera: Camera) {
  const rotation = new Quaternion(...camera.extrinsics.quaternion).normalize();
  if (camera.extrinsics.coordinateSystem === "rdf")
    rotation.multiply(new Quaternion(1, 0, 0, 0));
  return new Matrix4().compose(
    new Vector3(...camera.extrinsics.position),
    rotation,
    new Vector3(1, 1, 1),
  );
}
export function worldMatrix(
  node: SceneNode,
  nodes: Workspace["nodes"],
): Matrix4 {
  const matrix = new Matrix4().compose(
    new Vector3(...node.transform.position),
    new Quaternion(...node.transform.quaternion),
    new Vector3(...node.transform.scale),
  );
  return node.parentId
    ? worldMatrix(nodes[node.parentId], nodes).multiply(matrix)
    : matrix;
}
export function transformCamera(camera: Camera, matrix: Matrix4): Camera {
  return cameraFromWorld(
    camera.intrinsics,
    matrix.clone().multiply(cameraMatrix(camera)),
  );
}
export function uniformScale(matrix: Matrix4) {
  const x = new Vector3().setFromMatrixColumn(matrix, 0),
    y = new Vector3().setFromMatrixColumn(matrix, 1),
    z = new Vector3().setFromMatrixColumn(matrix, 2);
  const size = x.length();
  if (
    Math.abs(size - y.length()) > 1e-5 ||
    Math.abs(size - z.length()) > 1e-5 ||
    Math.abs(x.dot(y)) > 1e-5 ||
    Math.abs(x.dot(z)) > 1e-5 ||
    Math.abs(y.dot(z)) > 1e-5
  )
    throw new Error("Atlas context requires uniform scale without shear");
  return size;
}
export function samplePath(
  node: SceneNode,
  nodes: Workspace["nodes"],
  count: number,
): Camera[] {
  const frames = node.keyframes ?? [];
  if (node.kind !== "path" || frames.length < 2)
    throw new Error("A video path needs at least two keyframes");
  if (!Number.isInteger(count) || count < 2 || count > 600)
    throw new Error("Use between 2 and 600 target frames");
  const parent = worldMatrix(node, nodes);
  return Array.from({ length: count }, (_, i) => {
    const positionOnPath = (i / (count - 1)) * (frames.length - 1);
    const left = Math.min(Math.floor(positionOnPath), frames.length - 2);
    const a = frames[left],
      b = frames[left + 1];
    const alpha = positionOnPath - left;
    const am = cameraMatrix(a.camera),
      bm = cameraMatrix(b.camera);
    const position = new Vector3()
      .setFromMatrixPosition(am)
      .lerp(new Vector3().setFromMatrixPosition(bm), alpha);
    const rotation = new Quaternion()
      .setFromRotationMatrix(am)
      .slerp(new Quaternion().setFromRotationMatrix(bm), alpha);
    const intrinsics = { ...a.camera.intrinsics };
    if (
      intrinsics.width !== b.camera.intrinsics.width ||
      intrinsics.height !== b.camera.intrinsics.height
    )
      throw new Error("Camera path resolution must be constant");
    for (const key of ["fx", "fy", "cx", "cy"] as const)
      intrinsics[key] += (b.camera.intrinsics[key] - intrinsics[key]) * alpha;
    if (node.fov !== undefined) {
      intrinsics.fx = intrinsics.fy =
        intrinsics.height / (2 * Math.tan((node.fov * Math.PI) / 360));
    }
    return transformCamera(
      {
        extrinsics: {
          position: position.toArray(),
          quaternion: rotation.toArray(),
          coordinateSystem: "rub",
        },
        intrinsics,
      },
      parent,
    );
  });
}

export function reparentNode(
  node: SceneNode,
  parentId: string | null,
  nodes: Workspace["nodes"],
): SceneNode {
  if (parentId && !nodes[parentId]) throw new Error("Parent does not exist");
  const matrix = (
    parentId ? worldMatrix(nodes[parentId], nodes).invert() : new Matrix4()
  ).multiply(worldMatrix(node, nodes));
  return { ...node, parentId, transform: matrixTransform(matrix) };
}

export function matrixTransform(matrix: Matrix4): SceneNode["transform"] {
  const position = new Vector3(),
    rotation = new Quaternion(),
    scale = new Vector3();
  matrix.decompose(position, rotation, scale);
  const decomposed = new Matrix4().compose(position, rotation, scale);
  if (
    matrix.elements.some(
      (value, index) =>
        !Number.isFinite(value) ||
        Math.abs(value - decomposed.elements[index]) > 1e-5,
    )
  )
    throw new Error(
      "This transform would require shear; use object-space scaling or remove nonuniform ancestor scaling",
    );
  if (scale.toArray().some((value) => value <= 0))
    throw new Error("Scale must stay positive");
  return {
    position: position.toArray(),
    quaternion: rotation.normalize().toArray(),
    scale: scale.toArray(),
  };
}

export function transformNodes(
  nodes: Workspace["nodes"],
  ids: string[],
  delta: Matrix4,
): SceneNode[] {
  return ids.map((id) => {
    const node = nodes[id];
    const parent = node.parentId
      ? worldMatrix(nodes[node.parentId], nodes)
      : new Matrix4();
    const local = parent
      .invert()
      .multiply(delta)
      .multiply(worldMatrix(node, nodes));
    return { ...node, transform: matrixTransform(local) };
  });
}

/** Fit a camera to an Atlas grid, covering it at the same focal length per pixel. */
export function atlasCamera(
  camera: Camera,
  format: { width: number; height: number } = { width: 1280, height: 720 },
): Camera {
  const c = camera.intrinsics;
  const scale = Math.max(format.width / c.width, format.height / c.height);
  return {
    ...camera,
    intrinsics: {
      width: format.width,
      height: format.height,
      fx: c.fx * scale,
      fy: c.fy * scale,
      cx: format.width / 2,
      cy: format.height / 2,
    },
  };
}

export function spansBaseline(cameras: Camera[]) {
  const first = cameras[0]?.extrinsics.position;
  return Boolean(
    first &&
    cameras.some((camera) =>
      camera.extrinsics.position.some(
        (value, axis) => Math.abs(value - first[axis]) > 0.0001,
      ),
    ),
  );
}
