import { boxShape, compound } from "./colliders.mjs";
import {
  T,
  paint,
  ink,
  group,
  box,
  ball,
  cyl,
  rod,
  cord,
  poly,
  finish,
  binding,
} from "./desk-craft.mjs";
const body = paint("#203332"),
  edge = paint("#384946", "enamel"),
  black = paint("#141e1c"),
  platen = paint("#292b25", "enamel"),
  gold = paint("#ba9e70", "enamel"),
  key = paint("#9c967a"),
  letter = paint("#423c30"),
  mid = paint("#6e796c", "enamel");
function cheek(g, x0, x1) {
  const side = [
    [-0.235, 0.018],
    [0.228, 0.018],
    [0.223, 0.085],
    [0.19, 0.103],
    [0.159, 0.102],
    [-0.036, 0.172],
    [-0.074, 0.206],
    [-0.078, 0.249],
    [-0.192, 0.268],
    [-0.224, 0.232],
  ];
  const verts = [
      ...side.map(([z, y]) => [x0, y, z]),
      ...side.map(([z, y]) => [x1, y, z]),
    ],
    n = side.length,
    faces = [];
  for (let i = 1; i < n - 1; i++) faces.push(0, i, i + 1, n, n + i + 1, n + i);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    faces.push(i, i + n, j, j, i + n, j + n);
  }
  poly(g, body, verts, faces);
  cord(
    g,
    edge,
    side.slice(2, 9).map(([z, y]) => [x1, y + 0.002, z]),
    0.0035,
  );
}
export default {
  create({ params, random }) {
    const r = new T.Group(),
      t = group(r, -1.686, 0.801, 0.687);
    const bodies = [
      {
        id: "typewriter",
        type: "dynamic",
        object: t,
        collider: "box",
        density: 430,
        shape: compound(
          boxShape([0.66, 0.115, 0.45], [0, 0.058, 0]),
          boxShape([0.7, 0.14, 0.14], [0, 0.19, -0.158]),
        ),
      },
    ];
    t.scale.setScalar(0.91);
    t.rotation.y = params.typewriterYaw ?? 1.06;
    box(t, black, 0, 0.017, 0, 0.646, 0.032, 0.45, 0.012);
    box(t, body, 0, 0.061, 0.002, 0.668, 0.083, 0.46, 0.017);
    cheek(t, -0.33, -0.293);
    cheek(t, 0.293, 0.33);
    box(t, black, 0, 0.164, -0.162, 0.591, 0.114, 0.147, 0.009);
    const deck = box(t, black, 0, 0.125, 0.052, 0.6, 0.026, 0.308, 0.008);
    deck.rotation.x = 0.27;
    for (let k = 0; k < 4; k++) {
      const n = k === 0 ? 10 : k === 3 ? 9 : 11,
        z = -0.047 + 0.062 * k,
        y = 0.157 - 0.0157 * k;
      for (let i = 0; i < n; i++) {
        const x = (i - (n - 1) / 2) * 0.049 + (k % 2) * 0.008;
        const stick = rod(
          t,
          mid,
          [x, y - 0.028, z + 0.025],
          [x, y + 0.011, z],
          0.004,
          0.005,
        );
        const band = cyl(t, platen, x, y + 0.012, z, 0.0198, 0.017, 0.008, 14);
        band.rotation.x = 0.24;
        const cap = cyl(t, key, x, y + 0.017, z, 0.0125, 0.014, 0.004, 14);
        cap.rotation.x = 0.24;
        box(
          t,
          letter,
          x,
          y + 0.0195,
          z,
          0.002 + random() * 0.003,
          0.0013,
          0.0065,
        );
        box(t, gold, x - 0.006, y + 0.0185, z - 0.005, 0.004, 0.001, 0.002);
      }
    }
    const space = box(t, edge, 0, 0.096, 0.195, 0.377, 0.019, 0.027, 0.007);
    space.rotation.x = 0.24;
    for (let i = 0; i < 27; i++) {
      const a = (i / 26 - 0.5) * Math.PI * 0.79;
      const x = Math.sin(a) * 0.139;
      rod(
        t,
        mid,
        [x, 0.203, -0.093 - Math.cos(a) * 0.003],
        [x * 0.44, 0.221, -0.159 + Math.cos(a) * 0.006],
        0.0018,
        0.0017,
        5,
      );
    }
    rod(
      t,
      platen,
      [-0.345, 0.256, -0.171],
      [0.345, 0.256, -0.171],
      0.036,
      0.036,
      28,
    );
    rod(t, mid, [-0.34, 0.268, -0.153], [0.34, 0.268, -0.153], 0.005);
    for (const x of [-0.365, 0.365]) {
      rod(
        t,
        black,
        [x - 0.022, 0.256, -0.172],
        [x + 0.022, 0.256, -0.172],
        0.035,
        0.035,
        22,
      );
      rod(
        t,
        mid,
        [x + Math.sign(x) * 0.022, 0.256, -0.172],
        [x + Math.sign(x) * 0.024, 0.256, -0.172],
        0.016,
        0.016,
        13,
      );
    }
    for (const x of [-0.2, 0.05, 0.19]) {
      box(t, mid, x, 0.293, -0.186, 0.013, 0.017, 0.06, 0.002);
      box(t, black, x, 0.297, -0.165, 0.024, 0.01, 0.024, 0.004);
    }
    rod(t, mid, [-0.35, 0.283, -0.18], [-0.37, 0.32, -0.2], 0.004);
    rod(t, mid, [-0.37, 0.32, -0.2], [-0.398, 0.32, -0.157], 0.004);
    ball(t, black, -0.398, 0.32, -0.157, 0.007, 0.006, 0.014);
    for (const x of [-0.226, 0.221]) {
      box(t, gold, x, 0.208, -0.071, 0.066, 0.019, 0.004, 0.002);
      box(t, platen, x, 0.208, -0.068, 0.053, 0.01, 0.002);
    }
    // A stack of mismatched sketchbooks near the viewer: boards overhang each page block.
    const b = group(r, -1.476, 0, 1.49);
    b.rotation.y = 0.54;
    b.scale.y = 1.083;
    const cloth = [
      "#555644",
      "#9a6849",
      "#34485b",
      "#a56842",
      "#143f4a",
      "#b13e29",
      "#314a5d",
      "#345d54",
      "#213e5d",
      "#666556",
    ];
    let y = 0;
    for (let i = 0; i < 10; i++) {
      const h = [
          0.079, 0.089, 0.093, 0.082, 0.068, 0.05, 0.061, 0.047, 0.059, 0.051,
        ][i],
        w = 0.66 + random() * 0.095,
        d = 0.422 + random() * 0.078;
      const cover = paint(cloth[i], "cloth");
      const book = binding(
        b,
        (random() - 0.5) * 0.081,
        y,
        (random() - 0.5) * 0.061,
        w,
        h,
        d,
        cover,
        (random() - 0.5) * 0.23,
      );
      bodies.push({
        id: "sketchbook-" + (i + 1),
        type: "dynamic",
        object: book,
        collider: "box",
        shape: boxShape([w, h, d], [0, h / 2, 0]),
        density: 330,
        friction: 0.85,
      });
      if (i === 9) {
        box(
          book,
          paint("#dcd7ca"),
          0,
          h + 0.0008,
          0,
          w * 0.976,
          0.004,
          d * 0.972,
          0.003,
        );
        for (let k = 0; k < 10; k++) {
          const z = (k - 4.5) * 0.033,
            x = w * 0.385;
          cord(
            book,
            ink,
            [
              [x - 0.03, h + 0.002, z],
              [x - 0.02, h + 0.012, z],
              [x + 0.005, h + 0.018, z],
              [x + 0.035, h + 0.011, z],
              [x + 0.046, h + 0.002, z],
            ],
            0.0025,
          );
        }
      }
      y += h;
    }
    // Soft canvas carryall below the left trestle, with sewn corners and two handles.
    const bag = group(r, -0.96, 0, 0.218);
    bag.rotation.y = -0.18;
    const tan = paint("#97744d", "cloth"),
      seam = paint("#4c4131", "cloth");
    box(bag, tan, 0, 0.147, 0, 0.31, 0.29, 0.17, 0.02);
    for (const z of [0.084, -0.084]) {
      cord(
        bag,
        seam,
        [
          [-0.121, 0.285, z],
          [-0.113, 0.34, z],
          [-0.085, 0.41, z],
          [0.003, 0.445, z],
          [0.078, 0.409, z],
          [0.106, 0.294, z],
        ],
        0.01,
      );
      cord(
        bag,
        seam,
        [
          [-0.143, 0.28, z],
          [-0.13, 0.18, z],
          [-0.113, 0.024, z],
          [0.112, 0.02, z],
          [0.138, 0.144, z],
          [0.147, 0.273, z],
        ],
        0.0034,
      );
    }
    bodies.push({
      id: "satchel",
      type: "dynamic",
      object: bag,
      collider: "box",
      shape: boxShape([0.31, 0.29, 0.17], [0, 0.147, 0]),
      density: 150,
    });
    return finish(r, { bodies });
  },
};
