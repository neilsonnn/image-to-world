import { expect, test } from "bun:test";
import { PerspectiveCamera, Vector3 } from "three";
import { defaultCamera } from "../../../core/schema";
import {
  applyCamera,
  cameraInViewfinder,
  viewportProjection,
  viewfinderRect,
} from "./viewport-projection";

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
      applyCamera(camera, value);
      viewportProjection(camera, viewport.width, viewport.height, value);
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
