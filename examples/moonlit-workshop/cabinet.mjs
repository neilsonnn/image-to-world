import { defaults } from "./defaults.mjs";
import {
  T,
  group,
  box,
  cylinder,
  ellipse,
  wood,
  lit,
  paint,
  rod,
  finish,
  books,
  book,
  panel,
  cord,
  tau,
} from "./craft.mjs";
export default {
  create({ params, random }) {
    params = { ...defaults.cabinet, ...params };
    const root = new T.Group(),
      main = wood("#704431", "#bd8252", "y"),
      oak = wood("#99613c", "#deb078", "y", params.grain),
      slab = wood("#72513e", "#b98858", "x"),
      edge = paint("#594534"),
      brass = paint("#e2a454", 0.35, 0.56),
      iron = paint("#443c36", 0.46, 0.48);
    box(root, main, 0.4, 0.86, -0.08, 2.83, 1.68, 0.59, 0.025);
    for (let i = 0; i < 4; i++) {
      const x = -0.65 + i * 0.699;
      box(root, oak, x, 0.89, 0.241, 0.682, 1.5, 0.075, 0.017);
      box(root, main, x, 0.2, 0.286, 0.59, 0.027, 0.016);
      // An inset field and slender applied stile give each door a readable edge.
      const pane = box(root, oak, x, 1.05, 0.283, 0.553, 0.92, 0.017, 0.015);
      for (const dx of [-0.285, 0.285])
        box(root, main, x + dx, 1.05, 0.289, 0.013, 0.96, 0.011);
      for (const y of [0.566, 1.534])
        box(root, main, x, y, 0.289, 0.58, 0.013, 0.012);
      const hx = x + (i % 2 === 0 ? 0.24 : -0.24);
      box(root, iron, hx, 0.91, 0.286, 0.027, 0.108, 0.022, 0.006);
      rod(root, brass, [hx, 0.87, 0.314], [hx, 0.95, 0.314], 0.009);
    }
    box(root, slab, 0.4, 1.72, -0.05, 2.92, 0.095, 0.68, 0.017);
    box(root, slab, 0.4, 0.098, -0.03, 2.9, 0.11, 0.71, 0.015);
    const sx = -1.55;
    for (const x of [sx - 0.48, sx + 0.48])
      box(root, main, x, 0.73, -0.02, 0.073, 1.42, 0.56, 0.01);
    for (const h of [0.09, 0.54, 0.97, 1.4])
      box(root, slab, sx, h, 0, 1.04, 0.064, 0.63, 0.008);
    const covers = [
      "#344d5d",
      "#986744",
      "#6b3c34",
      "#515e66",
      "#bc9362",
      "#58736f",
    ].map((c) => paint(c));
    const pages = paint("#d1b997");
    for (const [shelf, count] of [
      [0.125, 7],
      [0.575, 9],
      [1.005, 4],
    ]) {
      let x = sx - 0.4;
      for (let i = 0; i < count; i++) {
        const thick = 0.052 + random() * 0.035,
          h = 0.23 + random() * 0.1;
        const b = book(
          root,
          covers[i % 6],
          pages,
          x + thick / 2,
          shelf + h / 2,
          0.08,
          h,
          thick,
          0.29,
          -1.57 + (i === count - 1 ? 0.22 : 0),
        );
        x += thick + 0.012;
      }
    }
    books(root, sx + 0.23, 1.441, 0.015, random, 3);
    const bookband = paint("#b5a57f");
    for (let i = 0; i < 8; i++) {
      const z = 0.253,
        xx = sx - 0.38 + i * 0.088;
      for (const h of [0.245, 0.266])
        box(root, bookband, xx, h, z, 0.035, 0.007, 0.004);
    }
    // Fine evidence of joinery: irregular checks, carved ports and exposed pegs.
    const carved = paint("#926c4c");
    for (const [x, y, m] of [
      [-0.46, 1.23, 1],
      [0.87, 0.36, -1],
      [1.39, 1.39, 1],
      [-0.13, 1.12, -1],
    ]) {
      cord(
        root,
        carved,
        [
          [x, y, 0.294],
          [x + 0.007 * m, y + 0.055, 0.294],
          [x + 0.005 * m, y + 0.092, 0.294],
          [x + 0.014 * m, y + 0.15, 0.294],
        ],
        0.0024,
      );
    }
    for (let i = 0; i < 4; i++)
      for (const y of [0.24, 1.47]) {
        const x = -0.65 + i * 0.699;
        ellipse(root, slab, x - 0.235, y, 0.299, 0.014, 0.014, 0.004);
      }

    // Mantel clock with hand-built hands, chapter markers and winding key.
    const clock = group(root, -0.73, 1.77, 0.02),
      dark = paint("#35444a"),
      enamel = paint("#e2ceaa");
    box(clock, dark, 0, 0.109, 0, 0.326, 0.218, 0.142, 0.022);
    const face = cylinder(
      clock,
      enamel,
      0,
      0.119,
      0.074,
      0.085,
      0.085,
      0.013,
      32,
    );
    face.rotation.x = Math.PI / 2;
    for (let i = 0; i < 12; i++) {
      const a = (tau * i) / 12;
      const tick = box(
        clock,
        iron,
        Math.sin(a) * 0.068,
        0.119 + Math.cos(a) * 0.068,
        0.084,
        0.006,
        0.014,
        0.006,
      );
      tick.rotation.z = -a;
    }
    rod(clock, iron, [0, 0.119, 0.086], [-0.045, 0.14, 0.088], 0.005);
    rod(clock, iron, [0, 0.119, 0.088], [0.016, 0.174, 0.09], 0.004);
    // A miniature marquetry landscape: dark mountains, a rising moon and hand-cut inlays.
    const art = group(root, 0.55, 1.775, 0.08);
    art.rotation.x = -0.09;
    box(art, edge, 0, 0.252, 0, 0.75, 0.5, 0.052, 0.017);
    box(art, brass, 0, 0.254, 0.031, 0.68, 0.438, 0.018);
    box(art, paint("#597684"), 0, 0.255, 0.044, 0.653, 0.412, 0.016);
    const sun = cylinder(
      art,
      paint("#e4bd72"),
      0.138,
      0.331,
      0.059,
      0.067,
      0.067,
      0.011,
      32,
    );
    sun.rotation.x = Math.PI / 2;
    for (const [y, peaks, mat] of [
      [
        0.17,
        [
          [0, 0.1],
          [0.12, 0.18],
          [0.23, 0.08],
          [0.39, 0.23],
          [0.56, 0.09],
          [0.62, 0.11],
        ],
        "#6a7e83",
      ],
      [
        0.094,
        [
          [0, 0.07],
          [0.11, 0.15],
          [0.2, 0.12],
          [0.33, 0.17],
          [0.4, 0.07],
          [0.53, 0.15],
          [0.62, 0.09],
        ],
        "#404e5b",
      ],
      [
        0.06,
        [
          [0, 0.07],
          [0.12, 0.09],
          [0.25, 0.04],
          [0.33, 0.09],
          [0.53, 0.06],
          [0.62, 0.08],
        ],
        "#293e46",
      ],
    ]) {
      panel(
        art,
        paint(mat),
        [[0, 0], ...peaks, [0.62, 0]],
        0.008,
        -0.31,
        y,
        0.064 + (0.18 - y) * 0.13,
      );
    }
    books(root, 1.4, 1.77, 0.02, random, 4);
    // A rangefinder on the top shelf, with a brass lens barrel and twin windows.
    const camera = group(root, -1.81, 1.435, 0.09);
    camera.rotation.y = -0.13;
    const leather = paint("#4b443b"),
      offblack = paint("#283e44", 0.38, 0.4);
    box(camera, leather, 0, 0.079, 0, 0.221, 0.147, 0.104, 0.016);
    box(camera, brass, 0, 0.15, 0, 0.218, 0.018, 0.106, 0.003);
    for (const [r, d, z, mat] of [
      [0.053, 0.031, 0.06, brass],
      [0.043, 0.025, 0.084, offblack],
      [0.026, 0.008, 0.101, steelColor()],
    ]) {
      const lens = cylinder(camera, mat, -0.019, 0.078, z, r, r, d, 28);
      lens.rotation.x = Math.PI / 2;
    }
    function steelColor() {
      return paint("#426370", 0.22, 0.51);
    }
    box(camera, enamel, 0.06, 0.125, 0.056, 0.04, 0.018, 0.012);
    cylinder(camera, brass, 0.062, 0.169, 0, 0.014, 0.014, 0.016);
    // Upper loft archive box with corner guards, label holder, and ribbed lid.
    const archive = group(root, 1.52, 3.21, -0.2);
    archive.rotation.y = -0.1;
    const blue = wood("#37485e", "#6e8194", "x");
    box(archive, blue, 0, 0.216, 0, 0.81, 0.43, 0.55, 0.018);
    box(archive, blue, 0, 0.45, 0, 0.85, 0.06, 0.59, 0.012);
    for (const x of [-0.374, 0.374])
      box(archive, iron, x, 0.217, 0.28, 0.04, 0.39, 0.012);
    box(archive, brass, 0, 0.24, 0.288, 0.158, 0.063, 0.014, 0.005);
    box(archive, enamel, 0, 0.242, 0.3, 0.108, 0.031, 0.01);
    return finish(root);
  },
};
