---
name: image-to-world-atlas
description: Reconstruct and expand static environments in image-to-world with public World Labs Atlas tasks, posed RGBD context, independent cameras, and camera-path generation.
---

# Atlas environments

Atlas is a specialized workflow inside an image-centric asset creation toolkit.
Use it for coherent environmental context, new views and background reconstruction;
combine its results with authored meshes, imported objects and procedural assets.
Read `skills/image-to-world/SKILL.md` for shared CLI, scene and concurrency contracts.

The app must be running. `bun run image-to-world status` reports provider setup;
configure the server through Environment. Use only the pinned public World Labs
SDK tasks: `images2PosedRGBD`, `atlasGenerate`, `posedImages2Splats`.

Images placed by default are local references, not aligned RGBD. Explicitly use
`scene place <asset-id> --mode individual` for independent posing, or
`scene place <id> <id> --reconstruct` for a joint solution. Wait for returned jobs,
then inspect `context list` and `scene inspect --rendered`. Only usable aligned
RGBD captures are context; a camera-only reference does not qualify.

Choose target cameras with visual judgment. `camera solve --position ... --look-at
... --out target.json` is read-only. `atlas --camera target.json --prompt '...'`
submits `atlasGenerate` using the current resolved context and frozen input bytes.
Use `--wait` or poll the job. Results integrate once through undoable commands.
Review with `scene preview --jobs <id> --out views.png` or independent `render`.
Do not move the shared editor camera just to inspect an agent's work.

When decomposing a reference into objects, use observe/crop/mask, image editing,
3D generation or authored code as appropriate. Keep extracted editable objects
and the static backdrop separable. Pose revised RGB again before using it as Atlas
context; stale depth is not a valid shortcut. Use `render <camera-node-id> --targets <mesh-or-group-id> --rgbd --wait` to
explicitly capture opaque mesh/primitive geometry as a new aligned RGBD context.
This uses measured linear camera-space depth, does not pose an image or call a
provider, and fails on splats, points, cutout/transmissive materials and custom
shaders. Presentation lens/bloom effects are excluded. Background pixels without
geometry have no depth; this is a capture of modeled surfaces, not hidden geometry.
For large static backgrounds, `splats <capture-id>...` is explicit and optional.

Keep context curated using `context include|exclude|solo`, preserve camera parents
and world transforms, and check seams/scale in actual renders. Freeze useful
results before expanding more views. Work within the user's generation scope;
failed provider tasks are inspectable, not an excuse for an unlimited retry loop.
Camera-path previews and generation share the same path math. Use the general skill
for exact camera-path commands and the CLI schema for current input fields.
