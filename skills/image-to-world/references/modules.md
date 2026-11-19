# Procedural code nodes

Create Three.js content in the existing viewport from a local TypeScript or JavaScript module:

```sh
bun run image-to-world module add examples/procedural-orbit.ts --name "Orbit sculpture"
bun run image-to-world module update <node-id> examples/procedural-orbit.ts
bun run image-to-world module params <node-id> --file parameters.json
bun run image-to-world module inspect <node-id>
```

Modules default-export `defineSceneModule({ create(context) { ... } })`, imported from
`image-to-world/runtime`. Import geometry from `three`, node materials from
`three/webgpu`, and shader expressions from `three/tsl`. These share the editor's
engine and are also available as `context.THREE`, `context.webgpu`, `context.tsl`
and `context.spark`. The context supplies JSON `params` (including arrays and
objects), seeded `random()`, an abort `signal`, and `assetUrl(id)` for dependencies
listed with `--assets id,id`.
Local module imports are bundled. Each build retains source files, their relative paths,
and the compiled bundle in project assets. Code is trusted executable project content;
it runs in the browser, not in a security sandbox. Only load code you trust.

Return `{ object, physics?, sample?, bounds?, dispose? }`. `object` is a Three.js Object3D subtree
owned by this node. The editor handles selection, transforms, parenting, visibility,
bounds and resource disposal. `bounds()` optionally returns a Box3 in the returned
object's local coordinates (useful for custom shader geometry). `sample({time,camera})`
updates the subtree from absolute seconds; the existing independent renderer samples
at time zero. `dispose()` releases your listeners and other resources; creation must
honor the abort signal and clean up partially constructed resources if it throws.
Keep scene-level placement in the node transform. Do not mutate the editor scene or
create another renderer. Meshes, lights, particles, custom materials and splats can all
live within the returned subtree. For splats, use uniform scale throughout the ancestry.

## Bodies and joints

The editor and standalone web player simulate the same rig. For a single imported mesh, set **Properties → Play mode → Rigid body** to **Dynamic**, or issue a `nodes.patch` with `{"physics":{"type":"dynamic","collider":"hull"}}` as its patch. **Static** supplies collision for floors and shelves. **None** skips collision. **Automatic** uses the module's authored rig or gives mesh geometry static collision. The editor applies these choices per instance.

For a mechanism, return one body for each independently moving part. Group bolts, decals and other detail under the part they follow. This example assumes `base` and `arm` are unrotated siblings in `object`, with `arm` positioned 0.4 units above the base and its local origin at the axle.

```ts
return {
  object,
  physics: {
    bodies: [
      { id: "base", object: base, type: "static", collider: "box" },
      { id: "arm", object: arm, type: "dynamic", collider: "hull" },
    ],
    joints: [{
      type: "hinge", a: "base", b: "arm",
      anchorA: [0, 0.4, 0], anchorB: [0, 0, 0], axis: [0, 0, 1],
      limits: [-0.8, 1.2],
      motor: { target: 0, stiffness: 12, damping: 2 },
    }],
  },
};
```

Give each anchor in its own body's local coordinates. Align the joint axis in both body frames. Hinge limits and motor targets are radians. A `slider` uses the same fields with travel in world metres, and a `ball` joint uses just the two anchors. Use a motor for a sprung mechanism. For a counterbalanced lamp, `gravityScale: 0` on the moving links lets the shade hold its position after release. Leave ordinary loose props at normal gravity.

A body can supply a separate lightweight `shape` tree in its own coordinates for collision. Keep `sample()` animations on decorative children when physics drives the body transform. The [Canopy Studio example](../../../examples/canopy-studio/) contains two working desk lamps.

## Programmable materials

Use TSL node materials for programmable surfaces in the viewport and independent
renders. Define the appearance in object space so it travels with the asset.
For instance, a turned metal part can vary its roughness across the grooves:

```ts
import { MeshStandardNodeMaterial } from "three/webgpu";
import { positionLocal, sin } from "three/tsl";

const brass = new MeshStandardNodeMaterial({
  color: "#af8749",
  metalness: 0.8,
});
brass.roughnessNode = sin(positionLocal.y.mul(120)).mul(0.12).add(0.3);
```

Use `sample({time})` to drive animation uniforms reproducibly. A module can
submit TSL compute kernels to its own renderer with `gpu.compute(kernel)` in
`create` or `sample`. A kernel can fill a storage attribute and a material can
read it with `buffer.toAttribute()`. The editor releases submitted kernels
when the node unloads. Use `gpu.backend` (`webgpu` or `webgl2`) for features
specific to a backend. Independent captures call `sample({time: 0})` on a fresh
instance; initialize buffers for that frame. Supply local bounds for displaced
geometry and update the mesh's bounding sphere for frustum culling. Three's CPU
raycaster can use a custom `raycast` on the mesh for shader-defined silhouettes.
Release module-owned render targets in `dispose()`.
Custom shader code uses TSL. Three.js compiles portable TSL graphs for the active
backend. [Three.js Shading Language](https://threejs.org/tsl/)

An imported model can also be the starting geometry for a code node. Declare its
GLB asset ID with `--assets`, load it with `GLTFLoader.loadAsync(assetUrl(id))`
inside `create`, and return its scene. Each mesh in that subtree can use a
different node material. Preserve skinning and animation on characters when
replacing materials. Use TSL functions for cross-backend shaders. Native WGSL
functions require WebGPU.

Parameters, seed and enabled state are editable in Properties. Updates and parameter
changes use ordinary undoable commands. Compiling invalid code leaves the old node
unchanged; runtime errors appear in scene inspection and can be undone. Concurrent
updates to the same module conflict instead of overwriting another agent's code.
Nodes are ordinary hierarchy entries: duplicate, reparent, transform or remove them
using the existing UI or CLI. No additional viewer is involved.
