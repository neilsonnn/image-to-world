---
name: image-to-world
description: Pose image references and build an Atlas world one user-selected view at a time, then author playable 3D sets in the image-to-world editor. Match the reference through geometry, shaders, lighting and post-processing. Verify the playable result and export it for the web.
---

# image-to-world

## Open the editor

If the user gives an editor URL, use it and confirm the intended project with `status`. Otherwise, use Bun 1.3.10 or newer. From the checkout, run `bun install --frozen-lockfile`, then `bun run image-to-world open ~/Projects/my-scene` with the project folder you want to open or create. Keep the launcher running and share the URL it prints. Use that full URL with `--url` on subsequent commands. See [local setup](references/cli.md#local-setup) for port conflicts and optional dependencies.

## Build the views first

1. **Check Atlas setup.** Run `status` against the full editor URL. If `worldLabsConfigured` is false, stop and ask the user to create a [World Labs API key](https://atlas.worldlabs.ai/api-keys) and save it as `WLT_API_KEY` in **Workspace settings → Environment variables**. Have them enter the key there. Check again before proceeding. If Atlas rejects the key, surface the error and pause for setup.
2. **Ask as soon as posing succeeds.** Import and pose the inputs with Atlas. The moment the pose job succeeds, ask in this chat where the user wants the next camera to go. Send the question before starting inspection renders, naming Frames, or checking the floor. Do those checks while the user answers. For disconnected references, also ask who should arrange them and finish that layout before submitting the pair. Preserve the solved relationship of overlapping photos.
3. **Repeat the conversation.** Always offer at least one camera-only option, for example “Step left and look along the façade, keeping the same description.” If the user gives only camera direction, solve the translated camera and run `atlas pair --camera shot.json --slug garden-steps` without `--prompt`. The server reuses the cached enhanced caption with enhancement off. Choose a distinct two- or three-word `--slug` for what the shot reveals. The kept Frame uses it automatically. Pass the chosen option or the user’s own wording with `--request-text` so it appears above the previews. Include `--prompt` only when the user requests new descriptive content. Tell the user to choose in the editor popup, then use `atlas round --wait` to watch for the decision. As soon as they keep a view or discard the pair, ask where to go next. Continue through as many rounds as they want. While waiting for an answer or editor choice, keep the loop pending across poll timeouts. End the loop or move into 3D only when the user explicitly asks. If a job fails, surface the error and help with recovery before resuming.

## Build the 3D world

Atlas supplies the initial scene beyond the posed inputs. Once the user finishes choosing views and asks to build, run `context guides off`. Use **SVG & 3D Design** for construction and composition. Build continuous architecture and parametric forms from the approved views. Keep source pixels out of authored materials.

### Match the look of the reference

Study the silhouettes, the shapes of light and shadow, the color in the distance, and the edges that catch a highlight. Use geometry, material and screen-space shaders, lighting, reflections, atmosphere, color grading, and motion wherever they serve the image. A painted surface can stay simple while bounced light gives it volume and a moving reflection makes it feel wet.

Render from the reference camera and compare the images side by side. Adjust the part of the rendering pipeline responsible for the most visible mismatch, then move through the scene to see how the result holds up in play.

### Build for play

Build colliders from the same dimensions as the procedural geometry. Give floors, walls, and other fixed surfaces simple static colliders that preserve doorways and gaps. Give each prop the player can lift or push a dynamic rigid body and a collider that fits its shape.

For articulated objects, give each independently moving part its own body. A gate needs a hinge at the post with a vertical axis. A drawer needs a slider along its runners with limits at either end. Attach handles and other details to the part they follow. See [Bodies and joints](references/modules.md#bodies-and-joints) for the module syntax.

In **Play**, walk the route and try the interactions you built. Check that a released prop rests on its support and that each mechanism moves through its intended range.

Use **Open in web** to preview the scene in a standalone player. **Export** downloads a ZIP with the player, scene, and runtime assets. The ZIP includes instructions for hosting and embedding it.

## Editor commands

Run `image-to-world` or, from the checkout, `bun run image-to-world`. Use `--url` for the project server and `--actor` to identify your edits.

| Task                          | Command                                                                                                                                                                                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Import and pose               | `import <file>…`, then `scene place <asset-id>…`. Use `--reconstruct` for overlapping photos and `jobs wait <job-id>` for each pose job.                                                                                                              |
| Author geometry and materials | `module add <source.ts> --parent <frame>` or `module update <node-id> <source.ts>`. See the [module reference](references/modules.md) for Three.js geometry and TSL materials.                                                                        |
| Isolate an object             | `observe <frame> --region x,y,w,h` saves the crop and placement evidence. Use `image edit <crop> --asset-only --prompt "…"` to make a complete object view.                                                                                           |
| Generate a reusable mesh      | `model speridlabs/idol/max --build-key <design> --file input.json` takes one image as `{"image_url":{"$asset":"<asset-id>"}}`. Set `rig` for a character or `enable_pbr` for material maps. Find `game_glb` or `rigged_character_glb` in `inventory`. |
| Place and fit                 | `scene place <mesh-asset> --parent <frame>`, then `fit <mesh-node> --observation <manifest>`. Review the proposed transform and apply it with the returned preconditions.                                                                             |
| Light the scene               | `lighting --file look.json` sets project lighting. `lighting <frame> --file rig.json` sets the rig for one shot.                                                                                                                                      |
| Capture environment lighting  | `probe <frame> --wait` captures a panorama of the built scene. In `look.json`, set `environmentAssetId`, `environmentIntensity`, and `environmentYaw`, then apply `lighting --file look.json`.                                                        |
| Compare with the reference    | `render <frame> --set --reference <image>` renders the Frame’s authored set from its camera. In the viewport, toggle **Input** and adjust its opacity under **Reference image settings**.                                                             |

Use independent renders for review. Keep edits narrow and undoable, and preserve the user’s selection and camera. See the [CLI reference](references/cli.md) for command options and Frame coordination.
