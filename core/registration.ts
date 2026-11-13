import { Matrix4, Quaternion, Vector3 } from "three";
import { cameraMatrix } from "./cameras";
import type { Camera } from "./schema";

export function median(values: number[]) {
  const sorted = values
    .filter((v) => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);
  if (!sorted.length)
    throw new Error("Reconstruction has no usable scale anchors");
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function registerCameras(
  solved: Camera[],
  targets: (Camera | undefined)[],
  depthScale?: number,
) {
  const pairs = solved.flatMap((camera, i) =>
    targets[i]
      ? [{ source: cameraMatrix(camera), target: cameraMatrix(targets[i]!) }]
      : [],
  );
  if (!pairs.length) return { scale: 1, matrix: new Matrix4() };
  const ratios: number[] = [];
  for (let i = 0; i < pairs.length; i++)
    for (let j = i + 1; j < pairs.length; j++) {
      const a = new Vector3()
        .setFromMatrixPosition(pairs[i].source)
        .distanceTo(new Vector3().setFromMatrixPosition(pairs[j].source));
      const b = new Vector3()
        .setFromMatrixPosition(pairs[i].target)
        .distanceTo(new Vector3().setFromMatrixPosition(pairs[j].target));
      if (a > 1e-4 && b > 1e-4) ratios.push(b / a);
    }
  const scale = ratios.length ? median(ratios) : depthScale;
  if (!scale || !Number.isFinite(scale) || scale <= 0)
    throw new Error(
      "Reconstruction needs translated saved cameras or an existing depth anchor to recover scene scale",
    );
  const rotations = pairs.map((pair) =>
    new Quaternion()
      .setFromRotationMatrix(pair.target)
      .multiply(new Quaternion().setFromRotationMatrix(pair.source).invert()),
  );
  const sum = [0, 0, 0, 0];
  for (const rotation of rotations) {
    const sign = rotation.dot(rotations[0]) < 0 ? -1 : 1;
    rotation.toArray().forEach((v, i) => (sum[i] += sign * v));
  }
  const rotation = new Quaternion(
    ...(sum as [number, number, number, number]),
  ).normalize();
  const offset = new Vector3();
  for (const pair of pairs)
    offset.add(
      new Vector3()
        .setFromMatrixPosition(pair.target)
        .sub(
          new Vector3()
            .setFromMatrixPosition(pair.source)
            .applyQuaternion(rotation)
            .multiplyScalar(scale),
        ),
    );
  offset.divideScalar(pairs.length);
  return {
    scale,
    matrix: new Matrix4().compose(
      offset,
      rotation,
      new Vector3(scale, scale, scale),
    ),
  };
}
