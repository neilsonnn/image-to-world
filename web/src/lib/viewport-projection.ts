import { PerspectiveCamera } from "three";
import { cameraMatrix } from "../../../core/cameras";
import type { Camera } from "../../../core/schema";
import type { Resolution } from "../../../core/formats";

/** Center-crop to the viewfinder without changing the calibrated optical axis. */
export function viewfinderCamera(value: Camera, format: Resolution): Camera {
  const c = value.intrinsics;
  const scale = Math.max(format.width / c.width, format.height / c.height);
  return {
    ...value,
    intrinsics: {
      ...format,
      fx: c.fx * scale,
      fy: c.fy * scale,
      cx: format.width / 2 + (c.cx - c.width / 2) * scale,
      cy: format.height / 2 + (c.cy - c.height / 2) * scale,
    },
  };
}

export function applyCamera(camera: PerspectiveCamera, value: Camera) {
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

export function cameraValue(
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

export function applyCalibratedProjection(
  camera: PerspectiveCamera,
  value: Camera,
) {
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

export function viewportProjection(
  camera: PerspectiveCamera,
  width: number,
  height: number,
  calibrated?: Camera,
) {
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  if (!calibrated) return;
  const c = calibrated.intrinsics;
  const { scale, left, top } = viewfinderRect({ width, height }, c);
  applyCalibratedProjection(camera, {
    ...calibrated,
    intrinsics: {
      width,
      height,
      fx: c.fx * scale,
      fy: c.fy * scale,
      cx: c.cx * scale + left,
      cy: c.cy * scale + top,
    },
  });
}

export function cameraWithIntrinsics(
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

/** Pixel rectangle shared by the mask and the calibrated viewport projection. */
export function viewfinderRect(viewport: Resolution, format: Resolution) {
  const scale = Math.min(
    viewport.width / format.width,
    viewport.height / format.height,
  );
  const width = format.width * scale,
    height = format.height * scale;
  return {
    left: (viewport.width - width) / 2,
    top: (viewport.height - height) / 2,
    width,
    height,
    scale,
  };
}

/** Read the actual projected render region, including during a camera transition. */
export function cameraInViewfinder(
  camera: PerspectiveCamera,
  viewport: Resolution,
  format: Resolution,
): Camera {
  const rect = viewfinderRect(viewport, format);
  const p = camera.projectionMatrix.elements;
  return cameraWithIntrinsics(camera, {
    width: format.width,
    height: format.height,
    fx: (p[0] * viewport.width) / (2 * rect.scale),
    fy: (p[5] * viewport.height) / (2 * rect.scale),
    cx: (((1 - p[8]) * viewport.width) / 2 - rect.left) / rect.scale,
    cy: (((1 + p[9]) * viewport.height) / 2 - rect.top) / rect.scale,
  });
}
