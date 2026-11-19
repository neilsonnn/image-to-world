import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  attribute,
  color,
  dot,
  mix,
  mx_noise_float,
  normalView,
  normalLocal,
  positionLocal,
  sin,
  smoothstep,
  uv,
  vec3,
} from "three/tsl";

const v = (x, y, z) => new THREE.Vector3(x, y, z);
const tau = 2 * Math.PI;

// Store the arc length on each bark strip. Fissures follow each bend in a
// bough; lichen uses a separate scale and catches the upper faces of the bark.
function barkMaterial(mossAmount) {
  const material = new MeshBasicNodeMaterial();
  const p = positionLocal;
  const broad = mx_noise_float(p.mul(4.4));
  const rough = mx_noise_float(p.mul(27));
  const light = dot(normalLocal, vec3(-0.76, 0.58, 0.3)).add(broad.mul(0.32));
  const wrap = uv().x.mul(tau);
  const around = vec3(
    wrap.cos().mul(2.8),
    wrap.sin().mul(2.8),
    uv().y.mul(2.1),
  );
  const fissure = sin(
    wrap.mul(15).add(mx_noise_float(around).mul(4)).add(uv().y.mul(3.9)),
  );
  const ink = smoothstep(0.78, 0.98, fissure.add(rough.mul(0.24)));
  let base = mix(
    color("#0c1513"),
    color("#1b2924"),
    smoothstep(-0.32, -0.11, light),
  );
  base = mix(base, color("#37453a"), smoothstep(0.43, 0.52, light).mul(0.84));
  const split = smoothstep(-0.37, 0.29, mx_noise_float(around.mul(1.9)));
  base = mix(base, color("#0e1714"), ink.mul(split).mul(0.72));
  const scoring = uv()
    .y.mul(118)
    .add(mx_noise_float(around.mul(3.1)).mul(7));
  const notches = smoothstep(0.72, 0.95, scoring.sin())
    .mul(smoothstep(0.16, 0.35, rough))
    .mul(light.clamp(0, 1));
  base = mix(base, color("#141f19"), notches.mul(0.78));
  const colonised = smoothstep(
    0.3,
    0.46,
    normalLocal.y
      .mul(0.45)
      .add(broad.mul(0.57))
      .add(rough.mul(0.32))
      .add(light.mul(0.24))
      .add(mossAmount - 0.55),
  );
  const lichen = mix(
    color("#23382b"),
    color("#456547"),
    smoothstep(0.25, 0.44, light.add(broad.mul(0.23))),
  );
  base = mix(base, lichen, colonised.mul(0.88));
  const fleck = smoothstep(0.32, 0.5, mx_noise_float(p.mul(73)))
    .mul(colonised)
    .mul(smoothstep(0.3, 0.6, light));
  base = mix(base, color("#748264"), fleck.mul(0.4));
  // Bent, broken pen hatches skirt the raised lips between the older scars.
  const scar = uv()
    .y.mul(63)
    .add(wrap.sin().mul(5))
    .add(mx_noise_float(around.mul(2.6)).mul(2.8));
  const lift = smoothstep(0.89, 0.99, scar.cos())
    .mul(smoothstep(-0.12, 0.19, rough))
    .mul(split);
  base = mix(base, color("#536454"), lift.mul(0.4));
  base = base.mul(mx_noise_float(p.mul(197)).mul(0.16).add(1));
  material.colorNode = mix(
    color("#11201c"),
    base,
    smoothstep(0.03, 0.19, normalView.z.abs()),
  );
  return material;
}

function leafMaterial() {
  const m = new MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  const light = dot(normalLocal, vec3(-0.59, 0.73, 0.34));
  const pigment = attribute("pigment", "float");
  const wash = mx_noise_float(positionLocal.mul(29)).mul(0.16);
  const tone = light.mul(0.3).add(pigment.mul(0.74)).add(wash);
  let leaf = mix(
    color("#122622"),
    color("#254638"),
    smoothstep(0.2, 0.27, tone),
  );
  leaf = mix(leaf, color("#3d654d"), smoothstep(0.6, 0.66, tone));
  leaf = mix(leaf, color("#7e9470"), smoothstep(0.92, 0.98, tone));
  const midrib = smoothstep(0.065, 0.16, uv().x.sub(0.5).abs());
  const line = midrib
    .oneMinus()
    .mul(smoothstep(0.58, 0.75, tone))
    .mul(0.3);
  m.colorNode = mix(leaf, color("#9aad80"), line);
  return m;
}

function arrays() {
  return { p: [], uv: [], pigment: [], idx: [] };
}
function mesh(data, material) {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(data.p, 3));
  geom.setAttribute("uv", new THREE.Float32BufferAttribute(data.uv, 2));
  if (data.pigment.length)
    geom.setAttribute(
      "pigment",
      new THREE.Float32BufferAttribute(data.pigment, 1),
    );
  geom.setIndex(data.idx);
  geom.computeVertexNormals();
  return new THREE.Mesh(geom, material);
}

// Tubes taper asymmetrically and develop flutes at the buttresses. The same
// indexed geometry builder also makes twigs, so a twig is round from behind.
function limb(data, path, widths, { sides = 9, squash = 1, phase = 0 } = {}) {
  const curve = new THREE.CatmullRomCurve3(
    path.map((p) => (Array.isArray(p) ? v(...p) : p)),
  );
  const length = curve.getLength();
  const steps = Math.min(58, Math.max(path.length * 3, Math.ceil(length * 18)));
  const frames = curve.computeFrenetFrames(steps, false);
  const first = data.p.length / 3;
  const pathSegments = path.length - 1;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps,
      u = curve.getUtoTmapping(t),
      d = Math.min(u * pathSegments, pathSegments - 0.000001),
      seg = Math.floor(d);
    const radius = THREE.MathUtils.lerp(widths[seg], widths[seg + 1], d - seg);
    const c = curve.getPoint(u);
    for (let j = 0; j <= sides; j++) {
      const theta = (tau * j) / sides,
        wind = theta + 0.15 * Math.sin(t * 4 + phase);
      const r =
        radius *
        (1 +
          0.105 * Math.sin(5 * wind + phase + t * 1.4) +
          0.062 * Math.sin(3 * wind - t * 2.4 + phase));
      const pt = c
        .clone()
        .addScaledVector(frames.normals[i], Math.cos(theta) * r)
        .addScaledVector(frames.binormals[i], Math.sin(theta) * r * squash);
      data.p.push(pt.x, pt.y, pt.z);
      data.uv.push(j / sides, t * length);
      if (i && j) {
        const n = first + i * (sides + 1) + j;
        data.idx.push(n - sides - 2, n - 1 - sides, n, n - sides - 2, n, n - 1);
      }
    }
  }
  for (const atEnd of [false, true]) {
    const ring = first + (atEnd ? steps * (sides + 1) : 0);
    const centre = data.p.length / 3;
    const p = curve.getPoint(atEnd ? 1 : 0);
    data.p.push(p.x, p.y, p.z);
    data.uv.push(0.5, atEnd ? length : 0);
    for (let j = 0; j < sides; j++) {
      if (atEnd) data.idx.push(centre, ring + j, ring + j + 1);
      else data.idx.push(centre, ring + j + 1, ring + j);
    }
  }
  return curve;
}

function blade(data, base, direction, width, pigment, roll) {
  const start = data.p.length / 3,
    dir = direction.clone().normalize();
  const axis = Math.abs(dir.z) < 0.91 ? v(0, 0, 1) : v(0, 1, 0);
  const side = dir.clone().cross(axis).normalize().applyAxisAngle(dir, roll);
  const fold = side.clone().cross(dir).normalize();
  for (let i = 0; i < 5; i++) {
    const t = i / 4,
      shape = Math.sin(Math.PI * t) ** 0.75 * (1.13 - 0.3 * t);
    const at = base.clone().addScaledVector(direction, t);
    at.y -= direction.length() * 0.13 * t * t;
    for (const across of [-1, 0, 1]) {
      const p = at
        .clone()
        .addScaledVector(side, across * width * shape)
        .addScaledVector(fold, across === 0 ? width * shape * 0.37 : 0);
      data.p.push(p.x, p.y, p.z);
      data.uv.push((across + 1) / 2, t);
      data.pigment.push(pigment);
    }
    if (i)
      for (let k = 0; k < 2; k++) {
        const n = start + i * 3 + k;
        data.idx.push(n - 3, n, n + 1, n - 3, n + 1, n - 2);
      }
  }
}

export default {
  create({ params, random }) {
    const root = new THREE.Group(),
      bark = arrays(),
      foliage = arrays();
    const moss = THREE.MathUtils.clamp(Number(params.moss ?? 0.55), 0, 1);
    const density = THREE.MathUtils.clamp(
      Number(params.leafDensity ?? 1),
      0.25,
      2,
    );
    const branchAxes = [];
    const sprig = (p, r, settings = {}) => {
      const curve = limb(bark, p, r, { phase: random() * 6, ...settings });
      if (r[0] >= 0.04) branchAxes.push(...curve.getPoints(24));
      return curve;
    };
    // Main bole turns towards the doorway before dividing. Buttress roots
    // span the stones at different depths, leaving the desk's open book clear.
    sprig(
      [
        [2.0, 0.76, 0.35],
        [2.26, 0.97, 0.3],
        [2.46, 1.34, 0.21],
        [2.38, 1.67, 0.23],
        [2.2, 2.08, 0.21],
        [1.99, 2.43, 0.23],
        [1.87, 2.79, 0.29],
        [1.72, 3.19, 0.34],
      ],
      [0.35, 0.39, 0.37, 0.3, 0.245, 0.226, 0.19, 0.134],
      { sides: 22, squash: 0.9 },
    );
    sprig(
      [
        [2.25, 1.11, 0.35],
        [2.08, 0.95, 0.43],
        [1.79, 0.84, 0.42],
        [1.54, 0.79, 0.46],
        [1.4, 0.63, 0.48],
        [1.29, 0.35, 0.54],
        [1.18, 0.23, 0.57],
      ],
      [0.28, 0.26, 0.18, 0.121, 0.073, 0.034, 0.008],
      { sides: 16, squash: 0.76 },
    );
    sprig(
      [
        [2.34, 1.15, 0.29],
        [2.46, 0.92, 0.44],
        [2.65, 0.76, 0.6],
        [2.82, 0.32, 0.73],
      ],
      [0.22, 0.175, 0.11, 0.014],
      { sides: 15 },
    );
    sprig(
      [
        [2.15, 0.99, 0.38],
        [1.96, 0.82, 0.29],
        [1.8, 0.77, 0.1],
        [1.64, 0.72, -0.2],
      ],
      [0.149, 0.1, 0.058, 0.004],
      { sides: 12 },
    );
    sprig(
      [
        [2.24, 1.01, 0.32],
        [2.17, 0.87, 0.61],
        [2.01, 0.83, 0.81],
        [1.9, 0.68, 0.88],
        [1.89, 0.42, 0.91],
      ],
      [0.17, 0.122, 0.074, 0.048, 0.005],
      { sides: 13 },
    );
    sprig(
      [
        [2.38, 1.42, 0.18],
        [2.56, 1.77, 0.06],
        [2.63, 2.22, -0.1],
        [2.51, 2.6, -0.23],
        [2.39, 2.92, -0.3],
        [2.45, 3.22, -0.34],
      ],
      [0.22, 0.21, 0.155, 0.104, 0.076, 0.042],
      { sides: 16 },
    );
    sprig(
      [
        [2.33, 1.71, 0.2],
        [2.09, 1.96, 0.21],
        [1.84, 2.14, 0.14],
        [1.53, 2.25, 0.09],
        [1.27, 2.39, 0.02],
        [1.16, 2.55, -0.04],
        [0.93, 2.68, -0.16],
        [0.71, 2.93, -0.23],
      ],
      [0.166, 0.144, 0.11, 0.087, 0.068, 0.046, 0.032, 0.009],
      { sides: 14 },
    );
    sprig(
      [
        [1.56, 2.25, 0.09],
        [1.38, 2.42, 0.19],
        [1.29, 2.64, 0.24],
        [1.08, 2.79, 0.27],
        [0.8, 2.86, 0.24],
      ],
      [0.059, 0.043, 0.03, 0.02, 0.006],
    );
    sprig(
      [
        [1.19, 2.52, -0.04],
        [0.96, 2.63, -0.03],
        [0.71, 2.63, 0.03],
        [0.4, 2.51, 0.03],
        [0.29, 2.46, 0.0],
      ],
      [0.055, 0.041, 0.033, 0.019, 0.004],
    );
    sprig(
      [
        [2.35, 2.03, 0.18],
        [2.2, 2.36, 0.03],
        [2.1, 2.66, -0.2],
        [2.21, 2.94, -0.4],
        [2.06, 3.22, -0.49],
      ],
      [0.12, 0.09, 0.061, 0.046, 0.016],
      { sides: 11 },
    );
    const twig = (a, b, c, r) =>
      sprig([a, b, c], [r, r * 0.65, 0.0015], { sides: 5 });
    // Crown clusters gather at the branch tips, leaving holes between masses.
    const centres = [
      [0.42, 2.45, 0.04, 0.19, 0.2, 0.18],
      [0.62, 2.45, -0.02, 0.22, 0.27, 0.17],
      [0.47, 2.72, 0.04, 0.28, 0.23, 0.2],
      [0.91, 2.57, 0.14, 0.16, 0.18, 0.12],
      [0.56, 2.61, -0.04, 0.3, 0.18, 0.2],
      [0.86, 2.78, -0.14, 0.27, 0.2, 0.19],
      [1.08, 2.65, 0.19, 0.22, 0.16, 0.15],
      [1.4, 2.81, 0.09, 0.22, 0.19, 0.2],
      [1.72, 2.89, 0.25, 0.22, 0.17, 0.23],
      [1.79, 2.21, 0.14, 0.19, 0.1, 0.15],
      [1.92, 2.11, 0.35, 0.24, 0.15, 0.16],
      [2.06, 1.99, 0.41, 0.18, 0.14, 0.18],
      [2.19, 1.88, 0.42, 0.18, 0.13, 0.12],
      [2.3, 1.76, 0.24, 0.24, 0.2, 0.23],
      [2.27, 1.38, 0.33, 0.18, 0.15, 0.17],
      [2.03, 1.12, 0.37, 0.22, 0.17, 0.15],
      [2.1, 1.2, 0.47, 0.16, 0.12, 0.2],
      [1.81, 0.94, 0.4, 0.21, 0.08, 0.15],
      [1.53, 0.84, 0.49, 0.15, 0.12, 0.12],
    ];
    for (const [x, y, z, width, height, depth] of centres) {
      const hub = v(x, y, z);
      const anchor = branchAxes.reduce((best, point) =>
        point.distanceToSquared(hub) < best.distanceToSquared(hub)
          ? point
          : best,
      );
      if (anchor.distanceTo(hub) > 0.015) {
        const elbow = anchor.clone().lerp(hub, 0.48);
        elbow.y += 0.018;
        sprig([anchor, elbow, hub], [0.017, 0.012, 0.006], { sides: 7 });
      }
      for (let i = 0; i < Math.round(12 * density); i++) {
        const angle = random() * tau,
          spread = Math.sqrt(random());
        const mid = hub
          .clone()
          .add(
            v(
              Math.cos(angle) * width * spread * 0.61,
              (random() - 0.47) * height,
              Math.sin(angle) * depth * spread * 0.6,
            ),
          );
        const tip = mid
          .clone()
          .add(
            v(
              Math.cos(angle) * width * 0.69,
              (random() - 0.32) * height,
              Math.sin(angle) * depth * 0.65,
            ),
          );
        twig(hub, mid, tip, 0.005 + random() * 0.0026);
        const twigDir = tip.clone().sub(hub).normalize();
        for (let k = 0; k < 7; k++) {
          const t = (k + random() * 0.46) / 7,
            p =
              t < 0.5
                ? hub.clone().lerp(mid, t * 2)
                : mid.clone().lerp(tip, t * 2 - 1);
          const phase = angle + (k % 2 ? 1 : -1) * (1.05 + random() * 0.68);
          const len = 0.052 + random() * 0.079;
          const shoot = v(
            Math.cos(phase) * 0.86,
            (random() - 0.48) * 1.0,
            Math.sin(phase) * 0.76,
          )
            .addScaledVector(twigDir, 0.3)
            .normalize()
            .multiplyScalar(len);
          blade(
            foliage,
            p,
            shoot,
            len * (0.17 + random() * 0.11),
            random() * 0.96,
            (random() - 0.35) * 1.7,
          );
        }
      }
    }
    // Woody ivy slips over the lip beside the desk. Alternate, broader
    // leaves and exposed tendrils distinguish it from the old tree's crown.
    for (let n = 0; n < 11; n++) {
      const h = n / 10;
      const start = v(
        1.46 + h * 0.63,
        0.81 + random() * 0.14,
        0.3 + random() * 0.28,
      );
      const end = start
        .clone()
        .add(
          v(
            -0.08 - random() * 0.2,
            -0.16 - random() * 0.41,
            0.05 + random() * 0.19,
          ),
        );
      const mid = start.clone().lerp(end, 0.49);
      mid.x += 0.06 * Math.sin(n);
      mid.z += 0.055;
      const vine = sprig([start, mid, end], [0.008, 0.005, 0.001], {
        sides: 5,
      });
      for (let i = 0; i < 9; i++) {
        const p = vine.getPoint(i / 9);
        const d = v(
          (i % 2 ? 1 : -1) * (0.029 + random() * 0.048),
          -0.027 - random() * 0.054,
          0.036 * (random() - 0.25),
        );
        blade(
          foliage,
          p,
          d,
          0.018 + random() * 0.01,
          random() * 0.7,
          (random() - 0.4) * 1.6,
        );
      }
    }
    const trunk = mesh(bark, barkMaterial(moss)),
      leaves = mesh(foliage, leafMaterial());
    trunk.name = "Fluted bole, moss and buttress roots";
    leaves.name = "Folded canopy leaves and hanging ivy";
    trunk.castShadow = leaves.castShadow = true;
    root.add(trunk, leaves);
    return {
      object: root,
      physics: {
        bodies: [
          { id: "house-tree", type: "static", object: trunk, collider: "mesh" },
        ],
      },
    };
  },
};
