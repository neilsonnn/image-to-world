import {
  BoxGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Raycaster,
  TubeGeometry,
  Vector2,
  Vector3,
  type Camera,
  type ColorRepresentation,
  type Object3D,
} from "three";
import type { TransformControlsMode } from "three/examples/jsm/controls/TransformControls.js";
import type { TransformCapabilities } from "../../../core/node-capabilities";

type Axis = "X" | "Y" | "Z" | "XYZ";
type Handle = {
  mesh: Mesh;
  mode: TransformControlsMode;
  axis: Axis;
  color: number;
};
const axes = ["X", "Y", "Z"] as const;
const units = [
  new Vector3(1, 0, 0),
  new Vector3(0, 1, 0),
  new Vector3(0, 0, 1),
];

/** Visible meshes are also the pick surfaces: no enlarged, overlapping proxy volumes. */
export class GizmoHandles {
  readonly root = new Group();
  private handles: Handle[] = [];
  private directions = axes.map(() => new Group());
  private arcs = axes.map(() => new Group());
  private signs = [1, 1, 1];
  private colors: ColorRepresentation[] = [
    "#b0b0b0",
    "#828282",
    "#5f5f5f",
    "#dedede",
  ];
  private raycaster = new Raycaster();

  constructor() {
    const add = (
      geometry: BoxGeometry | CylinderGeometry | TubeGeometry,
      parent: Group,
      mode: TransformControlsMode,
      axis: Axis,
      color: number,
    ) => {
      const mesh = new Mesh(
        geometry,
        new MeshBasicMaterial({ depthTest: false, depthWrite: false }),
      );
      mesh.name = `${mode}:${axis}`;
      geometry.computeBoundingSphere();
      parent.add(mesh);
      this.handles.push({ mesh, mode, axis, color });
      return mesh;
    };
    axes.forEach((axis, index) => {
      const direction = this.directions[index];
      this.root.add(direction);
      // A 3.2px shaft and filled arrowhead are picked exactly where they are drawn.
      add(
        new CylinderGeometry(1.6, 1.6, 48, 8),
        direction,
        "translate",
        axis,
        index,
      ).position.y = 30;
      add(
        new CylinderGeometry(0, 4.5, 11, 12),
        direction,
        "translate",
        axis,
        index,
      ).position.y = 59.5;
      add(
        new BoxGeometry(7, 7, 7),
        direction,
        "scale",
        axis,
        index,
      ).position.y = 38;
      const arc = this.arcs[index];
      this.root.add(arc);
      const u = units[(index + 1) % 3],
        v = units[(index + 2) % 3];
      const points = Array.from({ length: 33 }, (_, step) => {
        const angle = ((step / 32) * Math.PI) / 2;
        return u
          .clone()
          .multiplyScalar(Math.cos(angle) * 78)
          .addScaledVector(v, Math.sin(angle) * 78);
      });
      add(
        new TubeGeometry(new CatmullRomCurve3(points), 32, 1.8, 8, false),
        arc,
        "rotate",
        axis,
        index,
      );
    });
    add(new BoxGeometry(7, 7, 7), this.root, "scale", "XYZ", 3);
  }

  setColors(colors: ColorRepresentation[]) {
    this.colors = colors;
  }

  update(
    camera: Camera,
    object: Object3D | undefined,
    space: "world" | "local",
    supported: TransformCapabilities,
    height: number,
    dragging: boolean,
    active?: { mode: TransformControlsMode; axis: string | null },
  ) {
    this.root.visible = !!object;
    if (!object) return;
    object.updateWorldMatrix(true, false);
    camera.updateMatrixWorld();
    const position = object.getWorldPosition(new Vector3());
    const rotation =
      space === "local"
        ? object.getWorldQuaternion(new Quaternion())
        : new Quaternion();
    const eye = camera
      .getWorldPosition(new Vector3())
      .sub(position)
      .normalize()
      .applyQuaternion(rotation.clone().invert());
    if (!dragging)
      this.signs = this.signs.map((previous, index) =>
        Math.abs(eye.getComponent(index)) < 0.03
          ? previous
          : Math.sign(eye.getComponent(index)),
      );
    const depth = Math.abs(
      position.clone().applyMatrix4(camera.matrixWorldInverse).z,
    );
    const perspective = camera.projectionMatrix.elements[15] === 0;
    const pixelScale =
      (2 * (perspective ? Math.max(depth, 0.01) : 1)) /
      Math.abs(camera.projectionMatrix.elements[5]) /
      Math.max(height, 1);
    this.root.position.copy(position);
    this.root.quaternion.copy(rotation);
    this.root.scale.setScalar(pixelScale);
    this.directions.forEach((group, index) =>
      group.quaternion.setFromUnitVectors(
        new Vector3(0, 1, 0),
        units[index].clone().multiplyScalar(this.signs[index]),
      ),
    );
    this.arcs.forEach((group) =>
      group.scale.set(this.signs[0], this.signs[1], this.signs[2]),
    );
    for (const handle of this.handles) {
      const index = axes.indexOf(handle.axis as (typeof axes)[number]);
      const edgeOn =
        index >= 0 &&
        handle.mode !== "rotate" &&
        Math.abs(eye.getComponent(index)) > 0.98;
      const flatArc =
        index >= 0 &&
        handle.mode === "rotate" &&
        Math.abs(eye.getComponent(index)) < 0.12;
      handle.mesh.visible = supported[handle.mode] && !edgeOn && !flatArc;
      const material = handle.mesh.material as MeshBasicMaterial;
      material.color.set(
        this.colors[
          active?.mode === handle.mode && active.axis === handle.axis
            ? 3
            : handle.color
        ],
      );
    }
    this.root.updateMatrixWorld(true);
    // Paint far handles first, near handles last. Picking uses this same order at crossings.
    const ordered = this.handles
      .filter((handle) => handle.mesh.visible)
      .map((handle) => ({
        handle,
        depth: handle.mesh.geometry
          .boundingSphere!.center.clone()
          .applyMatrix4(handle.mesh.matrixWorld)
          .applyMatrix4(camera.matrixWorldInverse).z,
      }))
      .sort((a, b) => a.depth - b.depth);
    ordered.forEach(({ handle }, index) => {
      handle.mesh.renderOrder = 1100 + index;
    });
  }

  pick(camera: Camera, pointer: Vector2) {
    if (!this.root.visible) return undefined;
    this.raycaster.setFromCamera(pointer, camera);
    const handles = this.handles.filter((handle) => handle.mesh.visible);
    const hits = this.raycaster.intersectObjects(
      handles.map((handle) => handle.mesh),
      false,
    );
    hits.sort(
      (a, b) =>
        b.object.renderOrder - a.object.renderOrder || a.distance - b.distance,
    );
    const winner = hits[0];
    const handle = winner
      ? handles.find((handle) => handle.mesh === winner.object)
      : undefined;
    return handle ? { mode: handle.mode, axis: handle.axis } : undefined;
  }

  dispose() {
    for (const { mesh } of this.handles) {
      mesh.geometry.dispose();
      (mesh.material as MeshBasicMaterial).dispose();
    }
    this.root.removeFromParent();
  }
}
