import * as T from "three";

// These shapes are detached from the drawn scene. Fine paint marks, writing
// and brush fibres have no thickness of their own in the rigid-body model.
export function boxShape(size, center = [0, 0, 0]) {
  const mesh = new T.Mesh(new T.BoxGeometry(...size), null);
  mesh.position.fromArray(center);
  return mesh;
}
export function roundShape(radius, height, center, topRadius = radius) {
  const mesh = new T.Mesh(
    new T.CylinderGeometry(topRadius, radius, height, 16),
    null,
  );
  mesh.position.fromArray(center);
  return mesh;
}
export function beamShape(start, end, width, depth) {
  const a = new T.Vector3(...start),
    b = new T.Vector3(...end);
  const shape = boxShape(
    [width, a.distanceTo(b), depth],
    a.clone().lerp(b, 0.5).toArray(),
  );
  shape.quaternion.setFromUnitVectors(
    new T.Vector3(0, 1, 0),
    b.sub(a).normalize(),
  );
  return shape;
}
export function compound(...shapes) {
  return new T.Group().add(...shapes);
}
