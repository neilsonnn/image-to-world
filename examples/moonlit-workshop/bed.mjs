import { defaults } from "./defaults.mjs";
import {
  T,
  box,
  wood,
  weave,
  paint,
  finish,
  rod,
  cord,
  group,
  object,
  tau,
} from "./craft.mjs";

function surface(fn, nu, nv) {
  const pos = [],
    uv = [],
    indices = [];
  for (let j = 0; j <= nv; j++)
    for (let i = 0; i <= nu; i++) {
      const u = i / nu,
        v = j / nv;
      pos.push(...fn(u, v));
      uv.push(u, v);
      if (j && i) {
        const e = j * (nu + 1) + i;
        indices.push(e - nu - 2, e - 1, e, e - nu - 2, e, e - nu - 1);
      }
    }
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}
function cushion(root, mat, seam, x, y, z, w, h, d, angles) {
  const c = group(root, x, y, z);
  c.rotation.set(...angles);
  function patch(u, v, side) {
    const a = 2 * u - 1,
      b = 2 * v - 1,
      ax = Math.abs(a),
      az = Math.abs(b);
    // Two square fabric panels are stitched at their rims and bulge where
    // the filling has room. The points curl up slightly at the four corners.
    const chamber =
      (Math.max(0, 1 - ax ** 3.4) * Math.max(0, 1 - az ** 3.4)) ** 0.63;
    const corner = (ax * az) ** 2;
    const tuck =
      0.038 * Math.sin(18 * b + a * 2) * ax ** 5 +
      0.046 * Math.sin(17 * a + b) * az ** 5;
    return [
      ((a * w) / 2) * (0.95 + 0.065 * az ** 2),
      h * (side * (0.033 + 0.48 * chamber) - corner * 0.12 + tuck),
      ((b * d) / 2) * (0.94 + 0.07 * ax ** 2),
    ];
  }
  mat.side = T.DoubleSide;
  object(
    c,
    surface((u, v) => patch(u, v, 1), 46, 36),
    mat,
  );
  object(
    c,
    surface((u, v) => patch(1 - u, v, -1), 46, 36),
    mat,
  );
  for (const edge of [
    (t) => [t, 0],
    (t) => [1, t],
    (t) => [1 - t, 1],
    (t) => [0, 1 - t],
  ]) {
    object(
      c,
      surface(
        (u, v) => {
          const [a, b] = edge(u);
          return patch(a, b, 2 * v - 1);
        },
        32,
        1,
      ),
      mat,
    );
    const stitch = Array.from({ length: 36 }, (_, i) => {
      const [a, b] = edge(i / 35);
      return patch(a, b, 0);
    });
    cord(c, seam, stitch, 0.004);
  }
}
export default {
  create({ params }) {
    params = { ...defaults.bed, ...params };
    const root = new T.Group(),
      ash = wood("#4c423c", "#89705a", "x"),
      edge = wood("#4a4137", "#9b7952", "y");
    const sheet = weave("#d2c9b4", "#f3e5ca"),
      cotton = weave(params.shadow, params.linen),
      fold = weave("#7b8296", "#c3c0b7");
    const piping = paint("#b4b8c4"),
      seam = paint("#8d9daf"),
      slat = paint("#51483c");
    box(root, ash, 0, 0.3, 0, 3.4, 0.19, 1.63, 0.035);
    box(root, slat, 0, 0.27, 0, 3.31, 0.08, 1.57);
    for (const x of [-1.57, -0.08, 1.54])
      for (const z of [-0.7, 0.7])
        box(root, edge, x, 0.16, z, 0.13, 0.32, 0.14, 0.015);
    for (const x of [-1.65, 1.65]) {
      box(root, edge, x, 0.46, 0, 0.075, 0.31, 1.63, 0.02);
      box(root, ash, x, 0.63, 0, 0.085, 0.057, 1.69, 0.014);
    }
    for (let i = 0; i < 3; i++) {
      const x = -1.13 + i * 1.08;
      box(root, ash, x, 0.276, 0.84, 1.05, 0.2, 0.065, 0.009);
      box(root, slat, x, 0.326, 0.884, 0.18, 0.017, 0.018, 0.004);
    }
    box(root, sheet, 0.0, 0.55, 0, 3.25, 0.27, 1.53, 0.078);
    cord(
      root,
      piping,
      [
        [-1.55, 0.62, 0.764],
        [-0.6, 0.65, 0.78],
        [0.5, 0.63, 0.78],
        [1.52, 0.62, 0.766],
      ],
      0.012,
    );
    // The duvet has continuous cloth over the top and both long sides. The hem
    // moves with the folds and is stitched to a separate, closed underside.
    function cloth(u, v) {
      const t = 2 * v - 1,
        s = Math.abs(t),
        x = -1.67 + 2.64 * u + 0.036 * Math.sin(t * 4.1 + u * 0.9);
      const edge = 0.64 + 0.045 * Math.sin(u * 8.7 + 0.5);
      const drape = Math.min(1, Math.max(0, (s - edge) / (1 - edge)));
      const pleats =
        0.052 * Math.sin(u * 29 + t * 1.3) + 0.021 * Math.sin(u * 47 + 0.5);
      const z =
        Math.sign(t) *
          (0.79 * Math.min(s / edge, 1) +
            0.1 * Math.sin(drape * Math.PI * 0.64) +
            drape ** 1.65 * pleats) +
        0.016 * Math.sin(u * 14 + t);
      const bulge = (cx, cz, wx, wz) =>
        Math.exp(-(((u - cx) / wx) ** 2 + ((t - cz) / wz) ** 2));
      const mound =
        0.255 * bulge(0.8, 0.29, 0.15, 0.68) +
        0.15 * bulge(0.36, -0.05, 0.21, 0.61) +
        0.085 * bulge(0.14, 0.48, 0.12, 0.46);
      // Curved folds run from three gathered points and taper as they spread.
      const ridge = (center, width, amp) =>
        amp * Math.exp(-(((u - center) / width) ** 2));
      const sweep =
        ridge(0.75 + 0.14 * t - 0.05 * t * t, 0.047, 0.092) -
        ridge(0.7 + 0.13 * t, 0.044, 0.066) +
        ridge(0.23 - 0.09 * t + 0.055 * t * t, 0.063, 0.05) -
        ridge(0.14 - 0.08 * t, 0.071, 0.043) +
        ridge(0.58 + 0.08 * t * t, 0.062, 0.062) -
        ridge(0.51 + 0.04 * t, 0.066, 0.034) +
        ridge(0.83 - 0.12 * t + 0.035 * t * t, 0.026, 0.088) -
        ridge(0.8 - 0.12 * t + 0.035 * t * t, 0.028, 0.064);
      const sag =
        0.32 * drape ** 1.32 +
        (0.095 * Math.sin(u * 8.2 - 0.5) + 0.034 * Math.sin(u * 20 + t)) *
          drape ** 1.4;
      const foot = 0.16 * Math.exp(-u * 15);
      const y =
        0.772 +
        mound +
        params.folds * sweep * (0.46 + 0.72 * s) +
        0.024 * Math.cos(u * 13 + t * 3.3) -
        sag -
        foot;
      return [x, y, z];
    }
    // Offset against the local surface normal, including the vertical skirt.
    // A vertical offset alone lets the lining intersect the front of a fold.
    function offsetCloth(u, v, thickness) {
      const eps = 0.0001,
        p = new T.Vector3(...cloth(u, v));
      const tangent = new T.Vector3(...cloth(u + eps, v)).sub(p);
      const normal = new T.Vector3(...cloth(u, v + eps))
        .sub(p)
        .cross(tangent)
        .normalize();
      return p.addScaledVector(normal, thickness).toArray();
    }
    const blanket = surface(cloth, 106, 66);
    cotton.side = T.DoubleSide;
    object(root, blanket, cotton);
    const lining = weave("#8497b5", "#a0acc1");
    lining.side = T.DoubleSide;
    object(
      root,
      surface((u, v) => offsetCloth(1 - u, v, -0.016), 106, 66),
      lining,
    );
    for (const edgeFn of [
      (t) => [t, 0],
      (t) => [1, t],
      (t) => [1 - t, 1],
      (t) => [0, 1 - t],
    ]) {
      object(
        root,
        surface(
          (u, v) => {
            const [a, b] = edgeFn(u);
            return offsetCloth(a, b, -0.016 * v);
          },
          106,
          2,
        ),
        cotton,
      );
    }
    for (const u of [0, 1]) {
      const pts = Array.from({ length: 68 }, (_, i) => cloth(u, i / 67));
      cord(root, piping, pts, 0.0045);
    }
    for (const v of [0, 1]) {
      const pts = Array.from({ length: 106 }, (_, i) => cloth(i / 105, v));
      cord(root, piping, pts, 0.0045);
    }
    // Rolled-back cuff catches the sidelight, including its hem.
    function cuff(u, v) {
      return offsetCloth(
        0.84 + 0.145 * u + 0.014 * Math.sin(v * 8),
        v,
        0.01 + 0.028 * Math.sin(u * Math.PI),
      );
    }
    fold.side = T.DoubleSide;
    object(root, surface(cuff, 20, 58), fold);
    for (const u of [0, 1])
      cord(
        root,
        seam,
        Array.from({ length: 55 }, (_, i) => cuff(u, i / 54)),
        0.006,
      );
    // A glimpse of darker ticking between the bed rail and quilt.
    for (let i = 0; i < 4; i++)
      cord(
        root,
        piping,
        [
          [0.87, 0.62 - i * 0.036, 0.76],
          [1.11, 0.637 - i * 0.036, 0.77],
          [1.49, 0.636 - i * 0.036, 0.75],
        ],
        0.009,
      );
    cushion(
      root,
      sheet,
      piping,
      1.13,
      0.78,
      -0.22,
      0.97,
      0.25,
      0.78,
      [0.09, 0.1, -0.068],
    );
    cushion(
      root,
      sheet,
      piping,
      1.02,
      0.95,
      -0.34,
      1.08,
      0.33,
      0.8,
      [0.49, -0.28, 0.16],
    );
    cushion(
      root,
      fold,
      piping,
      0.66,
      0.86,
      0.24,
      0.94,
      0.25,
      0.59,
      [0.25, 0.22, 0.19],
    );
    return finish(root);
  },
};
