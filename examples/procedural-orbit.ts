import { defineSceneModule } from "image-to-world/runtime";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { color, positionLocal, sin } from "three/tsl";

export default defineSceneModule({
  create({ THREE, params, random }) {
    const object = new THREE.Group();
    const material = new MeshStandardNodeMaterial({ metalness: 0.65 });
    const frequency =
      typeof params.frequency === "number" ? params.frequency : 42;
    const grooves = sin(positionLocal.y.mul(frequency)).mul(0.5).add(0.5);
    const copper = color(
      typeof params.color === "string" ? params.color : "#cd8755",
    );
    material.colorNode = copper.mul(grooves.mul(0.18).add(0.82));
    material.roughnessNode = grooves.mul(0.18).add(0.21);
    const ring = new THREE.Mesh(
      new THREE.TorusKnotGeometry(0.65, 0.18, 120, 16),
      material,
    );
    ring.position.y = 1.15;
    object.add(ring);
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 1, 0.18, 64),
      new THREE.MeshStandardMaterial({ color: "#30383e", roughness: 0.8 }),
    );
    base.position.y = 0.09;
    object.add(base);
    const phase = random() * Math.PI * 2;
    return {
      object,
      sample({ time }) {
        ring.rotation.y = phase + time * 0.2;
      },
    };
  },
});
