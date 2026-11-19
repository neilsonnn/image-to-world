import * as T from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  attribute,
  normalWorld,
  positionWorld,
  cameraPosition,
  color,
  vec3,
  mix,
  dot,
  sin,
  smoothstep,
  mx_noise_float,
  max,
} from "three/tsl";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
export { T };

export const palette = {
  ink: "#211d16",
  blueblack: "#182b2d",
  brass: "#ad8550",
  darkBrass: "#775c40",
  fiber: "#d7c9aa",
  paper: "#f5eee4",
  cream: "#efdcba",
  wood: "#b0794a",
  teak: "#795135",
  oak: "#ae7443",
  orange: "#ae5333",
  steel: "#586568",
  ivory: "#eee6d7",
  indigo: "#294965",
  lake: "#3e6380",
  moss: "#465647",
};
const rgb = (h) => new T.Color(h);
const paletteRefs = new Map();
export const paint = (hex, surface = "pigment") => {
  const key = hex + surface;
  if (!paletteRefs.has(key)) paletteRefs.set(key, { hex, surface });
  return paletteRefs.get(key);
};
export const ink = paint(palette.ink, "ink");
export function group(r, x = 0, y = 0, z = 0) {
  const g = new T.Group();
  g.position.set(x, y, z);
  r.add(g);
  return g;
}
export function mesh(r, geo, mat, x = 0, y = 0, z = 0) {
  const o = new T.Mesh(geo, null);
  o.userData.paint = mat;
  o.position.set(x, y, z);
  r.add(o);
  return o;
}
export function box(r, m, x, y, z, w, h, d, bevel = 0) {
  return mesh(
    r,
    bevel
      ? new RoundedBoxGeometry(
          w,
          h,
          d,
          1,
          Math.min(bevel, w / 2.1, h / 2.1, d / 2.1),
        )
      : new T.BoxGeometry(w, h, d),
    m,
    x,
    y,
    z,
  );
}
export function ball(r, m, x, y, z, rx, ry, rz) {
  const o = mesh(r, new T.SphereGeometry(1, 18, 12), m, x, y, z);
  o.scale.set(rx, ry, rz);
  return o;
}
export function lathe(r, m, x, y, z, p, n = 24) {
  return mesh(
    r,
    new T.LatheGeometry(
      p.map((a) => new T.Vector2(...a)),
      n,
    ),
    m,
    x,
    y,
    z,
  );
}
export function cyl(r, m, x, y, z, a, b, h, n = 20) {
  return mesh(r, new T.CylinderGeometry(a, b, h, n), m, x, y, z);
}
export function rod(r, m, a, b, ra, rb = ra, n = 8) {
  const v = new T.Vector3(...a),
    w = new T.Vector3(...b),
    t = w.clone().sub(v);
  const o = cyl(
    r,
    m,
    ...v.add(w).multiplyScalar(0.5).toArray(),
    rb,
    ra,
    t.length(),
    n,
  );
  o.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), t.normalize());
  return o;
}
export function beam(r, m, a, b, w, d) {
  const v = new T.Vector3(...a),
    w2 = new T.Vector3(...b),
    t = w2.clone().sub(v);
  const o = box(
    r,
    m,
    ...v.add(w2).multiplyScalar(0.5).toArray(),
    w,
    t.length(),
    d,
    0.004,
  );
  o.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), t.normalize());
  return o;
}
export function cord(r, m, pts, rad = 0.003) {
  return mesh(
    r,
    new T.TubeGeometry(
      new T.CatmullRomCurve3(pts.map((p) => new T.Vector3(...p))),
      Math.max(10, pts.length * 4),
      rad,
      5,
      false,
    ),
    m,
  );
}
export function poly(r, m, verts, faces) {
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(verts.flat(), 3));
  g.setIndex(faces);
  g.computeVertexNormals();
  return mesh(r, g, m);
}
export function extrude(r, m, pts, depth, bevel = 0) {
  const s = new T.Shape();
  pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  return mesh(
    r,
    new T.ExtrudeGeometry(s, {
      depth,
      bevelEnabled: !!bevel,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 2,
      steps: 1,
    }),
    m,
  );
}
export function mark(r, m, pts, radius = 0.002) {
  return cord(r, m, pts, radius);
}
function shaded(surface) {
  const mat = new MeshBasicNodeMaterial({
    side: T.DoubleSide,
    toneMapped: false,
  });
  const p = attribute("studioPosition", "vec3");
  const base = attribute("pigment", "vec3");
  const n = normalWorld;
  const lum = dot(n, vec3(-0.58, 0.73, -0.34));
  const broad = mx_noise_float(p.mul(vec3(5.6, 6.8, 3.1)));
  const fib = mx_noise_float(p.mul(vec3(108, 81, 93)));
  const sun = smoothstep(-0.27, -0.14, lum.add(broad.mul(0.12)));
  const edge = smoothstep(0.56, 0.72, lum.add(broad.mul(0.058)));
  let shade = sun
    .mul(0.34)
    .add(0.56)
    .add(edge.mul(0.125))
    .add(broad.mul(0.035))
    .add(fib.mul(0.024));
  let out = base.mul(shade);
  if (surface === "wood" || surface === "wing") {
    const w = mx_noise_float(p.mul(vec3(1.7, 19, 24)));
    const band = sin(
      p.z.mul(174).add(p.y.mul(94)).add(w.mul(2.9)).add(p.x.mul(1.3)),
    );
    const grain = smoothstep(0.78, 0.99, band)
      .mul(smoothstep(-0.06, 0.41, w))
      .mul(0.215);
    out = base
      .mul(shade.sub(grain).add(w.mul(0.13)))
      .mul(mix(vec3(0.8, 0.75, 0.69), vec3(1.14, 1.09, 0.96), sun));
    if (surface === "wing") {
      const window = smoothstep(
        -1.91,
        -1.76,
        p.x.add(p.z.mul(0.29)).add(broad.mul(0.025)),
      );
      out = out.mul(mix(vec3(0.3, 0.38, 0.35), vec3(0.92, 0.88, 0.81), window));
    }
  } else if (surface === "sheet") {
    // Leaded window shadows on the laid-out drawing, broken by a small penumbra.
    const x = p.x.add(p.z.mul(0.49));
    const z = p.z.add(p.x.mul(-0.13));
    const bar = max(
      smoothstep(0.067, 0.027, x.sub(0.035).abs()),
      smoothstep(0.06, 0.029, z.add(0.5).abs()),
    );
    const rightShade = smoothstep(0.51, 0.57, p.x.add(p.z.mul(0.47)));
    out = mix(base, color("#b0a598"), max(bar, rightShade).mul(0.84)).mul(
      broad.mul(0.018).add(fib.mul(0.014)).add(0.99),
    );
  } else if (surface === "pottery" || surface === "lampLacquer") {
    const view = cameraPosition.sub(positionWorld).normalize();
    const highlight = dot(n, view.add(vec3(-0.68, 0.39, 0.35)).normalize());
    const pooled = mx_noise_float(p.mul(vec3(72, 18, 72))).add(fib.mul(0.46));
    const sheen = smoothstep(0.75, 0.89, highlight).mul(
      surface === "pottery" ? 0.13 : 0.24,
    );
    const scatter = smoothstep(
      0.985,
      0.997,
      highlight.add(pooled.mul(0.031)),
    ).mul(smoothstep(-0.22, 0.31, pooled));
    out = mix(
      base.mul(shade.add(pooled.mul(0.075))),
      color(surface === "pottery" ? "#b4b7a4" : "#6e8fa1"),
      sheen,
    );
    out = mix(
      out,
      color("#d8ddc9"),
      scatter.mul(surface === "pottery" ? 0.35 : 0.63),
    );
  } else if (surface === "bristle") {
    const strand = mx_noise_float(p.mul(vec3(305, 15, 184)));
    out = base.mul(shade.add(strand.mul(0.24)).add(fib.mul(0.052)));
  } else if (surface === "enamel") {
    const side = dot(n, vec3(-0.73, 0.16, 0.66));
    const glint = smoothstep(0.91, 0.966, side.add(fib.mul(0.032))).mul(0.44);
    out = mix(
      base.mul(shade),
      base.mul(0.44).add(vec3(0.38, 0.43, 0.435)),
      glint,
    );
  } else if (surface === "ink") {
    out = base.mul(broad.mul(0.085).add(0.83));
  } else if (surface === "cloth") {
    const nap = mx_noise_float(p.mul(vec3(38, 75, 146)));
    out = base
      .mul(shade.add(nap.mul(0.055)))
      .mul(mix(vec3(0.82, 0.7, 0.62), vec3(1.07, 1.01, 0.95), sun));
  } else if (surface === "flat") {
    out = base.mul(fib.mul(0.018).add(1));
  }
  mat.colorNode = out;
  return mat;
}
// Batch paint by both surface and rigid part. The original studio coordinates
// keep the paper shadows and wood grain attached to the painted piece in play.
export function finish(root, physics) {
  root.updateMatrixWorld(true);
  const owners = new Set([
    root,
    ...(physics?.bodies ?? []).map((body) => body.object),
  ]);
  const batches = new Map();
  const materials = new Map();
  function collect(object, owner) {
    if (owners.has(object)) owner = object;
    for (const child of [...object.children]) collect(child, owner);
    if (!object.isMesh) {
      if (!owners.has(object) && !object.children.length)
        object.removeFromParent();
      return;
    }
    const { hex, surface } = object.userData.paint;
    const geometry = object.geometry.index
      ? object.geometry.toNonIndexed()
      : object.geometry.clone();
    for (const key of Object.keys(geometry.attributes))
      if (!["position", "normal"].includes(key)) geometry.deleteAttribute(key);
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    geometry.applyMatrix4(object.matrixWorld);
    geometry.setAttribute(
      "studioPosition",
      geometry.attributes.position.clone(),
    );
    geometry.applyMatrix4(owner.matrixWorld.clone().invert());
    const shade = rgb(hex);
    const pigment = new Float32Array(geometry.attributes.position.count * 3);
    for (let i = 0; i < pigment.length; i += 3) shade.toArray(pigment, i);
    geometry.setAttribute("pigment", new T.BufferAttribute(pigment, 3));
    geometry.clearGroups();
    if (!batches.has(owner)) batches.set(owner, new Map());
    const surfaces = batches.get(owner);
    if (!surfaces.has(surface)) surfaces.set(surface, []);
    surfaces.get(surface).push(geometry);
    object.removeFromParent();
    object.geometry.dispose();
  }
  collect(root, root);
  for (const [owner, surfaces] of batches) {
    for (const [surface, geometries] of surfaces) {
      if (!materials.has(surface)) materials.set(surface, shaded(surface));
      const mesh = new T.Mesh(
        mergeGeometries(geometries),
        materials.get(surface),
      );
      geometries.forEach((geometry) => geometry.dispose());
      mesh.name = surface;
      mesh.castShadow = mesh.receiveShadow = true;
      owner.add(mesh);
    }
  }
  return { object: root, physics };
}
export function binding(r, x, y, z, w, h, d, cover, angle = 0) {
  const b = group(r, x, y, z);
  b.rotation.y = angle;
  box(
    b,
    paint("#c8b696"),
    0,
    h * 0.5,
    0,
    w * 0.977,
    h * 0.78,
    d * 0.971,
    0.003,
  );
  for (const v of [0.055, 0.947])
    box(b, cover, 0, h * v, 0, w, h * 0.106, d, 0.0025);
  box(b, cover, -w * 0.48, h * 0.5, 0, w * 0.038, h, d, 0.003);
  for (const f of [0.25, 0.46, 0.74])
    box(b, paint("#98846a"), 0.006, h * f, d * 0.486, w * 0.95, 0.0015, 0.0015);
  return b;
}
