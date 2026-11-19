import { boxShape, roundShape, compound } from "./colliders.mjs";
import { defineSceneModule } from "image-to-world/runtime";
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  Mesh,
  Vector2,
  Vector3,
} from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  abs,
  attribute,
  color,
  dot,
  mix,
  mx_noise_float,
  normalLocal,
  normalView,
  positionLocal,
  positionViewDirection,
  smoothstep,
  vec3,
} from "three/tsl";

const tau = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rgb = (value) => new Color(value);
function pigment(shadow, light, type = "clay") {
  const n = normalLocal,
    p = positionLocal;
  const grain = mx_noise_float(
    p.mul(type === "wood" ? vec3(4, 84, 42) : vec3(107, 92, 105)),
  );
  const mass = dot(n, vec3(-0.63, 0.44, 0.45));
  const paint = new MeshBasicNodeMaterial({
    side: DoubleSide,
    toneMapped: false,
  });
  paint.colorNode = mix(
    color(shadow),
    color(light),
    smoothstep(-0.32, 0.0, mass.add(grain.mul(0.04)))
      .mul(0.68)
      .add(0.11),
  ).mul(grain.mul(0.065).add(1));
  return paint;
}
function amber(tint) {
  const n = normalLocal,
    p = positionLocal;
  const tooth = mx_noise_float(p.mul(113));
  const fault = mx_noise_float(p.mul(vec3(19, 9, 23)));
  const shade = smoothstep(-0.26, 0.17, n.x.add(fault.mul(0.105)));
  const leftRim = smoothstep(0.023, 0.069, abs(n.x.add(0.72))).oneMinus();
  const broadReflection = smoothstep(0.65, 0.82, n.x.add(fault.mul(0.042))).mul(
    smoothstep(-0.52, 0.06, n.z),
  );
  const shoulder = smoothstep(0.12, 0.36, n.y).mul(smoothstep(-0.2, 0.35, n.x));
  const silhouette = smoothstep(
    0.02,
    0.19,
    abs(dot(normalView, positionViewDirection)),
  );
  let body = mix(color("#31291e"), color(tint), shade.mul(0.7).add(0.12));
  body = mix(
    body,
    color("#bab0a1"),
    broadReflection.mul(0.69).add(shoulder.mul(0.6)).clamp(0, 0.94),
  );
  body = mix(body, color("#f7d89a"), leftRim.mul(0.73));
  const spark = smoothstep(
    0.032,
    0.008,
    abs(n.x.sub(0.58).add(fault.mul(0.08))),
  ).mul(smoothstep(0.13, 0.4, p.y.add(fault.mul(0.05))));
  body = mix(body, color("#fff1d8"), spark.mul(0.82));
  const mat = new MeshBasicNodeMaterial({
    toneMapped: false,
    side: DoubleSide,
  });
  mat.colorNode = mix(
    color("#28241b"),
    body,
    silhouette.mul(0.78).add(0.22),
  ).mul(tooth.mul(0.072).add(1));
  return mat;
}

function leavesSurface() {
  const p = positionLocal,
    n = normalLocal;
  const blade = attribute("blade", "vec2"),
    ink = attribute("paint", "vec3");
  const noise = mx_noise_float(p.mul(vec3(115, 101, 106)));
  const angle = dot(n, vec3(-0.66, 0.76, -0.12));
  const fold = smoothstep(0.09, 0.32, angle.add(noise.mul(0.04)))
    .mul(0.26)
    .add(0.79);
  const glaze = smoothstep(0.8, 0.96, blade.x)
    .mul(smoothstep(0.13, 0.4, blade.y))
    .mul(smoothstep(0.96, 0.69, blade.y))
    .mul(0.17);
  const mat = new MeshBasicNodeMaterial({
    toneMapped: false,
    side: DoubleSide,
  });
  mat.colorNode = mix(ink.mul(fold), color("#7c8c62"), glaze).mul(
    noise.mul(0.08).add(1),
  );
  return mat;
}
export default defineSceneModule({
  create({ params = {}, random }) {
    const root = new Group(),
      leafPos = [],
      leafData = [],
      leafColors = [],
      indices = [];
    const range = (a, b) => a + (b - a) * random();
    const density = clamp(Number(params.bladeDensity ?? 1), 0.42, 1.8);
    const leafTint = rgb(params.leafTone ?? "#274235");
    const potDark = pigment("#1c271e", "#535340"),
      earth = pigment("#251e16", "#4d3c2b");
    const rim = pigment("#273026", "#63614a"),
      wood = pigment("#563c25", "#97754d", "wood");
    const darkWood = pigment("#3c3022", "#6c543b", "wood");
    function part(g, m, x, y, z, name) {
      const mesh = new Mesh(g, m);
      mesh.name = name;
      mesh.position.set(x, y, z);
      root.add(mesh);
      return mesh;
    }
    const box = (x, y, z, w, h, d, m) =>
      part(new BoxGeometry(w, h, d), m, x, y, z, "Window shelf");
    function lathe(x, y, z, profile, m, name) {
      return part(
        new LatheGeometry(
          profile.map((v) => new Vector2(...v)),
          31,
        ),
        m,
        x,
        y,
        z,
        name,
      );
    }
    function stick(start, end, ra, rb, m, name) {
      const a = new Vector3(...start),
        b = new Vector3(...end),
        line = b.clone().sub(a);
      const mesh = part(
        new CylinderGeometry(rb, ra, line.length(), 7),
        m,
        ...a.clone().lerp(b, 0.5).toArray(),
        name,
      );
      mesh.quaternion.setFromUnitVectors(
        new Vector3(0, 1, 0),
        line.normalize(),
      );
      return mesh;
    }
    // A short return continues the rear desk shelf to the tree trunk.
    box(2.48, 0.89, -1.05, 0.9, 0.06, 0.63, wood);
    for (const x of [2.16, 2.79]) {
      box(x, 0.72, -1.26, 0.065, 0.32, 0.06, darkWood);
      stick(
        [x, 0.59, -1.26],
        [x, 0.86, -0.84],
        0.027,
        0.024,
        darkWood,
        "Shelf bracket",
      );
    }
    const shelfShape = compound(
      boxShape([0.9, 0.06, 0.63], [2.48, 0.89, -1.05]),
    );
    function pot(x, z, r, h) {
      shelfShape.add(roundShape(r * 0.72, h, [x, 0.921 + h / 2, z], r));
      lathe(
        x,
        0.921,
        z,
        [
          [0, 0],
          [r * 0.66, 0],
          [r * 0.74, 0.015],
          [r * 0.86, h * 0.42],
          [r, h * 0.86],
          [r * 0.99, h],
          [r * 0.88, h],
          [r * 0.86, h * 0.9],
        ],
        potDark,
        "Stoneware planter",
      );
      lathe(
        x,
        0.921,
        z,
        [
          [r * 0.99, h * 0.88],
          [r * 1.025, h * 0.89],
          [r * 1.02, h * 0.972],
          [r * 0.997, h],
        ],
        rim,
        "Rolled lip",
      );
      part(
        new CylinderGeometry(r * 0.88, r * 0.88, 0.005, 28),
        earth,
        x,
        0.921 + h * 0.91,
        z,
        "Potting earth",
      );
    }
    function vertex(x, y, z, c, across, along) {
      leafPos.push(x, y, z);
      leafColors.push(c.r, c.g, c.b);
      leafData.push(across, along);
      return leafPos.length / 3 - 1;
    }
    function blade(
      x,
      y,
      z,
      a,
      length,
      height,
      fall,
      breadth,
      twist,
      tint,
      upright = false,
    ) {
      const vx = Math.cos(a),
        vz = Math.sin(a),
        bend = range(-0.24, 0.24);
      let last;
      for (let j = 0; j <= 11; j++) {
        const t = j / 11,
          s = Math.sin(Math.PI * t),
          r = (0.22 * t + 0.78 * t * t) * length;
        const turn = twist * t + 0.33 * Math.sin(3.4 * t);
        const sideX = -Math.sin(a + turn),
          sideZ = Math.cos(a + turn);
        const px = x + vx * r - vz * bend * s * s * length * 0.36,
          pz = z + vz * r + vx * bend * s * s * length * 0.36;
        const arc = upright
          ? 0.75 * t + 0.36 * Math.sin(t * Math.PI * 0.72)
          : Math.sin(t * Math.PI * 0.86);
        const py = y + arc * height - fall * t * t;
        const w =
          breadth *
          ((1 - t) * 0.26 + 0.74 * Math.sin(Math.PI * t) ** 0.68 + 0.008);
        const edge = 1.0 + 0.28 * Math.sin(t * 4.2 + twist);
        const part = [
          vertex(px - sideX * w, py - w * 0.12, pz - sideZ * w, tint, -1, t),
          vertex(px, py + w * edge, pz, tint, 0, t),
          vertex(px + sideX * w, py - w * 0.36, pz + sideZ * w, tint, 1, t),
        ];
        if (last)
          for (let k = 0; k < 2; k++)
            indices.push(
              last[k],
              last[k + 1],
              part[k + 1],
              last[k],
              part[k + 1],
              part[k],
            );
        last = part;
      }
    }
    function rosette(x, y, z, reach, lift, count) {
      // Arching outer leaves alternate with the tightly folded, upright heart.
      for (let i = 0; i < Math.round(count * density); i++) {
        const a = i * 2.399963 + range(-0.38, 0.38);
        const layer = random(),
          inner = layer < 0.29;
        const length = inner
          ? range(0.13, 0.58) * reach
          : range(0.56, 1.23) * reach;
        const height = lift * (inner ? range(0.86, 1.46) : range(0.25, 0.92));
        const droop = inner ? range(-0.09, 0.03) : range(0.04, 0.31);
        const baseTone = leafTint
          .clone()
          .lerp(
            rgb(random() < 0.56 ? "#121e18" : "#5b6f49"),
            range(0.12, 0.68),
          );
        blade(
          x + range(-0.041, 0.041),
          y + range(-0.014, 0.017),
          z + range(-0.035, 0.035),
          a,
          length,
          height,
          droop,
          range(0.006, 0.0185) * (inner ? 0.81 : 1),
          range(-0.82, 0.85),
          baseTone,
          inner && layer < 0.22,
        );
      }
    }
    const first = { x: 2.074, z: -1.2 },
      second = { x: 2.694, z: -1.2 };
    pot(first.x, first.z, 0.127, 0.258);
    pot(second.x, second.z, 0.148, 0.289);
    rosette(first.x, 1.164, first.z, 0.49, 0.346, 78);
    rosette(first.x - 0.049, 1.172, first.z + 0.028, 0.35, 0.264, 29);
    rosette(second.x, 1.192, second.z, 0.53, 0.36, 85);
    rosette(second.x + 0.077, 1.191, second.z, 0.4, 0.29, 29);
    // A lower pot of branching herbs fills the space beneath the long outer
    // blades. Paired almond-shaped leaves follow each stem to its growing tip.
    pot(1.76, -1.25, 0.089, 0.12);
    for (let i = 0; i < 12; i++) {
      const a = i * 2.4,
        reach = range(0.08, 0.25),
        height = range(0.14, 0.3);
      const start = [
        1.76 + range(-0.025, 0.025),
        1.027,
        -1.25 + range(-0.025, 0.025),
      ];
      const end = [
        start[0] + Math.cos(a) * reach,
        start[1] + height,
        start[2] + Math.sin(a) * reach,
      ];
      stick(start, end, 0.0051, 0.002, rim, "Herb stem");
      for (let j = 0; j < 8; j++) {
        const t = 0.14 + j * 0.102,
          p = start.map((v, k) => v + (end[k] - v) * t);
        const direction = a + (j % 2 ? 1.12 : -1.13);
        const c = leafTint.clone().lerp(rgb("#536740"), range(0.0, 0.5));
        blade(
          ...p,
          direction,
          range(0.04, 0.076),
          range(0.012, 0.03),
          -0.008,
          range(0.009, 0.018),
          range(-0.5, 0.5),
          c,
          true,
        );
      }
    }
    // The leaf tips emerge behind a corked apothecary bottle: the glass has a
    // dark interior, an amber wall and a narrow pale reflection on its right.
    const bx = 2.089,
      bz = -0.814,
      base = 0.921;
    const bottle = new Group();
    bottle.name = "Amber bottle";
    bottle.position.set(bx, base, bz);
    root.add(bottle);
    const glass = amber(params.bottleColor ?? "#ad824d");
    bottle.add(
      lathe(
        0,
        0,
        0,
        [
          [0, 0],
          [0.068, 0],
          [0.076, 0.012],
          [0.079, 0.024],
          [0.079, 0.203],
          [0.077, 0.236],
          [0.071, 0.259],
          [0.054, 0.283],
          [0.033, 0.308],
          [0.027, 0.325],
          [0.027, 0.348],
          [0.03, 0.35],
          [0.03, 0.36],
          [0.023, 0.362],
        ],
        glass,
        "Amber bottle",
      ),
    );
    const cork = pigment("#6b4730", "#cba57a");
    bottle.add(
      lathe(
        0,
        0,
        0,
        [
          [0.023, 0.354],
          [0.026, 0.36],
          [0.024, 0.406],
          [0.022, 0.41],
          [0, 0.41],
        ],
        cork,
        "Cork stopper",
      ),
    );
    if (leafPos.length) {
      const g = new BufferGeometry();
      g.setAttribute("position", new Float32BufferAttribute(leafPos, 3));
      g.setAttribute("paint", new Float32BufferAttribute(leafColors, 3));
      g.setAttribute("blade", new Float32BufferAttribute(leafData, 2));
      g.setIndex(indices);
      g.computeVertexNormals();
      part(g, leavesSurface(), 0, 0, 0, "Folded green blades");
    }
    return {
      object: root,
      physics: {
        bodies: [
          {
            id: "window-shelf",
            type: "static",
            object: root,
            shape: shelfShape,
            collider: "hull",
          },
          {
            id: "amber-bottle",
            type: "dynamic",
            object: bottle,
            collider: "hull",
            density: 390,
            shape: compound(
              roundShape(0.078, 0.251, [0, 0.1255, 0]),
              roundShape(0.074, 0.155, [0, 0.3285, 0], 0.025),
            ),
          },
        ],
      },
    };
  },
});
