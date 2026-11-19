import { defaults } from "./defaults.mjs";
import { Fn, smoothstep, vec3 } from "three/tsl";
import {
  T,
  box,
  group,
  wood,
  weave,
  paint,
  lit,
  finish,
  panel,
  ellipse,
  rod,
  object,
  tau,
} from "./craft.mjs";

export default {
  create({ params, random }) {
    params = { ...defaults.room, ...params };
    const root = new T.Group();
    const beam = wood("#202c35", "#384446", "y"),
      end = wood("#253239", "#4e5149", "x");
    const barn = [
      ["#734b3c", "#c78a58"],
      ["#915736", "#d49b66"],
      ["#76513d", "#bb8355"],
      ["#704737", "#b47951"],
    ].map(([a, b]) => wood(a, b, "y", params.grain));
    const roof = [
      wood("#654b42", "#a67a5a", "x"),
      wood("#7c5949", "#c08a64", "x"),
    ];
    const rim = paint("#37372f"),
      sill = wood("#524735", "#ad8454", "z"),
      steel = paint("#4e5c66", 0.65, 0.38);
    const floor = [
      ["#46574b", "#828565"],
      ["#536353", "#929478"],
      ["#4d5a4e", "#89876b"],
    ].map(([a, b]) => wood(a, b, "z"));
    const blue = wood("#344759", "#62717b", "y"),
      screen = lit("#b7d1e1"),
      second = lit("#8ca8c7"),
      night = lit("#334867"),
      moon = lit("#fff1bf");
    // Plank floor and the sunken, green-edged rush mats underfoot.
    box(root, rim, 0, -0.105, -0.28, 5.55, 0.18, 7.26);
    for (let i = 0; i < 21; i++)
      box(
        root,
        floor[i % 3],
        -2.7 + i * 0.27,
        -0.021,
        -0.28,
        0.263,
        0.08,
        7.25,
      );
    const tatami = weave("#70846c", "#a5aa83"),
      border = paint("#3d5d57");
    for (const [x, z, w, d] of [
      [-1.35, 1.1, 2.56, 1.22],
      [0.78, 1.25, 1.61, 1.52],
      [1.89, 0.18, 1.47, 0.47],
      [-0.02, -0.14, 2.64, 0.92],
    ]) {
      box(root, border, x, 0.018, z, w, 0.024, d);
      box(root, tatami, x, 0.033, z, w - 0.06, 0.016, d - 0.05);
    }
    // Back wall, roof over the sleeping alcove, and the high rafters above it.
    box(root, rim, 0, 1.96, -2.86, 5.45, 4.06, 0.14);
    for (let i = 0; i < 24; i++)
      box(
        root,
        barn[i % 4],
        -2.59 + i * 0.225,
        1.97,
        -2.765,
        0.22,
        4.02,
        0.085,
      );
    function roofHeight(x) {
      return x < 0.42 ? 1.86 + (x + 2.68) * 0.475 : 3.33;
    }
    for (let i = 0; i < 23; i++) {
      const x = -2.65 + i * 0.238;
      const r = box(
        root,
        roof[i % 2],
        x,
        roofHeight(x),
        -1.6,
        i < 13 ? 0.273 : 0.233,
        0.065,
        2.36,
      );
      if (i < 13) r.rotation.z = Math.atan(0.475);
    }
    for (const z of [-2.72, -0.48]) {
      const diag = box(root, end, -1.13, 2.576, z, 3.47, 0.13, 0.14);
      diag.rotation.z = Math.atan(0.475);
      box(root, end, 1.55, 3.31, z, 2.23, 0.16, 0.17);
    }
    for (const x of [0.4, 1.28, 2.4])
      box(root, end, x, 3.26, -1.58, 0.13, 0.17, 2.28);
    // Entry lintel and loft joists are discrete beams with pegged joinery.
    for (const x of [-2.38, 2.36]) {
      box(root, beam, x, 1.96, 0.8, 0.18, 3.94, 0.2);
      box(root, beam, x, 1.8, -0.46, 0.115, 3.6, 0.14);
      box(root, end, x, 0.16, 0.8, 0.22, 0.2, 0.23);
      for (const y of [2.93, 3.41]) {
        const peg = rod(
          root,
          steel,
          [x - 0.06, y, 0.888],
          [x - 0.06, y, 0.913],
          0.023,
        );
        peg.castShadow = false;
      }
    }
    box(root, end, 0, 3.43, 0.78, 4.91, 0.18, 0.23);
    box(root, end, 0, 3.06, -0.43, 4.9, 0.25, 0.18);
    const upper = wood("#24353a", "#52605b", "z");
    for (let i = 0; i < 21; i++)
      box(root, upper, -2.7 + i * 0.27, 3.94, -0.2, 0.262, 0.1, 6.8);
    for (const z of [-2.65, -1.22, 0.2, 1.67, 3.11])
      box(root, end, 0, 3.82, z, 5.48, 0.15, 0.13);
    for (const x of [-2.47, -1.55, -0.43, 0.75, 2.32])
      box(root, end, x, 3.74, -0.34, 0.11, 0.12, 6.87);
    for (const x of [-2.68, 2.67]) {
      const side = x < 0 ? -1 : 1;
      for (let i = 0; i < 12; i++) {
        const z = -2.68 + i * 0.255;
        box(root, barn[i % 4], x, 1.83, z, 0.11, 3.72, 0.251);
      }
      const wX = x - side * 0.09;
      box(root, sill, wX, 0.79, 0.72, 0.18, 0.1, 1.62);
      box(root, blue, x, 0.37, 0.71, 0.105, 0.73, 1.6);
      box(root, blue, x, 1.81, 2.75, 0.12, 3.7, 1.47);
      if (x > 0) continue; // The folding shoji fills the opening on this side.
      // Side windows have real openings, sills, corner stiles and individual panes.
      const zs = x < 0 ? [0.03, 1.6] : [0.1, 1.84];
      box(
        root,
        night,
        x + side * 0.16,
        1.96,
        (zs[0] + zs[1]) / 2,
        0.04,
        2.32,
        zs[1] - zs[0] + 0.05,
      );
      for (let iz = 0; iz < 4; iz++) {
        const z = zs[0] + ((iz + 0.5) * (zs[1] - zs[0])) / 4;
        for (let iy = 0; iy < 6; iy++) {
          const m = iz === 0 ? second : night;
          box(
            root,
            m,
            x + side * 0.085,
            1.0 + iy * 0.366,
            z,
            0.025,
            0.351,
            (zs[1] - zs[0]) / 4 - 0.025,
          );
        }
        box(root, sill, wX, 1.94, z + (zs[1] - zs[0]) / 8, 0.06, 2.31, 0.028);
      }
      for (let i = 0; i < 7; i++)
        box(
          root,
          sill,
          wX,
          0.81 + i * 0.366,
          (zs[0] + zs[1]) / 2,
          0.085,
          0.033,
          zs[1] - zs[0] + 0.08,
        );
      for (const z of zs)
        box(root, beam, x - side * 0.015, 1.8, z, 0.18, 3.6, 0.12);
    }
    // A carved crescent hangs just inside the left window.
    const crescent = new T.Shape();
    crescent.absarc(0, 0, 0.104, 0.48, 5.56, false);
    crescent.absarc(0.064, 0.025, 0.083, 4.71, 1.6, true);
    const c = object(
      root,
      new T.ExtrudeGeometry(crescent, {
        depth: 0.008,
        bevelEnabled: false,
        curveSegments: 24,
      }),
      moon,
      -2.53,
      2.03,
      1.38,
    );
    c.rotation.y = Math.PI / 2;
    // The blue return wall and a shoji screen folded across the doorway.
    box(root, blue, 2.54, 1.58, 0.9, 0.22, 3.27, 0.75);
    const sliding = group(root, 2.25, 0, 1.52);
    sliding.rotation.y = -0.25;
    box(sliding, rim, 0.58, 1.67, 0.0, 1.2, 3.38, 0.1);
    for (let iy = 0; iy < 9; iy++)
      for (let ix = 0; ix < 3; ix++) {
        box(
          sliding,
          (ix + iy) % 5 === 0 ? second : screen,
          0.036 + (ix + 0.5) * 0.372,
          0.064 + (iy + 0.5) * 0.358,
          0.072,
          0.361,
          0.35,
          0.036,
        );
      }
    for (let ix = 0; ix < 4; ix++)
      box(sliding, sill, 0.036 + ix * 0.372, 1.67, 0.102, 0.027, 3.3, 0.033);
    for (let iy = 0; iy < 10; iy++)
      box(sliding, sill, 0.596, 0.064 + iy * 0.358, 0.102, 1.13, 0.019, 0.035);
    box(root, upper, 1.4, 3.195, -1.65, 1.76, 0.085, 2.18);
    // An oversized barn beam and a short line of visible tenons at the loft lip.
    for (let i = 0; i < 9; i++)
      box(root, end, -2.18 + i * 0.54, 3.14, -0.42, 0.13, 0.105, 0.29);
    // An astronomical chart has punched-metal stars, a fine ruled border and
    // connecting threads. Its paper and pins stand slightly proud of the panel.
    const chart = group(root, 2.56, 1.89, -0.77);
    chart.rotation.y = -Math.PI / 2;
    const paper = paint("#aebdc2"),
      constellation = paint("#536d78"),
      stars = paint("#e4dbb9"),
      pins = paint("#b19c69", 0.44, 0.5);
    box(
      chart,
      wood("#555044", "#7e745b", "x"),
      0,
      0,
      -0.012,
      0.75,
      1.12,
      0.035,
      0.01,
    );
    box(chart, paper, 0, 0, 0.013, 0.69, 1.065, 0.024);
    for (const x of [-0.3, 0.3])
      box(chart, constellation, x, 0, 0.029, 0.003, 0.95, 0.002);
    for (const y of [-0.475, 0.475])
      box(chart, constellation, 0, y, 0.029, 0.606, 0.003, 0.002);
    const pts = [
      [-0.21, 0.1],
      [-0.11, 0.205],
      [-0.03, 0.151],
      [0.101, 0.248],
      [0.225, 0.12],
      [0.19, 0.037],
      [0.07, 0.002],
      [-0.09, -0.15],
      [-0.205, -0.12],
    ];
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = pts[i];
      ellipse(chart, stars, x, y, 0.035, 0.013, 0.013, 0.004);
      if (i)
        rod(
          chart,
          constellation,
          [pts[i - 1][0], pts[i - 1][1], 0.033],
          [x, y, 0.033],
          0.0025,
        );
    }
    for (let i = 0; i < 36; i++) {
      const x = random() * 0.52 - 0.26,
        y = random() * 0.65 - 0.29;
      ellipse(chart, stars, x, y, 0.031, 0.004, 0.004, 0.003, 7);
    }
    for (let i = 0; i < 3; i++)
      box(
        chart,
        constellation,
        -0.07,
        -0.33 - i * 0.039,
        0.031,
        0.36 - i * 0.049,
        0.007,
        0.004,
      );
    for (const x of [-0.28, 0.28])
      ellipse(chart, pins, x, 0.46, 0.03, 0.014, 0.012, 0.009);
    // A raking, shadow-casting wash through the window provides the main warm
    // light. Cool, broad illumination from the open doorway fills the shadows.
    const sun = new T.SpotLight("#ffcb93", params.lantern, 10, 0.65, 0.45, 2);
    sun.position.set(1.93, 2.53, 1.4);
    sun.target.position.set(-0.98, 0.79, -1.85);
    // Procedural mullion shadows travel with the lamp projection and wrap across
    // the bed, boards and carpentry instead of painting light onto their materials.
    sun.colorNode = Fn(([uv]) => {
      const x = uv.x.sub(0.52),
        y = uv.y.sub(0.48);
      const sx = x.add(y.mul(0.23)),
        sy = y.sub(x.mul(0.23));
      const aperture = smoothstep(0.3, 0.34, sx.abs())
        .oneMinus()
        .mul(smoothstep(0.28, 0.32, sy.abs()).oneMinus());
      const mullion = smoothstep(0.005, 0.015, sx.add(0.069).abs()).mul(
        smoothstep(0.006, 0.018, sy.sub(0.065).abs()),
      );
      const transmission = aperture.mul(mullion).mul(0.87).add(0.13);
      return vec3(transmission);
    });
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.014;
    root.add(sun, sun.target);
    const moonlight = new T.PointLight("#b0ccff", params.moonlight, 8.8, 2);
    moonlight.position.set(-0.85, 2.25, 2.33);
    root.add(moonlight);
    const bounce = new T.PointLight("#ffc08b", 2.4, 5.8, 2);
    bounce.position.set(-1.15, 1.82, -1.08);
    root.add(bounce);
    const warmReturn = new T.PointLight("#ffd6a0", 1.5, 4.6, 2);
    warmReturn.position.set(1.61, 1.74, -1.04);
    root.add(warmReturn);
    return finish(root);
  },
};
