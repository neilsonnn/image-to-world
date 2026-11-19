import { boxShape, compound } from "./colliders.mjs";
import { defineSceneModule } from "image-to-world/runtime";
import {
  T,
  Pigment,
  inkMaterial,
  random,
  lerp,
  wall,
  line,
  shot,
} from "./room-surface.mjs";

export default defineSceneModule({
  create({ params }) {
    const root = new T.Group(),
      body = new Pigment(),
      pen = new Pigment(),
      r = random(77561);
    const spread = (a, b) => lerp(a, b, r());
    const tint = (h, f) => new T.Color(h).multiplyScalar(f);
    const mean = (ps) =>
      ps.reduce(
        (a, p) => [a[0] + p[0] / ps.length, a[1] + p[1] / ps.length],
        [0, 0],
      );
    function half(poly, nx, ny, cut) {
      const out = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i],
          b = poly[(i + 1) % poly.length],
          da = a[0] * nx + a[1] * ny - cut,
          db = b[0] * nx + b[1] * ny - cut;
        if (da <= 0) out.push(a);
        if (da < 0 !== db < 0) {
          const f = da / (da - db);
          out.push([lerp(a[0], b[0], f), lerp(a[1], b[1], f)]);
        }
      }
      return out;
    }
    function chips(poly, center, xyz, base, fg) {
      const boundary = [],
        cx = center[0],
        cy = center[1];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i],
          b = poly[(i + 1) % poly.length],
          len = Math.hypot(a[0] - b[0], a[1] - b[1]),
          n = Math.max(1, Math.ceil(len / 0.13));
        for (let j = 0; j < n; j++) {
          const t = j / n,
            x = lerp(a[0], b[0], t),
            y = lerp(a[1], b[1], t);
          // Common crease coordinates keep adjacent stone edges seated in the mortar.
          const wav =
            j === 0
              ? 0
              : 0.02 * Math.sin(x * 23 + y * 17) * Math.sin(Math.PI * t);
          boundary.push([x + wav, y + 0.6 * wav]);
        }
      }
      const recess = fg ? 0.03 : 0.024;
      const edge = boundary.map((p) =>
        xyz(lerp(p[0], cx, 0.012), lerp(p[1], cy, 0.012), 0),
      );
      const inner = boundary.map((p, i) => {
        const n = spread(0.035, fg ? 0.19 : 0.105);
        return xyz(
          lerp(p[0], cx, n),
          lerp(p[1], cy, n),
          recess + spread(-0.009, 0.007),
        );
      });
      const core = xyz(
        cx + spread(-0.024, 0.024),
        cy + spread(-0.019, 0.019),
        recess + 0.008,
      );
      const shade = (a) =>
        fg
          ? Math.min(
              1.14,
              Math.max(0.67, 0.93 - 0.2 * (a[0] - 1.5) + 0.15 * (a[1] - 0.55)),
            )
          : 1;
      for (let i = 0; i < boundary.length; i++) {
        const j = (i + 1) % boundary.length,
          p = boundary[i],
          q = boundary[j];
        let side =
          Math.abs(q[0] - p[0]) * 0.03 + (p[1] - cy) * 0.3 - (p[0] - cx) * 0.29;
        side = Math.max(
          0.4,
          Math.min(1.3, 0.72 + side + spread(-0.085, 0.065)),
        );
        body.quad(
          edge[i],
          edge[j],
          inner[j],
          inner[i],
          tint(base, side * shade(p)),
        );
        body.tri(
          inner[i],
          inner[j],
          core,
          tint(base, shade(p) * spread(0.94, 1.04)),
          tint(base, shade(q)),
          tint(base, shade(center)),
        );
        if (r() < 0.65)
          line(pen, [edge[i], edge[j]], spread(0.0014, 0.006), "#252d26");
      }
      const fissures = fg
        ? Math.round(spread(4, 10))
        : Math.round(spread(2, 6));
      for (let j = 0; j < fissures; j++) {
        const n = Math.floor(r() * inner.length),
          p = inner[n],
          k = spread(0.16, 0.87);
        const pt = new T.Vector3(...core)
          .lerp(new T.Vector3(...p), k)
          .toArray();
        pt[2] += 0.012;
        const run = spread(0.025, 0.113),
          dir = r() < 0.6 ? -1 : 1;
        const path = [
          pt,
          [pt[0] + dir * run * 0.32, pt[1] - 0.018, pt[2]],
          [pt[0] + dir * run * 0.43, pt[1] - 0.043, pt[2]],
          [pt[0] + dir * run * 0.94, pt[1] - spread(0.073, 0.12), pt[2]],
        ];
        if (r() < 0.35) path.pop();
        line(
          pen,
          path,
          spread(0.0021, 0.006),
          r() < 0.3 ? "#6a6b58" : "#303b33",
        );
      }
    }
    function mosaic(poly, seeds, xyz, palette, fg = false) {
      seeds.forEach((s, i) => {
        let cell = [...poly];
        for (let j = 0; j < seeds.length && cell.length; j++) {
          if (i === j) continue;
          const a = seeds[j],
            dx = a[0] - s[0],
            dy = (a[1] - s[1]) * (fg ? 0.49 : 1.15);
          cell = half(
            cell,
            dx,
            dy,
            (dx * (s[0] + a[0])) / 2 + (dy * (s[1] + a[1])) / 2,
          );
        }
        if (cell.length < 3) return;
        const center = mean(cell);
        for (let k = 0; k < cell.length; k++)
          body.tri(
            xyz(...cell[k], -0.022),
            xyz(...cell[(k + 1) % cell.length], -0.022),
            xyz(...center, -0.022),
            fg ? "#31372e" : "#212d2d",
          );
        chips(cell, center, xyz, palette[Math.floor(r() * palette.length)], fg);
      });
    }
    const back = (x, y, offset) => [x, y, -1.46 + 0.067 * x * x + offset];
    let seeds = [];
    for (let j = 0; j < 4; j++)
      for (let i = -8; i <= 8; i++)
        seeds.push([
          i * 0.43 + (j % 2) * 0.215 + spread(-0.13, 0.13),
          -0.35 + j * 0.32 + spread(-0.11, 0.11),
        ]);
    mosaic(
      [
        [-3.58, -0.56],
        [3.58, -0.56],
        [3.58, 0.89],
        [-3.58, 0.89],
      ],
      seeds,
      back,
      ["#3a4b49", "#394a49", "#455450", "#41504d", "#50605b", "#334746"],
    );
    // A single projecting stone bank supports the living trunk from below.
    const outline = [
      [1.06, -0.42],
      [3.28, -0.42],
      [3.27, 0.81],
      [2.47, 0.835],
      [2.18, 0.83],
      [1.85, 0.838],
      [1.65, 0.828],
      [1.53, 0.776],
      [1.47, 0.657],
      [1.41, 0.549],
      [1.29, 0.399],
    ];
    const xyz = (x, y, d) => [
      x,
      y,
      0.52 + 0.075 * Math.sin(x * 1.83 + y * 0.76) + d,
    ];
    const rock = params.limestone || "#677060";
    seeds = [
      [1.22, 0.0],
      [1.45, 0.38],
      [1.58, 0.73],
      [1.79, 0.2],
      [1.96, 0.69],
      [2.15, -0.1],
      [2.34, 0.63],
      [2.56, -0.03],
      [2.78, 0.5],
      [3.15, 0.23],
      [3.35, 0.82],
    ];
    mosaic(
      outline,
      seeds,
      xyz,
      [rock, "#5d6458", "#6c7161", "#505b4d", "#626958", "#555e50"],
      true,
    );
    const flat = "#585f4b";
    for (let i = 2; i < outline.length; i++) {
      const a = outline[i],
        b = outline[(i + 1) % outline.length],
        p = xyz(...a, -0.004),
        q = xyz(...b, -0.004);
      body.quad(
        p,
        q,
        [q[0] + 0.2, q[1] + 0.055, -0.87],
        [p[0] + 0.2, p[1] + 0.055, -0.87],
        flat,
      );
    }
    const wallGeometry = new T.BufferGeometry();
    wallGeometry.setAttribute(
      "position",
      new T.Float32BufferAttribute(body.pos, 3),
    );
    const collision = compound(
      new T.Mesh(wallGeometry, null),
      boxShape([7.4, 0.13, 6.5], [0, -0.071, 0.95]),
    );
    // Shaded flagstones run underneath both trestles. The front of the drawing
    // table catches sun, while its feet recede into this blue-green footing.
    const flag = (x, z, d) => [x, -0.006 + d * 0.15, z];
    seeds = [];
    for (let row = 0; row < 8; row++)
      for (let i = -6; i <= 6; i++)
        seeds.push([
          i * 0.57 + (row % 2) * 0.25 + spread(-0.2, 0.2),
          -2.1 + row * 0.87 + spread(-0.26, 0.26),
        ]);
    mosaic(
      [
        [-3.7, -2.3],
        [3.7, -2.3],
        [3.7, 4.2],
        [-3.7, 4.2],
      ],
      seeds,
      flag,
      ["#364440", "#3c4a45", "#303e39", "#47534d", "#3b453f"],
    );
    body.finish(
      root,
      inkMaterial("limestone", Number(params.grain ?? 1)),
      "Hewn stones, mortar beds and flagstones",
    );
    pen.finish(root, inkMaterial("ink"), "Hairline faults and grain marks");
    return {
      object: root,
      physics: {
        bodies: [
          {
            id: "masonry-and-floor",
            type: "static",
            object: root,
            collider: "mesh",
            shape: collision,
            friction: 0.82,
          },
        ],
      },
    };
  },
});
