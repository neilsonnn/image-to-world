import * as T from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  attribute,
  color,
  float,
  mix,
  mx_noise_float,
  positionLocal,
  smoothstep,
  vec3,
} from "three/tsl";

export { T };
export const tau = 2 * Math.PI;
export const lerp = (a, b, t) => a + (b - a) * t;
export const v3 = (p) => new T.Vector3(...p);
export function random(seed) {
  return () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
const c = (h) => new T.Color(h);
export function inkMaterial(kind, amount = 1) {
  const p = positionLocal;
  const fiber = mx_noise_float(p.mul(vec3(540, 620, 540)));
  const pool = mx_noise_float(p.mul(vec3(1.5, 2.0, 1.8)));
  const charcoal = mx_noise_float(p.mul(vec3(41, 27, 35)));
  let pigment = attribute("pigment", "vec3");
  if (kind === "plaster") {
    const wash = mx_noise_float(p.mul(0.86)).mul(0.12);
    const sunnySide = float(1).sub(smoothstep(-1.05, 0.85, p.x));
    const lamplight = float(1)
      .sub(smoothstep(0.19, 1.24, p.sub(vec3(-1.35, 1.1, -1.37)).length()))
      .mul(0.55);
    const sunny = p.y
      .mul(-0.31)
      .add(0.76)
      .add(wash)
      .mul(sunnySide.mul(0.7).add(0.3))
      .add(lamplight)
      .clamp(0, 1);
    pigment = mix(pigment, color("#efd2b0"), sunny.mul(0.73));
    // Small, uncorrelated mineral particles soften the flat warm wash.
    pigment = pigment.mul(
      pool
        .mul(0.045)
        .add(charcoal.mul(0.022))
        .add(fiber.mul(0.18 * amount))
        .add(1),
    );
    const pit = smoothstep(0.44, 0.62, fiber).mul(0.13 * amount);
    pigment = pigment.mul(float(1).sub(pit));
  } else if (kind === "limestone") {
    const strata = mx_noise_float(
      vec3(p.x.mul(8).add(p.y.mul(5)), p.y.mul(31), p.z.mul(11)),
    );
    pigment = pigment.mul(
      pool
        .mul(0.17)
        .add(strata.mul(0.1))
        .add(fiber.mul(0.19 * amount))
        .add(1),
    );
    pigment = mix(
      pigment,
      color("#b5b397"),
      smoothstep(0.51, 0.71, fiber).mul(0.105),
    );
  } else if (kind === "wood-x" || kind === "wood-y") {
    const along = kind === "wood-x" ? p.x : p.y,
      across = kind === "wood-x" ? p.y : p.x;
    const sweep = mx_noise_float(
      vec3(along.mul(7), across.mul(73).add(pool.mul(2.6)), p.z.mul(51)),
    );
    const grain = mx_noise_float(
      vec3(along.mul(21), across.mul(237), p.z.mul(67)),
    );
    pigment = pigment.mul(
      sweep.mul(0.21).add(grain.mul(0.2)).add(fiber.mul(0.23)).add(1),
    );
    pigment = mix(
      pigment,
      color("#483523"),
      smoothstep(0.42, 0.62, grain.add(sweep.mul(0.27))).mul(0.4),
    );
  } else if (kind === "rag") {
    pigment = pigment.mul(
      pool
        .mul(0.037)
        .add(fiber.mul(0.13 * amount))
        .add(1),
    );
  } else {
    pigment = pigment.mul(charcoal.mul(0.075).add(1));
  }
  const m = new MeshBasicNodeMaterial({ side: T.DoubleSide });
  m.colorNode = pigment;
  return m;
}
// One buffer per surface preserves the varying ink color of individual strokes.
export class Pigment {
  constructor() {
    this.pos = [];
    this.col = [];
  }
  tri(a, b, d, ac, bc = ac, dc = ac) {
    for (const [p, h] of [
      [a, ac],
      [b, bc],
      [d, dc],
    ]) {
      this.pos.push(...p);
      const k = c(h);
      this.col.push(k.r, k.g, k.b);
    }
  }
  quad(a, b, d, e, ac, bc = ac, dc = ac, ec = ac) {
    this.tri(a, b, e, ac, bc, ec);
    this.tri(b, d, e, bc, dc, ec);
  }
  finish(root, mat, name) {
    if (!this.pos.length) return;
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("pigment", new T.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new T.Mesh(g, mat);
    m.name = name;
    root.add(m);
    return m;
  }
}
export const shot = (u, v, z) => [
  (2 * u - 1) * 0.615 * (4.2 - z),
  1.45 + (0.5 - v) * 0.688655 * (4.2 - z),
  z,
];
// The plaster curves forward at the sides and overhead into a low dome.
export const wallDepth = (u, v) =>
  -1.5 + 2.65 * (u - 0.5) ** 2 + 0.82 * Math.max(0, 0.29 - v) ** 2;
export const wall = (u, v, offset = 0) => {
  const p = shot(u, v, wallDepth(u, v));
  p[2] += offset;
  return p;
};
export function line(
  batch,
  pts,
  width,
  col,
  normal = new T.Vector3(0, 0, 1),
  endTaper = 0.27,
) {
  const v = pts.map(v3),
    l = [],
    r = [];
  for (let i = 0; i < v.length; i++) {
    const dir = v[Math.min(i + 1, v.length - 1)]
      .clone()
      .sub(v[Math.max(i - 1, 0)]);
    if (dir.lengthSq() < 1e-12) dir.set(1, 0, 0);
    const taper = i === 0 || i === v.length - 1 ? endTaper : 1;
    const across = new T.Vector3()
      .crossVectors(normal, dir)
      .normalize()
      .multiplyScalar(width * 0.5 * taper);
    l.push(v[i].clone().add(across).toArray());
    r.push(v[i].clone().sub(across).toArray());
  }
  for (let i = 1; i < v.length; i++)
    batch.quad(l[i - 1], r[i - 1], r[i], l[i], col);
}
