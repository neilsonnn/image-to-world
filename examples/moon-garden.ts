import { defineSceneModule } from "image-to-world/runtime";
import * as T from "three";
import { SplatMesh } from "@sparkjsdev/spark";

/** A portable procedural diorama: standard geometry, authored Gaussians and particles. */
export default defineSceneModule({
  parameters: {
    accent: { type: "color", label: "Petal color", default: "#ff9e83" },
    fireflies: { type: "number", default: 35, min: 0, max: 100, step: 1 },
    character: { type: "boolean", default: true },
  },
  async create({ params, random }) {
    const object = new T.Group();
    const mat = (color: string, roughness = 0.7, metalness = 0) =>
      new T.MeshStandardMaterial({ color, roughness, metalness });
    const cream = mat("#e6d4b4"),
      stone = mat("#927ea8"),
      dark = mat("#283d50"),
      green = mat("#537c6e"),
      gold = mat("#d5aa65", 0.3, 0.65),
      pink = mat(String(params.accent));
    const glow = new T.MeshStandardMaterial({
      color: "#ffe3a3",
      emissive: "#ffbd63",
      emissiveIntensity: 3,
    });
    const mesh = (
      geometry: T.BufferGeometry,
      material: T.Material,
      position: number[],
      parent: T.Object3D = object,
    ) => {
      const item = new T.Mesh(geometry, material);
      item.position.set(position[0], position[1], position[2]);
      item.castShadow = true;
      item.receiveShadow = true;
      parent.add(item);
      return item;
    };
    const box = (
      size: number[],
      position: number[],
      material = cream,
      parent = object,
    ) =>
      mesh(
        new T.BoxGeometry(...(size as [number, number, number])),
        material,
        position,
        parent,
      );
    const sphere = (
      radius: number,
      position: number[],
      material = pink,
      parent = object,
    ) => mesh(new T.SphereGeometry(radius, 16, 12), material, position, parent);
    const cylinder = (
      r: number,
      height: number,
      position: number[],
      material = cream,
      parent = object,
    ) =>
      mesh(
        new T.CylinderGeometry(r, r, height, 48),
        material,
        position,
        parent,
      );
    cylinder(3.45, 0.25, [0, -0.3, 0], dark);
    cylinder(3.3, 0.3, [0, -0.08, 0], stone);
    cylinder(3.12, 0.08, [0, 0.1, 0], cream);
    // Floating masonry under the garden gives the silhouette a deliberate finish.
    for (let n = 0; n < 36; n++) {
      const angle = (n * Math.PI * 2) / 36;
      const tile = box(
        [0.18, 0.17, 0.31],
        [Math.cos(angle) * 3.23, 0.12, Math.sin(angle) * 3.23],
        n % 3 ? stone : gold,
      );
      tile.rotation.y = -angle;
    }
    // A freestanding portal, with a thin gilded inner arch.
    const arch = new T.Group();
    arch.position.set(0, 0.2, -0.9);
    object.add(arch);
    for (const x of [-1.4, 1.4]) {
      box([0.48, 2.3, 0.5], [x, 1.15, 0], cream, arch);
      box([0.62, 0.18, 0.65], [x, 0.09, 0], stone, arch);
      box([0.56, 0.15, 0.59], [x, 2.1, 0], gold, arch);
    }
    mesh(
      new T.TorusGeometry(1.4, 0.24, 12, 48, Math.PI),
      cream,
      [0, 2.3, 0],
      arch,
    );
    mesh(
      new T.TorusGeometry(1.4, 0.055, 8, 64, Math.PI),
      gold,
      [0, 2.3, 0.27],
      arch,
    );
    const moon = mesh(
      new T.TorusGeometry(0.63, 0.105, 12, 48, Math.PI * 1.55),
      glow,
      [0, 2.65, -0.95],
    );
    moon.rotation.z = -0.5;
    cylinder(0.76, 0.24, [0, 0.3, -0.8], stone);
    cylinder(0.65, 0.08, [0, 0.46, -0.8], gold);
    // Stepping stones lead into the composition.
    for (let n = 0; n < 5; n++) {
      const item = cylinder(
        0.3 - n * 0.015,
        0.06,
        [Math.sin(n * 0.6) * 0.25, 0.18, 2.45 - n * 0.58],
        stone,
      );
      item.scale.z = 0.62;
    }
    // Hand-placed planters plus seeded foliage; randomness is fixed per node.
    for (const [x, z, size] of [
      [-1.95, 0.9, 0.8],
      [1.8, -0.25, 0.75],
      [-1.6, -1.8, 0.6],
      [1.8, 1.6, 0.5],
    ]) {
      cylinder(size * 0.43, size * 0.6, [x, size * 0.3 + 0.15, z], stone);
      cylinder(size * 0.47, 0.1, [x, size * 0.6 + 0.16, z], gold);
      for (let j = 0; j < 7; j++) {
        const a = random() * Math.PI * 2,
          height = size * (0.7 + random() * 0.9),
          dx = Math.cos(a) * size * 0.3,
          dz = Math.sin(a) * size * 0.3;
        const stem = cylinder(
          0.018,
          height,
          [x + dx, size * 0.6 + height * 0.5 + 0.2, z + dz],
          green,
        );
        const leaf = sphere(
          0.18 * size,
          [x + dx, stem.position.y + height * 0.23, z + dz],
          green,
        );
        leaf.scale.set(0.65, 2, 0.65);
        leaf.rotation.z = Math.sin(a) * 0.6;
        const flower = new T.Group();
        flower.position.set(x + dx, size * 0.6 + height + 0.2, z + dz);
        object.add(flower);
        for (let k = 0; k < 5; k++) {
          const b = (k * Math.PI * 2) / 5;
          const petal = sphere(
            0.12 * size,
            [Math.cos(b) * 0.12 * size, Math.sin(b) * 0.12 * size, 0],
            pink,
            flower,
          );
          petal.scale.z = 0.55;
        }
        sphere(0.065 * size, [0, 0, 0.07], glow, flower);
      }
    }
    const motes = new T.Group();
    object.add(motes);
    const positions: T.Vector3[] = [];
    for (let n = 0; n < Number(params.fireflies); n++) {
      const p = new T.Vector3(
        (random() - 0.5) * 4.7,
        0.4 + random() * 3.3,
        (random() - 0.5) * 3.8,
      );
      positions.push(p);
      sphere(0.018 + random() * 0.016, p.toArray(), glow, motes);
    }
    let character: SplatMesh | undefined;
    if (params.character) {
      // Explicit Gaussian volumes: a little moon keeper with ears, feet and a satchel.
      character = new SplatMesh({
        raycastable: true,
        constructSplats(data) {
          const ellipsoid = (
            center: number[],
            scale: number[],
            color: string,
          ) => {
            const count = 320;
            for (let i = 0; i < count; i++) {
              const z = 1 - (2 * (i + 0.5)) / count,
                a = i * 2.399963,
                r = Math.sqrt(1 - z * z);
              data.pushSplat(
                new T.Vector3(
                  center[0] + scale[0] * r * Math.cos(a),
                  center[1] + scale[1] * z,
                  center[2] + scale[2] * r * Math.sin(a),
                ),
                new T.Vector3().setScalar(
                  Math.max(0.004, Math.min(0.046, Math.min(...scale) * 0.4)),
                ),
                new T.Quaternion(),
                0.95,
                new T.Color(color),
              );
            }
          };
          ellipsoid([0, 0.55, 0], [0.31, 0.4, 0.24], "#f4d6b7");
          ellipsoid([0, 0.97, 0], [0.29, 0.27, 0.25], "#f6debd");
          for (const x of [-0.17, 0.17]) {
            ellipsoid([x, 1.27, -0.01], [0.08, 0.22, 0.08], "#f4d6b7");
            ellipsoid([x, 0.18, 0.1], [0.12, 0.1, 0.17], "#caa394");
          }
          ellipsoid([-0.1, 1.01, 0.233], [0.027, 0.04, 0.02], "#283d50");
          ellipsoid([0.1, 1.01, 0.233], [0.027, 0.04, 0.02], "#283d50");
          ellipsoid([0, 0.92, 0.26], [0.035, 0.023, 0.02], "#d17f73");
          ellipsoid([0.3, 0.55, 0.1], [0.1, 0.16, 0.12], "#66918a");
        },
      });
      await character.initialized;
      character.position.set(0.9, 0.18, 1.05);
      object.add(character);
    }
    return {
      object,
      sample({ time }) {
        for (let n = 0; n < motes.children.length; n++) {
          const p = positions[n];
          motes.children[n].position.set(
            p.x + Math.sin(time * 0.4 + n) * 0.12,
            p.y + Math.sin(time * 0.8 + n * 2) * 0.09,
            p.z,
          );
        }
        if (character) {
          character.position.y = 0.18 + Math.sin(time * 1.7) * 0.025;
          character.rotation.y = 0.45 + Math.sin(time * 0.35) * 0.08;
        }
        moon.rotation.z = -0.5 + Math.sin(time * 0.2) * 0.06;
      },
    };
  },
});
