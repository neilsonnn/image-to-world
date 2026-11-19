import { defineSceneModule } from "image-to-world/runtime";
import {
  T,
  Pigment,
  inkMaterial,
  random,
  tau,
  lerp,
  wall,
  wallDepth,
  shot,
  line,
} from "./room-surface.mjs";

export default defineSceneModule({
  create({ params }) {
    const root = new T.Group(),
      face = new Pigment(),
      rims = new Pigment(),
      uprights = new Pigment(),
      rails = new Pigment(),
      rag = new Pigment(),
      nib = new Pigment();
    const rand = random(3917),
      between = (a, b) => lerp(a, b, rand());
    const plaster = params.plaster || "#9f988b",
      paper = params.paper || "#afa594";
    const windows = [
      [0.515, 0.282, 0.178, 0.302],
      [-0.006, 0.522, 0.065, 0.118],
      [0.912, 0.348, 0.128, 0.253],
    ];
    const ring = (win, k = 1) =>
      Array.from({ length: 112 }, (_, i) => {
        const t = (i * tau) / 112,
          ripple =
            1 +
            0.0031 * Math.sin(9 * t + 0.32) +
            0.0017 * Math.sin(17 * t + 1.6);
        return [
          win[0] + win[2] * k * ripple * Math.cos(t),
          win[1] + win[3] * k * ripple * Math.sin(t),
        ];
      });
    const outline = [
      [-0.26, -0.66],
      [1.24, -0.66],
      [1.24, 0.827],
      [1.02, 0.77],
      [0.82, 0.687],
      [0.62, 0.656],
      [0.38, 0.655],
      [0.2, 0.69],
      [-0.02, 0.749],
      [-0.26, 0.806],
    ];
    const outer = outline.map((p) => new T.Vector2(...p)),
      holes = windows.map((w) => ring(w).map((p) => new T.Vector2(...p)));
    const coords = [...outer, ...holes.flat()].map((v) => [v.x, v.y]);
    const triangles = T.ShapeUtils.triangulateShape(outer, holes);
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    // A coarse tessellation of the same shell preserves all three window openings.
    const shellTriangles = [];
    function plasterTriangle(a, b, c, depth) {
      if (depth === 3)
        shellTriangles.push(...wall(...a), ...wall(...b), ...wall(...c));
      if (depth) {
        const m = mid(a, b),
          n = mid(b, c),
          s = mid(c, a);
        plasterTriangle(a, m, s, depth - 1);
        plasterTriangle(m, b, n, depth - 1);
        plasterTriangle(s, n, c, depth - 1);
        plasterTriangle(m, n, s, depth - 1);
      } else {
        const tint = (p) =>
          new T.Color(plaster)
            .lerp(
              new T.Color("#9ea1ae"),
              Math.max(0, Math.min(0.85, (p[0] - 0.46) * 2.2)),
            )
            .lerp(new T.Color("#d8c9ac"), Math.max(0, (p[1] - 0.32) * 0.55));
        face.tri(wall(...a), wall(...b), wall(...c), tint(a), tint(b), tint(c));
        face.tri(
          wall(...c, -0.19),
          wall(...b, -0.19),
          wall(...a, -0.19),
          "#99958f",
        );
      }
    }
    for (const ids of triangles)
      plasterTriangle(...ids.map((i) => coords[i]), 4);
    const shellEnd = face.pos.length;
    // Side returns and a vaulted ceiling connect to the curved entrance end.
    // These surfaces are visible when walking around either side of the desk.
    const ends = [
      [-0.26, 0.806, -1],
      [1.24, 0.827, 1],
    ];
    for (const [u, v, sign] of ends) {
      const slices = 16;
      const point = (t, h) => {
        // Follow the curved seam at the dome. The side return shares the same
        // points as its plaster boundary across the entire height.
        const base = wall(u, lerp(v, -0.66, h));
        return [
          base[0] - sign * 0.43 * t * t,
          base[1] - 0.32 * h * t * t,
          lerp(base[2], 5.65, t),
        ];
      };
      for (let i = 0; i < slices; i++) {
        const t = i / slices,
          n = (i + 1) / slices,
          a = point(t, 0),
          b = point(n, 0);
        face.quad(a, b, [b[0], -0.09, b[2]], [a[0], -0.09, a[2]], "#606456");
      }
      for (let i = 0; i < slices; i++) {
        const t = i / slices,
          n = (i + 1) / slices;
        for (let j = 0; j < 24; j++) {
          const h = j / 24,
            g = (j + 1) / 24;
          face.quad(
            point(t, h),
            point(n, h),
            point(n, g),
            point(t, g),
            plaster,
          );
        }
      }
    }
    for (let i = 2; i < outline.length - 1; i++) {
      const a = outline[i],
        b = outline[i + 1];
      for (let j = 0; j < 14; j++) {
        const make = (t) =>
          wall(lerp(a[0], b[0], t), lerp(a[1], b[1], t), -0.095);
        const p = make(j / 14),
          q = make((j + 1) / 14);
        face.quad(p, q, [q[0], -0.1, q[2]], [p[0], -0.1, p[2]], "#465344");
      }
    }
    for (let i = 0; i < 28; i++) {
      const x = i / 28,
        x1 = (i + 1) / 28;
      const roof = (x, t) => {
        const p = wall(lerp(-0.26, 1.24, x), -0.66);
        return [
          p[0] * (1 - 0.12 * t * t),
          p[1] + Math.sin(Math.PI * x) * 0.29 - 0.32 * t * t,
          lerp(p[2], 5.66, t),
        ];
      };
      for (let k = 0; k < 8; k++) {
        const t = k / 8,
          f = (k + 1) / 8;
        face.quad(roof(x, t), roof(x1, t), roof(x1, f), roof(x, f), "#99978e");
      }
    }
    const low = -0.07,
      top = 4.6,
      entranceZ = 5.64;
    const endWall = (x, y) => [x, y, entranceZ];
    const doorWidth = 0.6,
      doorShoulder = 1.63,
      doorTop = 2.23;
    for (let i = 0; i < 34; i++) {
      const x = lerp(-3.8, 3.8, i / 34),
        right = lerp(-3.8, 3.8, (i + 1) / 34);
      const arch = (x) =>
        Math.abs(x) <= doorWidth
          ? doorShoulder +
            Math.sqrt(1 - (x / doorWidth) ** 2) * (doorTop - doorShoulder)
          : low;
      face.quad(
        endWall(x, arch(x)),
        endWall(right, arch(right)),
        endWall(right, top),
        endWall(x, top),
        "#999689",
      );
    }
    // Continuous rolled masonry reveals run from the face to the exterior skin.
    windows.forEach((win, idx) => {
      const layers = [
        [1.006, 0.01],
        [1.002, 0.016],
        [0.998, 0.008],
        [0.986, -0.058],
        [0.973, -0.17],
        [0.976, -0.187],
      ];
      const rings = layers.map(([k, d], i) =>
        ring(win, k).map(([u, v]) => {
          const depth = wallDepth(u, v) + d;
          // The two side reveals turn into the room. Their rolled inner lips are
          // offset towards the side of the shell, exposing a crescent of lime.
          const f = i / (layers.length - 1);
          const drift =
            idx === 1 ? -0.02 * f : idx === 2 ? 0.025 * f : 0.0048 * f;
          const inner = idx === 0 ? 0 : 0.065 * f;
          return shot(
            win[0] + (u - win[0]) * (1 - inner) + drift,
            win[1] + (v - win[1]) * (1 - inner),
            depth,
          );
        }),
      );
      for (let l = 0; l < rings.length - 1; l++) {
        for (let i = 0; i < rings[l].length; i++) {
          const j = (i + 1) % rings[l].length,
            t = (i * tau) / 112;
          const sunny = (1 - Math.cos(t - 0.2)) * 0.5;
          const palette =
            idx === 0
              ? ["#786f60", "#574a3f", "#dfd0bb", "#9d968b", "#736e62"]
              : ["#69695e", "#524f4b", "#b7bdc2", "#87939b", "#596363"];
          const light =
            idx === 0
              ? ["#a89783", "#6f5b49", "#fffef1", "#f7f3e8", "#afa7a0"]
              : ["#9ca4a7", "#5b6364", "#c3d2d9", "#aebeca", "#95a6b3"];
          const h = new T.Color(palette[l]).lerp(new T.Color(light[l]), sunny);
          rims.quad(
            rings[l][i],
            rings[l][j],
            rings[l + 1][j],
            rings[l + 1][i],
            h,
          );
        }
      }
    });
    const w = windows[0]; // Paint worn ogee window bars in deep-set shadowed wood.
    function mullion(horizontal, at, width) {
      const q = (at - w[horizontal ? 1 : 0]) / w[horizontal ? 3 : 2];
      const span = Math.sqrt(1 - q * q) * 0.964;
      const lo = (horizontal ? w[0] : w[1]) - span * w[horizontal ? 2 : 3],
        hi = (horizontal ? w[0] : w[1]) + span * w[horizontal ? 2 : 3];
      const sections = [
        [-0.5, -0.172, "#362f28"],
        [-0.5, -0.07, "#514535"],
        [-0.35, -0.052, "#8e7c61"],
        [-0.16, -0.055, "#635543"],
        [0.38, -0.057, "#4e4233"],
        [0.5, -0.079, "#3f3933"],
        [0.5, -0.172, "#413934"],
      ];
      const loc = (p, s) => {
        const u = horizontal ? p : at + width * s[0],
          v = horizontal ? at + width * s[0] : p;
        return wall(u, v, s[1]);
      };
      for (let i = 1; i < sections.length; i++) {
        for (let j = 0; j < 7; j++) {
          const p = lerp(lo, hi, j / 7),
            t = lerp(lo, hi, (j + 1) / 7),
            a = sections[i - 1],
            b = sections[i];
          const washed = new T.Color(a[2]).lerp(
            new T.Color(horizontal ? "#a16539" : "#815236"),
            horizontal && at > 0.3 ? 0.6 : 0.3,
          );
          (horizontal ? rails : uprights).quad(
            loc(p, a),
            loc(t, a),
            loc(t, b),
            loc(p, b),
            washed,
          );
        }
      }
      const rr = random(Math.round(at * 83139));
      for (const [side, h] of [
        [-0.48, "#392c22"],
        [0.45, "#3a2c21"],
        [-0.34, "#dbc39f"],
      ]) {
        const N = 26;
        for (let j = 0; j < N; j++) {
          if (rr() < 0.17) continue;
          const p = lerp(lo, hi, (j + 0.05) / N),
            q = lerp(lo, hi, (j + 1.11) / N);
          const offset = (rr() - 0.5) * 0.05;
          line(
            nib,
            [
              loc(p, [side + offset, -0.037]),
              loc((p + q) / 2, [side - 0.018, -0.037]),
              loc(q, [side + offset, -0.037]),
            ],
            0.002 + rr() * 0.004,
            h,
          );
        }
      }
      for (let i = 0; i < 82; i++) {
        const p = lerp(lo, hi, rr()),
          s = rr() * 0.64 - 0.32,
          length = lerp(0.0007, 0.006, rr());
        const a = loc(p, [s, -0.036]),
          b = loc(p + length, [s + 0.011, -0.036]);
        line(
          nib,
          [a, b],
          0.0015 + rr() * 0.003,
          rr() < 0.37 ? "#c1aa85" : "#4f392a",
        );
      }
    }
    mullion(false, 0.448, 0.0118);
    mullion(false, 0.588, 0.0102);
    mullion(true, 0.162, 0.0148);
    mullion(true, 0.403, 0.0177);
    // Small dark wedges and peened nailheads interrupt the ink at each half-lap.
    for (const u of [0.448, 0.588])
      for (const v of [0.162, 0.403]) {
        for (const [x, y, r] of [
          [-0.0015, -0.0021, 0.01],
          [0.0028, 0.0025, 0.006],
        ]) {
          const cp = wall(u + x, v + y, -0.025);
          for (let i = 0; i < 8; i++) {
            const t = (tau * i) / 8,
              t1 = (tau * (i + 1)) / 8;
            nib.tri(
              cp,
              [cp[0] + r * Math.cos(t), cp[1] + 0.85 * r * Math.sin(t), cp[2]],
              [
                cp[0] + r * Math.cos(t1),
                cp[1] + 0.85 * r * Math.sin(t1),
                cp[2],
              ],
              "#342c26",
            );
          }
          line(
            nib,
            [
              [cp[0] - 0.005, cp[1] + 0.006, cp[2] + 0.001],
              [cp[0] + 0.001, cp[1] + 0.0065, cp[2] + 0.001],
            ],
            0.0036,
            "#d9c2a3",
          );
        }
      }
    const stroke = (points, width, col, d = 0.018) =>
      line(
        nib,
        points.map((p) => wall(...p, d)),
        width,
        col,
      );
    // Hand-fractured plaster: distinct stress lines, isolated gouges and dry chips.
    const fractures = [
      [
        [0.233, -0.015],
        [0.238, 0.047],
        [0.25, 0.084],
        [0.245, 0.14],
        [0.244, 0.224],
        [0.232, 0.281],
        [0.248, 0.365],
        [0.243, 0.444],
        [0.252, 0.54],
      ],
      [
        [0.244, 0.229],
        [0.235, 0.201],
        [0.231, 0.168],
        [0.219, 0.142],
      ],
      [
        [0.253, -0.04],
        [0.257, 0.012],
        [0.276, 0.034],
        [0.288, 0.012],
        [0.312, 0.037],
      ],
      [
        [0.324, 0.276],
        [0.331, 0.296],
        [0.323, 0.34],
        [0.341, 0.397],
      ],
      [
        [0.786, -0.008],
        [0.786, 0.049],
        [0.808, 0.097],
        [0.803, 0.145],
        [0.819, 0.174],
      ],
      [
        [0.294, 0.531],
        [0.309, 0.553],
        [0.321, 0.604],
        [0.339, 0.633],
      ],
      [
        [0.778, 0.338],
        [0.773, 0.383],
        [0.779, 0.419],
        [0.77, 0.444],
      ],
      [
        [0.837, 0.622],
        [0.828, 0.59],
        [0.813, 0.577],
      ],
      [
        [0.562, -0.025],
        [0.592, 0.022],
        [0.614, 0.006],
      ],
    ];
    function crack(path) {
      const pts = [];
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1],
          b = path[i],
          count = Math.max(
            3,
            Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 175),
          );
        for (let j = 0; j < count; j++) {
          const f = j / count;
          pts.push([
            lerp(a[0], b[0], f) + between(-0.0014, 0.0014),
            lerp(a[1], b[1], f) + between(-0.001, 0.001),
          ]);
        }
      }
      pts.push(path.at(-1));
      for (let i = 1; i < pts.length; i++) {
        if (rand() < 0.19) continue;
        const a = pts[i - 1],
          b = pts[i];
        stroke(
          [a, b],
          between(0.003, 0.013),
          rand() < 0.3 ? "#a18d77" : "#524736",
          0.024,
        );
        if (rand() < 0.12) {
          const sign = rand() > 0.5 ? 1 : -1;
          stroke(
            [
              a,
              [a[0] + sign * 0.0032, a[1] - 0.004],
              [a[0] + sign * 0.0042, a[1] - 0.011],
            ],
            0.003,
            "#716351",
            0.024,
          );
        }
      }
    }
    fractures.forEach(crack);
    for (let i = 0; i < 255; i++) {
      const u = between(-0.04, 1.02),
        v = between(-0.18, 0.7);
      if (
        windows.some(
          (w) => ((u - w[0]) / w[2]) ** 2 + ((v - w[1]) / w[3]) ** 2 < 1.05,
        )
      )
        continue;
      const s = between(0.0004, 0.0024);
      nib.tri(
        wall(u, v, 0.023),
        wall(u + s, v + s * 0.6, 0.023),
        wall(u + s * 0.3, v + s * 1.5, 0.023),
        rand() < 0.3 ? "#857461" : "#c3b49e",
      );
    }
    // Rag-paper sketches of joinery and natural specimens, with curled corners and pins.
    const sheets = [
      [0.059, 0.288, 0.036, 0.127, -0.03, 1],
      [0.093, 0.288, 0.038, 0.11, 0.015, 0],
      [0.123, 0.285, 0.038, 0.109, -0.015, 1],
      [0.043, 0.212, 0.024, 0.115, 0.064, 0],
      [0.057, 0.154, 0.115, 0.172, 0.035, 0],
      [0.086, 0.397, 0.026, 0.079, 0.035, 0],
      [0.08, 0.463, 0.044, 0.076, -0.075, 1],
      [0.102, 0.535, 0.027, 0.045, -0.065, 2],
      [0.279, 0.145, 0.062, 0.13, -0.085, 1],
      [0.709, 0.208, 0.05, 0.135, -0.073, 2],
    ];
    sheets.forEach(([x, y, ww, hh, ang, figure], index) => {
      const pt = (a, b, d = 0) => {
        const u = x + ww * a + Math.sin(ang) * hh * b * 0.56,
          v = y + hh * b + Math.sin(ang) * ww * a * 1.79;
        const lift =
          0.047 +
          index * 0.0051 +
          0.013 * b * b +
          0.014 * Math.pow(Math.max(0, b - 0.6) * 2.5, 2) * (a * 0.8 + 0.2);
        return wall(u, v, lift + d);
      };
      const silhouette = [
        [0, 0],
        [0.36, 0.005],
        [0.73, -0.009],
        [1, 0.008],
        [0.988, 0.36],
        [0.993, 0.76],
        [1.012, 0.98],
        [0.67, 1.001],
        [0.42, 0.989],
        [0.06, 1],
        [0.008, 0.96],
        [0.002, 0.55],
      ];
      const ring = silhouette.map((p) => pt(...p));
      const center = pt(0.5, 0.5);
      for (let i = 0; i < ring.length; i++) {
        const j = (i + 1) % ring.length;
        const shadow = (p) => [p[0] + 0.009, p[1] - 0.015, p[2] - 0.018];
        rag.tri(shadow(center), shadow(ring[i]), shadow(ring[j]), "#817c71");
        const col = new T.Color(paper).lerp(
          new T.Color("#b4aaa8"),
          index === 9 ? 0.74 : between(0.01, 0.2),
        );
        rag.tri(center, ring[i], ring[j], col, col, col);
        line(
          nib,
          [
            [ring[i][0], ring[i][1], ring[i][2] + 0.003],
            [ring[j][0], ring[j][1], ring[j][2] + 0.003],
          ],
          between(0.004, 0.01),
          "#594e40",
          new T.Vector3(0, 0, 1),
          0.82,
        );
      }
      const draw = (pairs, width = 0.0046, h = "#776852") =>
        line(
          nib,
          pairs.map((p) => pt(...p, 0.005)),
          width,
          h,
        );
      const pin = pt(0.49, 0.047, 0.007),
        radius = index === 4 ? 0.0095 : 0.006;
      for (let i = 0; i < 7; i++) {
        const t = (i * tau) / 7,
          s = ((i + 1) * tau) / 7;
        nib.tri(
          pin,
          [
            pin[0] + radius * Math.cos(t),
            pin[1] + radius * Math.sin(t),
            pin[2],
          ],
          [
            pin[0] + radius * Math.cos(s),
            pin[1] + radius * Math.sin(s),
            pin[2],
          ],
          "#594a38",
        );
      }
      if (figure === 1) {
        const g = index === 8 ? 0.9 : 0.53;
        for (const p of [
          [
            [0.16, 0.18],
            [0.31, 0.16],
            [0.33, 0.39],
            [0.12, 0.4],
            [0.15, 0.19],
          ],
          [
            [0.2, 0.38],
            [0.17, 0.61],
            [0.43, 0.57],
            [0.46, 0.85],
            [0.64, 0.63],
          ],
          [
            [0.58, 0.18],
            [0.82, 0.17],
            [0.79, 0.59],
            [0.63, 0.58],
            [0.66, 0.42],
            [0.59, 0.42],
            [0.58, 0.18],
          ],
        ])
          draw(p, 0.0051 * g);
      } else if (figure === 2) {
        for (let j = 0; j < 6; j++) {
          const px = between(0.19, 0.31),
            py = 0.23 + j * 0.09;
          for (let k = 0; k < 7; k++) {
            const a = px + k * 0.059;
            draw(
              [
                [a, py + between(-0.012, 0.012)],
                [a + 0.032, py + 0.002],
                [a + 0.052, py - 0.017],
              ],
              0.0033,
            );
          }
        }
        draw(
          [
            [0.2, 0.18],
            [0.53, 0.17],
            [0.53, 0.08],
          ],
          0.003,
        );
      }
      for (let j = 0; j < 3; j++) {
        const a = between(0.18, 0.83),
          b = between(0.14, 0.92);
        draw(
          [
            [a, b],
            [a + 0.035, b - 0.008],
            [a + 0.065, b - 0.01],
          ],
          0.0019,
          "#938574",
        );
      }
    });
    face.finish(
      root,
      inkMaterial("plaster", Number(params.paperTooth ?? 1)),
      "Lime washed dome",
    );
    rims.finish(root, inkMaterial("rag"), "Rolled window reveals");
    const stiles = uprights.finish(
      root,
      inkMaterial("wood-y"),
      "Mortised oak stiles",
    );
    const windowRails = rails.finish(
      root,
      inkMaterial("wood-x"),
      "Half-lapped rails",
    );
    rag.finish(root, inkMaterial("rag"), "Pinned stationery");
    nib.finish(
      root,
      inkMaterial("ink"),
      "Dry pen, cracks and sketched studies",
    );
    const geometry = new T.BufferGeometry();
    geometry.setAttribute(
      "position",
      new T.Float32BufferAttribute(
        shellTriangles.concat(face.pos.slice(shellEnd)),
        3,
      ),
    );
    const physics = {
      bodies: [
        {
          id: "dome",
          type: "static",
          object: root,
          collider: "mesh",
          shape: new T.Mesh(geometry, null),
        },
        {
          id: "window-stiles",
          type: "static",
          object: stiles,
          collider: "mesh",
        },
        {
          id: "window-rails",
          type: "static",
          object: windowRails,
          collider: "mesh",
        },
      ],
    };
    return { object: root, physics };
  },
});
