# Build a world from images

Proposed product and engineering plan, November 18, 2026.

A user pastes one or more images into chat and asks the agent to build the world. The images appear as posed references in the existing editor. The user can watch objects take shape, select and move them, fly past the original cameras into an Atlas-built environment, and take the assets elsewhere. A successful scene reads as one place from several angles, including somewhere the source photographer never stood.

## Two skills and one editor

Use OpenAI’s **SVG & 3D Design** as the primary creative skill. Explicitly designate image-to-world as the authoring environment when starting work and when handing an object to a specialist. The upstream skill already honors a specified tool. Use its judgment about form, materials, composition and visual repair. Document how to enable the two skills together and verify discovery in a fresh session with the plugin available. For installations without the upstream skill, explain how to obtain it and keep the editor independently usable.

Keep **image-to-world** as the short companion and CLI reference. Its opening could read:

> You’re building in image-to-world, a shared Three.js scene. Bring images into the scene as posed views. You can observe an object from a camera, make fresh references, generate or import a mesh, write a procedural node, place assets, render from any saved camera, and extend the environment with Atlas. Each agent can inspect its own render while the user keeps flying.

Follow this with a compact table of intents, commands and results. Link detailed command examples and recovery semantics as references. Include one worked image-to-world example. Keep the creative brief, representation choices, number of workers and iteration count with the agent. The longer journey below describes what the product must support.

## The first-run journey

1. **Pose, arrange and outpaint.** Pose imported images and inspect floor contact and orientation from above and from the side. For multiple images, ask who will arrange them. Separate the observed volumes of disconnected views and preserve joint registration for overlapping photos. Use sparse translated Atlas cameras with returned depth to connect missing regions. Review the new geometry as each view arrives. Imported and frozen guides are full opacity and generated guides are half opacity. Turn off Frame guides before building architecture and assets from all available views.
2. **Identify objects across views.** Workers can observe separate cameras in parallel. Each observation keeps its source camera, crop, silhouette and available depth. The lead decides which objects deserve separate identities, which repeated instances can share geometry, and which details belong to the static environment. Reprojection, appearance, relative position and occlusion can support that decision. Keep uncertain matches unresolved until inspected.
3. **Make fresh object images.** For each asset being generated, use the source crops to create an isolated, complete image in an informative view. Generate complementary angles where they resolve a hidden attachment, silhouette or material. Preserve distinguishing details and align all variants with the same design. Store generated views as ordinary image assets linked to their evidence. Keep them distinct from photographed observations so imagined geometry cannot silently become camera or depth evidence.
4. **Generate and place each asset.** Give one specialist ownership of a unique asset build and its assigned placements. Send the chosen single-object image to Idol Max. Select the appropriate output by role. Use its game mesh for a prop or a successful rigged mesh for a character that needs articulation. Place each instance, start with the existing depth-based fit, then compare its projected silhouette, contact and occlusion against every relevant original camera. Use a side or rear view to catch an object that only looks right head-on. Workers use independent renders and guarded node edits.
5. **Build the environment.** Author continuous floors, walls and large forms with parametric geometry and original materials. Compare the construction from imported and connecting cameras.
6. **Clean plates where needed.** If removed objects must disappear from a background asset, coordinate a masked edit and refresh its depth. Keep original evidence and editable assets available.
7. **Finish lighting and deliver.** Match editable assets to the world, inspect source and novel views, and refine the highest-impact discrepancy. Preserve the editable project, reusable assets, source/reference relationships, environment textures and presentation cameras. Deliver a source comparison and a short sequence or contact sheet from inside the finished world. Verify a representative exported asset by reopening it with its materials and, where applicable, skeleton intact.

## The small amount of shared state that matters

The lead maintains one project-wide inventory using the existing command service. An **observation** is a sighting in a particular view. An **instance** is one physical object with one scene node and its authoritative transform. A **reusable asset** can serve several instances. One chair seen in three cameras gets three observations and one node. Two identical chairs get two independently placed nodes sharing one generated asset. A visibly different chair can have its own asset. This distinction prevents both duplicate billing and objects disappearing through over-aggressive merging.

Start with durable links between observation IDs, an intended instance and an asset build. Give the lead ordinary inspect/link/unlink actions so it can correct a mistaken association. Preserve node transforms and source evidence when correcting links. No agent-maintained directory tree or second scene description is needed. A lead can initially pass stable IDs with assignments. Persist the associations through the WorkspaceStore before testing overlapping work and restart.

For paid generation, reserve or join a build atomically. Derive the request identity from the shared build ID, approved reference version, endpoint, effective options and variant intent. The winner submits through the existing job runner. Peers get its job or result. Reuse existing receipts, field guards and input snapshots. An explicit variant has a new identity. After an ambiguous remote submission, reconcile the stored request before resubmitting. Identical request keys prevent races only after the lead has matched the object identities. A visually similar crop alone must never silently merge assets.

## What to reuse and what to build

| Area | Already available | Work to do |
| --- | --- | --- |
| Sources and decomposition | Import, individual/joint posing, masked observations, asset-only image edits, version history | Verify chat handoff. Link several observations and generated reference variants to one instance/build. |
| Model generation | Public FAL schema discovery, arbitrary model inputs, asynchronous jobs and retained assets | Add Idol Max and Turbo to suggestions. Preserve named output roles and select the intended GLB. Verify textures, materials, skinning, independently posed duplicates and animation data with representative files. |
| Placement and collaboration | Single-observation fit proposal, guarded transforms, headless color/reference overlays and mesh ID/mask/depth passes, automatic activity | Make all observing cameras easy to render for one candidate transform. Begin with visual iteration. Add a multi-observation fit refinement only if the benchmark shows a recurring manual error. Report conflicting views rather than inventing precision. |
| Background and Atlas | Mask union, unchanged-pixel protection, coordinated RGB/depth refresh, scoped Atlas context and camera planning | Make per-view cleanup completeness visible to the coordinator. Verify that stale views cannot reintroduce extracted objects in an expansion. |
| Native authored assets | Three.js/Spark procedural modules, declared assets, editable parameters and shared node transforms | Surface modules in the companion. The agent can construct geometry, practical fixtures or stylized details locally where appropriate. |
| Rendering | Shared scene graph, existing viewport and independent renderer, fixed ambient/directional lights | Add authored scene lighting, generated/imported environment maps, shadows and one shared presentation configuration. |

### Model integration

The linked announcement is for **Idol Max** (`speridlabs/idol/max`) and **Idol Max Turbo** (`speridlabs/idol/max/turbo`). Both accept one `image_url`. Use Max as the proposed quality default and expose Turbo as a deliberate speed choice. A second paid run is a separate creative decision. Keep all fresh angles for source comparison, regeneration or use by another model. Preserve the output roles `game_glb`, `model_glb`, and optional `rigged_character_glb` plus animation outputs. Record actual rig success and clips returned. Test that the editor selects the intended role even when the response order changes or rigging yields only a static mesh. Keep the public generic model command as the entry point.

### Environment generation and lighting

- **Persist an environment asset and a scene look.** Support a solid background or oriented equirectangular panorama, independent background visibility and image-based lighting intensity, exposure and color management. Reference project assets. Let a neutral initial rig be editable or replaceable. Lights that occupy space should be ordinary transformed scene nodes with the shared spatial and command contracts.
- **Create a map from the cleaned scene.** Give the agent a local route to render six consistently oriented faces from a chosen probe position and assemble an equirectangular map. Build from the static environment with movable meshes and editor overlays excluded. For missing coverage, let an available image model complete a seamless panorama using cleaned views, or import a supplied HDRI. Verify face orientation, seam, horizon and bright-source directions. Label inferred areas and LDR versus HDR accurately. Prepare the map for roughness-dependent reflections and diffuse lighting. Use direct lights for strong sources an LDR panorama cannot reproduce.
- **Match the source in the existing viewport.** Compare shadow direction and softness, illuminated versus shaded faces, apparent material roughness, contact at the floor and reflection orientation. Add shadow receivers where the rendered background cannot receive geometric shadows. Keep captured pixels and baked point/splat appearance color-faithful. Shade editable geometry consistently alongside them. Keep flat color, hard edges and minimal lighting available for stylized work.
- **Use the same renderer configuration everywhere.** Live color, headless color and delivered renders consume the same scene settings and asset references. Keep masks, IDs and linear depth independent of exposure and tone mapping. Snapshot the look for a render job so another agent editing lights cannot change a comparison in flight. Verify the environment loads from a saved project and that light edits survive undo.

## Delivery order and proof

| Milestone | Demonstration required before moving on |
| --- | --- |
| 1. Skills and one source | From a fresh chat, the agent chooses image-to-world, poses an image, creates a fresh object view, uses an Idol-shaped fixture through the ordinary model path, places the mesh, cleans the source and renders the result. Check documentation against the CLI. |
| 2. Multiple sources and workers | A disposable three-view scene contains one desk seen repeatedly, two chairs of one design and a distinct character. The expected inventory is four physical nodes and three asset builds. Two workers requesting the same build join one provider submission. Restart and retry preserve that result. Test conflicting edits, a mistaken match that is split, and a failed background refresh. |
| 3. Environment and presentation | Expand the clean static scene with Atlas, create a reusable environment map, fit lights and inspect assets at source and novel cameras. Use an asymmetric map and a lit reference object to catch rotation, exposure and shadow errors. Check a flat-style scene as well. Live and headless comparisons use identical poses and look settings. |
| 4. End-to-end showcase | In a fresh project, build a complete world from user-authorized reference images and provider jobs. Present originals, fresh object references, independently selectable/portable assets, clean plates, Atlas expansion, lighting assets and final renders. Reopen an exported prop and character. Include a novel-angle view where their placement and contact are legible. |

Run the repeatable suite with provider fixtures, in-process command/store tests and disposable CLI projects. Exercise restart, request reuse, hierarchy transforms, RGBD ownership, GLB selection, render parity and raw diagnostic passes. Use actual renders for judging source fidelity and visual quality. Keep a separate, explicitly authorized real-provider showcase to establish how well the models perform on the chosen images.

## Sources

- [Original image-blaster object skill](https://github.com/neilsonnn/image-blaster/blob/main/.claude/skills/image-blast-3d/SKILL.md)
- [OpenAI SVG & 3D Design](https://chatgpt.com/plugins/Plugin_13c5903473e081919917a1070fad1dd1?open_in_app)
- [FAL announcement](https://x.com/fal/status/2123079365978190282), [Idol Max API](https://fal.ai/models/speridlabs/idol/max/api), [Turbo](https://fal.ai/models/speridlabs/idol/max/turbo)
- [Shipped image-to-world primitives](../IMAGE_BLASTER_PLAN.md), [editor skill](../skills/image-to-world/SKILL.md), [procedural node contract](../core/module-contract.ts), [shared scene renderer](../web/src/lib/scene.ts)
