import { expect, test } from "bun:test";
import {
  Group,
  Mesh,
  PerspectiveCamera,
  Scene,
  TubeGeometry,
  Vector2,
  Vector3,
} from "three";
import { GizmoHandles } from "./gizmo-handles";

test("visible handles own precise triangle picking, with no hits in the gaps or disabled modes", () => {
  const camera = new PerspectiveCamera(50, 1, 0.01, 100);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const scene = new Scene(),
    pivot = new Group(),
    gizmo = new GizmoHandles();
  scene.add(pivot, gizmo.root);
  const update = (scale = true) =>
    gizmo.update(
      camera,
      pivot,
      "world",
      { translate: true, rotate: true, scale },
      600,
      false,
    );
  const point = (x: number, y: number, z = 0) => {
    const p = gizmo.root.localToWorld(new Vector3(x, y, z)).project(camera);
    return new Vector2(p.x, p.y);
  };
  try {
    update();
    expect(gizmo.pick(camera, point(60, 0))?.mode).toBe("translate");
    expect(gizmo.pick(camera, point(60, 0))?.axis).toBe("X");
    expect(gizmo.pick(camera, point(60, 10))).toBeUndefined();
    expect(gizmo.pick(camera, point(38, 0))).toEqual({
      mode: "scale",
      axis: "X",
    });
    expect(gizmo.pick(camera, point(55, 55))).toEqual({
      mode: "rotate",
      axis: "Z",
    });
    expect(gizmo.pick(camera, point(-55, 55))).toBeUndefined();
    update(false);
    expect(gizmo.pick(camera, point(38, 0))?.mode).toBe("translate");
    const arc = gizmo.root.getObjectByName("rotate:Z") as Mesh<TubeGeometry>;
    expect(
      arc.geometry.parameters.path
        .getPoint(0)
        .angleTo(arc.geometry.parameters.path.getPoint(1)),
    ).toBeCloseTo(Math.PI / 2);
    const geometry = arc.geometry;
    camera.position.set(-4, -3, -6);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    update();
    const arcStart = arc.geometry.parameters.path
      .getPoint(0)
      .applyMatrix4(arc.matrixWorld);
    const arcEnd = arc.geometry.parameters.path
      .getPoint(1)
      .applyMatrix4(arc.matrixWorld);
    expect(arcStart.x).toBeLessThan(0);
    expect(arcEnd.y).toBeLessThan(0);
    expect(arc.geometry).toBe(geometry);
    gizmo.update(
      camera,
      undefined,
      "world",
      { translate: true, rotate: true, scale: true },
      600,
      false,
    );
    expect(gizmo.pick(camera, new Vector2())).toBeUndefined();
  } finally {
    gizmo.dispose();
  }
});
