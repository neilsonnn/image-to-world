# Editor command reference

## Compare two Atlas views

Run `status` against the editor URL and check `worldLabsConfigured` before posing or generating. Use `camera solve` to save a translated target camera, then submit `atlas pair --camera shot.json --prompt 'View-specific caption'`. Add Frame IDs after `pair` to limit context. The editor displays two variations of the same shot. The request returns both job IDs. `--wait` waits until the pair is ready for review or has failed.

Use `atlas round --wait --timeout 120` to wait for the human’s choice. On timeout it reports the current phase. When the result includes a keep decision, use its `frameId` to inspect the scene or plan the next view. Only the editor’s **Keep** action places a candidate in the project. A pending round survives reload and restart.

## Discover the workspace

1. Run `bun run image-to-world status` to verify the connection and provider configuration.
2. Run `bun run image-to-world state` for the current selection, image drafts, scene, panel
   settings, and jobs. Asset and node IDs are separate identities in the same
   selection collection. Resolve a node's `assetId` before editing its image.
3. Use `bun run image-to-world schema commands` for all commands, `schema workspace` for
   state, `schema camera` for cameras, or `schema draft` for image layers/strokes.

All command results are JSON. Errors go to stderr with exit 1. For arbitrary
commands, write JSON to a file and use `bun run image-to-world command @file.json`; this
avoids shell quoting problems. Do not replace the entire workspace to change one
object. Read the affected object, change its fields, and send `nodes.put`,
`assets.update`, `image.draft`, or `workspace.update`.

## Plan and review scenes

These helpers support the agent's visual judgment. Inspect the images and viewport,
choose positions and look-at targets yourself, and visually evaluate the results.
`camera solve` calculates orientation from your supplied choices; `camera place`
records a chosen camera as an undoable scene edit. Neither chooses viewpoints,
optimizes coverage, or generates images. Inspection reports structural validity,
not visual quality; contact sheets provide images for you to review. Choose the
order and combination of tools to suit the scene, without a fixed building sequence.

Use `scene inspect` for compact JSON with world poses, calibrated cameras,
transform capabilities, scene/subtree bounds, and usable or broken Atlas inputs.
It waits for an open viewport so bounds come from the same NodeSpatial providers
as framing and selection. `scene inspect --headless` works without a browser and
explicitly returns null bounds. Optional node IDs limit either report to subtrees.
Bounds include hidden content and framing boxes for empty nodes; they are not a
coverage score and do not reflect clipping. Review actual images before splatting.

```sh
bun run image-to-world scene inspect --out inspection.json
bun run image-to-world camera solve --position 2,1.6,3 --look-at 0,1,-4 --fov 65 --out target-camera.json
bun run image-to-world camera place --position 2,1.6,3 --look-at 0,1,-4 --relative-to <node-id> --name 'Window aisle'
bun run image-to-world scene preview --out room.png
bun run image-to-world scene preview --jobs <job-id>,<job-id> --columns 3 --out round.png
```

`camera solve` is read-only and returns normal camera JSON. Pass it to existing
`atlas --camera`, `capture --camera`, image creation, or placement commands.
Position, target, and optional `--up` are interpreted in world coordinates unless
`--relative-to` names a node. Its current transform and ancestors are respected,
including scale. The resulting camera is world-space, not parented. Vertical FOV
is optional; default intrinsics come from the current camera. Coincident targets
and an up vector parallel to the viewing direction are rejected explicitly.
`camera place` with these flags makes one undoable camera through `camera.aim`.

`scene preview` defaults to every Frame's current participating image. Supply
Frame IDs, `--jobs id,id` for completed rounds, or `--assets id,id`; choose one
selector. This local `contactSheet` job snapshots bindings/labels and produces a
PNG and JSON manifest. It needs no browser or provider key and does not move the
viewport or add scene nodes. `--out` exports a copy without overwriting a file.

Discover exact interfaces with `schema aim`, `schema inspection`, `schema jobs`,
and `schema commands`. Inspection and contact sheets are local jobs, not generation
requests; they do not authorize subsequent paid Atlas generation. Use the returned
job ID to inspect/retry a timed-out viewport operation instead of blindly duplicating it.

## Place multiple images

`scene place <id>... --reconstruct` reconstructs images together and places the
shared camera solution at the viewport. Omit `--reconstruct` to pose images
individually. Both use `assets.place`; its `mode` is `reconstruct` or `individual`.
The browser asks for this choice when multiple images are dropped or pasted into the scene; library imports only save files. CLI calls are
explicit and never wait for that dialog. Optional camera and parent arguments
preserve the intended scene destination.

## Search and manage assets

Use `assets --search "room image"` to filter names, kinds, and paths. `assets trash
<id>...` moves unused files into recoverable project trash. `assets --trash` lists
those files; `assets restore <id>...` restores them. `assets reveal <id>` reveals
the file in Finder. Scene, geometry, layer, and active-job dependencies block
trashing; remove the dependency first. Asset trash is separate from scene undo.

Both panels persist search through partial collection settings, for example
`workspace.update` with `settings: {collections: {sceneSearch: "camera"}}`.
Changing search preserves outline expansion and other collection settings.

## Nano Banana and image history

The image panel under the viewport is first class. Use `image open <asset-id>` to focus it.
Every edited image is a new asset, linked to its primary parent by `parentAssetId`.
Additional references are `referenceAssetIds`; they do not change the primary
history branch. The job retains prompt, model settings, seed, and input draft.

```sh
bun run image-to-world import /absolute/path/to/source.png
bun run image-to-world image open <source-id>
bun run image-to-world image history <source-id>
bun run image-to-world image edit <source-id> --prompt 'Replace the chair with a red armchair' --model 2 --resolution 1K
bun run image-to-world jobs wait <job-id> --timeout 300
bun run image-to-world image history <source-id>
```

A completed edit activates its first output in linked captures. The previous depth
stays visible while its `childJobId` reconstructs geometry. Wait for that child job
when geometry completion matters. Use `--no-reconstruct` for color-only edits.
`image activate <version-id>` selects a history version and updates all linked
captures. Add capture IDs to affect only those instances. Browsing with `image
open` does not activate a version. `image history` reports the default active ID.

Select any historical output ID as the next source to branch. Preserve existing
branches. Use `--reference id,id` for style/content references, `--model pro` for
Nano Banana Pro, `--ratio`, `--count`, and `--seed` for explicit generation settings.
`image edit` captures the saved image draft; `--draft file.json` overrides it.

Draft layers render in array order over the source. Coordinates and dimensions
are normalized to the source image. Stroke coordinates are normalized to [0,1];
size is a fraction of image width. `erase:true` erases annotations only. The server
composites the draft into a PNG and uploads binary files to FAL. Annotation marks
guide the model; they do not guarantee a hard pixel mask. Save draft changes with:

```sh
bun run image-to-world image draft <source-id> --file draft.json
```

Use the dedicated Nano command for image edits, not generic `fal`, so generation
history and source relationships are recorded. Opening/selecting images or
changing layout does not authorize unrelated paid generation.

## Scene, posing, and Atlas

Use `scene place <asset-id>...` to add images at the current viewport's floor
position and yaw. It returns `jobIds` immediately for images that need posing;
already posed assets can be instanced without another API request. `--camera`
captures an explicit placement. Library import alone saves the binary.

```sh
bun run image-to-world import /absolute/path/to/source.png
bun run image-to-world scene place <image-id> --camera camera.json
bun run image-to-world jobs wait <job-id>
bun run image-to-world context list
bun run image-to-world camera view <capture-id>
bun run image-to-world camera free
bun run image-to-world atlas <capture-id> --camera target-camera.json --prompt 'Sunlight through the windows'
```

A `capture` parent (Frame in the UI) contains a camera and camera-local points.
No clip boxes are created automatically; add them explicitly when needed.
The image plane is a child of the camera. New Frames start with the image and points hidden.
Use Reference while viewing the camera, or enable individual guides in the Outline.
Atlas can use a visible Frame's aligned RGBD while both guides are hidden. Move the capture parent to keep these
components aligned. Camera/points transforms are locked in the UI by default.
The asset owns the immutable RGB/depth and estimated calibration. Pose completion
preserves parent edits made while the job runs. `pose <asset-id>...` explicitly
estimates a joint set; its relative camera baseline is retained.

Cameras use XYZW quaternions and camera-to-world poses. `rub` is Three.js right/up/
backward; `rdf` is accepted and converted. Intrinsics are in pixels. Atlas accepts
capture IDs or child IDs; `context list` reports currently usable captures.
While viewing a camera, WASD, right-drag, scroll, and pinch leave viewing mode
and continue from the visible pose and lens. Escape or `camera free` restores
the previous free view instead. `camera.release` accepts an optional `camera`
for an explicit navigation handoff; omitting it restores the previous view.
Nonuniform scaling or independently displaced camera/point children cannot describe
one RGBD frame and are excluded. Atlas prepares RGB, depth, and masks together on
the session’s selected grid. View generation requests depth by default. Move the target away
from the context camera: pure rotations have no baseline for depth registration.

```sh
bun run image-to-world context hide <capture-id>
bun run image-to-world context show <capture-id>
bun run image-to-world context exclude <capture-id>
bun run image-to-world context include <capture-id>
bun run image-to-world context solo <capture-id>
bun run image-to-world context solo
bun run image-to-world context freeze <capture-id>
bun run image-to-world context unfreeze <capture-id>
bun run image-to-world path create <camera-id> <camera-id> --target-frames 36
bun run image-to-world context exclude <capture-id> --path <path-id>
```

Hide changes scene visibility. Exclusion changes generation membership. Solo
narrows context and the viewport; an empty `context solo` clears it. `--path`
addresses independent context settings on a camera path; omission addresses the
global context. Context lists imports first, then generated Frames, in scene hierarchy
order within each group. Freeze promotes a generated Frame into the import group;
it does not lock transforms, image editing, or generation. Reorder Frames in the
scene hierarchy to change their order within a group.

All nodes share parent, transform, visibility, and selection. Use `scene put
--file nodes.json` for exact records or `scene transform <id>...` for common edits.
Local clips affect point renderers beneath their parent; global clips affect the
whole scene. `invert:true` retains the inside of the box. Spark renders clipping;
Atlas receives a matching binary mask. Source files are preserved.

Hover the viewport for WASD/QE flight, right-drag or two-finger swipe to look,
Shift for speed, and pinch to change FOV. The combined gizmo shows supported move/rotate/scale handles together.
Center uses combined bounds; Origin uses average selected origins. World/Object
chooses world axes or the primary selected object’s axes. Frames and cameras
cannot be scaled; per-node `transformPermissions` can further restrict operations. `camera --file`
writes the persisted viewport camera; `camera view` resolves a node's world camera.

## Layout, ordered edits, and undo

`settings.layout` stores right-column width, left split, and history width;
`sidebarWidth` and `editor2d.height` store the other pane sizes. `settings.collections`
stores expanded node IDs and asset list/grid mode. `settings.display`
stores RGB visibility/opacity/distance, point style, and frustum visibility.
`atlasPanel` saves selected-only mode and output history. `format` is the
session's Atlas grid, set on first import. `prompt` is the scene description
Atlas and splats send; `enhancePrompt` asks the API to enhance it. `seed`
advances after each current-view render when `seedMode` is `auto`.
`collections.assetKinds` lists the asset kinds Project assets shows. Selecting a path shows its Atlas context. Context membership is `settings.atlas` or a path node's `context`.
Read current state before patching nested settings; `workspace.update` replaces
provided nested objects. These display controls leave API camera/depth inputs intact.

```sh
bun run image-to-world scene move <id> --parent <parent-id> --before <sibling-id>
bun run image-to-world scene move <id> --parent root
bun run image-to-world scene duplicate <id>
bun run image-to-world undo
bun run image-to-world redo
bun run image-to-world image undo <source-id>
bun run image-to-world image redo <source-id>
```

Moves preserve world transforms and relative order, and filter selected descendants
when their ancestor is also moved. Prefer `scene move` for parenting. Use
`selection.set` with `ids`, `primaryId`, and `anchorId` when controlling the UI's
primary item or range anchor. Selection never submits generation.

For a single undoable multi-object edit, send `edit.batch` with a `commands` array
of local `nodes.put`, `nodes.move`, `nodes.reparent`, `nodes.remove`, or
`assets.update` or `image.activate` commands. A failing edit rolls back the whole batch. Pass `null`
to clear an asset's depth, confidence, or mask association. Undo affects local
scene/property edits; image draft undo is scoped by asset ID. Jobs and binary
file changes are not undone. A conflict error means an affected field changed
externally; inspect state before retrying or applying a replacement edit.

## Capture and camera paths

`camera place` records the current view and extends camera selection, matching C
in the viewport. `path create <camera-id>...` uses selection order supplied by the
caller. A path node owns vertical `fov` (degrees) and `targetFrameCount`; edit
these through `path update <id> --fov 60 --target-frames 48`. Keyframes are ordered
poses with no timestamps. Target frames controls sampling; FPS controls playback. Properties owns path edits; the viewport palette owns preview, scrub,
and generation actions. Atlas owns context, generation settings, and output.

`capture --camera camera.json --wait` saves a clean PNG at the specified camera's
resolution. Without `--camera` it captures the current viewport. An open browser
viewport is required for capture; other commands work headlessly.

```sh
bun run image-to-world scene add path --name 'Camera move'
bun run image-to-world path keyframe <path-id> --file start-camera.json
bun run image-to-world path keyframe <path-id> --file end-camera.json
bun run image-to-world video <posed-node-id> --path <path-id> --target-frames 36 --fps 12 --keyframes 4
bun run image-to-world video frames <keyframe-job-id>
bun run image-to-world image edit <frame-asset-id> --prompt 'Add flowering plants'
bun run image-to-world image activate <edited-frame-id>
bun run image-to-world video --source-job <keyframe-job-id>
bun run image-to-world video integrate <dense-job-id> --indices 0,4,8
bun run image-to-world video reconstruct <dense-job-id>
```

Wait for each generation before using its outputs; wait for an edit's reconstruction
child before using the edited keyframe as depth context. Dense generation uses the
active versions, preserves keyframe pixels, and samples the remaining cameras from
the frozen camera sequence. It is a fresh Atlas request conditioned on those keyframes.
`video frames` lists actual sampled-frame indices; sparse indices are not thumbnail
positions. Use `video view <job-id> <index>` to inspect a frame camera. Integration
is idempotent. `video reconstruct --indices ...` limits reconstruction to those frames.

Camera keyframes share pixel dimensions. `path keyframe` appends a pose. Use
`--id <keyframe-id> --index <zero-based-position>` to reorder it. To replace or
remove one, use `path keyframe <path-id> --id <keyframe-id>` with
optional `--remove`. Without `--file`, it records the current world-space camera.
Atlas allows 128 combined context and target views per request. Reduce target frames or context if a request exceeds that budget. The server encodes the MP4
using FFmpeg. Export with `export <asset-id> /new/output.mp4`.

Reconstruct imported video or images without opening a browser:

```sh
bun run image-to-world reconstruct --video <video-asset-id> --fps 2 --max-frames 60
bun run image-to-world reconstruct <image-id> <image-id>
bun run image-to-world jobs wait <job-id>
```

Video sampling uses FFmpeg/ffprobe and spreads the cap across the duration.
Reconstruction stores camera/depth per frame and integrates new captures. Existing
captures keep their placement. Saved camera extrinsics anchor the solve; a single
view needs source depth for scale. Intrinsics are re-estimated. Large image changes
can reduce registration accuracy. Inspect the result before using it as context.

Generation intent passes through `generation.submit`. See `schema generation` for the available request kinds. `splats [capture-id...] [--refine]`
reconstructs a splat node at the scene root from the Atlas context captures. Use `schema commands` for exact fields and
`command @file.json` for options beyond the CLI flags. UI and CLI share its defaults.

## Jobs and recovery

Submission is nonblocking. Inspect `jobs show <id>` or use `jobs wait <id>` when
completion is required. A wait timeout does not cancel the provider job. Keep the
ID rather than submitting a duplicate. `jobs retry <id>` resumes a saved request
or re-downloads its results. For a terminal provider error, inspect its error and
submit a new generation only when that retry is intended.

`jobs cancel <id>` stops local work and requests FAL cancellation when possible;
World Labs may continue and bill its remote task. If FAL submission lost its
request ID, check provider history before resubmitting. `events` streams revision
notifications; fetch `state` to inspect the change.

Import through the CLI or add binaries beneath the workspace's `assets/` folder.
The app watches nested files. Avoid base64, browser storage, private backend URLs,
or editing `workspace.json` while a command is pending.

Camera gestures and display edits participate in the scene undo journal. Each
multi-object gizmo drag is one edit; duplicate/delete undo restores selection.
Pane sizing and image drafts retain their separate behavior. Nonuniform ancestor
scaling can make a world rotation require shear; image-to-world rejects that transform.

## Decompose a posed image into editable objects

Use independent primitives; there is no mandatory blast sequence or task-folder layout.
Generated files are ordinary project assets with provenance. Only the command service
writes scene state. Use `schema generation` and `schema context` to discover exact inputs.

- `models` lists suggested endpoints. `models <endpoint>` fetches its public schema;
  `models --search text` queries FAL. Any public FAL model can be invoked with
  `model <endpoint> --file input.json`. `{ "$asset": "asset-id" }` uploads local
  assets. Results remain assets; `scene place` explicitly creates a scene instance.
- `observe <capture-id> --region x,y,w,h [--polygon points.json | --mask asset-id]`
  saves a padded crop, foreground mask, unchanged-background mask, and observation
  JSON. Coordinates and polygons are normalized, top-left. Depth comes from the
  active points node. Observation coordinates and distances use the Frame’s local space. Inspect its sample count and
  dispersion; it does not infer hidden shape or metric scale.
- `image edit <crop-id> --asset-only --prompt 'Complete and isolate this object…'`
  can outpaint missing parts. The original observation remains placement evidence.
  Idol Max takes one fresh reference via `image_url: { "$asset": "..." }`.
- `scene place <mesh-asset-id>` creates an ordinary transformable mesh node.
  Self-contained uncompressed GLB 2.0 is supported. Use `nodes.patch` to change its
  asset binding without sending a stale whole node.
- `fit <mesh-node-id> --observation <manifest-asset-id> [--quaternion x,y,z,w]`
  returns a read-only transform proposal and preconditions. It is a starting point
  based on image extent and depth, not an automatic orientation or quality solver.
  Export the proposal, extract `command` and `preconditions`, then use
  `command @command.json --expect preconditions.json`. Reobserve if its internal geometry, evidence or calibration changed. A rigid move of the entire shared Frame preserves a local placement. A quaternion here specifies world orientation.
- `render <camera-or-capture-id> [--targets id,id] [--reference image-id]`
  uses an independent headless Chrome renderer, with the shared scene geometry.
  It never moves the browser viewport. `--passes color,mask,depth,ids` adds mesh
  silhouettes, camera-forward linear EXR depth and stable node IDs. Geometry passes
  require mesh-only targets; color supports points, meshes and splats. Every render
  includes a JSON manifest and renderer bounds. `generate --file request.json`
  additionally accepts temporary node transform overrides for candidate review.
- Inspect at the source camera and from a second camera; correct orientation,
  size, grounding and occlusion with ordinary scene commands. One image does not
  determine hidden shape, exact scale or orientation.
- When an extracted object needs a clean background, coordinate one cleanup per shared source view.
  `mask <mask-id>... --operation union --dilate 24 --feather 16 --invert` combines removed regions
  into an unchanged mask. Dilation should exceed feathering to avoid blending the original object back into the image. `image edit <source-id> --targets <capture-id>` with
  `--unchanged-mask <id>` preserves white mask pixels locally, then reconstructs
  depth using only that evidence. The candidate RGB and new depth apply together
  through the existing result ownership rules. A failed refresh retains the old
  scene and candidate assets. `--no-reconstruct` is explicit; edited RGB without
  matching depth is excluded from Atlas context.
- During initial layout, use `context guides on` and `atlas --camera shot.json --depth --wait` for sparse connecting views. Use `context guides off` before modeling. For subsequent clean-plate expansion, exclude views that still show removed objects.

## Concurrent workers

Workers may share one live server. Set `IMAGE_TO_WORLD_URL` once and optionally
`IMAGE_TO_WORLD_ACTOR` per worker; identity also accepts `--actor`. Work on separate
objects, and nominate one worker to clean a shared source view. Independent local
rendering and provider generation have separate scheduling slots.

Use `nodes.patch`, `scene transform`, and command batches for narrow changes. Add
`--expect guards.json` when the result depends on observed fields or parents;
conflicts return HTTP 409 and do not partially apply. Use a stable `--request-id`
when retrying the same mutation. Reusing it with different content is rejected.
Completed receipts survive restart; interrupted submissions with saved jobs recover
that job. An interrupted file operation without a receipt requires inspecting its
actual effects before choosing a new request ID. Do not edit workspace.json or
write into another worker's output file. Job inputs are copied into immutable,
content-addressed snapshots before running.

CLI changes preserve human selection unless selection was explicitly requested.
Use `revert <edit-id>` for your own unchanged edit instead of undoing the global
latest action. Existing dependent changes make a revert fail atomically. No worker
needs an interactive browser tab. Chrome/Chromium must be installed locally for
headless rendering; `CHROMIUM_PATH` overrides detection. Startup never downloads it.
