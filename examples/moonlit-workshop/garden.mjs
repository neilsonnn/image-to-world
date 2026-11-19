import { defaults } from "./defaults.mjs";
import {
  T,
  wood,
  paint,
  box,
  group,
  rod,
  cord,
  lathe,
  books,
  book,
  object,
  finish,
  tau,
  ellipse,
  lit,
} from "./craft.mjs";
function leaf(root, mat, a, b, wide, tilt) {
  const start = new T.Vector3(...a),
    end = new T.Vector3(...b),
    line = end.clone().sub(start);
  const side = new T.Vector3(
    Math.cos(tilt),
    0.06,
    Math.sin(tilt),
  ).multiplyScalar(wide);
  const pos = [],
    indices = [];
  for (let i = 0; i <= 7; i++) {
    const t = i / 7,
      arc = Math.sin(t * Math.PI),
      center = start.clone().addScaledVector(line, t);
    center.y += arc * 0.032;
    const w = side.clone().multiplyScalar(arc * (0.72 + 0.52 * t));
    for (const j of [-1, 0, 1]) {
      const p = center.clone().addScaledVector(w, j);
      p.y -= Math.abs(j) * arc * 0.014;
      pos.push(...p.toArray());
    }
    if (i) {
      const a = (i - 1) * 3;
      indices.push(
        a,
        a + 1,
        a + 3,
        a + 1,
        a + 4,
        a + 3,
        a + 1,
        a + 2,
        a + 4,
        a + 2,
        a + 5,
        a + 4,
      );
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  object(root, g, mat);
}
export default {
  create({ params, random }) {
    params = { ...defaults.garden, ...params };
    const root = new T.Group(),
      shell = wood("#85543a", "#bc8250", "y"),
      front = wood("#985a36", "#d39456", "y"),
      edging = wood("#554736", "#9a7244", "x"),
      brass = paint("#b89b62", 0.45, 0.58);
    box(root, shell, 0, 0.58, 0, 0.84, 1.14, 1.08, 0.017);
    box(root, edging, 0, 1.17, 0, 0.91, 0.08, 1.15, 0.017);
    for (let i = 0; i < 3; i++) {
      const y = 0.246 + i * 0.346;
      box(root, front, 0.423, y, 0, 0.046, 0.321, 0.994, 0.009);
      for (const z of [-0.32, 0.32]) {
        box(root, brass, 0.45, y + 0.058, z, 0.013, 0.038, 0.074, 0.006);
        rod(
          root,
          brass,
          [0.465, y + 0.055, z - 0.03],
          [0.465, y + 0.055, z + 0.03],
          0.008,
        );
      }
    }
    for (const x of [-0.333, 0.333])
      for (const z of [-0.42, 0.42])
        box(root, edging, x, 0.068, z, 0.11, 0.136, 0.12);
    const sage = paint("#84957d"),
      ochre = paint("#a77855"),
      soil = paint("#463d33"),
      teal = paint("#374e55"),
      trim = paint("#ded4b4");
    function pot(x, y, z, r, h, mat) {
      const p = group(root, x, y, z);
      lathe(p, mat, 0, 0, 0, [
        [0, 0],
        [r * 0.67, 0],
        [r * 0.72, 0.035],
        [r * 0.94, h * 0.84],
        [r, h * 0.86],
        [r, h],
        [r * 0.86, h],
        [r * 0.83, h * 0.9],
      ]);
      lathe(p, mat, 0, -0.015, 0, [
        [0, 0],
        [r * 0.76, 0],
        [r * 0.92, 0.022],
        [r * 0.91, 0.035],
        [r * 0.72, 0.036],
      ]);
      ellipse(p, soil, 0, h * 0.91, 0, r * 0.85, 0.014, r * 0.85);
      for (const ht of [0.11, 0.14])
        lathe(p, trim, 0, 0, 0, [
          [r * 0.82, ht * h * 3.45],
          [r * 0.83, ht * h * 3.45 + 0.009],
        ]);
      return p;
    }
    const p = pot(0.11, 1.212, 0.08, 0.164, 0.3, sage);
    const leaves = ["#314b46", "#415d50", "#59725a", "#7b8a65"].map((c) => {
      const m = paint(c);
      m.side = T.DoubleSide;
      return m;
    });
    const stem = paint("#55644a");
    // Long arching grass fans and their midribs.
    for (let i = 0; i < params.leaves; i++) {
      const a = i * 2.4,
        reach = 0.17 + random() * 0.26,
        rise = 0.33 + random() * 0.43,
        pts = [];
      for (let j = 0; j <= 7; j++) {
        const t = j / 7;
        pts.push([
          Math.sin(a) * reach * t ** 1.4,
          0.29 + rise * (t - 0.52 * t * t),
          Math.cos(a) * reach * t ** 1.4,
        ]);
      }
      const verts = [],
        idx = [];
      for (let j = 0; j < 8; j++) {
        const t = j / 7,
          w = 0.013 * Math.sin(Math.PI * (t * 0.85 + 0.15)) * (1 - t * 0.85);
        const [x, y, z] = pts[j];
        verts.push(
          x + Math.cos(a) * w,
          y,
          z - Math.sin(a) * w,
          x,
          y + 0.006 * Math.sin(t * Math.PI),
          z,
          x - Math.cos(a) * w,
          y,
          z + Math.sin(a) * w,
        );
        if (j) {
          let q = 3 * j - 3;
          idx.push(
            q,
            q + 1,
            q + 3,
            q + 3,
            q + 1,
            q + 4,
            q + 1,
            q + 2,
            q + 4,
            q + 4,
            q + 2,
            q + 5,
          );
        }
      }
      const g = new T.BufferGeometry();
      g.setAttribute("position", new T.Float32BufferAttribute(verts, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      object(p, g, leaves[i % 4]);
    }
    const p2 = pot(-0.17, 0.038, 0.93, 0.182, 0.32, teal);
    for (let j = 0; j < 11; j++) {
      const a = j * 2.4,
        pts = [];
      const spread = 0.18 + random() * 0.28,
        rise = 0.89 + random() * 1.05;
      for (let k = 0; k < 10; k++) {
        const t = k / 9;
        pts.push([
          Math.cos(a) * spread * t + 0.06 * Math.sin(t * 5 + j),
          0.3 + rise * t,
          Math.sin(a) * spread * t,
        ]);
      }
      cord(p2, stem, pts, 0.009);
      for (let k = 2; k < 10; k++) {
        const [x, y, z] = pts[k];
        for (const s of [-1, 1]) {
          const angle = a + s * (1.4 + random() * 0.25),
            len = 0.1 + random() * 0.11;
          const end = [
            x + Math.cos(angle) * len,
            y + len * 0.4,
            z + Math.sin(angle) * len,
          ];
          leaf(
            p2,
            leaves[(k + j) % 4],
            [x, y, z],
            end,
            len * 0.25,
            angle + 1.57,
          );
        }
      }
    }
    const herb = pot(-0.19, 1.213, -0.28, 0.109, 0.18, ochre);
    for (let i = 0; i < 21; i++) {
      const a = i * 2.4,
        l = 0.12 + random() * 0.13;
      leaf(
        herb,
        leaves[i % 4],
        [0, 0.16, 0],
        [Math.cos(a) * l, 0.17 + random() * 0.27, Math.sin(a) * l],
        0.037,
        a + 1.57,
      );
    }
    const paper = paint("#b7ac8c"),
      cover = paint("#455d65");
    for (let i = 0; i < 3; i++) {
      const b = book(
        root,
        cover,
        paper,
        0.13,
        1.24 + i * 0.031,
        -0.3,
        0.23,
        0.03,
        0.18,
      );
      b.rotation.y = -0.12 + i * 0.06;
    }
    return finish(root);
  },
};
