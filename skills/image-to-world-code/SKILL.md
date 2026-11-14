---
name: image-to-world-code
description: Author live Three.js geometry, Gaussian splats, particles, shaders and animation as procedural image-to-world scene nodes; expose parameters, inspect renders, and bake or export portable assets.
---

# Authored scene code

Use this for assets that benefit from code, not as a requirement for every object.
Work from the user's desired aesthetic and references. Read `schema modules`,
`schema nodes`, and `schema art` for exact contracts. Run the CLI from the checkout
with `bun run image-to-world`, using `--url` for a nondefault project port.

Create a TS/JS file default-exporting `{parameters?, create(context)}`. The context
supplies `THREE`, `spark`, typed-value `params`, seeded `random()`, `assetUrl(id)`,
`signal`, and the host `renderer`. Return `{object, sample?, bounds?, dispose?}`.
`sample({time,camera})` must evaluate from absolute time, not accumulate deltas;
this makes independent render, playback and baking agree. `bounds()` returns a
local Box3; ordinary geometry and nested Spark SplatMesh bounds are automatic.
Dispose custom listeners, render targets and timers; the host disposes ordinary
geometry, materials and textures. Await async geometry/splat initialization before
returning, and observe the abort signal.

```ts
import { defineSceneModule } from "image-to-world/runtime";
import { Mesh, TorusGeometry, MeshStandardMaterial } from "three";
export default defineSceneModule({
  parameters: { color: { type: "color", default: "#eb9b72" } },
  create({ params }) {
    const object = new Mesh(
      new TorusGeometry(1, 0.2, 16, 64),
      new MeshStandardMaterial({ color: String(params.color) }),
    );
    return {
      object,
      sample({ time }) {
        object.rotation.y = time * 0.2;
      },
    };
  },
});
```

```sh
bun run image-to-world module add /absolute/path/asset.ts --name 'Sculpture'
bun run image-to-world module update <node-id> /absolute/path/asset.ts --watch
bun run image-to-world module params <node-id> --file params.json
bun run image-to-world scene inspect <node-id> --rendered
bun run image-to-world render <camera-node-id> --targets <node-id> --presentation --time 2 --bake --wait
```

Parameters support number/string/boolean/color/select/asset with labels, defaults,
limits and options. Declare file dependencies with `--assets id,id` or asset-typed
parameters, then load through `assetUrl`. The compiler snapshots local sources and
bundles installed dependencies. `three` and `@sparkjsdev/spark` resolve to the host
engine; ordinary Three addon imports work. Do not import a second copy of Three or
reach into editor state. Use CLI commands to add or change sibling nodes, with
narrow patches and concurrency preconditions. The module's returned object is
local content; `node.transform` is the only editor-owned placement. Procedural
nodes currently support uniform scaling, including their ancestors, to keep nested
Gaussian geometry coherent.

A build is preflighted before replacing the previous working binding. An older
build cannot replace a newer submission, and a deleted destination is never
resurrected. Runtime code is trusted JavaScript, not an untrusted-plugin sandbox.
Use finite work and modest geometry budgets; headless timeout cannot make a slow
live animation pleasant. Custom renderer-wide behavior needs deliberate ownership
and cleanup; modules should generally return scene content and sample it.

Useful editable examples in the checkout:

- `examples/moon-garden.ts`: composed geometry, materials, seeded particles,
  an authored Gaussian character and fixed-time animation.
- `examples/pixel-sculpture.ts`: image asset to extruded voxel or Gaussian pixels.
  Set `image` to an imported asset ID and `representation` to `voxels` or `splats`
  with `--file params.json`, then use `art pixel`. This is a stylized extrusion,
  not learned reconstruction of hidden surfaces. Adapt the recipe for the asset.

Review beauty renders from multiple angles and refine. Bake returns GLB/PLY and an
omissions report; preserve source for behaviors or custom shaders that do not fit
those formats. `export project --out <new-directory>` retains the live scene and
shared presentation renderer. Rebuild or adapt it for the user's intended medium.
