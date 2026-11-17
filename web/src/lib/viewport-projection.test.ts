import { expect, test } from "bun:test";
import { Euler, PerspectiveCamera, Vector3 } from "three";
import { defaultCamera } from "../../../core/schema";
import {
  applyCamera,
  cameraInViewfinder,
  viewportProjection,
  viewfinderRect,
  viewfinderCamera,
} from "./viewport-projection";
import { lookFlyCamera, moveFlyCamera, zoomFlyCamera } from "./fly";

test("the project viewfinder and Render camera agree across wide, tall, and resized viewports", () => {
  for (const format of [
    { width: 1280, height: 720 },
    { width: 720, height: 1280 },
  ]) {
    const value = defaultCamera();
    value.intrinsics = {
      ...format,
      fx: 800,
      fy: 900,
      cx: format.width * 0.47,
      cy: format.height * 0.52,
    };
    for (const viewport of [
      { width: 1700, height: 400 },
      { width: 400, height: 900 },
      { width: 800, height: 600 },
    ]) {
      const camera = new PerspectiveCamera();
      const viewed = viewfinderCamera(value, format);
      applyCamera(camera, viewed);
      viewportProjection(camera, viewport.width, viewport.height, viewed);
      camera.updateMatrixWorld();
      const rect = viewfinderRect(viewport, format);
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.top).toBeGreaterThanOrEqual(0);
      expect(rect.width / rect.height).toBeCloseTo(
        format.width / format.height,
      );
      const point = new Vector3(0.2, 0.1, -2);
      const projected = point
        .clone()
        .applyMatrix4(camera.matrixWorld)
        .project(camera);
      const imageX =
        (value.intrinsics.fx * point.x) / -point.z + value.intrinsics.cx;
      const imageY =
        (-value.intrinsics.fy * point.y) / -point.z + value.intrinsics.cy;
      expect(((projected.x + 1) * viewport.width) / 2).toBeCloseTo(
        rect.left + imageX * rect.scale,
      );
      expect(((1 - projected.y) * viewport.height) / 2).toBeCloseTo(
        rect.top + imageY * rect.scale,
      );
      const read = cameraInViewfinder(camera, viewport, format);
      for (const key of ["fx", "fy", "cx", "cy", "width", "height"] as const)
        expect(read.intrinsics[key]).toBeCloseTo(value.intrinsics[key]);
      expect(read.extrinsics.position).toEqual(value.extrinsics.position);
    }
  }
});

test("viewfinder crop preserves off-center image calibration", () => {
  const value = defaultCamera();
  value.intrinsics = {
    width: 1280,
    height: 720,
    fx: 900,
    fy: 850,
    cx: 570,
    cy: 390,
  };
  const cropped = viewfinderCamera(value, { width: 960, height: 720 });
  expect(cropped.intrinsics).toEqual({
    width: 960,
    height: 720,
    fx: 900,
    fy: 850,
    cx: 410,
    cy: 390,
  });
  expect(cropped.extrinsics).toEqual(value.extrinsics);
});

test("flying, looking, and zooming keep the visible camera calibration and roll", () => {
  const value = defaultCamera();
  value.intrinsics = {
    width: 1280,
    height: 720,
    fx: 900,
    fy: 850,
    cx: 570,
    cy: 390,
  };
  const camera = new PerspectiveCamera();
  applyCamera(camera, value);
  camera.rotation.set(0.2, 0.5, 0.12, "YXZ");
  const viewport = { width: 400, height: 900 };
  viewportProjection(camera, viewport.width, viewport.height, value);
  moveFlyCamera(camera, new Set(["w"]), 1 / 60, 5);
  lookFlyCamera(camera, 10, 10);
  expect(new Euler().setFromQuaternion(camera.quaternion, "YXZ").z).toBeCloseTo(
    0.12,
  );
  const moved = cameraInViewfinder(camera, viewport, value.intrinsics);
  for (const key of ["fx", "fy", "cx", "cy", "width", "height"] as const)
    expect(moved.intrinsics[key]).toBeCloseTo(value.intrinsics[key]);
  zoomFlyCamera(camera, -20);
  const after = cameraInViewfinder(camera, viewport, value.intrinsics);
  expect(after.intrinsics.cx).toBeCloseTo(570);
  expect(after.intrinsics.cy).toBeCloseTo(390);
  expect(after.intrinsics.fx / after.intrinsics.fy).toBeCloseTo(900 / 850);
  expect(after.intrinsics.fy).toBeGreaterThan(850);
});
