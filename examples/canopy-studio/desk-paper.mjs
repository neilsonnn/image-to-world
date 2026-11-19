import { boxShape } from "./colliders.mjs";
import {
  T,
  paint,
  ink,
  group,
  box,
  poly,
  mark,
  cyl,
  rod,
  lathe,
  binding,
  finish,
} from "./desk-craft.mjs";
const paper = paint("#fcf7ed", "sheet"),
  pageEdge = paint("#bfaa8b"),
  line = paint("#765c40"),
  cream = paint("#ede6d7"),
  blue = paint("#41607b"),
  cover = paint("#394746", "cloth");
function pagePoint(s, t, side, zeta, n) {
  const lifted = Math.sin(s * Math.PI) * (0.076 + side * 0.017) + 0.016 * s;
  const high = lifted * zeta + Math.sin(Math.PI * 0.87 * s) * 0.012;
  const x =
    side *
    s *
    (0.393 + side * 0.017) *
    (1 - 0.027 * Math.sin(Math.PI * s) * zeta);
  const y =
    0.009 +
    0.039 * zeta +
    high +
    (0.032 - 0.055 * t) * Math.sin(Math.PI * s) * zeta +
    0.013 * (1 - t) * (1 - Math.cos(s * Math.PI));
  const z =
    (t - 0.5) * 0.49 -
    0.035 * Math.sin(s * Math.PI) * zeta +
    0.003 * Math.sin(n * 0.77 + s * 4) * (t - 0.5);
  return [x, y, z];
}
function surface(r, m, point, n, msteps, s0 = 0, s1 = 1, t0 = 0, t1 = 1) {
  const v = [],
    f = [];
  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= msteps; j++) {
      v.push(point(s0 + ((s1 - s0) * i) / n, t0 + ((t1 - t0) * j) / msteps));
      if (i && j) {
        const q = i * (msteps + 1) + j,
          k = q - msteps - 1;
        f.push(k - 1, k, q, k - 1, q, q - 1);
      }
    }
  return poly(r, m, v, f);
}
export default {
  create({ params, random }) {
    const r = new T.Group();
    // The drawing sheets have slightly lifted, irregular corners and separate cut edges.
    const sheets = group(r, -0.01, 0.913, -0.48);
    sheets.rotation.x = params.boardTilt ?? 0.143;
    box(
      sheets,
      paint("#ae8059", "wood"),
      0,
      -0.009,
      0,
      1.584,
      0.016,
      1.224,
      0.003,
    );
    for (const x of [-0.68, 0.68])
      box(
        r,
        paint("#856449", "wood"),
        x,
        0.902,
        -1.046,
        0.07,
        0.16,
        0.06,
        0.002,
      );
    for (let j = 0; j < 4; j++) {
      const g = group(
        sheets,
        (random() - 0.5) * 0.047,
        j * 0.0025,
        (random() - 0.5) * 0.055,
      );
      g.rotation.y = [-0.032, 0.012, -0.022, 0.021][j];
      const w = 0.84 - j * 0.008,
        d = 0.657 - j * 0.016;
      const fn = (s, t) => [
        (s - 0.5) * w * 2,
        0.002 +
          Math.pow(t, 4) * (0.011 * Math.sin(s * 9 + j) - 0.008) +
          Math.pow(1 - s, 7) * 0.025 * Math.sin(4 * t + j),
        (t - 0.5) * d * 2,
      ];
      surface(g, j === 3 ? paper : cream, fn, 12, 8);
      for (const k of [0, 1])
        mark(
          g,
          j % 2 ? line : pageEdge,
          Array.from({ length: 12 }, (_, i) => fn(i / 11, k)),
          0.0019,
        );
      for (const k of [0, 1])
        mark(
          g,
          j % 2 ? line : pageEdge,
          Array.from({ length: 7 }, (_, i) => fn(k, i / 6)),
          0.0015,
        );
    }
    // A small curled strip exposes the dark hollow and spiral at its near end.
    const tube = group(sheets, -0.749, 0.043, 0.383);
    tube.rotation.x = Math.PI * 0.5;
    tube.rotation.z = 0.11;
    lathe(
      tube,
      cream,
      0,
      0,
      0,
      [
        [0.028, -0.119],
        [0.037, -0.119],
        [0.039, -0.113],
        [0.039, 0.117],
        [0.031, 0.117],
        [0.028, 0.113],
        [0.029, -0.119],
      ],
      30,
    );
    cyl(tube, paint("#827c66"), 0, 0.099, 0, 0.028, 0.028, 0.002, 20);
    mark(
      tube,
      line,
      [
        [0.008, 0.118, 0.03],
        [0.023, 0.118, 0.023],
        [0.032, 0.118, 0.008],
        [0.03, 0.118, -0.014],
        [0.014, 0.118, -0.022],
      ],
      0.0017,
    );
    // Real signatures of a thick printed folio; the upper leaves fan above their neighbours.
    const b = group(r, 1.438, 0.823, -0.176);
    b.rotation.y = params.folioYaw ?? -0.09;
    box(b, cover, 0, 0.011, 0, 0.86, 0.022, 0.524, 0.007);
    for (const side of [-1, 1]) {
      const N = 7;
      for (let n = 0; n <= N; n++) {
        const fn = (s, t) => pagePoint(s, t, side, (n + 1) / (N + 1), n);
        surface(
          b,
          n === N ? cream : paint(n % 3 ? "#d4c6ac" : "#eee0c5"),
          fn,
          15,
          6,
        );
        mark(
          b,
          n % 4 === 3 ? line : pageEdge,
          Array.from({ length: 18 }, (_, k) => fn(k / 17, 1)),
          n % 3 === 0 ? 0.0024 : 0.0015,
        );
        if (n % 2 === 0)
          mark(
            b,
            line,
            Array.from({ length: 8 }, (_, k) => fn(1, k / 7)),
            0.0017,
          );
      }
      const fn = (s, t) => {
        const p = pagePoint(s, t, side, 1, N);
        p[1] += 0.0017;
        return p;
      };
      if (side === -1) {
        surface(b, blue, fn, 16, 6, 0.115, 0.856, 0.09, 0.759);
        for (const tt of [0.827, 0.868])
          mark(
            b,
            pageEdge,
            Array.from({ length: 14 }, (_, k) => fn(0.133 + k * 0.054, tt)),
            0.0011,
          );
      } else {
        for (let i = 0; i < 10; i++) {
          const t = 0.12 + 0.077 * i,
            len = 0.57 + random() * 0.14;
          mark(
            b,
            i % 4 === 0 ? pageEdge : paint("#c3b59e"),
            Array.from({ length: 16 }, (_, k) => fn(0.114 + (k / 15) * len, t)),
            0.0015,
          );
        }
        surface(b, paint("#c3ccc9"), fn, 12, 4, 0.13, 0.61, 0.09, 0.267);
      }
    }
    // A paint pan rests across the red sketchbook on the other side.
    const stack = group(r, -1.41, 0.822, -0.226);
    binding(
      stack,
      -0.013,
      0.003,
      0.006,
      0.47,
      0.03,
      0.35,
      paint("#314a56"),
      0.045,
    );
    binding(
      stack,
      0.012,
      0.032,
      -0.009,
      0.455,
      0.032,
      0.351,
      paint("#a5482d", "cloth"),
      -0.1,
    );
    lathe(stack, paint("#886349", "enamel"), 0.049, 0.067, -0.035, [
      [0, 0],
      [0.084, 0],
      [0.096, 0.016],
      [0.105, 0.049],
      [0.103, 0.06],
      [0.097, 0.061],
      [0.095, 0.049],
      [0.084, 0.023],
      [0, 0.016],
    ]);
    lathe(stack, paint("#b29268"), 0.051, 0.067, -0.035, [
      [0, 0.023],
      [0.078, 0.023],
      [0.09, 0.038],
    ]);
    // Narrow rectangular erasers, a loose envelope and two used sanguine pencils.
    const card = group(r, -1.139, 0.824, -0.033);
    card.rotation.y = 0.19;
    box(card, pageEdge, 0, 0.0032, 0, 0.208, 0.006, 0.132, 0.003);
    box(card, cream, 0, 0.0072, 0, 0.2, 0.003, 0.127);
    box(card, blue, 0.018, 0.009, 0.007, 0.107, 0.001, 0.043);
    for (const [x, z] of [
      [-1.45, -0.012],
      [-1.28, 0.016],
      [0.954, -0.215],
      [0.996, -0.195],
    ]) {
      if (x < 0) {
        const er = box(r, cream, x, 0.835, z, 0.081, 0.021, 0.043, 0.005);
        er.rotation.y = -0.21;
      } else {
        rod(
          r,
          paint("#b9793f"),
          [x, 0.829, z],
          [x - 0.069, 0.83, z - 0.226],
          0.0068,
          0.0062,
        );
        rod(
          r,
          line,
          [x - 0.07, 0.83, z - 0.226],
          [x - 0.074, 0.83, z - 0.24],
          0.006,
          0.0006,
        );
      }
    }
    return finish(r, {
      bodies: [
        {
          id: "drafting-board",
          type: "static",
          object: sheets,
          collider: "box",
          shape: boxShape([1.584, 0.027, 1.224], [0, -0.003, 0]),
        },
        {
          id: "folio",
          type: "dynamic",
          object: b,
          collider: "box",
          shape: boxShape([0.86, 0.082, 0.524], [0, 0.041, 0]),
          density: 115,
          friction: 0.83,
        },
        {
          id: "paint-pan-and-studies",
          type: "dynamic",
          object: stack,
          collider: "box",
          shape: boxShape([0.47, 0.065, 0.35], [0, 0.0325, 0]),
          density: 240,
        },
        {
          id: "envelope",
          type: "dynamic",
          object: card,
          collider: "box",
          shape: boxShape([0.208, 0.009, 0.132], [0, 0.0045, 0]),
          density: 190,
        },
      ],
    });
  },
};
