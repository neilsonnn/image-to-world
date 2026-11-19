import { boxShape, roundShape, beamShape, compound } from "./colliders.mjs";
import {
  T,
  paint,
  ink,
  group,
  box,
  ball,
  beam,
  rod,
  cord,
  lathe,
  cyl,
  poly,
  finish,
  binding,
} from "./desk-craft.mjs";
const bronze = paint("#a38557", "enamel"),
  wood = paint("#9c6f46", "wood"),
  darkWood = paint("#644931", "wood"),
  iron = paint("#292e2b", "enamel"),
  cream = paint("#ece3ce"),
  steel = paint("#778482", "enamel"),
  black = paint("#152629", "enamel");
function lamp(root, large, physics) {
  const z = large ? -0.975 : -1.065,
    p = large
      ? [
          [-1.756, 0.923, z],
          [-2.195, 1.605, z - 0.025],
          [-1.509, 2.179, z + 0.02],
          [-1.387, 2.116, z + 0.034],
        ]
      : [
          [1.082, 0.924, z],
          [1.374, 1.656, z + 0.086],
          [0.976, 2.087, z + 0.048],
          [0.858, 2.112, z + 0.074],
        ];
  const prefix = large ? "oak-lamp" : "steel-lamp";
  const parts = ["base", "lower-arm", "upper-arm", "shade"];
  const origins = [p[0], p[0], p[1], p[2]];
  const local = (v, i) => v.map((n, k) => n - origins[i][k]);
  const groups = parts.map((name, i) => {
    const pivot = group(root, ...origins[i]);
    pivot.name = prefix + "-" + name;
    // The paint recipe is in studio coordinates; each body turns at its own pin.
    const paintRoot = group(pivot, ...origins[i].map((v) => -v));
    const shape =
      i === 0
        ? boxShape(
            [large ? 0.218 : 0.18, 0.044, large ? 0.11 : 0.18],
            [0, 0.024, 0],
          )
        : beamShape(
            i === 1 ? local(p[i], i).map((v) => v * 0.09) : [0, 0, 0],
            local(p[i], i),
            large ? 0.097 : 0.05,
            large ? 0.067 : 0.03,
          );
    physics.bodies.push({
      id: pivot.name,
      object: pivot,
      type: i === 0 ? "static" : "dynamic",
      shape: i === 3 ? compound(shape) : shape,
      collider: "hull",
      density: large ? 260 : 390,
      // The lamp's parallelogram and tension springs counterbalance its links.
      // Their effective weight is zero, while their inertia and contacts remain.
      gravityScale: i === 0 ? 1 : 0,
    });
    if (i)
      physics.joints.push({
        type: "hinge",
        a: prefix + "-" + parts[i - 1],
        b: pivot.name,
        anchorA: local(origins[i], i - 1),
        anchorB: [0, 0, 0],
        axis: [0, 0, 1],
        limits: i === 3 ? [-1, 1] : [-0.83, 0.83],
        motor: {
          target: 0,
          stiffness: 0,
          damping: i === 3 ? 225 : 350,
        },
      });
    return paintRoot;
  });
  let r = groups[0];
  if (large) {
    box(r, iron, p[0][0], 0.936, z, 0.218, 0.029, 0.112, 0.009);
    box(r, wood, p[0][0], 0.958, z, 0.155, 0.033, 0.094, 0.004);
  } else {
    lathe(r, iron, p[0][0], 0.924, z, [
      [0, 0],
      [0.096, 0],
      [0.102, 0.016],
      [0.082, 0.044],
      [0.03, 0.061],
      [0, 0.061],
    ]);
  }
  for (let i = 0; i < 3; i++) {
    r = groups[i + 1];
    const a = p[i],
      b = p[i + 1];
    if (large) {
      beam(r, ink, a, b, i === 2 ? 0.07 : 0.106, 0.065);
      beam(
        r,
        wood,
        [a[0], a[1], a[2] + 0.033],
        [b[0], b[1], b[2] + 0.033],
        i === 2 ? 0.052 : 0.087,
        0.016,
      );
      beam(
        r,
        darkWood,
        [a[0] + 0.017, a[1], a[2] + 0.044],
        [b[0] + 0.017, b[1], b[2] + 0.044],
        0.009,
        0.002,
      );
    } else {
      for (const dx of [-0.016, 0.016])
        rod(
          r,
          i === 2 ? iron : paint("#494a3b", "enamel"),
          [a[0] + dx, a[1], a[2]],
          [b[0] + dx, b[1], b[2]],
          0.01,
          0.01,
          8,
        );
      rod(
        r,
        bronze,
        [a[0] + 0.014, a[1], a[2] + 0.008],
        [b[0] + 0.014, b[1], b[2] + 0.008],
        0.0035,
      );
    }
    for (const end of [a, b]) {
      const [x, y, zz] = end;
      rod(r, iron, [x, y, zz - 0.04], [x, y, zz + 0.05], large ? 0.026 : 0.023);
      rod(
        r,
        bronze,
        [x, y, zz + 0.05],
        [x, y, zz + 0.056],
        large ? 0.015 : 0.012,
      );
    }
  }
  const end = p[3],
    hood = group(r, ...end);
  hood.rotation.x = large ? -0.153 : -0.135;
  hood.rotation.z = large ? 0.33 : -0.13;
  const k = large ? 1.07 : 0.72;
  hood.scale.setScalar(k);
  const bell = roundShape(0.163 * k, 0.25 * k, [0, 0, 0], 0.044 * k);
  bell.quaternion.copy(hood.quaternion);
  bell.position
    .set(0, -0.073 * k, 0)
    .applyQuaternion(hood.quaternion)
    .add(new T.Vector3(...local(end, 3)));
  physics.bodies.at(-1).shape.add(bell);
  const profile = [
    [0.162, -0.276],
    [0.163, -0.258],
    [0.151, -0.221],
    [0.129, -0.186],
    [0.099, -0.153],
    [0.062, -0.134],
    [0.049, -0.125],
    [0.046, -0.043],
    [0.041, -0.034],
    [0.03, -0.026],
    [0, -0.026],
  ];
  lathe(
    hood,
    large ? paint("#172b2d", "lampLacquer") : steel,
    0,
    0.08,
    0,
    profile,
    40,
  );
  lathe(
    hood,
    large ? paint("#ffe5a8", "flat") : paint("#b7c0b6", "enamel"),
    0,
    0.08,
    0,
    [
      [0, -0.218],
      [0.115, -0.242],
      [0.154, -0.271],
      [0.159, -0.272],
    ],
    40,
  );
  lathe(
    hood,
    large ? ink : iron,
    0,
    0.08,
    0,
    [
      [0.159, -0.276],
      [0.164, -0.274],
      [0.166, -0.269],
      [0.165, -0.263],
    ],
    40,
  );
  lathe(
    hood,
    large ? paint("#365458", "enamel") : cream,
    0,
    0.08,
    0,
    [
      [0.044, -0.091],
      [0.047, -0.088],
      [0.047, -0.08],
      [0.044, -0.08],
    ],
    28,
  );
  const enamelPoint = (angle, level) => {
    const row = profile.findIndex((ring, i) => i > 0 && level <= ring[1]);
    const [r0, h0] = profile[row - 1],
      [r1, h1] = profile[row];
    const radius = r0 + ((r1 - r0) * (level - h0)) / (h1 - h0) + 0.0018;
    return [Math.sin(angle) * radius, 0.08 + level, Math.cos(angle) * radius];
  };
  if (large) {
    // A cool sky reflection follows one shoulder. Its width and hue change as the bell turns.
    const blue = paint("#486475", "lampLacquer");
    curvedStroke(hood, blue, enamelPoint, [
      [-1.3, -0.251, 0.013],
      [-1.27, -0.225, 0.015],
      [-1.2, -0.193, 0.013],
      [-1.07, -0.164, 0.01],
      [-0.88, -0.151, 0.002],
    ]);
    curvedStroke(hood, paint("#aec1c4", "lampLacquer"), enamelPoint, [
      [0.69, -0.26, 0.001],
      [0.81, -0.256, 0.003],
      [0.94, -0.254, 0.002],
      [1.01, -0.253, 0.0007],
    ]);
    curvedStroke(hood, blue, enamelPoint, [
      [0.45, -0.265, 0.001],
      [0.63, -0.262, 0.002],
      [0.68, -0.261, 0.001],
    ]);
  }
  for (const [left, right] of [
    [-0.97, -0.65],
    [-0.54, 0.29],
    [0.49, 0.79],
  ]) {
    const pts = Array.from({ length: 10 }, (_, i) => {
      const a = left + ((right - left) * i) / 9;
      return [Math.sin(a) * 0.164, 0.08 - 0.275, Math.cos(a) * 0.164];
    });
    cord(hood, paint(large ? "#d4a077" : "#b1a78a", "pottery"), pts, 0.00175);
  }
  if (!large)
    for (const k of [0, 0.4, 1, 1.65, 2.3, 2.85])
      rod(
        hood,
        iron,
        [Math.sin(k) * 0.047, 0.043, Math.cos(k) * 0.046],
        [Math.sin(k) * 0.047, -0.05, Math.cos(k) * 0.047],
        0.0038,
      );
  const a = p[2];
  cord(
    r,
    iron,
    [
      [a[0] - 0.055, a[1] - 0.043, a[2] - 0.028],
      [a[0] - 0.016, a[1] + 0.025, a[2] - 0.033],
      [a[0] + 0.063, a[1] + 0.07, a[2] - 0.011],
      [end[0], end[1] + 0.054, end[2]],
      [end[0] + 0.01, end[1] + 0.006, end[2]],
    ],
    0.007,
  );
  if (large)
    cord(
      groups[1],
      iron,
      [
        [-2.062, 0.937, z],
        [-2.003, 1.052, z],
        [-2.028, 1.232, z],
        [-2.152, 1.538, z],
        [-2.188, 1.61, z],
      ],
      0.006,
    );
}
const brushes = [
  "#c09050",
  "#825433",
  "#b79c6c",
  "#344b4c",
  "#9b6538",
  "#715138",
].map((c) => paint(c, "wood"));
// A stroke follows angular and vertical coordinates on a turned surface. The ends
// taper independently, so glaze chips and brush marks do not form regular stripes.
function curvedStroke(root, material, point, knots) {
  const vertices = [],
    faces = [];
  for (const [angle, level, halfHeight] of knots) {
    vertices.push(
      point(angle, level - halfHeight),
      point(angle, level + halfHeight),
    );
    const i = vertices.length - 2;
    if (i) faces.push(i - 2, i - 1, i, i, i - 1, i + 1);
  }
  poly(root, material, vertices, faces);
}
function cup(r, x, y, z, rad, h, m, handle = false) {
  const g = group(r, x, y, z);
  const colored = m !== cream;
  const skin = colored ? paint(m.hex, "pottery") : m;
  const radius = [
    [0, 0.8],
    [0.028, 0.89],
    [0.069, 0.927],
    [0.43, 0.956],
    [0.84, 0.985],
    [0.92, 1.003],
    [0.963, 1.048],
    [0.987, 1.043],
    [1, 0.99],
  ];
  const outer = (angle, level, offset = 0.0013) => {
    const upper = radius.findIndex((entry, i) => i > 0 && level <= entry[0]);
    const [ha, ra] = radius[upper - 1],
      [hb, rb] = radius[upper];
    const rr = rad * (ra + ((rb - ra) * (level - ha)) / (hb - ha)) + offset;
    return [Math.sin(angle) * rr, h * level, Math.cos(angle) * rr];
  };
  lathe(
    g,
    skin,
    0,
    0,
    0,
    [
      [0, 0],
      ...radius.map(([level, rr]) => [rad * rr, h * level]),
      [rad * 0.903, h * 0.998],
      [rad * 0.876, h * 0.959],
    ],
    32,
  );
  lathe(
    g,
    paint("#25221a", "ink"),
    0,
    0,
    0,
    [
      [rad * 0.905, h * 0.998],
      [rad * 0.88, h * 0.94],
      [rad * 0.86, h * 0.837],
      [0, h * 0.831],
    ],
    32,
  );
  if (colored) {
    const cool =
      m.hex.startsWith("#2") ||
      m.hex.startsWith("#3") ||
      m.hex.startsWith("#5");
    const sheen = paint(cool ? "#a3bdc2" : "#e6ba8d", "pottery"),
      oxide = paint(cool ? "#687a75" : "#9e5533");
    const rim = paint(cool ? "#182b2c" : "#543525", "ink");
    const cap = (start, end, level, thickness, material) => {
      const pts = Array.from({ length: 14 }, (_, i) =>
        outer(start + ((end - start) * i) / 13, level),
      );
      cord(g, material, pts, thickness);
    };
    cap(-2.07, -0.51, 0.953, 0.0025, rim);
    cap(0.66, 1.82, 0.958, 0.0019, rim);
    cap(-0.19, 0.36, 0.992, 0.0021, sheen);
    cap(0.51, 0.73, 0.988, 0.0015, sheen);
    cap(0.81, 1.5, 0.035, 0.0023, rim);
    curvedStroke(g, sheen, outer, [
      [0.41, 0.49, 0.01],
      [0.45, 0.558, 0.029],
      [0.46, 0.638, 0.049],
      [0.5, 0.645, 0.027],
      [0.54, 0.7, 0.004],
    ]);
    curvedStroke(g, sheen, outer, [
      [0.39, 0.754, 0.005],
      [0.42, 0.77, 0.023],
      [0.46, 0.791, 0.009],
    ]);
    curvedStroke(g, oxide, outer, [
      [-0.63, 0.47, 0.005],
      [-0.48, 0.455, 0.011],
      [-0.35, 0.447, 0.006],
      [-0.23, 0.426, 0.002],
    ]);
    curvedStroke(g, rim, outer, [
      [-0.89, 0.722, 0.001],
      [-0.77, 0.703, 0.005],
      [-0.63, 0.695, 0.005],
      [-0.56, 0.684, 0.001],
    ]);
    curvedStroke(g, rim, outer, [
      [-0.74, 0.638, 0.003],
      [-0.69, 0.623, 0.003],
      [-0.61, 0.619, 0.006],
    ]);
    if (cool)
      curvedStroke(g, sheen, outer, [
        [-0.91, 0.072, 0.004],
        [-0.78, 0.084, 0.008],
        [-0.61, 0.111, 0.018],
        [-0.55, 0.12, 0.007],
      ]);
  }
  if (handle)
    cord(
      g,
      skin,
      [
        [rad * 0.92, h * 0.81, 0],
        [rad * 1.48, h * 0.83, 0],
        [rad * 1.62, h * 0.63, 0],
        [rad * 1.49, h * 0.36, 0],
        [rad * 0.92, h * 0.31, 0],
      ],
      rad * 0.125,
    );
  return g;
}
// Brush profiles use a pinched heel and a loose crown. Clumps follow the broad faces
// of flat brushes or flare away on a round brush that has lost its point.
function bristles(g, rng, width, depth, length, kind) {
  const broad = kind === "wash",
    fan = kind === "fan";
  const bristle = paint(
    broad ? "#69432d" : fan ? "#39382a" : "#534028",
    "bristle",
  );
  const vertices = [],
    faces = [],
    sides = 12;
  const rings = [
    [0, 0.8],
    [0.18, 0.94],
    [0.48, fan ? 1.1 : 0.96],
    [0.75, fan ? 1.24 : broad ? 1.02 : 0.78],
    [1, fan ? 1.21 : broad ? 0.96 : 0.29],
  ];
  for (let j = 0; j < rings.length; j++)
    for (let i = 0; i < sides; i++) {
      const a = (Math.PI * 2 * i) / sides,
        [t, size] = rings[j];
      const crown =
        t === 1 ? (rng() - 0.5) * length * (broad ? 0.12 : 0.24) : 0;
      vertices.push([
        Math.cos(a) * width * size * 0.5,
        length * t + crown,
        Math.sin(a) * depth * size * 0.5,
      ]);
      if (j) {
        const k = j * sides + i,
          l = j * sides + ((i + 1) % sides);
        faces.push(k - sides, l - sides, k, l - sides, l, k);
      }
    }
  for (let i = 1; i < sides - 1; i++)
    faces.push(sides * 4, sides * 4 + i + 1, sides * 4 + i);
  poly(g, bristle, vertices, faces);
  const count = broad ? 8 : fan ? 7 : 4;
  for (let i = 0; i < count; i++) {
    const u = i / (count - 1) - 0.5,
      start = [
        u * width * 0.82,
        length * (0.12 + rng() * 0.21),
        depth * (0.43 + rng() * 0.06),
      ];
    const rise = length * (0.85 + rng() * 0.4);
    const end = [
      u * width * (fan ? 1.48 : broad ? 0.98 : 0.64) +
        (rng() - 0.5) * width * 0.1,
      rise,
      depth * (0.42 + rng() * 0.2),
    ];
    rod(
      g,
      paint(
        i % 3 === 0 ? "#916949" : i % 3 === 1 ? "#46392a" : "#60422c",
        "bristle",
      ),
      start,
      end,
      width * (broad ? 0.036 : 0.055),
      width * 0.007,
      5,
    );
  }
}
function brushcup(
  r,
  rng,
  x,
  y,
  z,
  rad,
  h,
  m,
  number,
  height,
  style = 0,
  left = x < 0,
) {
  cup(r, x, y, z, rad, h, m, style === 2);
  const kinds = [
    "fan",
    "fine",
    "wash",
    "point",
    "round",
    "fine",
    "wash",
    "round",
    "fine",
    "point",
    "round",
  ];
  for (let i = 0; i < number; i++) {
    const a = (6.283 * i) / number + rng() * 0.73,
      b = 0.3 + rng() * 0.43;
    const kind = kinds[i % kinds.length],
      wide = kind === "wash",
      fine = kind === "fine";
    const lean = 0.028 + rng() * (wide ? 0.138 : 0.099),
      dx = Math.cos(a),
      dz = Math.sin(a);
    const base = new T.Vector3(
      x + dx * rad * b,
      y + h * 0.81,
      z + dz * rad * b,
    );
    const breadth = wide
      ? 0.045 + rng() * 0.016
      : kind === "fan"
        ? 0.029 + rng() * 0.014
        : fine
          ? 0.012
          : 0.022 + rng() * 0.011;
    const heightFactor = [
      0.98, 0.69, 1.04, 0.67, 0.56, 0.72, 0.8, 0.67, 0.52, 0.6, 0.73,
    ][i % 11];
    const along = new T.Vector3(
      dx * lean,
      height * heightFactor * (left ? 1.41 : 1.14),
      dz * lean,
    );
    const g = group(r, ...base.toArray());
    g.quaternion.setFromUnitVectors(
      new T.Vector3(0, 1, 0),
      along.clone().normalize(),
    );
    g.rotateY((rng() - 0.5) * 0.86);
    const total = along.length(),
      tuft = wide ? 0.071 : kind === "fan" ? 0.055 : fine ? 0.034 : 0.057;
    const ferrule = wide ? 0.049 : fine ? 0.023 : 0.036,
      stem = total - tuft - ferrule;
    const handle = brushes[(i + 2) % brushes.length],
      grip = wide ? 0.011 : fine ? 0.0058 : 0.009;
    rod(g, handle, [0, 0, 0], [0, stem * 0.42, 0], grip * 0.52, grip, 8);
    rod(g, handle, [0, stem * 0.42, 0], [0, stem, 0], grip, grip * 0.82, 8);
    const binding = group(g, 0, stem, 0);
    const oxidized = paint(
      i % 3 === 0 ? "#ad8d59" : i % 3 === 1 ? "#858379" : "#c0b4a3",
      "enamel",
    );
    const ferruleWidth = breadth * (wide ? 0.94 : 0.77),
      ferruleDepth = wide ? 0.013 : ferruleWidth * 0.67;
    box(
      binding,
      oxidized,
      0,
      ferrule * 0.49,
      0,
      ferruleWidth,
      ferrule,
      ferruleDepth,
      0.0021,
    );
    for (const [level, thickness, mat] of [
      [0.11, 0.115, iron],
      [0.23, 0.07, cream],
      [0.68, 0.06, iron],
    ]) {
      box(
        binding,
        mat,
        0,
        level * ferrule,
        0,
        ferruleWidth * 1.026,
        thickness * ferrule,
        ferruleDepth * 1.074,
        0.0008,
      );
    }
    if (wide) {
      const vertices = [
        [-ferruleWidth * 0.46, ferrule * 0.35, ferruleDepth * 0.544],
        [ferruleWidth * 0.46, ferrule * 0.3, ferruleDepth * 0.544],
        [ferruleWidth * 0.46, ferrule * 0.78, ferruleDepth * 0.544],
        [ferruleWidth * 0.23, ferrule * 0.79, ferruleDepth * 0.544],
        [ferruleWidth * 0.05, ferrule * 0.71, ferruleDepth * 0.544],
        [-ferruleWidth * 0.31, ferrule * 0.8, ferruleDepth * 0.544],
        [-ferruleWidth * 0.46, ferrule * 0.72, ferruleDepth * 0.544],
      ];
      poly(
        binding,
        paint("#e0d8c8"),
        vertices,
        [0, 1, 3, 1, 2, 3, 0, 3, 4, 0, 4, 5, 0, 5, 6],
      );
      box(
        binding,
        paint("#b4b1a3"),
        -ferruleWidth * 0.17,
        0.55 * ferrule,
        ferruleDepth * 0.568,
        0.002,
        0.012,
        0.001,
      );
    }
    bristles(
      group(g, 0, stem + ferrule, 0),
      rng,
      breadth,
      wide ? breadth * 0.26 : breadth * 0.67,
      tuft,
      kind,
    );
  }
}
function jar(r, x, y, z, w, h, m, rim) {
  lathe(
    r,
    m,
    x,
    y,
    z,
    [
      [0, 0],
      [w * 0.8, 0],
      [w, 0.013],
      [w * 0.985, h * 0.69],
      [w * 0.82, h * 0.8],
      [w * 0.73, h * 0.81],
      [w * 0.73, h * 0.94],
      [w * 0.8, h * 0.956],
      [w * 0.8, h],
      [0, h],
    ],
    25,
  );
  const shoulder = (a, t) => {
    const rr = w * (0.985 - (t - 0.69) * 1.5) + 0.0014;
    return [x + Math.sin(a) * rr, y + h * t, z + Math.cos(a) * rr];
  };
  curvedStroke(r, paint("#c5b39b", "pottery"), shoulder, [
    [0.37, 0.705, 0.003],
    [0.48, 0.728, 0.014],
    [0.54, 0.752, 0.008],
    [0.59, 0.766, 0.002],
  ]);
  curvedStroke(r, ink, shoulder, [
    [-1.36, 0.76, 0.003],
    [-1.2, 0.772, 0.006],
    [-0.98, 0.778, 0.006],
    [-0.87, 0.783, 0.001],
  ]);
  cyl(r, rim, x, y + h * 0.964, z, w * 0.83, w * 0.83, h * 0.069, 24);
  cyl(r, m, x, y + h + 0.001, z, w * 0.62, w * 0.65, 0.003, 20);
}
function vial(r, x, y, z, w, h, m) {
  lathe(
    r,
    m,
    x,
    y,
    z,
    [
      [0, 0],
      [w * 0.85, 0],
      [w, 0.012],
      [w, h * 0.52],
      [w * 0.91, h * 0.6],
      [w * 0.46, h * 0.67],
      [w * 0.41, h * 0.86],
      [w * 0.53, h * 0.89],
      [w * 0.53, h * 0.93],
      [w * 0.35, h * 0.94],
      [0, h * 0.94],
    ],
    22,
  );
  cyl(r, darkWood, x, y + h * 0.97, z, w * 0.35, w * 0.34, h * 0.076, 12);
}
export default {
  create({ params, random }) {
    const r = new T.Group();
    const physics = { bodies: [], joints: [] };
    lamp(r, true, physics);
    lamp(r, false, physics);
    function looseCup(
      id,
      x,
      y,
      z,
      radius,
      height,
      m,
      count = 0,
      brushHeight = 0,
    ) {
      const g = group(r, x, y, z);
      g.name = id;
      if (count)
        brushcup(
          g,
          random,
          0,
          0,
          0,
          radius,
          height,
          m,
          count,
          brushHeight,
          0,
          x < 0,
        );
      else cup(g, 0, 0, 0, radius, height, m, true);
      const shape = roundShape(
        radius,
        height,
        [0, height / 2, 0],
        radius * 1.02,
      );
      physics.bodies.push({
        id,
        object: g,
        type: "dynamic",
        collider: "hull",
        shape,
        density: 760,
        friction: 0.72,
      });
    }
    const rear = 0.922;
    const jarShelf = 1.002;
    box(
      r,
      paint("#896443", "wood"),
      -0.013,
      0.959,
      -1.185,
      1.732,
      0.078,
      0.285,
      0.004,
    );
    box(
      r,
      paint("#af8a61", "wood"),
      -0.013,
      0.999,
      -1.185,
      1.75,
      0.009,
      0.293,
      0.002,
    );
    const note = group(r, -0.064, jarShelf, -1.201);
    for (let i = 0; i < 5; i++) {
      const page = box(
        note,
        i % 2 ? cream : paint("#ac8f6c"),
        i * 0.002,
        i * 0.0093 + 0.003,
        0,
        0.49 + (i % 3) * 0.03,
        0.008,
        0.21,
        0.001,
      );
      page.rotation.y = Math.sin(i * 1.61) * 0.03;
    }
    for (let i = 0; i < 3; i++) {
      const x = -1.154 + i * 0.078,
        z = -0.945 - (i % 2) * 0.014;
      box(
        r,
        paint(i === 1 ? "#b69068" : "#926f4c"),
        x,
        0.897,
        z,
        0.087,
        0.144 - i * 0.011,
        0.104,
        0.003,
      );
      box(r, cream, x + 0.001, 0.91, z + 0.052, 0.059, 0.057, 0.003, 0.001);
      box(r, paint("#646244"), x, 0.925, z + 0.055, 0.038, 0.0035, 0.001);
    }
    jar(r, -1.624, 0.829, -0.814, 0.062, 0.101, paint("#d2b48d"), bronze);
    jar(r, 1.196, rear, -1.19, 0.044, 0.096, paint("#667364", "enamel"), iron);
    brushcup(
      r,
      random,
      -1.73,
      rear,
      -1.135,
      0.076,
      0.212,
      paint("#c4572c", "enamel"),
      5,
      0.269,
    );
    brushcup(
      r,
      random,
      -1.098,
      rear,
      -1.172,
      0.083,
      0.262,
      paint("#bd9070"),
      8,
      0.338,
    );
    brushcup(
      r,
      random,
      -0.896,
      rear,
      -1.126,
      0.064,
      0.216,
      paint("#546171", "enamel"),
      4,
      0.222,
    );
    looseCup(
      "brush-jar",
      -1.293,
      0.825,
      -0.826,
      0.073,
      0.224,
      paint("#263d46", "enamel"),
      7,
      0.339,
    );
    looseCup("cream-mug", -0.947, 0.822, -0.655, 0.076, 0.181, cream);
    vial(r, -0.737, jarShelf, -1.22, 0.049, 0.276, paint("#a6512b", "enamel"));
    jar(
      r,
      -0.548,
      jarShelf,
      -1.138,
      0.069,
      0.095,
      paint("#855c3b", "enamel"),
      darkWood,
    );
    jar(
      r,
      -0.329,
      jarShelf,
      -1.142,
      0.07,
      0.139,
      paint("#243136", "enamel"),
      steel,
    );
    jar(
      r,
      -0.159,
      jarShelf,
      -1.094,
      0.068,
      0.149,
      paint("#24363d", "enamel"),
      iron,
    );
    jar(
      r,
      0.027,
      jarShelf,
      -1.109,
      0.063,
      0.09,
      paint("#e6dbbe", "enamel"),
      bronze,
    );
    jar(r, 0.201, jarShelf, -1.119, 0.069, 0.076, cream, steel);
    lathe(r, wood, 0.5, jarShelf, -1.125, [
      [0, 0],
      [0.063, 0.001],
      [0.064, 0.014],
      [0.036, 0.029],
      [0.038, 0.057],
      [0.074, 0.078],
      [0.095, 0.119],
      [0.093, 0.129],
      [0.085, 0.13],
      [0.076, 0.108],
      [0.035, 0.07],
    ]);
    vial(r, 0.688, jarShelf, -1.2, 0.045, 0.106, paint("#41584b", "enamel"));
    looseCup(
      "blue-mug",
      0.835,
      0.825,
      -0.615,
      0.066,
      0.177,
      paint(params.mugColor ?? "#315570", "enamel"),
    );
    brushcup(
      r,
      random,
      1.079,
      rear,
      -1.113,
      0.07,
      0.174,
      paint("#95422c", "enamel"),
      12,
      0.221,
    );
    brushcup(
      r,
      random,
      0.935,
      rear,
      -1.166,
      0.062,
      0.14,
      paint("#344853", "enamel"),
      5,
      0.156,
    );
    binding(
      r,
      1.52,
      rear,
      -1.153,
      0.48,
      0.063,
      0.254,
      paint("#9d764b"),
      -0.022,
    );
    binding(
      r,
      1.537,
      rear + 0.064,
      -1.167,
      0.474,
      0.061,
      0.256,
      paint("#54604f"),
      0.028,
    );
    box(
      r,
      paint("#34523f", "enamel"),
      1.335,
      0.956,
      -0.783,
      0.173,
      0.206,
      0.17,
      0.025,
    );
    cyl(r, iron, 1.337, 1.071, -0.785, 0.066, 0.068, 0.036, 17);
    // Crassula in a shallow earthenware bowl on the books.
    const h = rear + 0.127,
      x = 1.52,
      z = -1.17;
    lathe(r, paint("#454d3b", "enamel"), x, h, z, [
      [0, 0],
      [0.066, 0],
      [0.091, 0.013],
      [0.102, 0.055],
      [0.096, 0.062],
      [0.089, 0.06],
    ]);
    cyl(r, darkWood, x, h + 0.052, z, 0.089, 0.089, 0.006, 20);
    for (let i = 0; i < 9; i++) {
      const xx = x + (random() - 0.5) * 0.115,
        zz = z + (random() - 0.5) * 0.095,
        y = h + 0.11 + random() * 0.083;
      rod(r, paint("#454b2e"), [x, h + 0.05, z], [xx, y, zz], 0.004, 0.0024, 6);
      for (let j = 0; j < 3; j++) {
        const a = (i + j) * 2.4;
        const o = ball(
          r,
          paint(["#38472e", "#4c5935", "#3e4f32"][j]),
          xx + 0.02 * Math.sin(a),
          y - j * 0.023,
          zz + 0.017 * Math.cos(a),
          0.034,
          0.008,
          0.013,
        );
        o.rotation.y = a;
        o.rotation.z = 0.35 * Math.sin(a);
      }
    }
    physics.bodies.push({
      id: "jar-shelf",
      object: r,
      type: "static",
      collider: "box",
      shape: boxShape([1.75, 0.082, 0.293], [-0.013, 0.962, -1.185]),
    });
    return finish(r, physics);
  },
};
