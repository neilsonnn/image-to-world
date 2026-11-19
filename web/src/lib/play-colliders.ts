import type * as Rapier from "@dimforge/rapier3d-compat";
import {
  BatchedMesh,
  Box3,
  InstancedMesh,
  Matrix4,
  Mesh,
  Object3D,
  Quaternion,
  Vector3,
} from "three";
import type { PhysicsBody } from "../../../core/physics";

type Engine = typeof Rapier;
const scratch = new Vector3();

// Rapier can construct a zero-mass hull from coplanar points. Give a flat
// mesh thickness before making it dynamic, even when its plane is oblique.
function hullVertices(vertices: number[], extent: number) {
  const first = new Vector3().fromArray(vertices);
  const edge = new Vector3(),
    normal = new Vector3(),
    delta = new Vector3();
  const epsilon = extent * 1e-7;
  for (let i = 3; i < vertices.length; i += 3) {
    delta.fromArray(vertices, i).sub(first);
    if (!edge.lengthSq()) {
      if (delta.length() > epsilon) edge.copy(delta).normalize();
    } else if (!normal.lengthSq()) {
      normal.crossVectors(edge, delta);
      if (normal.length() > epsilon) normal.normalize();
      else normal.set(0, 0, 0);
    } else if (Math.abs(normal.dot(delta)) > epsilon)
      return new Float32Array(vertices);
  }
  if (!normal.lengthSq()) return;
  const solid = new Float32Array(vertices.length * 2);
  normal.multiplyScalar(Math.max(0.0005, epsilon * 4));
  for (let i = 0; i < vertices.length; i += 3) {
    delta.fromArray(vertices, i).add(normal).toArray(solid, i);
    delta
      .fromArray(vertices, i)
      .sub(normal)
      .toArray(solid, i + vertices.length);
  }
  return solid;
}

// Keep gaps between the parts of a compound object. A mesh collider follows
// its triangles, a hull wraps its points, and a box follows its local axes.
function meshCollider(
  engine: Engine,
  mesh: Mesh,
  matrix: Matrix4,
  mode: NonNullable<PhysicsBody["collider"]>,
  proxy: boolean,
  draw = mesh.geometry.drawRange,
) {
  const geometry = mesh.geometry;
  const positions = geometry.getAttribute("position");
  if (!positions) return;
  const index = geometry.index;
  const count = index?.count ?? positions.count;
  const rangeEnd = Math.min(count, draw.start + draw.count);
  const material = mesh.material;
  const groups = Array.isArray(material)
    ? geometry.groups.filter(
        (g) => proxy || material[g.materialIndex ?? 0]?.visible,
      )
    : proxy || material.visible
      ? [{ start: 0, count }]
      : [];
  const local = new Box3();
  const vertices: number[] = [];
  const indices: number[] = [];
  const remap = new Map<number, number>();
  for (const group of groups) {
    const start = Math.max(group.start, draw.start);
    const end = Math.min(group.start + group.count, rangeEnd);
    const triangleEnd = end - ((end - start) % 3);
    for (let i = start; i < triangleEnd; i++) {
      const vertex = index ? index.getX(i) : i;
      let mapped = remap.get(vertex);
      if (mapped === undefined) {
        mapped = remap.size;
        remap.set(vertex, mapped);
        mesh.getVertexPosition(vertex, scratch);
        if (!Number.isFinite(scratch.lengthSq()))
          throw new Error("Collider geometry contains non-finite vertices");
        local.expandByPoint(scratch);
        if (mode !== "box") {
          scratch.applyMatrix4(matrix);
          vertices.push(scratch.x, scratch.y, scratch.z);
        }
      }
      if (mode === "mesh") indices.push(mapped);
    }
  }
  if (local.isEmpty()) return;
  if (mode === "mesh")
    return engine.ColliderDesc.trimesh(
      new Float32Array(vertices),
      new Uint32Array(indices),
    );
  if (mode === "hull") {
    const points = hullVertices(
      vertices,
      local.getSize(scratch).length() * matrix.getMaxScaleOnAxis(),
    );
    if (points) return engine.ColliderDesc.convexHull(points);
  }

  // A thin solid keeps planar boxes and degenerate convex hulls pickable.
  const center = local.getCenter(new Vector3()).applyMatrix4(matrix);
  const half = local.getSize(new Vector3()).multiplyScalar(0.5);
  const basis = [0, 1, 2].map((i) =>
    new Vector3().setFromMatrixColumn(matrix, i),
  );
  const radii = basis.map((axis, i) =>
    Math.max(0.0005, axis.length() * half.getComponent(i)),
  );
  basis.forEach((axis) => axis.normalize());
  // An affine transform can shear a box when rotated under nonuniform scale.
  // Use its eight transformed corners in that case.
  if (
    Math.max(
      Math.abs(basis[0].dot(basis[1])),
      Math.abs(basis[0].dot(basis[2])),
      Math.abs(basis[1].dot(basis[2])),
    ) > 1e-5
  ) {
    const corners: number[] = [];
    for (const x of [-1, 1])
      for (const y of [-1, 1])
        for (const z of [-1, 1]) {
          const p = center
            .clone()
            .addScaledVector(basis[0], x * radii[0])
            .addScaledVector(basis[1], y * radii[1])
            .addScaledVector(basis[2], z * radii[2]);
          corners.push(p.x, p.y, p.z);
        }
    return engine.ColliderDesc.convexHull(new Float32Array(corners));
  }
  if (matrix.determinant() < 0) basis[0].negate();
  const rotation = new Quaternion().setFromRotationMatrix(
    new Matrix4().makeBasis(basis[0], basis[1], basis[2]),
  );
  return engine.ColliderDesc.cuboid(radii[0], radii[1], radii[2])
    .setTranslation(center.x, center.y, center.z)
    .setRotation(rotation);
}

export function addColliders(
  engine: Engine,
  world: Rapier.World,
  body: Rapier.RigidBody,
  definition: PhysicsBody,
  geometryRoot: Object3D,
  geometryToBody: Matrix4,
  otherBodies: Set<Object3D>,
) {
  const mode =
    definition.collider ?? (definition.type === "dynamic" ? "hull" : "mesh");
  const proxy = !!definition.shape;
  const visit = (object: Object3D, matrix: Matrix4) => {
    if (
      (!proxy && !object.visible) ||
      (object !== geometryRoot && otherBodies.has(object))
    )
      return;
    if (object instanceof Mesh) {
      const add = (
        transform: Matrix4,
        range?: { start: number; count: number },
      ) => {
        const collider = meshCollider(
          engine,
          object,
          transform,
          mode,
          proxy,
          range,
        );
        if (collider)
          world.createCollider(
            collider
              .setFriction(definition.friction ?? 0.65)
              .setDensity(definition.density ?? 1)
              .setRestitution(definition.restitution ?? 0.05),
            body,
          );
      };
      if (object instanceof InstancedMesh) {
        const instance = new Matrix4();
        for (let i = 0; i < object.count; i++) {
          object.getMatrixAt(i, instance);
          add(instance.premultiply(matrix));
        }
      } else if (object instanceof BatchedMesh) {
        const instance = new Matrix4();
        // Instance IDs stay stable across deletion and can contain holes.
        for (
          let id = 0, found = 0;
          found < object.instanceCount && id < object.maxInstanceCount;
          id++
        ) {
          let geometryId: number;
          try {
            geometryId = object.getGeometryIdAt(id);
          } catch {
            continue;
          }
          found++;
          if (!object.getVisibleAt(id)) continue;
          const range = object.getGeometryRangeAt(geometryId);
          if (range)
            add(object.getMatrixAt(id, instance).premultiply(matrix), range);
        }
      } else add(matrix);
    }
    for (const child of object.children) {
      if (child.matrixAutoUpdate) child.updateMatrix();
      visit(child, matrix.clone().multiply(child.matrix));
    }
  };
  visit(geometryRoot, geometryToBody);
}
