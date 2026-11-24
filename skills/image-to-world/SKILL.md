---
name: image-to-world
description: Pose image references and build an Atlas world one user-selected view at a time, then author playable 3D sets in the image-to-world editor. Match the reference through geometry, shaders, lighting and post-processing. Verify the playable result and export it for the web.
---

# image-to-world

## Match the look of the reference

Study what gives the image its character. Look at the silhouettes, the shapes of light and shadow, the color in the distance, the edges that catch a highlight. Use the full rendering pipeline to recreate those relationships. Shape the environment and lighting, write material and screen-space shaders, and use reflections, atmosphere, color grading and motion wherever they serve the reference. A painted surface can stay simple while bounced light gives it volume and a moving reflection makes it feel wet.

Render at the reference framing and look at the images side by side. Identify the most visible mismatch and change the part of the pipeline that can solve it. Move through the scene to see how the look holds together in play.

## Open the editor

If the user gives an editor URL, use it and confirm the intended project with `status`. Otherwise, use Bun 1.3.10 or newer. From the checkout, run `bun install --frozen-lockfile`, then `bun run image-to-world open ~/Projects/my-scene` with the project folder you want to open or create. Keep the launcher running and share the URL it prints. Use that full URL with `--url` on subsequent commands. See [local setup](references/cli.md#local-setup) for port conflicts and optional dependencies.

## Build the views first

1. **Check Atlas setup.** Run `status` against the full editor URL. If `worldLabsConfigured` is false, stop and ask the user to create a [World Labs API key](https://atlas.worldlabs.ai/api-keys) and save it as `WLT_API_KEY` in **Workspace settings → Environment variables**. Have them enter the key there. Check again before proceeding. If Atlas rejects the key, surface the error and pause for setup.
2. **Ask as soon as posing succeeds.** Import and pose the inputs with Atlas. The moment the pose job succeeds, ask in this chat where the user wants the next camera to go. Send the question before starting inspection renders, naming Frames, or checking the floor. Do those checks while the user answers. For disconnected references, also ask who should arrange them and finish that layout before submitting the pair. Preserve the solved relationship of overlapping photos.
3. **Repeat the conversation.** Always offer at least one camera-only option, for example “Step left and look along the façade, keeping the same description.” If the user gives only camera direction, solve the translated camera and run `atlas pair --camera shot.json --slug garden-steps` without `--prompt`. The server reuses the cached enhanced caption with enhancement off. Choose a distinct two- or three-word `--slug` for what the shot reveals. The kept Frame uses it automatically. Pass the chosen option or the user’s own wording with `--request-text` so it appears above the previews. Include `--prompt` only when the user requests new descriptive content. Tell the user to choose in the editor popup, then use `atlas round --wait` to watch for the decision. As soon as they keep a view or discard the pair, ask where to go next. Continue through as many rounds as they want. While waiting for an answer or editor choice, keep the loop pending across poll timeouts. End the loop or move into 3D only when the user explicitly asks. If a job fails, surface the error and help with recovery before resuming.
4. **Build after approval.** Atlas supplies the entire initial scene beyond the posed inputs. Wait for the user to finish choosing views before authoring geometry. Turn `context guides off` and build continuous architecture, parametric forms, and style-matched materials from those views. Keep source pixels out of authored materials.

## Build for play

Decide what supports weight, what the player can move, and what should turn or slide at a joint. Give structures simple colliders that preserve openings. Put hinges at their actual pivots. Walk the route in **Play** and operate a representative prop to check contact, clearance and movement.

Use **Open in web** to preview the scene in a standalone player. **Export** downloads a ZIP with the player, scene, and runtime assets. The ZIP includes instructions for hosting and embedding it.

## Authoring tools

Use **SVG & 3D Design** for construction and composition. Preserve the user’s selection and camera with independent renders and narrow, undoable edits. For editor commands, frame coordination and review, see the [CLI reference](references/cli.md). For Three.js geometry, TSL materials and articulated props, see the [module reference](references/modules.md).
