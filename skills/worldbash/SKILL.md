---
name: worldbash
description: >-
  Control an worldbash spatial studio workspace through its CLI: edit images with Nano Banana via FAL, explore branching image history, activate image versions in posed captures, reconstruct images and video, arrange and clip scenes, generate Atlas views, and render camera-path video through keyframes.
---

# worldbash

Run commands from the worldbash project directory with `bun run worldbash`. If the CLI is
installed as a binary, use `worldbash` instead. The app must be running; default URL
is `http://127.0.0.1:4310`. `--url` or `WORLDBASH_URL` selects another loopback port.
API keys belong to the server, never to command arguments or saved workspace JSON.

## Discover the workspace

1. Run `bun run worldbash status` to verify the connection and provider configuration.
2. Run `bun run worldbash state` for the current selection, image drafts, scene, panel
   settings, and jobs. Asset and node IDs are separate identities in the same
   selection collection. Resolve a node's `assetId` before editing its image.
3. Use `bun run worldbash schema commands` for all commands, `schema workspace` for
   state, `schema camera` for cameras, or `schema draft` for image layers/strokes.

All command results are JSON. Errors go to stderr with exit 1. For arbitrary
commands, write JSON to a file and use `bun run worldbash command @file.json`; this
avoids shell quoting problems. Do not replace the entire workspace to change one
object. Read the affected object, change its fields, and send `nodes.put`,
`assets.update`, `image.draft`, or `workspace.update`.

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
bun run worldbash import /absolute/path/to/source.png
bun run worldbash image open <source-id>
bun run worldbash image history <source-id>
bun run worldbash image edit <source-id> --prompt 'Replace the chair with a red armchair' --model 2 --resolution 1K
bun run worldbash jobs wait <job-id> --timeout 300
bun run worldbash image history <source-id>
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
bun run worldbash image draft <source-id> --file draft.json
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
bun run worldbash import /absolute/path/to/source.png
bun run worldbash scene place <image-id> --camera camera.json
bun run worldbash jobs wait <job-id>
bun run worldbash context list
bun run worldbash camera view <capture-id>
bun run worldbash camera free
bun run worldbash atlas <capture-id> --camera target-camera.json --prompt 'Sunlight through the windows'
```

A `capture` parent contains a camera, camera-local points, and a local clip box.
The image plane is a child of the camera. Move the capture parent to keep these
components aligned. Camera/points transforms are locked in the UI by default.
The asset owns the immutable RGB/depth and estimated calibration. Pose completion
preserves parent edits made while the job runs. `pose <asset-id>...` explicitly
estimates a joint set; its relative camera baseline is retained.

Cameras use XYZW quaternions and camera-to-world poses. `rub` is Three.js right/up/
backward; `rdf` is accepted and converted. Intrinsics are in pixels. Atlas accepts
capture IDs or child IDs; `context list` reports currently usable captures.
Nonuniform scaling or independently displaced camera/point children cannot describe
one RGBD frame and are excluded. Atlas prepares RGB, depth, and masks together on
its 1280x720 grid. View generation requests depth by default. Move the target away
from the context camera: pure rotations have no baseline for depth registration.

```sh
bun run worldbash context hide <capture-id>
bun run worldbash context show <capture-id>
bun run worldbash context exclude <capture-id>
bun run worldbash context include <capture-id>
bun run worldbash context solo <capture-id>
bun run worldbash context solo
bun run worldbash context order <first-id> <second-id>
bun run worldbash path create <camera-id> <camera-id> --target-frames 36
bun run worldbash context exclude <capture-id> --path <path-id>
```

Hide changes scene visibility. Exclusion changes generation membership. Solo
narrows context and the viewport; an empty `context solo` clears it. `--path`
addresses independent context settings on a camera path; omission addresses the
global context. Read state before replacing a context order or selection.

All nodes share parent, transform, visibility, and selection. Use `scene put
--file nodes.json` for exact records or `scene transform <id>...` for common edits.
Local clips affect point renderers beneath their parent; global clips affect the
whole scene. `invert:true` retains the inside of the box. Spark renders clipping;
Atlas receives a matching binary mask. Source files are preserved.

Hover the viewport for WASD/QE flight, right-drag or two-finger swipe to look,
Shift for speed, and pinch to change FOV. Gizmo modes use 1/2/3. `camera --file`
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
bun run worldbash scene move <id> --parent <parent-id> --before <sibling-id>
bun run worldbash scene move <id> --parent root
bun run worldbash scene duplicate <id>
bun run worldbash undo
bun run worldbash redo
bun run worldbash image undo <source-id>
bun run worldbash image redo <source-id>
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
bun run worldbash scene add path --name 'Camera move'
bun run worldbash path keyframe <path-id> --file start-camera.json
bun run worldbash path keyframe <path-id> --file end-camera.json
bun run worldbash video <posed-node-id> --path <path-id> --target-frames 36 --fps 12 --keyframes 4
bun run worldbash video frames <keyframe-job-id>
bun run worldbash image edit <frame-asset-id> --prompt 'Add flowering plants'
bun run worldbash image activate <edited-frame-id>
bun run worldbash video --source-job <keyframe-job-id>
bun run worldbash video integrate <dense-job-id> --indices 0,4,8
bun run worldbash video reconstruct <dense-job-id>
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
Atlas allows 128 combined context and target views per request. Reduce FPS,
target frames or context if a request exceeds that budget. The server encodes the MP4
using FFmpeg. Export with `export <asset-id> /new/output.mp4`.

Reconstruct imported video or images without opening a browser:

```sh
bun run worldbash reconstruct --video <video-asset-id> --fps 2 --max-frames 60
bun run worldbash reconstruct <image-id> <image-id>
bun run worldbash jobs wait <job-id>
```

Video sampling uses FFmpeg/ffprobe and spreads the cap across the duration.
Reconstruction stores camera/depth per frame and integrates new captures. Existing
captures keep their placement. Saved camera extrinsics anchor the solve; a single
view needs source depth for scale. Intrinsics are re-estimated. Large image changes
can reduce registration accuracy. Inspect the result before using it as context.

All generation intent passes through `generation.submit`: `image.edit`, `pose`,
`view`, `splats`, `video`, or `reconstruct`. `splats [capture-id...] [--refine]`
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
scaling can make a world rotation require shear; worldbash rejects that transform.
