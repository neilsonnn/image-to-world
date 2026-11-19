import { defineSceneModule } from "image-to-world/runtime";
import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  Vector3,
} from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  attribute,
  color,
  mix,
  mx_noise_float,
  positionLocal,
  smoothstep,
  vec3,
} from "three/tsl";

const TAU = Math.PI * 2;
const clamp = (x, min, max) => Math.max(min, Math.min(max, x));
const vec = (x, y, z) => new Vector3(x, y, z);
const blend = (a, b, t) => a.clone().lerp(b, t);
const screen = (u, v, z) =>
  vec((2 * u - 1) * 0.614 * (4.2 - z), 1.45 + (0.5 - v) * 0.689 * (4.2 - z), z);

// All the colour marks have ordinary three-dimensional positions. Each batch is
// one draw call; overlapping crowns and brush marks are still separate surfaces.
function batch(name, material, root, brushed = false) {
  const positions = [],
    colors = [],
    coverage = [],
    indices = [];
  function point(p, c, edge = 1) {
    const i = positions.length / 3;
    positions.push(p.x, p.y, p.z);
    colors.push(c.r, c.g, c.b);
    if (brushed) coverage.push(edge);
    return i;
  }
  const tri = (a, b, c) => indices.push(a, b, c);
  const quad = (a, b, c, d) => indices.push(a, b, c, a, c, d);
  function finish() {
    if (!positions.length) return;
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geo.setAttribute("pigment", new Float32BufferAttribute(colors, 3));
    if (brushed)
      geo.setAttribute("coverage", new Float32BufferAttribute(coverage, 1));
    geo.setIndex(indices);
    const mesh = new Mesh(geo, material);
    mesh.name = name;
    root.add(mesh);
  }
  return { point, tri, quad, finish };
}
function surface(type, dry) {
  const p = positionLocal,
    base = attribute("pigment", "vec3");
  const mat = new MeshBasicNodeMaterial({
    side: DoubleSide,
    toneMapped: false,
  });
  if (type === "sky") {
    const haze = mx_noise_float(p.mul(vec3(0.37, 0.8, 0.36)));
    const high = smoothstep(0.4, 8.5, p.y.add(haze.mul(0.36)));
    mat.colorNode = mix(base, color("#96bed2"), high.mul(0.68));
  } else {
    const bark = type === "bark";
    const tooth = mx_noise_float(
      p.mul(bark ? vec3(84, 16, 77) : vec3(57, 66, 56)),
    );
    const broken = mx_noise_float(
      p.mul(bark ? vec3(13, 1.4, 12) : vec3(9, 12, 9)),
    );
    const gouache = smoothstep(-0.13, 0.13, broken)
      .sub(0.5)
      .mul(bark ? 0.08 : 0.05);
    const pigment = base.mul(
      tooth
        .mul(0.095 * dry)
        .add(1)
        .add(gouache),
    );
    // Cooled indigo splits under dry ink. Fine pepper and the broader washes
    // share the same solid coordinates through the trunk and its side branches.
    const paper = mx_noise_float(p.mul(vec3(135, 160, 134)));
    const granulation = smoothstep(0.1, 0.52, paper).mul(0.24 * dry);
    if (bark) {
      const twist = mx_noise_float(p.mul(vec3(2.6, 0.87, 2.3)));
      const wash = mx_noise_float(
        vec3(p.x.mul(8.2).add(twist.mul(1.4)), p.y.mul(1.15), p.z.mul(3.6)),
      );
      const ink = smoothstep(0.12, 0.25, wash).mul(0.34);
      const blue = smoothstep(
        0.18,
        0.38,
        wash.negate().add(tooth.mul(0.11)),
      ).mul(0.28);
      mat.colorNode = mix(
        mix(mix(pigment, color("#173d40"), ink), color("#5e819e"), blue),
        color("#142f39"),
        granulation,
      );
    } else if (type === "leaf") {
      const drag = mx_noise_float(
        vec3(p.x.mul(67).add(p.y.mul(32)), p.y.mul(139), p.z.mul(102)),
      );
      const well = smoothstep(-0.07, 0.23, broken);
      const fleck = smoothstep(0.19, 0.49, drag.add(paper.mul(0.25)))
        .mul(well)
        .mul(0.45 * dry);
      mat.colorNode = mix(pigment, color("#243a37"), fleck).mul(
        paper.mul(0.17 * dry).add(1),
      );
      mat.opacityNode = attribute("coverage", "float")
        .add(drag.mul(0.41))
        .add(tooth.mul(0.15));
      mat.alphaTest = 0.11;
    } else mat.colorNode = pigment;
  }
  return mat;
}

export default defineSceneModule({
  create({ params = {}, random }) {
    const root = new Group();
    const dry = clamp(Number(params.paperTooth ?? 1), 0, 2);
    const density = clamp(Number(params.leafDensity ?? 1), 0.35, 1.9);
    const sky = new Color(params.sky ?? "#edf5f2"),
      meadow = new Color(params.meadow ?? "#9ab76b");
    const range = (a, b) => a + (b - a) * random();
    const choose = (items) =>
      items[Math.min(items.length - 1, Math.floor(random() * items.length))];
    const paint = (hex) => new Color(hex);
    const bark = batch(
      "Alder trunks and pulled bark strokes",
      surface("bark", dry),
      root,
    );
    const foliage = batch(
      "Layered gouache, leaves, and seed heads",
      surface("leaf", dry),
      root,
      true,
    );
    const land = batch("Meadow banks", surface("land", dry), root);
    const air = batch("Daylight above the woodland", surface("sky", dry), root);

    // Curved cyclorama behind the modeled middle distance, wrapping the side windows.
    for (let i = 0; i < 30; i++) {
      const a = (TAU * i) / 30,
        b = (TAU * (i + 1)) / 30,
        r = 19;
      air.quad(
        ...[
          [a, -3],
          [b, -3],
          [b, 13],
          [a, 13],
        ].map(([t, y]) =>
          air.point(vec(r * Math.sin(t), y, 4.2 - r * Math.cos(t)), sky),
        ),
      );
    }
    function ground(x, z) {
      const ridge = clamp((-z - 6.0) / 5.3, 0, 1);
      return (
        0.44 +
        Math.min(1, Math.max(0, (-z - 2) / 4)) * 0.37 +
        0.39 * Math.sin(x * 0.73 - z * 0.24) +
        0.23 * Math.cos(x * 0.62 + z * 0.52) +
        0.14 * Math.sin(z * 1.0 - x * 0.28) +
        ridge * (0.78 + 0.15 * Math.cos(x * 0.9))
      );
    }
    const grassShadow = paint("#3f7154"),
      grassLight = meadow;
    let prev;
    for (let j = 0; j <= 34; j++) {
      const row = [];
      for (let i = 0; i <= 52; i++) {
        const x = (i - 26) * 0.58,
          z = -1.83 - j * 0.47;
        const h = ground(x, z);
        const t = clamp(
          0.63 +
            0.26 * Math.sin(x * 1.1 + z * 0.68) +
            0.17 * Math.cos(z * 1.63 - x) +
            range(-0.05, 0.05),
          0,
          1,
        );
        row.push(land.point(vec(x, h, z), blend(grassShadow, grassLight, t)));
        if (i && j) land.quad(prev[i - 1], prev[i], row[i], row[i - 1]);
      }
      prev = row;
    }

    // Irregular cross-section tapers continuously through every bend. The azimuth
    // colours shape each trunk, while narrow tapered strips describe bark fissures.
    function timber(path, radii, palette, fissures = 3, sides = 9) {
      const phase = range(0, 0.42),
        section = Array.from({ length: sides }, () => range(0.89, 1.07));
      const shade = paint(palette[0]),
        sun = paint(palette[1]),
        edge = paint(palette[2] ?? palette[0]);
      function onRing(i, t, d = 1) {
        const p = path[i],
          a = phase + (t * TAU) / sides;
        const k = ((Math.round(t) % sides) + sides) % sides;
        return vec(
          p.x + Math.cos(a) * radii[i] * section[k] * d,
          p.y,
          p.z + Math.sin(a) * radii[i] * section[k] * d,
        );
      }
      for (let k = 0; k < sides; k++) {
        const a = phase + ((k + 0.5) * TAU) / sides,
          v = clamp(0.56 - 0.37 * Math.cos(a) - 0.22 * Math.sin(2.3 * a), 0, 1);
        const pigment = blend(shade, sun, v);
        let last = [];
        for (let i = 0; i < path.length; i++) {
          const c = pigment
            .clone()
            .multiplyScalar(0.94 + 0.05 * Math.sin(i + k * 0.7));
          const pair = [
            bark.point(onRing(i, k), c),
            bark.point(onRing(i, k + 1), c),
          ];
          if (i) bark.quad(last[0], last[1], pair[1], pair[0]);
          last = pair;
        }
      }
      for (let f = 0; f < fissures; f++) {
        const k = range(0, sides),
          start = Math.floor(range(0, Math.max(1, path.length - 3)));
        const end = Math.min(path.length - 1, start + Math.floor(range(2, 6)));
        let last;
        for (let i = start; i <= end; i++) {
          const t = (i - start) / (end - start),
            drift = 0.27 * Math.sin(t * 7 + f) + t * 0.17;
          const w = (0.006 + 0.057 * Math.sin(t * Math.PI)) * range(0.8, 1.2);
          const c = blend(edge, shade, range(0, 0.53));
          const pair = [
            bark.point(onRing(i, k + drift - w, 1.017), c),
            bark.point(onRing(i, k + drift + w, 1.017), c),
          ];
          if (last) bark.quad(last[0], last[1], pair[1], pair[0]);
          last = pair;
        }
      }
    }
    function sapling(x, z, height, r, palette, boughs) {
      const y = ground(x, z) - 0.2,
        lean = range(-0.29, 0.29) * height;
      const path = [],
        radii = [];
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        path.push(
          vec(
            x + t * lean + 0.025 * height * Math.sin(t * 4.8),
            y + t * height,
            z + 0.09 * height * Math.sin(t * 3),
          ),
        );
        radii.push(r * (1 - 0.85 * t));
      }
      timber(path, radii, palette, 4, 7);
      for (let i = 0; i < boughs; i++) {
        const n = Math.floor(range(2, 5)),
          base = path[n];
        const sign = i % 2 ? 1 : -1;
        timber(
          [
            base,
            base
              .clone()
              .add(vec(sign * height * 0.1, height * 0.07, range(-0.16, 0.16))),
            base
              .clone()
              .add(
                vec(sign * height * 0.22, height * 0.27, range(-0.27, 0.27)),
              ),
          ],
          [r * 0.49, r * 0.27, r * 0.06],
          palette,
          0,
          6,
        );
      }
    }
    // Large near trunk straddles the crossbar to the left of centre.
    const alder = ["#214953", "#426682", "#16333f"];
    const signature = [
      [0.477, 0.62, -4.65, 0.36],
      [0.48, 0.46, -4.69, 0.325],
      [0.475, 0.36, -4.7, 0.29],
      [0.474, 0.24, -4.73, 0.286],
      [0.468, 0.14, -4.75, 0.31],
      [0.47, 0.025, -4.8, 0.3],
      [0.456, -0.12, -4.9, 0.25],
      [0.446, -0.24, -5, 0.18],
    ];
    const main = signature.map(([u, v, z]) => screen(u, v, z));
    timber(
      main,
      signature.map((a) => a[3]),
      alder,
      18,
      15,
    );
    function branch(points, rs, pal = alder) {
      timber(
        points.map((args) => screen(...args)),
        rs,
        pal,
        3,
        7,
      );
    }
    branch(
      [
        [0.474, 0.31, -4.72],
        [0.499, 0.25, -4.84],
        [0.514, 0.17, -4.9],
        [0.532, 0.095, -5.12],
        [0.532, 0.045, -5.1],
      ],
      [0.1, 0.075, 0.057, 0.033, 0.013],
    );
    branch(
      [
        [0.47, 0.18, -4.78],
        [0.453, 0.144, -4.82],
        [0.426, 0.124, -5],
        [0.393, 0.112, -5.1],
      ],
      [0.076, 0.063, 0.035, 0.01],
    );
    const blue = ["#587994", "#809ab0", "#455d76"];
    branch(
      [
        [0.543, 0.53, -8.8],
        [0.549, 0.395, -8.8],
        [0.545, 0.315, -8.85],
        [0.544, 0.208, -8.95],
        [0.534, 0.107, -9],
        [0.538, -0.056, -9.15],
      ],
      [0.16, 0.145, 0.13, 0.11, 0.102, 0.075],
      blue,
    );
    branch(
      [
        [0.545, 0.315, -8.85],
        [0.558, 0.27, -8.84],
        [0.568, 0.21, -8.9],
        [0.584, 0.16, -8.96],
      ],
      [0.076, 0.049, 0.025, 0.01],
      blue,
    );
    branch(
      [
        [0.55, 0.24, -8.86],
        [0.578, 0.216, -8.9],
        [0.594, 0.176, -8.95],
      ],
      [0.033, 0.018, 0.005],
      blue,
    );
    branch(
      [
        [0.667, 0.54, -5.82],
        [0.661, 0.4, -5.89],
        [0.672, 0.27, -5.99],
        [0.676, 0.12, -6.09],
        [0.686, -0.06, -6.2],
      ],
      [0.33, 0.32, 0.285, 0.245, 0.22],
      ["#264a50", "#426878", "#213d4a"],
    );
    branch(
      [
        [0.665, 0.35, -5.86],
        [0.646, 0.292, -6],
        [0.634, 0.21, -6.1],
        [0.608, 0.14, -6.19],
      ],
      [0.16, 0.11, 0.05, 0.015],
    );
    branch(
      [
        [0.283, 0.56, -6.21],
        [0.296, 0.42, -6.25],
        [0.302, 0.31, -6.26],
        [0.319, 0.21, -6.31],
        [0.346, 0.131, -6.3],
        [0.385, 0.093, -6.28],
      ],
      [0.16, 0.133, 0.105, 0.076, 0.052, 0.012],
    );
    branch(
      [
        [0.302, 0.31, -6.26],
        [0.331, 0.313, -6.18],
        [0.353, 0.295, -6.06],
        [0.383, 0.26, -5.96],
      ],
      [0.09, 0.058, 0.032, 0.01],
    );
    branch(
      [
        [0.47, 0.09, -4.78],
        [0.44, 0.064, -4.95],
        [0.408, 0.029, -5.26],
        [0.373, 0.032, -6.13],
      ],
      [0.13, 0.09, 0.051, 0.015],
    );
    branch(
      [
        [0.672, 0.16, -5.97],
        [0.65, 0.127, -6.04],
        [0.623, 0.081, -6.36],
        [0.593, 0.07, -6.51],
      ],
      [0.117, 0.081, 0.037, 0.01],
    );
    branch(
      [
        [0.663, 0.37, -5.86],
        [0.646, 0.353, -6.02],
        [0.621, 0.371, -6.17],
        [0.595, 0.388, -6.41],
      ],
      [0.12, 0.071, 0.04, 0.012],
    );
    const distant = ["#7993a4", "#9ab2c1", "#718da0"];
    for (let i = 0; i < 49; i++) {
      const z = range(-14, -8.1),
        u = range(-0.25, 1.3);
      if (u > 0.33 && u < 0.7 && random() < 0.84) continue;
      const p = screen(u, 0.5, z);
      sapling(
        p.x,
        z,
        range(2.1, 5.5),
        range(0.045, 0.23),
        choose([blue, distant, alder]),
        3,
      );
    }

    // A crown consists of asymmetric paint-shaped volumes and tapered folded leaves.
    // Small leaf sprays extend past the hull and break the outline into brush marks.
    // Keep fine mark variation independent from the generator that places
    // major crowns, so the canopy composition stays fixed while editing detail.
    let brushSeed = 918374;
    function brush() {
      brushSeed = (Math.imul(1664525, brushSeed) + 1013904223) >>> 0;
      return brushSeed / 4294967296;
    }
    function leaf(c, size, pigment, angle, pitch) {
      const width = size * range(0.17, 0.3);
      const length = size * (0.58 + 0.42 * brush()),
        arched = (brush() - 0.4) * width * 1.3;
      const axis = vec(Math.cos(angle), Math.sin(angle), pitch);
      const side = vec(-Math.sin(angle), Math.cos(angle), 0.1);
      const offset = (t, v, depth) =>
        c
          .clone()
          .addScaledVector(axis, length * t)
          .addScaledVector(side, v * width + arched * (1 - 4 * t * t))
          .add(vec(0, 0, size * depth));
      const ridge = foliage.point(offset(0.02, 0.02, 0.16), pigment, 1);
      // Short, off-centre shoulders leave each leaf with a rounded brush heel,
      // a shallow notch and a dragged, tapered end.
      const outline = [
        [-0.53, -0.03],
        [-0.4, 0.48],
        [-0.19, 0.93],
        [0.04, 0.89],
        [0.21, 0.44],
        [0.42, 0.33],
        [0.58, 0.025],
        [0.35, -0.36],
        [0.11, -0.78],
        [-0.17, -0.71],
        [-0.4, -0.49],
      ];
      const ring = outline.map(([t, v]) =>
        foliage.point(
          offset(t, v * (0.72 + 0.34 * brush()), 0.03 * v),
          pigment.clone().multiplyScalar(v < 0 ? 0.89 : 1),
          -0.06 + 0.22 * brush(),
        ),
      );
      for (let k = 0; k < ring.length; k++)
        foliage.tri(ridge, ring[k], ring[(k + 1) % ring.length]);
    }
    // Arcs follow the actual convex leaf masses. Some terminate inside the
    // body; some extend over its silhouette as a sliver of light or dark ink.
    function crescent(center, normal, size, width, curvature, angle, pigment) {
      const tangent = vec(1, 0, 0);
      tangent.addScaledVector(normal, -normal.x);
      if (tangent.lengthSq() < 0.01)
        tangent.copy(vec(0, 0, 1)).addScaledVector(normal, -normal.z);
      tangent.normalize();
      const bitangent = normal.clone().cross(tangent).normalize();
      const u = tangent
        .clone()
        .multiplyScalar(Math.cos(angle))
        .addScaledVector(bitangent, Math.sin(angle));
      const v = tangent
        .clone()
        .multiplyScalar(-Math.sin(angle))
        .addScaledVector(bitangent, Math.cos(angle));
      let prior;
      for (let k = 0; k < 5; k++) {
        const t = k / 4,
          arch = Math.sin(t * Math.PI),
          mid = center
            .clone()
            .addScaledVector(u, (t - 0.5) * size)
            .addScaledVector(v, curvature * arch)
            .addScaledVector(normal, 0.002 + arch * 0.004);
        const widthAtTip = width * (0.05 + 0.95 * arch);
        const pair = [
          foliage.point(
            mid.clone().addScaledVector(v, -widthAtTip * 0.55),
            pigment,
            0.38,
          ),
          foliage.point(
            mid.clone().addScaledVector(v, widthAtTip * 0.55),
            pigment,
            0.91,
          ),
        ];
        if (prior) foliage.quad(prior[0], prior[1], pair[1], pair[0]);
        prior = pair;
      }
    }
    function daub(c, rx, ry, rz, pigment) {
      // A flattened, gently scalloped and lopsided solid, recognizable edge-on too.
      const m = 11,
        rings = [],
        shell = [],
        phase = range(0, TAU),
        drift = range(-0.34, 0.34);
      for (let j = 0; j < 3; j++) {
        const ring = [],
          samples = [];
        const y = [-0.64, 0, 0.67][j],
          width = [0.72, 1, 0.73][j];
        for (let k = 0; k < m; k++) {
          const t = phase + (k * TAU) / m,
            rad = width * range(0.8, 1.16);
          const p = vec(
            c.x + (Math.cos(t) * rad + drift * y) * rx,
            c.y + (y + range(-0.22, 0.21)) * ry,
            c.z + Math.sin(t) * rad * rz,
          );
          samples.push(p);
          ring.push(
            foliage.point(
              p,
              pigment
                .clone()
                .multiplyScalar(0.94 + j * 0.045 + range(-0.025, 0.025)),
            ),
          );
          if (j && k)
            foliage.quad(
              rings[j - 1][k - 1],
              rings[j - 1][k],
              ring[k],
              ring[k - 1],
            );
        }
        if (j)
          foliage.quad(
            rings[j - 1][m - 1],
            rings[j - 1][0],
            ring[0],
            ring[m - 1],
          );
        rings.push(ring);
        shell.push(samples);
      }
      const top = foliage.point(
        c.clone().add(vec(drift * rx, ry * 0.94, -rz * 0.05)),
        pigment,
      );
      const bottom = foliage.point(
        c.clone().add(vec(-drift * rx, -ry * 0.89, rz * 0.08)),
        pigment,
      );
      for (let i = 0; i < m; i++) {
        foliage.tri(top, rings[2][i], rings[2][(i + 1) % m]);
        foliage.tri(bottom, rings[0][i], rings[0][(i + 1) % m]);
      }
      // Dip the brush again for each small group. Pearly marks collect along
      // sunlit side edges; irregular dark comma strokes curl under the leaves.
      if (c.z > -9.5 && c.z < -3.0 && Math.abs(c.x) < 5) {
        const green = pigment.g > pigment.b * 1.18;
        const sunColor = paint(green ? "#d4d5a6" : "#b2c2bb"),
          bright = paint("#f0edd0");
        const dark = blend(pigment, paint("#152e2d"), 0.78);
        const periphery = brush() < 0.4 ? 4 : 2;
        for (let k = 0; k < periphery; k++) {
          const angle = brush() * TAU;
          let index = Math.floor((((angle - phase + TAU * 2) % TAU) * m) / TAU);
          index = Math.min(m - 1, index);
          const next = (index + 1) % m;
          const f = brush(),
            band = brush() < 0.79 ? 1 : 0;
          const low = shell[band][index].clone().lerp(shell[band][next], f);
          const high = shell[band + 1][index]
            .clone()
            .lerp(shell[band + 1][next], f);
          const p = low.clone().lerp(high, brush() * 0.85 + 0.14);
          const n = vec(
            (p.x - c.x) / (rx * rx),
            (p.y - c.y) / (ry * ry),
            (p.z - c.z) / (rz * rz),
          ).normalize();
          if (n.z < -0.35) continue;
          const onSun = green && n.y > 0.12 && brush() > 0.2;
          const b = brush() * 2 - 0.86,
            amount = onSun
              ? 5 + Math.floor(brush() * 10)
              : 3 + Math.floor(brush() * 7);
          const axis = vec(Math.cos(b), Math.sin(b), 0.22);
          axis.addScaledVector(n, -axis.dot(n)).normalize();
          const side = n.clone().cross(axis);
          for (let q = 0; q < amount; q++) {
            const length = 0.009 + brush() * (onSun ? 0.027 : 0.05);
            const mark = p
              .clone()
              .addScaledVector(n, 0.012)
              .addScaledVector(
                axis,
                (q - amount * 0.5) * 0.009 + (brush() - 0.5) * 0.018,
              )
              .addScaledVector(side, (brush() - 0.5) * 0.043);
            const ink = onSun ? (brush() < 0.31 ? bright : sunColor) : dark;
            crescent(
              mark,
              n,
              length,
              length * (onSun ? 0.31 + 0.36 * brush() : 0.13 + 0.22 * brush()),
              length * (0.13 + 0.3 * brush()),
              b + (brush() - 0.5) * 1.8,
              ink,
            );
          }
        }
      }
    }
    function crown(c, rx, ry, rz, hexes, n = 18) {
      const swatches = hexes.map(paint);
      n = Math.round(n * (0.55 + 0.45 * density));
      daub(c, rx * 0.76, ry * 0.65, rz * 0.7, swatches[0]);
      for (let j = 0; j < n; j++) {
        const t = range(0, TAU),
          h = range(-0.87, 0.89),
          d = Math.sqrt(1 - h * h),
          scale = range(0.12, 0.32);
        const p = c
          .clone()
          .add(
            vec(
              rx * d * Math.cos(t) * range(0.53, 1),
              ry * h,
              rz * d * Math.sin(t) * range(0.55, 1),
            ),
          );
        const index = clamp(
          Math.floor(
            (h * 0.36 + 0.36 * Math.cos(t - 2.8) + range(0.15, 0.85)) *
              swatches.length,
          ),
          0,
          swatches.length - 1,
        );
        const col = swatches[index],
          w = rx * scale * range(0.8, 1.2),
          ht = ry * scale * range(0.65, 1.15),
          dep = rz * scale;
        daub(p, w, ht, dep, col);
        for (let k = 0; k < Math.round(12 * density); k++) {
          const phi = range(-Math.PI, Math.PI),
            v = range(-0.82, 0.95),
            flat = Math.sqrt(1 - v * v);
          const mark = p
            .clone()
            .add(
              vec(Math.cos(phi) * w * flat, ht * v, Math.sin(phi) * flat * dep),
            );
          const leafColor =
            swatches[
              clamp(
                index + (random() < 0.24 ? 1 : random() < 0.2 ? -1 : 0),
                0,
                swatches.length - 1,
              )
            ];
          leaf(
            mark,
            range(0.052, 0.19) * Math.max(0.55, Math.min(2, rx)),
            leafColor,
            range(-0.9, 1.42),
            range(-0.8, 0.8),
          );
        }
        // A brush-loaded twig touches the near face, then separates into fours
        // and fives at the edge. Groups of marks share an angle and pigment.
        for (let spray = 0; spray < 3; spray++) {
          const phi = range(-2.65, 0.35),
            start = p
              .clone()
              .add(vec(w * Math.sin(phi), ht * range(-0.42, 0.84), dep * 0.75));
          const step = range(0.032, 0.083) * clamp(rx, 0.6, 1.4),
            angle = range(-0.47, 0.85) + (spray % 2 ? 0 : 2.75);
          const tone =
            swatches[
              clamp(index + (random() < 0.55 ? 1 : -1), 0, swatches.length - 1)
            ];
          const length = Math.round(range(4, 8) * density);
          for (let blade = 0; blade < length; blade++) {
            const point = start
              .clone()
              .add(
                vec(
                  Math.cos(angle) * step * blade,
                  Math.sin(angle) * step * blade,
                  step * blade * 0.3,
                ),
              );
            leaf(
              point,
              step * range(1.3, 2.8),
              tone,
              angle + (blade % 2 ? 1 : -1) * range(0.38, 0.96),
              range(-0.6, 0.8),
            );
          }
        }
      }
    }
    const deep = ["#16383e", "#20464b", "#2e515c", "#486b75"];
    const forest = ["#274d48", "#315d57", "#44745e", "#65956d"];
    const haze = ["#7995a9", "#8aa7ba", "#a2bdc6", "#b5cdd0"];
    const light = ["#4e7954", "#739e61", "#9cb777", "#b4c888"];
    const shade = ["#244c53", "#2c575c", "#366576", "#577f82"];
    const middle = ["#3f697a", "#51768c", "#6d91a7", "#92adbc"];
    function vista(u, v, z, rx, ry, rz, colors, n) {
      crown(screen(u, v, z), rx * 1.18, ry * 1.22, rz, colors, n);
    }
    for (let i = 0; i < 25; i++) {
      const u = -0.35 + i * 0.075,
        z = range(-14.5, -12.4);
      vista(
        u,
        0.38 + range(-0.032, 0.028),
        z,
        range(0.99, 1.9),
        range(0.44, 0.84),
        range(0.5, 1.4),
        haze,
        10,
      );
    }
    for (let i = 0; i < 22; i++) {
      const u = -0.27 + i * 0.072,
        z = range(-11.45, -9.46);
      vista(
        u,
        0.42 + range(-0.037, 0.055),
        z,
        range(0.55, 1.05),
        range(0.31, 0.67),
        range(0.6, 1.3),
        middle,
        12,
      );
      if (u < 0.29 || u > 0.73)
        vista(
          u,
          range(0.05, 0.34),
          z,
          range(0.52, 1.11),
          range(0.49, 0.91),
          range(0.65, 1.8),
          choose([forest, middle, light]),
          17,
        );
    }
    // Leave strips of pale sky between the canopy crown, the tall blue trunks,
    // and the airy, yellow-green understory immediately outside the window.
    vista(0.375, 0.145, -6.28, 0.5, 0.36, 0.56, deep, 21);
    vista(0.365, 0.074, -6.55, 0.6, 0.26, 0.74, shade, 17);
    vista(0.39, 0.27, -5.92, 0.52, 0.245, 0.58, light, 22);
    vista(0.345, 0.316, -5.8, 0.47, 0.31, 0.5, forest, 19);
    vista(0.397, 0.405, -5.51, 0.48, 0.187, 0.5, forest, 17);
    vista(0.399, 0.455, -5.0, 0.49, 0.16, 0.45, light, 17);
    vista(0.406, 0.523, -5.16, 0.48, 0.19, 0.45, forest, 15);
    vista(0.472, 0.006, -4.89, 0.91, 0.41, 0.81, deep, 25);
    vista(0.529, 0.053, -6.43, 0.64, 0.239, 0.7, deep, 22);
    vista(0.57, 0.016, -7.16, 0.61, 0.24, 0.65, shade, 15);
    vista(0.565, 0.139, -7.37, 0.29, 0.105, 0.42, middle, 13);
    vista(0.536, 0.239, -8.0, 0.29, 0.136, 0.34, middle, 17);
    vista(0.613, 0.2, -6.58, 0.27, 0.14, 0.4, shade, 13);
    vista(0.642, 0.095, -6.27, 0.55, 0.35, 0.64, deep, 20);
    vista(0.655, 0.286, -6.0, 0.43, 0.32, 0.63, deep, 22);
    vista(0.582, 0.391, -6.87, 0.5, 0.19, 0.54, shade, 17);
    vista(0.529, 0.442, -5.17, 0.51, 0.19, 0.6, shade, 23);
    vista(0.498, 0.487, -5.64, 0.27, 0.14, 0.45, forest, 14);
    vista(0.612, 0.52, -5.34, 0.43, 0.125, 0.51, light, 18);
    vista(0.658, 0.444, -5.66, 0.38, 0.14, 0.51, light, 14);
    vista(0.464, 0.538, -5.56, 0.35, 0.104, 0.4, light, 13);
    vista(0.365, 0.051, -5.98, 0.56, 0.248, 0.64, deep, 26);
    vista(0.425, 0.008, -5.14, 0.57, 0.33, 0.6, deep, 23);
    vista(0.511, 0.002, -5.58, 0.65, 0.36, 0.63, deep, 28);
    vista(0.587, 0.082, -6.39, 0.41, 0.31, 0.55, shade, 18);
    vista(0.59, 0.034, -6.56, 0.52, 0.26, 0.54, deep, 22);
    vista(0.625, 0.073, -6.24, 0.47, 0.36, 0.54, deep, 19);
    vista(0.364, 0.289, -5.52, 0.42, 0.3, 0.41, light, 23);
    vista(0.342, 0.384, -5.74, 0.61, 0.32, 0.52, forest, 19);
    vista(0.376, 0.462, -5.19, 0.54, 0.24, 0.43, forest, 18);
    vista(0.417, 0.491, -5.0, 0.4, 0.162, 0.37, light, 13);
    vista(0.502, 0.485, -4.94, 0.41, 0.24, 0.52, shade, 24);
    vista(0.557, 0.46, -5.79, 0.48, 0.21, 0.54, shade, 20);
    vista(0.581, 0.425, -6.41, 0.36, 0.198, 0.55, shade, 17);
    vista(0.613, 0.35, -6.26, 0.43, 0.25, 0.47, shade, 22);
    vista(0.665, 0.365, -5.88, 0.49, 0.27, 0.48, deep, 20);
    vista(0.483, 0.556, -4.95, 0.6, 0.13, 0.61, forest, 23);
    vista(0.494, 0.087, -5.36, 0.49, 0.25, 0.46, deep, 16);
    vista(0.419, 0.131, -5.99, 0.31, 0.112, 0.41, deep, 18);
    vista(0.47, 0.512, -3.98, 0.21, 0.109, 0.36, shade, 16);
    vista(0.455, 0.555, -3.76, 0.36, 0.106, 0.32, light, 15);
    // A sprig immediately outside the tiny shaded porthole. Only pinpricks
    // of the sunlit woodland show between the broad blue-green leaves.
    const porthole = ["#294a48", "#355855", "#40615c", "#4a6862"];
    vista(-0.011, 0.524, -2.37, 0.6, 0.52, 0.36, porthole, 19);
    for (let i = 0; i < 26; i++) {
      const u = i % 2 ? range(0.746, 1.29) : range(-0.3, 0.28);
      const z = range(-7.2, -4.03);
      vista(
        u,
        range(0.17, 0.54),
        z,
        range(0.28, 0.79),
        range(0.18, 0.5),
        range(0.39, 0.72),
        choose([forest, light, shade]),
        13,
      );
    }
    // Spikes, dry blades and glints on the real undulating meadow surface.
    for (let j = 0; j < 3700 * density; j++) {
      const x = range(-11.4, 11.4),
        z = range(-13, -1.92),
        y = ground(x, z) + 0.019;
      const tint = choose([
        meadow,
        paint("#6a8d60"),
        paint("#bed18b"),
        paint("#729563"),
      ]);
      const w = range(0.008, 0.029),
        h = range(0.028, 0.126);
      const a = land.point(vec(x - w, y, z), tint),
        b = land.point(vec(x + w, y, z + 0.009), tint);
      land.tri(
        a,
        b,
        land.point(
          vec(x + range(-0.038, 0.054), y + h, z + range(-0.02, 0.04)),
          tint,
        ),
      );
    }
    for (const b of [air, land, bark, foliage]) b.finish();
    return { object: root, physics: { bodies: [] } };
  },
});
