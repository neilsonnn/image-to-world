import * as T from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { MeshStandardNodeMaterial } from "three/webgpu";
import {
  color,
  mix,
  mx_noise_float,
  attribute,
  sin,
  vec3,
  smoothstep,
} from "three/tsl";

export { T };
export const tau = 2 * Math.PI;
export const group = (root, x = 0, y = 0, z = 0) => {
  const o = new T.Group();
  root.add(o);
  o.position.set(x, y, z);
  return o;
};
export function object(root, geo, mat, x = 0, y = 0, z = 0) {
  const mesh = new T.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
  return mesh;
}
export function box(root, mat, x, y, z, w, h, d, r = 0) {
  const geo =
    r > 0
      ? new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 3, h / 3, d / 3))
      : new T.BoxGeometry(w, h, d);
  return object(root, geo, mat, x, y, z);
}
export function ellipse(root, mat, x, y, z, w, h, d, seg = 18) {
  const mesh = object(
    root,
    new T.SphereGeometry(1, seg, Math.ceil(seg / 2)),
    mat,
    x,
    y,
    z,
  );
  mesh.scale.set(w, h, d);
  return mesh;
}
export function cylinder(root, mat, x, y, z, top, bottom, h, seg = 20) {
  return object(
    root,
    new T.CylinderGeometry(top, bottom, h, seg),
    mat,
    x,
    y,
    z,
  );
}
export function rod(root, mat, a, b, radius, taper = radius, sides = 10) {
  const start = new T.Vector3(...a),
    end = new T.Vector3(...b);
  const dir = end.clone().sub(start),
    mid = start.add(end).multiplyScalar(0.5);
  const mesh = cylinder(
    root,
    mat,
    mid.x,
    mid.y,
    mid.z,
    taper,
    radius,
    dir.length(),
    sides,
  );
  mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir.normalize());
  return mesh;
}
export function cord(root, mat, pts, radius = 0.008) {
  return object(
    root,
    new T.TubeGeometry(
      new T.CatmullRomCurve3(pts.map((p) => new T.Vector3(...p))),
      Math.max(12, pts.length * 5),
      radius,
      6,
      false,
    ),
    mat,
  );
}
export function lathe(root, mat, x, y, z, rings) {
  return object(
    root,
    new T.LatheGeometry(
      rings.map(([r, h]) => new T.Vector2(r, h)),
      32,
    ),
    mat,
    x,
    y,
    z,
  );
}
export function panel(root, mat, points, depth, x, y, z) {
  const s = new T.Shape();
  points.forEach(([px, py], i) => (i ? s.lineTo(px, py) : s.moveTo(px, py)));
  s.closePath();
  return object(
    root,
    new T.ExtrudeGeometry(s, { depth, bevelEnabled: false }),
    mat,
    x,
    y,
    z,
  );
}

export const paint = (hex, roughness = 0.82, metalness = 0) =>
  new T.MeshStandardMaterial({ color: hex, roughness, metalness });
export const lit = (hex) => new T.MeshBasicMaterial({ color: hex });
export function wood(dark, light, axis = "x", strength = 1) {
  const p = attribute("craftCoord", "vec3");
  const long = p[axis],
    broad =
      axis === "x" ? p.z.add(p.y) : axis === "y" ? p.x.add(p.z) : p.x.add(p.y);
  // A few growth lines wander through a broad heartwood field. Longitudinal
  // noise distorts the rings; the narrow pores have little diffuse contrast.
  const bend = mx_noise_float(vec3(long.mul(1.35), broad.mul(2.3), 0.6));
  const band = broad.mul(52).add(bend.mul(2.7));
  const ring = smoothstep(0.87, 0.995, sin(band)).mul(0.088 * strength);
  const longGrain = mx_noise_float(
    vec3(long.mul(1.9), broad.mul(11), 0.31),
  ).mul(0.095 * strength);
  const old = mx_noise_float(p.mul(2.7)).mul(0.08);
  const blend = old.add(longGrain).add(0.64).sub(ring).clamp(0, 1);
  const m = new MeshStandardNodeMaterial();
  m.colorNode = mix(color(dark), color(light), blend);
  m.roughnessNode = blend.mul(0.09).add(0.75);
  return m;
}
export function weave(lo, hi) {
  const p = attribute("craftCoord", "vec3");
  const nap = mx_noise_float(p.mul(4.3)).mul(0.12).add(0.52);
  const yarn = sin(p.x.mul(142))
    .mul(sin(p.z.add(p.y).mul(158)))
    .mul(0.014);
  const m = new MeshStandardNodeMaterial();
  m.colorNode = mix(color(lo), color(hi), nap.add(yarn));
  m.roughness = 1;
  return m;
}
// Retain continuous material coordinates before joining static pieces. Each material
// becomes a single draw call and the user can still move the complete authored object.
export function finish(root) {
  root.updateMatrixWorld(true);
  const batches = new Map();
  const parts = [];
  root.traverse((o) => {
    if (o.isMesh && o.geometry && !Array.isArray(o.material)) parts.push(o);
  });
  for (const o of parts) {
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const k of Object.keys(g.attributes))
      if (!["position", "normal", "uv"].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv)
      g.setAttribute(
        "uv",
        new T.BufferAttribute(
          new Float32Array(g.attributes.position.count * 2),
          2,
        ),
      );
    const coords = g.attributes.position.clone();
    const offset = new T.Vector3(
      o.matrixWorld.elements[12] * 0.173,
      o.matrixWorld.elements[13] * 0.237,
      o.matrixWorld.elements[14] * 0.213,
    );
    for (let i = 0; i < coords.count; i++)
      coords.setXYZ(
        i,
        coords.getX(i) + offset.x,
        coords.getY(i) + offset.y,
        coords.getZ(i) + offset.z,
      );
    g.setAttribute("craftCoord", coords);
    g.applyMatrix4(o.matrixWorld);
    g.clearGroups();
    if (!batches.has(o.material)) batches.set(o.material, []);
    batches.get(o.material).push(g);
    o.removeFromParent();
    o.geometry.dispose();
  }
  for (const [mat, geometries] of batches) {
    const combined = mergeGeometries(geometries);
    geometries.forEach((g) => g.dispose());
    object(root, combined, mat);
  }
  return { object: root };
}
export function book(root, cover, pages, x, y, z, w, h, d, tilt = 0) {
  const g = group(root, x, y, z);
  g.rotation.z = tilt;
  box(g, pages, 0.005, 0, 0, w * 0.91, h * 0.78, d * 0.96);
  box(g, cover, 0, h * 0.47, 0, w, h * 0.08, d, 0.003);
  box(g, cover, 0, -h * 0.47, 0, w, h * 0.08, d, 0.003);
  box(g, cover, -w * 0.47, 0, 0, w * 0.06, h, d, 0.005);
  return g;
}
export function books(root, x, y, z, rng, n = 5) {
  const covers = ["#233f58", "#354f70", "#834936", "#64756c", "#b18b58"].map(
    (c) => paint(c),
  );
  const pages = paint("#c6ac87");
  let h = y;
  for (let i = 0; i < n; i++) {
    const t = 0.035 + rng() * 0.045;
    const b = book(
      root,
      covers[i % covers.length],
      pages,
      x + (rng() - 0.5) * 0.045,
      h + t / 2,
      z,
      0.4 + rng() * 0.12,
      t,
      0.28 + rng() * 0.06,
    );
    b.rotation.y = (rng() - 0.5) * 0.15;
    h += t;
  }
}
