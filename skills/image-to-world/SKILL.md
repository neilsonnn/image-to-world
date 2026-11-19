---
name: image-to-world
description: Pose reference images, outpaint connected views with Atlas, then build playable 3D sets in the image-to-world editor. Author geometry, style-matched TSL materials and articulated props, verify the result from independent cameras, and export interactive scenes for the web.
---

# image-to-world

Build in the user’s existing Three.js canvas. Use **SVG & 3D Design** for construction, composition and visual review.

## Build the views first

1. **Pose and ground.** Import the images and immediately place them as posed Frames. Wait for their pose jobs. Turn on `context guides on` and inspect an overhead and a side render. Check floor contact, camera height, scale and upright orientation.
2. **Arrange multiple inputs.** Ask whether the user wants you to arrange them or will move them themselves. For disconnected views, move and rotate whole Frames into a plausible shared space. Keep their observed frustum volumes and depth points disjoint. Use `scene inspect` to check each point cloud’s world bounds together with its camera origin. Leave a clear gap between the input volumes and verify it in both renders. Preserve the solved relative poses of genuinely overlapping photos reconstructed together. For manual placement, wait for the user’s layout before outpainting.
3. **Outpaint the gaps.** Choose a few translated cameras that reveal missing regions and connect neighboring views. Use `camera solve … --out shot.json`, then `atlas --camera shot.json --depth --wait`. Inspect each integrated view before choosing the next. Imported and frozen guides are full opacity. Generated guides are half opacity. Freeze a trusted view in Spatial context to group it with the inputs.
4. **Build the scene.** Once the views connect, run `context guides off` before modeling. Use all views to design continuous architecture, parametric forms and style-matched TSL materials. Generate or import individual assets where useful. Parent each physical object under one owning Frame and check it from neighboring cameras. Use **Input** to compare the source image. Keep source pixels out of authored materials.

Give each new Frame a distinctive two- or three-word slug that describes its subject, such as `desk-painter`. Set `frameSlug` with `nodes.patch`. When working on a Frame, run `frame work <frame-id> "Shaping lamp arms" --actor <worker>`. Update the two-to-four-word description as your task changes. Run `frame work <frame-id> done --actor <worker>` when you finish or stop. Each worker clears its own status.

## Match the reference’s surface style

Study a few representative patches at full size before choosing materials. Look at where a shadow changes hue, how wide a highlight is, which edges carry a drawn line, and the scale and direction of marks. Write surface-specific TSL shaders for the features that give this particular image its character. Share a palette where the painting does, and give different materials their own response to light.

For an anime illustration, follow what the artist actually drew. Paper might have broad flat light and a crisp lavender cast shadow, glazed ceramic a single broken highlight, and foliage overlapping dark masses with a few bright brushstrokes. A painted background may call for soft value transitions beside sharply inked props. For a hard cel boundary, use a narrow `smoothstep` on the normal–light dot product to mix two painted colors. For a gouache wash, broaden that transition and break it with pigment variation in object space.

Render the authored set at the reference framing, compare matching crops, then turn the camera to check that highlights, marks and silhouettes still describe the forms. Revise the shader with the most visible mismatch.

## Build for play

Treat the set as a realtime level. Decide what supports weight, what someone can pick up, and what should turn or slide at a joint. Give furniture and architecture fixed collision surfaces, loose props a dynamic rigid body, and purely visual details a place on their owning part. Build a task lamp as a base, arms and shade with pivots at its actual hinges. A pull on the shade should bend the arm while the base stays planted. Use simple collision shapes that preserve openings and leave enough clearance for the mechanism to move.

Test the finished set in **Play**. Let it settle, pull a movable part off-center, release it onto a support, and check the pose at the joint limits. **Stop** restores the authored scene. The [module reference](references/modules.md#bodies-and-joints) shows how to declare bodies and joints.

## Editor tools

Run `image-to-world` (or `bun run image-to-world` from the repository). Use `--url` for the project's local server and `--actor` for the worker’s name.

| To | Use |
| --- | --- |
| Import and pose | `import <file>…`, then `scene place <asset-id>…` and `jobs wait <job-id>` for each returned job. Use `--reconstruct` for overlapping photos of one place. For offline modeling, `--reference-only` creates a local camera without depth. |
| Author geometry and materials | `module add <source.ts> --parent <frame>` or `module update <node-id> <source.ts>`. Import geometry from `three`, node materials from `three/webgpu`, and shader functions from `three/tsl`. Expose the dimensions, palette or pattern values that someone might want to change. |
| Build an object from a sighting | `observe <frame> --region x,y,w,h` saves a crop, masks and original placement evidence. `image edit <crop> --asset-only --prompt …` creates fresh complete object views. |
| Generate a reusable mesh | `model speridlabs/idol/max --build-key <shared-design> --file input.json` takes one chosen image as `{"image_url":{"$asset":"…"}}`. Add `rig` for a character or `enable_pbr` for material maps. Find the `game_glb` or successful `rigged_character_glb` output by name in `inventory`. |
| Place or author | `scene place <mesh-asset> --parent <frame>`, `fit <mesh-node> --observation <manifest>`, or `module add <source.ts> --parent <frame>`. Apply fit proposals with their returned preconditions. Modules can own meshes, lights, shaders and splats. |
| Match and review | `lighting <frame> --file rig.json` adjusts that shot. `lighting --file look.json` sets the project look. `render <frame> --set --reference <image>` compares only that Frame’s authored set from its camera, omitting the source image and points. Each worker renders independently of the human viewport. In the viewport, toggle **Input** to compare the reference with the scene. Adjust its opacity under **Reference image settings**. Use an oblique view for depth and contacts. |
| Capture environment lighting | `probe <frame> --wait` captures the built geometry as a panoramic lighting asset. Assign it with `lighting --file look.json` (`environmentAssetId`, intensity and yaw). |

The lead can give different Frames or objects to parallel workers. Agree on a shared build key for one reusable design. Identical requests join one job. A new variant gets a new key. Two physical chairs can share one mesh and have separate local transforms. A chair seen from several cameras can have a single owning Frame and several observation IDs. Use `nodes.patch` to attach `observationAssetIds`; use field guards if another worker is editing the same node.

The original image and depth are placement evidence. Keep fresh generated angles as separate assets. Preserve the user's selection and camera with independent renders and narrow, undoable edits.

Read the [CLI reference](references/cli.md) for calibrated cameras, masks, recovery and concurrency. Read the [module reference](references/modules.md) for authored Three.js objects. Discover exact fields with `--help`, `schema commands` and `schema generation`.
