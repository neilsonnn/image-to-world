# worldbash

worldbash is a local spatial studio for editing images, reconstructing RGBD scenes,
and generating new views and camera-path videos. The browser and CLI share a
filesystem workspace. Generation runs in the background while you keep editing.

## Run

Use Bun 1.3.10 or newer. Install FFmpeg and ffprobe for video encoding and reconstruction. World Labs
posing and Atlas require a Developer API key with access to those tasks; Nano
Banana uses a FAL key. Importing, arranging, annotating, and capturing scenes work
without either key.

1. Install the locked dependencies:

   ```sh
   bun install --frozen-lockfile
   ```

2. Copy `.env.example` to `.env` and set `WLT_API_KEY` and `FAL_KEY` for generation.
   To share credentials across checkouts, put the same variables in
   `~/.config/worldbash/env` (or `$XDG_CONFIG_HOME/worldbash/env`) with file permissions
   `600`. Shell variables override checkout `.env`, which overrides user config.
   `WLT_API_BASE_URL` overrides the World Labs API origin. Keys stay on the server.

3. Open a project:

   ```sh
   bun run worldbash open ~/Projects/my-scene
   ```

   The launcher builds on first use or after source changes, starts the local
   server, and opens your browser. Keep the terminal open; Ctrl+C stops the server.
   Without a project argument, it uses `WORLDBASH_WORKSPACE` or this checkout's `.worldbash/`.
   The launcher defaults to port 4310 and ignores the generic `PORT` variable.
   A matching server on the requested port is reused. For another project, use
   `--port 4311`; pass `--url http://127.0.0.1:4311` to subsequent CLI commands.
   Use `--no-browser` for agent or terminal-only sessions.

4. Check setup and CLI access:

   ```sh
   bun run worldbash doctor ~/Projects/my-scene
   bun run worldbash status
   ```

`doctor` reports configuration without contacting providers or printing secrets.
Missing API keys or video tools disable the corresponding features, not local
editing. Install FFmpeg through your system package manager; its distribution
normally includes ffprobe. `FFMPEG_PATH` and `FFPROBE_PATH` override detection.

Use `bun run dev` when editing the app itself. The launcher loads user config;
the development server uses the checkout `.env` and shell environment.
The server binds to loopback and serves one local workspace. Project files live
in the chosen directory, independently of the installation. Generation requires
internet access; local editing does not.

Update to a tested release explicitly, run `bun install --frozen-lockfile`, stop
the old server, and launch again. Startup never updates code or dependencies.
Back up project directories before changing versions; rolling back the app does
not roll back project data, and older versions may reject newer project formats.

## Editor layout and shortcuts

The outline and project assets stay on the left, properties on the right, and
Atlas and Image tabs below the viewport. Image history occupies the image editor's
right column. Atlas context stays directly accessible; additional generation tools
and Jobs open from the top toolbar. Drag the dividers to
resize panes, or focus a divider and use arrows, Home, or End. Workspace settings
includes Reset layout. Sizes, collapsed branches, asset view, and selection persist. Narrow embedded
windows keep both side panes visible and scroll the lower editor horizontally.

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
bun run worldbash assets --search "room image"
bun run worldbash assets trash <asset-id> <another-id>
bun run worldbash assets --trash
bun run worldbash assets restore <asset-id>
bun run worldbash assets reveal <asset-id>
```

Viewport buttons control RGB visibility, opacity/distance, point style/size,
frustums, and grid independently. Transform fields accept arrow steps (Shift for
coarse, Alt for fine), label scrubbing, Enter to commit, and Escape to cancel.

```sh
bun run worldbash scene move <node-id> --parent <parent-id> --before <sibling-id>
bun run worldbash scene duplicate <node-id>
bun run worldbash undo
bun run worldbash redo
bun run worldbash image undo <asset-id>
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
bun run worldbash import /absolute/path/to/photo.png
bun run worldbash image open <asset-id>
bun run worldbash image edit <asset-id> --prompt 'Change the light to blue hour' --model 2
bun run worldbash jobs wait <job-id>
bun run worldbash image history <asset-id>
bun run worldbash image activate <output-asset-id>
bun run worldbash image edit <output-asset-id> --prompt 'Add climbing plants' --reference <reference-id>
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
Imported images become posed point clouds after **Pose images** completes. Select
posed image nodes as Atlas context and generate a view from the current camera.
The inspector can also attach a depth asset and camera metadata to an image.

All scene objects share parent, transform, visibility, and selection behavior.
Hover over the viewport to fly with WASD or arrow keys; Q/E moves down/up.
Right-drag or two-finger swipes look around; Shift moves faster and pinch changes FOV. Left-click
selects; Shift/Cmd/Ctrl-click toggles items. Use 1/2/3 for move/rotate/scale and
F to frame the selection. Cmd/Ctrl-D duplicates selected hierarchies; Backspace
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
bun run worldbash pose <image-asset-id>
bun run worldbash jobs wait <job-id>
bun run worldbash scene
bun run worldbash atlas <posed-node-id> --camera camera.json --prompt 'Warm afternoon light'
bun run worldbash capture --camera camera.json --wait
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
bun run worldbash scene place <image-a> <image-b> --reconstruct
bun run worldbash scene place <image-a> <image-b>
```

Drop image files or library assets into the viewport to place them at its current
yaw and floor position. Unposed images queue `images2PosedRGBD`; existing posed
assets can be instanced immediately. Each capture is a movable parent with camera,
image, point-cloud, and clip children. Estimated camera height and orientation
remain on the children. Moving the parent during generation preserves that edit.

```sh
bun run worldbash scene place <asset-id> --camera camera.json
bun run worldbash context list
bun run worldbash camera view <capture-id>
bun run worldbash camera free
bun run worldbash context solo <capture-id>
bun run worldbash context solo
bun run worldbash atlas <capture-id> --camera target-camera.json
bun run worldbash splats --wait --timeout 1800
```

`splats` (or **Make splats** in the viewport) sends the same posed captures as
Atlas context to `posedImages2Splats` and adds the returned SPZ at the scene root.
Drafts take 2 to 32 captures and cost 500 credits; `--refine` takes up to 512,
costs 5,000 credits, and usually runs 15 to 25 minutes.

The Atlas grid supports range selection, arrows that move to a reference camera,
thumbnail ordering, hide/show, exclusion, and solo. Double-click a camera in the
viewport, outline, or grid to view its perspective. Press C over the viewport to place cameras and accumulate their selection.
The bottom viewport action palette creates a path from those cameras. Selecting a
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
bun run worldbash scene add path --name 'Courtyard move'
bun run worldbash path keyframe <path-id> --file start-camera.json
bun run worldbash path keyframe <path-id> --file end-camera.json
bun run worldbash video --path <path-id> --target-frames 36 --fps 12 --keyframes 4
bun run worldbash video frames <keyframe-job-id>
bun run worldbash video --source-job <keyframe-job-id>
bun run worldbash video integrate <dense-job-id> --indices 0,4,8
bun run worldbash video reconstruct <dense-job-id>
```

Frame indices refer to positions in the full sampled sequence, including sparse keyframe
jobs. `video frames` lists the valid indices; `video view <job-id> <index>` uses
that frame's camera. Paths interpolate position, quaternion rotation, and focal
length. Camera keyframes are ordered poses with no timestamps and must share one
pixel resolution. Target frames sets the exact sample count; FPS sets playback
length (`target frames / FPS`). Adding, removing, or reordering poses preserves
the target count. The per-keyframe order control is one-based; CLI `--index` is
zero-based. `path keyframe` appends; `--id` replaces; `--id` with `--index` reorders.

worldbash uses project schema version 4. During this buildout, schema changes are
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
bun run worldbash reconstruct --video <video-asset-id> --fps 2 --max-frames 60
bun run worldbash reconstruct <image-asset-id> <image-asset-id>
bun run worldbash jobs wait <job-id>
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
stops local work; World Labs may still finish and bill a submitted task. worldbash also
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
[`skills/worldbash/SKILL.md`](skills/worldbash/SKILL.md).

```sh
bun run check
bun run test
bun run build
bun run start
```

The tests cover persistence, scene constraints, image compositing, mocked provider
requests and restart recovery, plus real FFmpeg encoding and video extraction. They do not require API
keys and do not incur provider charges. Native canvas binaries are installed
through Bun's platform-specific optional dependencies.

## Contributing

Fork the repository, make changes on a branch, and run `bun run check`,
`bun run test`, and `bun run build` before opening a pull request.

Licensed under [Apache-2.0](LICENSE).
