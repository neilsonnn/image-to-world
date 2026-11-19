# image-to-world

image-to-world is a local asset creation toolkit for building 3D scenes from
reference images, parametric Three.js geometry, shader materials, and generated
or imported assets. Model and light each set in the WebGPU viewport and inspect
it from independent cameras. Atlas provides
posed image context, new environment views, and camera-path videos. The browser
and CLI share a filesystem workspace. Generation runs in the background while
you keep editing.

## Run

Use Bun 1.3.10 or newer. Install FFmpeg and ffprobe for video encoding and reconstruction. World Labs
posing and Atlas require a Developer API key with access to those tasks; Nano
Banana uses a FAL key. Importing, arranging, annotating, and capturing scenes work
without either key.

1. Clone the repository and install the locked dependencies:

   ```sh
   git clone https://github.com/neilsonnn/image-to-world.git
   cd image-to-world
   bun install --frozen-lockfile
   ```

2. No credential setup is needed before opening the editor. Use **Environment**
   in the top bar or **Workspace settings → Environment variables** to edit the
   shared local config as key/value rows. `WLT_API_KEY` and `FAL_KEY` are suggested
   entries; add any variable by name. Values stay masked, and existing values are
   never sent back to the browser. Blank replacement fields keep current values;
   removing a saved variable restores any inherited process value.
   Saves use permissions `600` in `~/.config/image-to-world/env` (or
   `$XDG_CONFIG_HOME/image-to-world/env`), outside project state and undo history.
   Saved variables override shell variables and checkout `.env`. Provider keys,
   `WLT_API_BASE_URL`, `FFMPEG_PATH`, and `FFPROBE_PATH` apply immediately;
   startup settings such as the workspace directory apply next launch.
   Saving does not contact providers or validate keys or task access.

3. Open a project:

   ```sh
   bun run image-to-world open ~/Projects/my-scene
   ```

   The launcher builds on first use or after source changes, starts the local
   server, and opens your browser. Keep the terminal open; Ctrl+C stops the server.
   Without a project argument, it uses `IMAGE_TO_WORLD_WORKSPACE` or this checkout's `.image-to-world/`.
   The launcher defaults to port 4310 and ignores the generic `PORT` variable.
   A matching server on the requested port is reused. For another project, use
   `--port 4311`; pass `--url http://127.0.0.1:4311` to subsequent CLI commands.
   Use `--no-browser` for agent or terminal-only sessions.

4. Check setup and CLI access:

   ```sh
   bun run image-to-world doctor ~/Projects/my-scene
   bun run image-to-world status
   ```

`doctor` reports configuration without contacting providers or printing secrets.
Missing API keys or video tools disable the corresponding features, not local
editing. Install FFmpeg through your system package manager; its distribution
normally includes ffprobe. `FFMPEG_PATH` and `FFPROBE_PATH` override detection.

Use `bun run dev` when editing the app itself. The launcher loads user config;
the development server also reads saved provider keys, with checkout `.env` and
shell variables available for other configuration.
The server binds to loopback and serves one local workspace. Project files live
in the chosen directory, independently of the installation. Generation requires
internet access; local editing does not.

Update to a tested release explicitly, run `bun install --frozen-lockfile`, stop
the old server, and launch again. Startup never updates code or dependencies.
Back up project directories before changing versions; rolling back the app does
not roll back project data, and older versions may reject newer project formats.

## Play and export a scene

Click **Play** in the center of the header. Drag a loose object from the point you want to hold, or pull a jointed part to move its mechanism. Right-drag to look and use WASD to fly. On a touch screen, drag empty space to look around. **Stop** or **Esc** returns to the authored scene and camera. Simulation runs locally and each visitor has their own session.

Mesh and procedural nodes expose **Rigid body** in Properties. **Automatic** runs an authored rig or treats mesh geometry as static scenery. Choose **Dynamic** for a movable prop. Procedural modules can supply lightweight colliders and jointed assemblies such as the lamps in Canopy Studio. See [bodies and joints](skills/image-to-world/references/modules.md#bodies-and-joints).

**Open in web** opens the current scene in a full-window player. **Export** in the viewport saves a ZIP with an HTML entry point, the Three.js player, scene data and its runtime assets. Unzip it into a directory on a static web host and open that directory's `index.html`. For a local preview, run `python3 -m http.server` inside the extracted directory.

Embed the scene in another site with an iframe, or import the player for direct control of its lifecycle. The archive includes a working page.

```html
<iframe src="./studio/index.html" title="Canopy Studio" allowfullscreen
  style="width:100%;height:70vh;border:0"></iframe>
```

For a custom interaction, mount into a sized element and use the returned Three.js scene and camera from your own code.

```js
import { mountScene, THREE } from "./studio/scene-player.js";

const player = await mountScene(document.querySelector("#studio"), "./studio/scene.json");
player.scene.add(new THREE.HemisphereLight(0xfff0cf, 0x46404a, 0.3));
await player.play();
// Call player.stop() to reset physics, or await player.dispose() on unmount.
```

Declare module resources through `assetUrl(id)` so they travel in the ZIP. Any external service your custom JavaScript calls still needs to be reachable from the published site.

## Editor layout and shortcuts

Turn on **Auto** beside Focus in the viewport to follow new agent scene edits. The camera eases toward the changed objects in your browser and yields to manual navigation, camera review, and Play. Hover a colored cursor to see its actor’s latest activity. The footer activity monitor lists recently active actors, including those working on global settings, and can hide cursors. The CLI recognizes Codex thread identity automatically. A worker can use its existing `--actor` or `IMAGE_TO_WORLD_ACTOR` name.

The editor opens with Spatial context visible along the bottom. Use the footer buttons to toggle the strip or open the outline, where image Frames start expanded. The centered header row offers Import, the Frame count, Play and Open in web. Select a projected slug to select its Frame, or click its spatial-context thumbnail to view it and describe an image edit. The spinner shows active work on hover. Open the image editor from the footer for layers and history. Spatial context and Atlas generation
controls share the resizable horizontal dock above the footer. Outline, project assets, and
properties open in their respective side panels; generation history opens from the viewport and agent
activity opens from the bottom right. Image versions and edit history open
from the image editor's floating controls. Its centered edit prompt bar is capped
at 480px and shrinks with the panel. Drag dividers to resize panes, or focus a
divider and use arrows, Home, or End. Workspace settings includes Reset layout.
Sizes, collapsed branches, asset view, and selection persist.

Shortcuts follow the pane under the pointer without requiring a click. Keyboard
focus is the fallback. Text fields, sliders, menus, and active gestures keep their
keys even when the pointer crosses another pane.

| Input                         | Outline, project assets, and image history                     |
| ----------------------------- | -------------------------------------------------------------- |
| Up / Down, Home / End         | Select a visible item and scroll it into view                  |
| Shift-click / Shift-arrow     | Extend or shrink the range from its anchor                     |
| Cmd/Ctrl-click                | Toggle an item                                                 |
| Cmd/Ctrl+A                    | Select all visible items in that pane                          |
| Left / Right                  | Navigate tree branches, or adjacent asset-grid cells           |
| Enter / F2                    | Open / rename the primary item where supported                 |
| Cmd/Ctrl+Z / Shift+Cmd/Ctrl+Z | Undo / redo local edits; history uses its active image's draft |

Drag selected outline rows before, inside, or after another row. Selected children
move with their parent once, and world transforms remain unchanged. Drop on the
outline background to move to the scene root. Alt+Left moves up a parent. Delete
removes scene instances; original asset files remain. Cmd/Ctrl+D duplicates scene
instances. A drag, grouping action, or mixed property edit creates one undo entry.
Undo history survives reload and refuses to overwrite conflicting external edits.

Assets and the outline share search controls and compact, alternating gray list rows.
Search matches names and types; asset search also matches paths. Outline search
retains ancestors without changing saved expansion. Backspace/Delete and row trash
icons act on visible selected rows. Finder icons reveal the backing file, including
files shared by capture children.

Asset deletion moves files into project-local `assets/.trash/`, retaining IDs and
history. The library's Trash toggle exposes Restore; this is separate from scene
undo and macOS Trash. Files used by scene nodes, geometry, image layers, or active
jobs must be released first. Restore refuses to overwrite a replacement file.

```sh
bun run image-to-world assets --search "room image"
bun run image-to-world assets trash <asset-id> <another-id>
bun run image-to-world assets --trash
bun run image-to-world assets restore <asset-id>
bun run image-to-world assets reveal <asset-id>
```

Viewport buttons control RGB visibility, opacity/distance, point style/size,
frustums, and grid independently. Transform fields accept arrow steps (Shift for
coarse, Alt for fine), label scrubbing, Enter to commit, and Escape to cancel.

```sh
bun run image-to-world scene move <node-id> --parent <parent-id> --before <sibling-id>
bun run image-to-world scene duplicate <node-id>
bun run image-to-world undo
bun run image-to-world redo
bun run image-to-world image undo <asset-id>
```

`selection.set` accepts `primaryId` and `anchorId`. Use `edit.batch` to combine
local node and asset edits into one atomic undo entry. `workspace.update` exposes
`layout`, `collections`, and `display` settings; read `schema commands` before
sending a JSON command. Provider jobs and binary file replacement are outside
local edit undo.

## Edit images

Open the Image tab below the 3D viewport, or double-click a library image. Select an image in Assets, an image
node in Scene, or any entry in History. Draw guidance, combine image layers, add
reference images, and submit an edit with Nano Banana 2 or Pro.

Every generation creates a new asset. History retains the source relationship,
reference images, prompt, model, settings, and input draft. Select an ancestor to
make a new branch. **Reuse** restores a generation's inputs; **Compare** shows the
parent image. Pending and failed jobs appear beside their source in history.

Annotations are visual instructions to Nano Banana, not a hard pixel mask. Erase
removes annotation strokes without erasing the source image. Composite layers
have normalized placement, visibility, and opacity. Drafts are saved independently
of immutable generated image files. The first completed output immediately updates
linked captures, including point colors. RGB and geometry have separate asset
references: the previous geometry remains visible while a child reconstruction
job estimates replacement depth. Capture transforms and clip settings remain intact.
Disable **Reconstruct geometry after edit** for color-only edits.

**Make active** chooses the version used by linked captures and video keyframes.
Browsing history only changes the editor source. Active versions persist even when
a frame has no scene instance. Explicit per-capture activation is available through
the CLI. The newest submitted job may replace a version chosen while it runs.
Older jobs save their outputs to history without applying them to the scene,
even if the newest job fails or is cancelled. Automatic depth reconstruction
belongs to the original edit and cannot supersede a newer request. Activation
and geometry replacement participate in scene undo. If destination components
were deleted or replaced, outputs are saved and the job reports an application
error without recreating or redirecting scene nodes.

The same workflow is available from the CLI. Replace the example asset IDs with
IDs returned by `import`, `assets`, or `image history`:

```sh
bun run image-to-world import /absolute/path/to/photo.png
bun run image-to-world image open <asset-id>
bun run image-to-world image edit <asset-id> --prompt 'Change the light to blue hour' --model 2
bun run image-to-world jobs wait <job-id>
bun run image-to-world image history <asset-id>
bun run image-to-world image activate <output-asset-id>
bun run image-to-world image edit <output-asset-id> --prompt 'Add climbing plants' --reference <reference-id>
```

`jobs wait` waits for the image job; read its `childJobId` and wait for that job
when you also need replacement geometry. `image edit --no-reconstruct` skips it.

`image edit` snapshots the saved draft unless `--draft file.json` is supplied.
`image draft <id> --file file.json` replaces its saved annotations and layers.
Use `schema draft` to discover the exact shape. Brush coordinates are normalized
to the source image; size is a fraction of its width. Layers render over the source
in array order, then annotation strokes render on a separate transparent surface.
The CLI composites the same draft on the server before uploading PNG bytes to FAL.

## Build scenes and generate views

Import images, linear EXR depth, logarithmic depth PNGs, SPZ/PLY splats, or video.
**Pose images** gives each Frame a camera and depth points. Its depth guide is visible for layout. Use **Input** while viewing its camera to compare the original. **Frame guides** in Spatial context hides the depth guides together when modeling begins. To model directly from a reference
without depth estimation, use `scene place <image-id> --reference-only`.
This local operation places the Frame at your chosen camera and makes no provider request. Select
posed image nodes as Atlas context and generate a view from the current camera.
The inspector can also attach a depth asset and camera metadata to an image.

All scene objects share parent, transform, visibility, and selection behavior.
Hover over the viewport to fly with WASD or arrow keys; Q/E moves down/up.
Right-drag or two-finger swipes look around; Shift moves faster and pinch changes FOV. Left-click
selects; Shift/Cmd/Ctrl-click toggles items. The combined gizmo exposes move/rotate/scale together; F frames the selection.
Choose Center (combined bounds) or Origin (average selected origins), and World
or Object axes (the primary selected object). Frames and cameras cannot be scaled.
Per-node `transformPermissions` can further restrict operations through the shared
capability contract. Cmd/Ctrl-D duplicates selected hierarchies; Backspace
or Delete removes them. Cmd/Ctrl-Z undoes and Cmd/Ctrl-Shift-Z redoes.
Camera gestures, display changes, and each gizmo drag are single undo entries.
Undo/redo restores the selection for scene edits and survives restart.
World transforms that require shear under nonuniform ancestors are rejected.
The palette and density tokens live in `web/src/theme.css`; all panels share
`PanelHeader`, and `Hint` provides immediate hover help. Grouping reparents selected objects. Clip
boxes use Spark's built-in splat editing: local clips apply beneath their parent;
clips can be parented anywhere, and local clips at the scene root affect nothing.
Global clips affect all editable splats. Posed clouds use the same Spark
pipeline. Point-cloud display samples up to roughly 250,000 points per image and
uses a fixed 0.5 confidence threshold when confidence is available.
Clips affect viewport rendering, captures, and masks prepared for Atlas. Original
RGBD and mask files remain unchanged.
Posed-image components may be rearranged or deleted. Atlas requests validate the
remaining camera, image, and points at submission and report missing, ambiguous,
or misaligned components. Depth comes from the active points child.

```sh
bun run image-to-world pose <image-asset-id>
bun run image-to-world jobs wait <job-id>
bun run image-to-world scene
bun run image-to-world atlas <posed-node-id> --camera camera.json --prompt 'Warm afternoon light'
bun run image-to-world capture --camera camera.json --wait
```

`schema camera` describes pixel intrinsics and camera-to-world pose. Quaternions
are XYZW. The `rub` convention is Three.js (right, up, backward); `rdf` inputs are
converted. Context image transforms affect API camera poses, and uniform scaling
also scales the uploaded depth. Nonuniform scale/shear is rejected for Atlas
context because one pinhole camera cannot describe that deformation.

Captures wait for scene assets and Spark updates, omit editing helpers, and save
a PNG plus its camera metadata. They require an open browser viewport. Other CLI
commands and provider jobs run without a browser.

## Place captures and build Atlas context

Dropping or pasting multiple images asks whether to **Reconstruct together** or
**Pose individually** before generation starts. Reconstruction solves their shared
camera geometry in one request; individual posing treats each image independently.
Library imports only save files; drag them into the viewport or outline to place them. Cancel
keeps imported files in the library and starts no jobs. Single-image viewport
placement continues immediately. Copy selected library images with Cmd/Ctrl+C and
paste with Cmd/Ctrl+V; text inputs retain normal clipboard behavior.

The CLI chooses explicitly without an interactive prompt:

```sh
bun run image-to-world scene place <image-a> <image-b> --reconstruct
bun run image-to-world scene place <image-a> <image-b>
```

Drop image files or library assets into the viewport to place them at its current
yaw and floor position. Unposed images queue `images2PosedRGBD`; existing posed
assets can be instanced immediately. Each capture is a movable parent with camera,
image and point-cloud children. Clip boxes are added explicitly; posing never creates them. Estimated camera height and orientation
remain on the children. Moving the parent during generation preserves that edit.

```sh
bun run image-to-world scene place <asset-id> --camera camera.json
bun run image-to-world context list
bun run image-to-world camera view <capture-id>
bun run image-to-world camera free
bun run image-to-world context solo <capture-id>
bun run image-to-world context solo
bun run image-to-world atlas <capture-id> --camera target-camera.json
bun run image-to-world splats --wait --timeout 1800
```

`splats` (or **Make splats** below Render in the Spatial context column) sends the
same posed captures as Atlas context to `posedImages2Splats` and adds the returned
SPZ at the scene root. The editor defaults to refined reconstruction; enable
**Draft** in its settings for a faster draft. Make splats and its retry controls
require an explicit confirmation after a five-second countdown. X or Escape
cancels before submission. The panel lists every splat job and provides visibility,
delete, download, and re-add controls for its results. The CLI defaults to drafts.
Drafts take 2 to 32 captures and cost 500 credits; `--refine` takes up to 512,
costs 5,000 credits, and usually runs 15 to 25 minutes.

The Spatial context column supports range selection, arrows that move to a
reference camera, hide/show, exclusion, and solo. Imports appear first, then
generated Frames, each in scene hierarchy order. Right-click a generated Frame
and choose **Freeze** to group it with imports; this does not lock editing. Double-click a camera in the
viewport, outline, or grid to view its perspective. Press C over the viewport to place cameras and accumulate their selection.
Use `path create` to create a path from those cameras. Selecting a
path shows its context in Atlas;
`context ... --path <path-id>` controls that same state from the CLI.

Two-finger swipes look around like right-mouse dragging. Pinching changes FOV.
WASD/QE remain the translation controls. Camera viewing, gestures, context changes,
and scene edits participate in undo/redo. Path playback is a local preview and
does not write one undo entry per frame.

Atlas uploads calibrated RGB/depth/masks on its required 1280x720 grid. Local clip
boxes move with their parents; global boxes affect the scene. Masks match those
clip volumes and preserve source files. Generated views request depth so they can
become context for another generation. They automatically enter the scene and open
in the Atlas output viewer. Outputs without depth retain their camera and image,
but require reconstruction before becoming Atlas context. Depth registration requires translation
between cameras; pure rotations are rejected before submission. The public API
does not expose the legacy known-camera single-image registration operation.

## Keyframes, video, and reconstruction

1. Place cameras with C, then choose **Create path** in the viewport action palette.
   Edit FOV, target frames, and keyframe order in Properties. **Keyframe** appends the current
   view; **Replace** updates an existing pose. Preview, scrub, and generate from the
   viewport palette. Atlas owns context, prompt, FPS, and generated-keyframe count.
2. Generate sparse keyframes, inspect them in Generations, and open any frame in
   the image editor. **Make active** selects an edited version for later generation.
3. Use **Generate dense video** on the completed keyframe job. It conditions on
   the active keyframe versions and keeps their pixels in the output sequence.
4. Select frames in Generations and choose **Integrate** to add their RGBD to the
   scene, or **Reconstruct** to estimate replacement geometry. Repeated integration
   does not create duplicate captures.

```sh
bun run image-to-world scene add path --name 'Courtyard move'
bun run image-to-world path keyframe <path-id> --file start-camera.json
bun run image-to-world path keyframe <path-id> --file end-camera.json
bun run image-to-world video --path <path-id> --target-frames 36 --fps 12 --keyframes 4
bun run image-to-world video frames <keyframe-job-id>
bun run image-to-world video --source-job <keyframe-job-id>
bun run image-to-world video integrate <dense-job-id> --indices 0,4,8
bun run image-to-world video reconstruct <dense-job-id>
```

Frame indices refer to positions in the full sampled sequence, including sparse keyframe
jobs. `video frames` lists the valid indices; `video view <job-id> <index>` uses
that frame's camera. Paths interpolate position, quaternion rotation, and focal
length. Camera keyframes are ordered poses with no timestamps and must share one
pixel resolution. Target frames sets the exact sample count; FPS sets playback
length (`target frames / FPS`). Adding, removing, or reordering poses preserves
the target count. The per-keyframe order control is one-based; CLI `--index` is
zero-based. `path keyframe` appends; `--id` replaces; `--id` with `--index` reorders.

image-to-world uses project schema version 7. During this buildout, schema changes are
breaking and there are no migrations or compatibility readers. Create a fresh
project after a schema change; existing project files are left untouched.
Camera nodes store their pose in `transform` and lens intrinsics in `projection`.

The job freezes its cameras and context; editing the path later cannot change a
running or resumed generation. Dense generation is a new Atlas request conditioned
on saved keyframes, rather than the legacy backend's continuation operation.
Atlas allows at most 128 combined context and target views per request. Larger
requests are rejected before submission; automatic sequence chunking is not implemented.

Select an imported video in the asset library and choose **Reconstruct** to sample
frames at up to 1 FPS, capped at 60 across the duration. The CLI exposes sampling
controls and can reconstruct images directly:

```sh
bun run image-to-world reconstruct --video <video-asset-id> --fps 2 --max-frames 60
bun run image-to-world reconstruct <image-asset-id> <image-asset-id>
bun run image-to-world jobs wait <job-id>
```

Reconstruction uses public `images2PosedRGBD`. Uploaded video frames are solved
jointly. Frames with saved cameras keep their extrinsics; scale comes from their
baseline, or median source-depth ratios for a single edited view. Intrinsics are
estimated again. This alignment is not a constrained known-intrinsics solve and
needs visual inspection after substantial scene changes. Without a valid scale
anchor the job fails and preserves existing geometry. Frame assets retain video
provenance, timestamps, and image history. FFmpeg produces a playable MP4 while
individual generated frames remain available.

## Files and jobs

```text
<workspace>/
  workspace.json       Versioned scene, selection, panels, drafts, jobs, provenance
  workspace.json.bak   Previous valid snapshot
  assets/              Binary originals, depth, generated frames, captures, video
```

The server serializes mutations, writes snapshots by atomic rename, and holds a
workspace process lock. Nested additions, replacements, and removals in `assets/`
appear in the UI through server-sent events. Missing files keep their metadata and
are marked missing. Symlinks escaping the asset directory are not served. Valid
external edits to `workspace.json` are reloaded; invalid JSON blocks writes until
fixed rather than being silently replaced.

Up to three provider jobs run concurrently. Jobs preserve remote operation IDs
and resume polling after restart. `jobs retry` resumes the same remote request,
which is useful after download or connection failures. A terminal provider error
may need a fresh generation with **Reuse** or another submit command. Cancellation
stops local work; World Labs may still finish and bill a submitted task. image-to-world also
requests FAL cancellation when a request ID is known. If FAL submission was
interrupted before its ID was saved, check FAL history before explicitly submitting
again; retry will not blindly create another paid request.

Use `fal <endpoint> --file input.json` for additional FAL models. A JSON object
`{"$asset":"<asset-id>"}` anywhere in the input is uploaded and replaced by a FAL
storage URL. Outputs and the provider's JSON result are saved to the asset library.
Nano Banana uses its dedicated command to retain image lineage and edit settings.

## Extend and verify

`core/schema.ts` defines validated commands and file formats. `core/commands.ts`
handles scene edits. `core/images.ts` indexes image families and their capture
instances. `core/generation.ts` resolves generation intent and shared defaults;
`web/src/server/commands.ts` dispatches generation, integration, and local edits.
Browser controls and `cli/index.ts` both use `/api/commands`;
`command @file.json` exposes every command, including panel and editor settings.
Run `schema commands` or `schema workspace` for machine-readable discovery.

Panels are React components composed in `web/src/components/Editor.tsx`.
Each editor has a Zustand browser store with selective panel subscriptions.
Server snapshots preserve unchanged object references; scene helpers declare the
project fields they read. Commands and filesystem persistence remain server-owned.
Camera animation and GPU resources stay in the renderer.
Shared collection navigation handles outline, asset, and history selection. Provider work belongs in
`web/src/server`, outside the browser bundle. The agent skill is
[`skills/image-to-world/SKILL.md`](skills/image-to-world/SKILL.md).

```sh
bun run check
bun run build
bun run test
bun scripts/smoke-launch.ts
```

CI runs these checks on Linux and macOS with Bun 1.3.10, the frozen lockfile,
and a pinned Chromium test browser. Provider calls are mocked in the test suite;
the launch smoke check creates and removes a disposable project with keys disabled.

The tests cover persistence, scene constraints, image compositing, mocked provider
requests and restart recovery, plus real FFmpeg encoding and video extraction. They do not require API
keys and do not incur provider charges. Native canvas binaries are installed
through Bun's platform-specific optional dependencies.

## Contributing

Fork the repository, make changes on a branch, and run `bun run check`,
`bun run test`, and `bun run build` before opening a pull request.

Licensed under [Apache-2.0](LICENSE).

### Create an image at the current view

Open **Generation tools** in the viewport, enter an image prompt, and press Enter. A Frame and placeholder
camera appear immediately at the current horizontal position and yaw. FLUX Schnell
creates the image through FAL, then the ordinary World Labs image-posing workflow
fills that same Frame with the calibrated image and points. Solved height
provides grounding; subsequent viewport navigation does not change the placement.
The stages appear in Jobs, where failed stages can be retried. Deleting or undoing
the Frame prevents late results from recreating it. Requires `FAL_KEY` and
`WLT_API_KEY`, editable in Workspace settings → Environment variables.

The CLI uses the same workflow:

```sh
bun run image-to-world image create --prompt 'An abandoned Soviet laboratory' --model schnell
# Optionally supply the placement camera:
bun run image-to-world image create --prompt 'A tiled laboratory' --camera camera.json
```

`core/models.ts` owns image model IDs, labels, aliases, and shared options for the
UI, CLI, and schema. The new-image workflow uses FLUX Schnell; image editing uses
the Nano Banana models.

Atlas saves the enhanced caption returned by a render and reuses it for later
renders, path generation, and splats with the same scene description. A lightning
icon beside **Prompt** indicates a cached caption. Its popover shows
only the cache status and a **Clear** action. Editing the description invalidates
the cache; clear it when changing the scene's content while keeping the description.

### Viewport camera and compact controls

The floating bottom-left viewport controls own the free camera's field of view,
lens and clipping settings, plus a toggleable passepartout matching the project
aspect ratio. Viewing through a Frame or camera temporarily overrides the lens
and names the source node. WASD, right-drag, scrolling, or pinching exits viewing
mode and continues from the visible camera pose and lens. Escape (or the restore
button) restores the saved free camera while viewing mode is still active.
Render uses the camera inside the project viewfinder.

Image and viewport tools share compact floating groups. The edit prompt floats
inside the image canvas, and the neutral palette icon opens the brush color
picker. Text actions show an orange outline and icon when ready to submit.
The footer spans the window and shows selection and live command/job activity.
At widths of 1600px or more, the resizable agent guide opens alongside the editor.

### Agent camera planning, inspection, and previews

These are regular CLI commands backed by shared camera math, the command service,
and the existing viewport spatial contracts. No provider calls are required.
The user or agent chooses the viewpoints and visually evaluates the scene.
`camera solve` calculates orientation from a supplied position and target;
`camera place` records the chosen camera as an undoable edit. Neither selects
viewpoints, optimizes coverage, or generates images. Inspection reports structural
validity rather than visual quality, and previews provide images for review.
These helpers can be combined in any order appropriate to the scene.

```sh
# Discover the interface without guessing fields.
bun run image-to-world --help
bun run image-to-world schema aim
bun run image-to-world schema jobs
bun run image-to-world schema inspection

# Resolve a camera without editing the scene. Coordinates can be world-space
# or local to any scene node, including a transformed Frame or group.
bun run image-to-world camera solve --position 2,1.6,3 --look-at 0,1,-4 --fov 65 --out camera.json
bun run image-to-world camera place --position 2,1.6,3 --look-at 0,1,-4 --relative-to <node-id> --name 'Window aisle'

# Full scene report with bounds from the open viewport's NodeSpatial providers.
bun run image-to-world scene inspect --out inspection.json
# Structural information works with no browser. Missing bounds are explicit.
bun run image-to-world scene inspect --headless

# One contact sheet for all Frames, a selection, or completed generation rounds.
bun run image-to-world scene preview --out room.png
bun run image-to-world scene preview <frame-id> <frame-id> --columns 2 --out selected.png
bun run image-to-world scene preview --jobs <job-id>,<job-id> --out round.png
```

`camera solve` emits the standard camera JSON accepted by `atlas --camera`,
`capture --camera`, `image create --camera`, and placement. `--relative-to` resolves
position, look-at target, and `--up` in that node's current coordinate frame; it
creates a world-space camera, without parenting it. `--fov` is vertical degrees.
`camera place` with aim flags uses the undoable `camera.aim` command. Standard
`camera place` and viewport C continue to record the live view.

`scene inspect` returns node IDs/names/kinds, parent IDs, effective visibility,
world matrices, camera calibration/poses, transform capabilities, world bounds,
and usable/broken Atlas inputs. Bounds match framing, including hidden content
and empty-node framing boxes; they do not represent clipped geometry or certify
scene coverage. Full inspection queues an `inspect` job serviced by an open
viewport and waits up to 30 seconds by default. Headless inspection is a read-only
`GET /api/scene/inspect`; it explicitly returns null bounds. The report carries the
revision observed by the renderer, rather than claiming a submission-time snapshot.

`scene preview` queues a local `contactSheet` job, snapshots the selected image
bindings and labels, and writes a labeled PNG plus a JSON source manifest into
project assets. It works headlessly and does not move cameras or create scene nodes.
Images are letterboxed without cropping. `--out` also exports a local copy and
refuses to overwrite an existing file. Preview/inspection results are normal
assets, available through the usual export command. `schema commands` includes
`camera.aim` and `jobs.submit`; `schema jobs` describes both new local job kinds.
The bundled [ImageToWorld agent skill](skills/image-to-world/SKILL.md) teaches the same paths.

## Build a movable reference set

Use [SVG & 3D Design](https://chatgpt.com/plugins/Plugin_13c5903473e081919917a1070fad1dd1?open_in_app) for asset construction and composition and the [image-to-world companion](skills/image-to-world/SKILL.md) for editor commands. Ask the agent to build from an image in this editor. The Frame owns the camera and its set. Select the Frame in the Outline and use the viewport gizmo to move or rotate it while workers add objects underneath it. Review through the source camera, tune that shot’s lighting, and fly out to check the arrangement. Start by grounding the posed inputs. Choose who arranges disconnected views, leaving their observed volumes clear of each other. Outpaint the gaps with sparse Atlas cameras before modeling. Generated depth guides display at half opacity until frozen. Turn Frame guides off and use the connected views to build the environment and its assets.

The [Moonlit Workshop example](examples/moonlit-workshop/README.md) rebuilds an
illustrated attic from six local modules, including the rumpled quilt, wooden
joinery and a light that projects a shoji window pattern.

## Image decomposition and parallel agents

Posed views can become independently editable mesh objects. The CLI provides
`observe`, `mask`, `model`, `fit`, and `render`, plus unrestricted public FAL model
inputs through `generate`. `models` discovers endpoints and their schemas. Existing
image edits support asset-only outputs, explicit target captures, and unchanged
pixel masks; scene replacements wait for reconstructed depth. See the
[agent workflow](skills/image-to-world/SKILL.md) for the commands and review steps.

Mesh imports support self-contained GLB 2.0 with embedded textures. They share the
editor's transforms, parenting, picking, bounds, properties and undo. Independent
rendering uses an installed Chrome/Chromium (`CHROMIUM_PATH` to override). It renders
the shared scene in a separate worker, so several agents never fight over the
human viewport. Color works with points, splats and meshes; mask, ID and linear
EXR depth passes currently require mesh-only targets.

When a point cloud or splat is visible, Spark sorts and draws its Gaussians in a
WebGL2 layer. Opaque geometry supplies its depth buffer. Transparent meshes
draw after that layer, so glass crossing a cloud can show a sorting seam.

Commands accept optional actor identities, idempotency keys and field preconditions.
Jobs retain immutable input bytes. The footer Activity drawer records automatic
command/job history with Summary, Actions and Trace detail, actor/severity filters,
search and linked resources. Colored resource badges and optional fading viewport
markers indicate recent work. These overlays are local editor state, excluded from
picking, scene bounds, exports and generated views; agents do not manage them.

Older project schemas are rejected explicitly;
there is no automatic migration or rewriting of existing projects. Open a fresh
project to try this workflow.

## Procedural code nodes

Author parametric geometry and original materials in the existing viewport from a local TypeScript or JavaScript module. Both the editor and independent camera renders use the Three.js node renderer. It selects WebGPU on a supported device and WebGL2 on other supported browsers. Import node materials from `three/webgpu` and compose their shading with [Three.js Shading Language](https://threejs.org/tsl/).

```sh
bun run image-to-world module add examples/procedural-orbit.ts --name "Orbit sculpture"
bun run image-to-world module update <node-id> examples/procedural-orbit.ts
bun run image-to-world module params <node-id> --file parameters.json
bun run image-to-world module inspect <node-id>
```

Modules default-export `defineSceneModule({ create(context) { ... } })`, imported from
`image-to-world/runtime`. The context supplies the editor's `THREE`, `webgpu`, `tsl` and `spark`,
JSON `params`, seeded `random()`, an abort `signal`, and `assetUrl(id)` for dependencies
listed with `--assets id,id`. Three.js imports and addons share the editor's engine.
Local module imports are bundled. Each build retains source files, their relative paths,
and the compiled bundle in project assets. Code is trusted executable project content;
it runs in the browser, not in a security sandbox. Only load code you trust.

Use `context.gpu.compute(kernel)` to dispatch TSL compute work on the same renderer
as the node's material. A module can generate its geometry, shade its own imported
GLB, or fill GPU attributes for an animated mesh. The [module contract and shader example](skills/image-to-world/references/modules.md)
cover parameter editing, deterministic sampling, bounds and cleanup.

Return `{ object, sample?, bounds?, dispose? }`. `object` is a Three.js Object3D subtree
owned by this node. The editor handles selection, transforms, parenting, visibility,
bounds and resource disposal. `bounds()` optionally returns a Box3 in the returned
object's local coordinates (useful for custom shader geometry). `sample({time,camera})`
updates the subtree from absolute seconds; the existing independent renderer samples
at time zero. `dispose()` releases your listeners and other resources; creation must
honor the abort signal and clean up partially constructed resources if it throws.
Keep scene-level placement in the node transform. Do not mutate the editor scene or
create another renderer. Meshes, lights, particles, custom materials and splats can all
live within the returned subtree. For splats, use uniform scale throughout the ancestry.

Parameters, seed and enabled state are editable in Properties. Updates and parameter
changes use ordinary undoable commands. Compiling invalid code leaves the old node
unchanged; runtime errors appear in scene inspection and can be undone. Concurrent
updates to the same module conflict instead of overwriting another agent's code.
Nodes are ordinary hierarchy entries: duplicate, reparent, transform or remove them
using the existing UI or CLI. No additional viewer is involved.
