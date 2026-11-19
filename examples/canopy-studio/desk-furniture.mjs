import { boxShape, beamShape, compound } from "./colliders.mjs";
import {
  T,
  paint,
  ink,
  group,
  box,
  beam,
  poly,
  mark,
  finish,
} from "./desk-craft.mjs";
export default {
  create({ params, random }) {
    const r = new T.Group(),
      top = paint(params.tableWood ?? "#ba8652", "wood"),
      cut = paint("#84603f", "wood"),
      frame = paint("#503d2b", "wood"),
      side = paint("#986a45", "wood"),
      dark = paint("#453627", "wood"),
      glint = paint("#ce9765", "wood");
    // Long joined top. Its front edge is battered and occasionally chipped.
    const v = [],
      f = [];
    const N = 54;
    for (let j = 0; j <= N; j++) {
      const x = -2.17 + (j * 4.22) / N,
        chip = random(),
        d = 0.067 + (random() - 0.5) * 0.013;
      const dip = chip > 0.82 ? 0.006 + random() * 0.009 : random() * 0.002;
      v.push(
        [x, 0.82, -1.33],
        [x, 0.82 - dip, d],
        [x, 0.747 + dip * 0.17, d],
        [x, 0.747, -1.33],
      );
      if (j) {
        const a = j * 4;
        for (let k = 0; k < 4; k++) {
          const u = a - 4 + k,
            w = a - 4 + ((k + 1) % 4);
          f.push(u, w, a + k, w, a + ((k + 1) % 4), a + k);
        }
      }
    }
    f.push(
      0,
      3,
      1,
      1,
      3,
      2,
      N * 4,
      N * 4 + 1,
      N * 4 + 3,
      N * 4 + 1,
      N * 4 + 2,
      N * 4 + 3,
    );
    poly(r, top, v, f);
    for (let j = 0; j < 40; j++) {
      const x = -2.13 + random() * 4.11,
        y = 0.752 + random() * 0.056,
        w = 0.02 + random() * 0.094;
      mark(
        r,
        j % 5 ? dark : glint,
        [
          [x, y, 0.069],
          [x + w * 0.52, y + random() * 0.004, 0.072],
          [x + w, y - 0.002, 0.07],
        ],
        0.0014 + random() * 0.0019,
      );
    }
    for (const z of [-0.39, -0.89])
      mark(
        r,
        cut,
        [
          [-2.16, 0.8208, z],
          [-1.04, 0.821, z - 0.003],
          [0.13, 0.821, z + 0.003],
          [2.02, 0.8208, z],
        ],
        0.0022,
      );
    box(r, frame, 0, 0.704, -0.015, 4.04, 0.092, 0.077, 0.004);
    box(r, side, 0.05, 0.633, -0.096, 1.26, 0.165, 0.2, 0.005);
    for (const x of [-0.422, 0.208]) {
      box(r, dark, x, 0.643, 0.011, 0.62, 0.157, 0.035, 0.003);
      box(r, side, x, 0.645, 0.032, 0.595, 0.144, 0.012, 0.003);
      box(r, cut, x, 0.676, 0.038, 0.054, 0.008, 0.006, 0.002);
    }
    const solid = compound(
      boxShape([4.22, 0.073, 1.4], [-0.06, 0.7835, -0.631]),
      boxShape([4.04, 0.092, 0.077], [0, 0.704, -0.015]),
      boxShape([1.26, 0.165, 0.2], [0.05, 0.633, -0.096]),
      boxShape([0.88, 0.121, 1.88], [-1.99, 0.7355, 0.32]),
      boxShape([4, 0.1005, 0.34], [0.03, 0.87025, -1.17]),
    );
    // Splayed trestles are real four-sided sections with rails and bolt heads.
    const bolts = paint("#403930", "enamel");
    for (const x of [-0.82, 1.22]) {
      box(r, frame, x, 0.715, -0.52, 0.19, 0.097, 1.13, 0.006);
      for (const z of [-0.91, -0.04]) {
        const sign = z > -0.4 ? 1 : -1;
        for (const flip of [-1, 1]) {
          const b = [x + flip * 0.193, 0.005, z + sign * 0.037],
            t = [x + flip * 0.015, 0.745, z];
          solid.add(beamShape(b, t, 0.063, 0.081));
          beam(r, flip < 0 ? frame : cut, b, t, 0.063, 0.081);
          beam(
            r,
            dark,
            [b[0] - 0.016, 0.008, b[2] + 0.042],
            [t[0] - 0.016, 0.732, t[2] + 0.042],
            0.009,
            0.003,
          );
        }
        box(r, side, x, 0.24, z, 0.253, 0.045, 0.051);
        box(r, bolts, x, 0.696, z + 0.042, 0.021, 0.019, 0.007, 0.002);
      }
      for (const dx of [-0.103, 0.103])
        box(r, frame, x + dx, 0.32, -0.48, 0.049, 0.048, 0.96, 0.003);
    }
    box(
      r,
      paint("#805a3e", "wing"),
      -1.99,
      0.675,
      0.28,
      0.87,
      0.105,
      1.91,
      0.009,
    );
    box(
      r,
      paint("#b18152", "wing"),
      -1.99,
      0.76,
      0.32,
      0.88,
      0.072,
      1.88,
      0.008,
    );
    for (const z of [-0.48, 1.13]) {
      for (const x of [-2.31, -1.66])
        solid.add(boxShape([0.09, 0.73, 0.1], [x, 0.365, z]));
      box(r, frame, -2.31, 0.365, z, 0.09, 0.73, 0.1, 0.006);
      box(r, frame, -1.66, 0.365, z, 0.09, 0.73, 0.1, 0.006);
    }
    // Back riser for the jars and vials.
    box(r, cut, 0.03, 0.863, -1.17, 3.98, 0.086, 0.32, 0.004);
    box(r, top, 0.03, 0.912, -1.17, 4, 0.017, 0.34, 0.004);
    return finish(r, {
      bodies: [
        {
          id: "oak-desk",
          type: "static",
          object: r,
          shape: solid,
          collider: "box",
          friction: 0.8,
        },
      ],
    });
  },
};
