#!/usr/bin/env bun
import { compileModule } from "./modules";
import {
  primitiveSchema,
  surfaceSchema,
  lightSchema,
  proceduralSchema,
  artDirectionSchema,
  artPresets,
} from "../core/creation";
import { createHash } from "node:crypto";
import { cameraNodeData } from "../core/cameras";
import { commandContextSchema } from "../core/command-context";
import { generationSchema } from "../core/schema";
import { sceneCamera } from "../core/captures";
import { resolveImageModel, type ImageModelFor } from "../core/models";
import { watch as watchFiles } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import { aimCamera } from "../core/cameras";
import { currentCamera } from "../core/generation";
import { inspectionSchema } from "../core/inspection";
import { doctor, openProject } from "./launch";
import { collectionMatches } from "../core/collections";
import { frameAssets } from "../core/frames";
import {
  atlasContext,
  spatialContextFrames,
  contextSettings,
} from "../core/captures";
import path from "node:path";
import { parseArgs } from "node:util";
import { zodToJsonSchema } from "zod-to-json-schema";
import { moveNodes } from "../core/scene";
import { imageHistory } from "../core/history";
import {
  cameraSchema,
  cameraAimSchema,
  jobInputSchema,
  commandSchema,
  identity,
  imageDraftSchema,
  nanoSettingsSchema,
  nodeSchema,
  workspaceSchema,
  type Command,
  type Generation,
  type JobInput,
  type Workspace,
} from "../core/schema";

const HELP = `image-to-world controls the same filesystem workspace as the browser.

  bun run image-to-world open [project] [--port 4310] [--no-browser]  Build and launch locally
  bun run image-to-world doctor [project]                Check local setup without API requests
  bun run image-to-world schema commands|jobs|workspace|draft|camera|aim|inspection  JSON Schema for agents
  bun run image-to-world status                         Provider configuration and workspace path
  bun run image-to-world state                          Full workspace JSON
  bun run image-to-world import <file-or-url>... [--creator name] [--license license]  Import assets
  bun run image-to-world assets [--trash] [--search text] List assets
  bun run image-to-world assets trash|restore <asset-id>...
  bun run image-to-world assets reveal <asset-id>
  bun run image-to-world image open <asset-id>           Open an image in the bottom editor
  bun run image-to-world image activate <asset-id> [node-id...]  Use this version in scene captures
  bun run image-to-world image history <asset-id>        Branching assets, prompts, and jobs
  bun run image-to-world image create --prompt '...' [--model schnell] [--camera camera.json]
  bun run image-to-world image edit <asset-id> --prompt '...' [--reference id,id]
                   [--model 2|pro] [--resolution 1K|2K|4K] [--ratio auto|16:9]
                   [--count 1] [--seed 42] [--draft draft.json]
  bun run image-to-world image draft <asset-id> --file draft.json
  bun run image-to-world image undo|redo <asset-id>       Undo/redo this image's draft
  bun run image-to-world export <asset-id> <file>        Write binary output to a local file
  bun run image-to-world module add <source.ts> [--watch] [--assets id,id] [--file params.json]
  bun run image-to-world module update <node-id> <source.ts> [--watch]
  bun run image-to-world module params <node-id> --file params.json
  bun run image-to-world module inspect|bake <node-id> [--time 0] [--wait]
  bun run image-to-world art [studio|cinematic|pixel] [--file settings.json]
  bun run image-to-world export project --out <new-directory>  Portable web player, assets and source
  bun run image-to-world scene                          List scene objects
  bun run image-to-world scene inspect [node-id...] [--headless|--rendered] [--time 0] [--out report.json]
                   Inspect cameras, context, errors and renderer bounds (open viewport required)
  bun run image-to-world scene preview [node-id...] [--jobs id,id | --assets id,id]
                   [--columns 3] [--width 384] [--out preview.png]  Headless contact sheet
  bun run image-to-world scene add image --asset <id> [--name 'Image'] [--parent id]
  bun run image-to-world scene add camera|group|path|clip|primitive|light [--shape box] [--name '...'] [--parent id]
  bun run image-to-world scene put --file nodes.json    Create/update complete node records
  bun run image-to-world scene transform <id>... [--position x,y,z] [--scale x,y,z]
                   [--quaternion x,y,z,w] [--parent id|root]
  bun run image-to-world scene move <id>... --parent <id|root> [--before <sibling-id>]
  bun run image-to-world scene duplicate <id>...
  bun run image-to-world undo|redo                     Undo/redo scene, camera, display, or property edits
  bun run image-to-world scene remove <id>...           Remove objects and their descendants
  bun run image-to-world select <id>...                 Select any mixture of assets and nodes
  bun run image-to-world camera [--file camera.json]    Read/set viewport camera
  bun run image-to-world path update <path-id> [--fov 60] [--target-frames 36]
  bun run image-to-world path keyframe <path-id> [--index 0] [--file camera.json] [--id keyframe-id] [--remove]
  bun run image-to-world scene place <asset-id>... [--camera camera.json] [--reconstruct]  Place references locally; --mode individual or --reconstruct explicitly poses
  bun run image-to-world camera solve --position x,y,z --look-at x,y,z [--relative-to node-id]
                   [--up x,y,z] [--fov 60] [--out camera.json]  Calculate orientation from your position/target; no scene edit
  bun run image-to-world camera place [--position x,y,z --look-at x,y,z --relative-to node-id]
                   [--name 'Camera'] [--file camera.json]  Record your chosen camera, undoably; extend selection (viewport C)
  bun run image-to-world camera view <node-id> | camera free
  bun run image-to-world context [list|include|exclude|solo|show|hide|freeze|unfreeze] <capture-id>...
  bun run image-to-world path create <camera-id>... [--target-frames 36]
  bun run image-to-world pose <asset-id>... [--camera camera.json]
  bun run image-to-world atlas [--camera camera.json] [--path path-id] [--prompt '...']
  bun run image-to-world splats [capture-id...] [--path path-id] [--prompt '...'] [--refine]
                   Reconstruct splats from posed captures (draft unless --refine)
  bun run image-to-world video [--path path-id] [--fps 12] [--target-frames 36]
                   [--keyframes count] [--source-job job-id]
  bun run image-to-world video frames <job-id>
  bun run image-to-world video view <job-id> <frame-index>
  bun run image-to-world video integrate <job-id> [--indices 0,4,8]
  bun run image-to-world video reconstruct <job-id> [--indices 0,4,8]
  bun run image-to-world reconstruct <asset-id>... [--video video-asset-id]
                   [--fps 1] [--max-frames 60]
  bun run image-to-world render <camera-or-capture-id> [--camera file.json] [--targets id,id]
                   [--passes color,mask,depth,ids] [--reference image-id] [--presentation] [--time 0] [--bake] [--rgbd]
  bun run image-to-world mask <asset-id>... [--operation union|intersection] [--invert] [--dilate pixels] [--feather pixels]
  bun run image-to-world observe <capture-id> --region x,y,w,h [--mask asset-id] [--padding .1]
                   Save crop, masks, camera and scene-depth observation (normalized top-left coordinates)
  bun run image-to-world fit <mesh-node-id> --observation manifest-asset-id [--quaternion x,y,z,w]
                   Read-only placement proposal; use its command and preconditions after reviewing
  bun run image-to-world models [endpoint] [--search text]  Suggestions or live provider schema
  bun run image-to-world model <endpoint> --file input.json  General image/3D model call; {"$asset":"id"}
  bun run image-to-world generate --file request.json   All generation and local inspection workflows
  bun run image-to-world activity [--after sequence]    Automatic action history
  bun run image-to-world revert <edit-id>               Revert only an unchanged edit
  All mutations accept --actor name --request-id id --expect preconditions.json
  Image edits accept --asset-only or --targets capture-id,... --unchanged-mask asset-id
  bun run image-to-world fal <endpoint> --file input.json  Asset input: {"$asset":"asset-id"}
  bun run image-to-world capture [--camera camera.json]   Requires an open browser viewport
  bun run image-to-world jobs [show|wait|cancel|retry] [job-id] [--timeout 300]
  bun run image-to-world command '<JSON>'|@file.json    Every UI command, including panel/settings changes
  bun run image-to-world events                        Stream workspace revisions as JSON lines

Planning helpers leave viewpoint selection and visual review to the user or agent.
They do not choose shots, assess visual quality, or prescribe a scene-building sequence.

All responses are JSON. Errors use stderr and exit 1. Generation returns a job ID
immediately; --wait waits for completion; --ready follows automatic depth/pose jobs. --url defaults to http://127.0.0.1:4310
(or IMAGE_TO_WORLD_URL). No API credentials are needed by the CLI.
`;

export async function run(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      rgbd: { type: "boolean" },
      watch: { type: "boolean" },
      presentation: { type: "boolean" },
      bake: { type: "boolean" },
      rendered: { type: "boolean" },
      shape: { type: "string" },
      size: { type: "string" },
      mode: { type: "string" },
      time: { type: "string" },
      color: { type: "string" },
      shading: { type: "string" },
      preset: { type: "string" },
      actor: { type: "string" },
      feather: { type: "string" },
      polygon: { type: "string" },
      operation: { type: "string" },
      dilate: { type: "string" },
      region: { type: "string" },
      mask: { type: "string" },
      padding: { type: "string" },
      passes: { type: "string" },
      observation: { type: "string" },
      targets: { type: "string" },
      "unchanged-mask": { type: "string" },
      "asset-only": { type: "boolean" },
      after: { type: "string" },
      "request-id": { type: "string" },
      expect: { type: "string" },
      out: { type: "string" },
      "look-at": { type: "string" },
      "relative-to": { type: "string" },
      up: { type: "string" },
      headless: { type: "boolean" },
      jobs: { type: "string" },
      assets: { type: "string" },
      columns: { type: "string" },
      width: { type: "string" },
      port: { type: "string" },
      "no-browser": { type: "boolean" },
      trash: { type: "boolean" },
      search: { type: "string" },
      help: { type: "boolean", short: "h" },
      url: { type: "string" },
      file: { type: "string" },
      prompt: { type: "string" },
      reference: { type: "string" },
      model: { type: "string" },
      resolution: { type: "string" },
      ratio: { type: "string" },
      count: { type: "string" },
      seed: { type: "string" },
      draft: { type: "string" },
      name: { type: "string" },
      creator: { type: "string" },
      license: { type: "string" },
      asset: { type: "string" },
      parent: { type: "string" },
      before: { type: "string" },
      position: { type: "string" },
      scale: { type: "string" },
      quaternion: { type: "string" },
      index: { type: "string" },
      id: { type: "string" },
      remove: { type: "boolean" },
      "no-reconstruct": { type: "boolean" },
      reconstruct: { type: "boolean" },
      camera: { type: "string" },
      depth: { type: "boolean" },
      path: { type: "string" },
      fov: { type: "string" },
      fps: { type: "string" },
      "target-frames": { type: "string" },
      keyframes: { type: "string" },
      "source-job": { type: "string" },
      indices: { type: "string" },
      video: { type: "string" },
      "max-frames": { type: "string" },
      refine: { type: "boolean" },
      wait: { type: "boolean" },
      ready: { type: "boolean" },
      timeout: { type: "string" },
      local: { type: "boolean" },
      invert: { type: "boolean" },
    },
  });
  if (values.help || !positionals.length) {
    process.stdout.write(HELP);
    return;
  }
  const base = (
    values.url ||
    process.env.IMAGE_TO_WORLD_URL ||
    "http://127.0.0.1:4310"
  ).replace(/\/$/, "");
  const output = (value: unknown) =>
    process.stdout.write(JSON.stringify(value, null, 2) + "\n");
  let requestSuffix = "";
  const request = async (route: string, init?: RequestInit) => {
    const response = await fetch(`${base}/api/${route}`, {
      ...init,
      headers: {
        "X-Image-To-World-Client": "cli",
        "X-Image-To-World-Context": JSON.stringify({
          actorId:
            values.actor ?? process.env.IMAGE_TO_WORLD_ACTOR ?? "CLI session",
          requestId: values["request-id"]
            ? `${values["request-id"]}${requestSuffix}`
            : crypto.randomUUID(),
          ...(values.expect
            ? { preconditions: await Bun.file(values.expect).json() }
            : {}),
        }),
        ...init?.headers,
      },
    });
    if (!response.ok) {
      const body = (await response
        .json()
        .catch(() => ({ error: response.statusText }))) as { error: string };
      throw new Error(body.error);
    }
    return response;
  };
  const state = async () =>
    (await request("workspace")).json() as Promise<Workspace>;
  const jsonFile = async (file: string | undefined) => {
    if (!file) throw new Error("Supply --file");
    return Bun.file(file.replace(/^@/, "")).json();
  };
  const need = (value: string | undefined, name: string) => {
    if (!value) throw new Error(`Supply ${name}`);
    return value;
  };
  const finite = (value: string | undefined, fallback: number) => {
    const parsed = value === undefined ? fallback : Number(value);
    if (!Number.isFinite(parsed)) throw new Error(`Invalid number ${value}`);
    return parsed;
  };
  const command = async (input: Command) =>
    (
      await request("commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(commandSchema.parse(input)),
      })
    ).json() as Promise<{ jobId?: string; revision: number }>;
  const wait = async (id: string, defaultTimeout = 300) => {
    const deadline = Date.now() + finite(values.timeout, defaultTimeout) * 1000;
    for (;;) {
      const job = (await state()).jobs[id];
      if (!job) throw new Error(`Unknown job ${id}`);
      if (job.status === "succeeded") {
        if (values.ready && job.applicationError)
          throw new Error(job.applicationError);
        if (values.ready && job.childJobId) {
          id = job.childJobId;
          continue;
        }
        return job;
      }
      if (job.status === "failed" || job.status === "cancelled")
        throw new Error(JSON.stringify(job));
      if (Date.now() >= deadline)
        throw new Error(
          `Timed out; job ${id} is still ${job.status}. Resume with jobs wait ${id}`,
        );
      await Bun.sleep(1000);
    }
  };
  const submit = async (input: JobInput) => {
    const result = await command({ type: "jobs.submit", input });
    output(values.wait ? await wait(result.jobId!) : result);
  };
  const generate = async (generation: Generation) => {
    const result = await command({
      type: "generation.submit",
      request: generation,
    });
    output(values.wait ? await wait(result.jobId!) : result);
  };
  const indices = () =>
    values.indices
      ? values.indices
          .split(",")
          .filter(Boolean)
          .map((value) => finite(value, 0))
      : undefined;
  const uploadBytes = async (blob: Blob, name: string) => {
    const form = new FormData();
    form.append("files", blob, name);
    return (
      (await (
        await request("assets", { method: "POST", body: form })
      ).json()) as import("../core/schema").Asset[]
    )[0];
  };
  const [action, sub, ...rest] = positionals;
  if (action === "open") {
    await openProject(sub, {
      port: values.port,
      noBrowser: values["no-browser"],
    });
  } else if (action === "doctor") {
    const report = await doctor(sub);
    output(report);
    if (!report.ok) process.exitCode = 1;
  } else if (action === "export" && sub === "project") {
    const destination = path.resolve(need(values.out, "--out new-directory"));
    const result = await command({
      type: "generation.submit",
      request: { kind: "project.export" },
    });
    const job = await wait(result.jobId!);
    const manifest = (await (
      await request(`assets/${job.outputAssetIds[0]}`)
    ).json()) as { workspace: Workspace; assets: string[] };
    await mkdir(destination);
    for (const id of manifest.assets) {
      const asset = manifest.workspace.assets[id];
      if (path.basename(asset.name) !== asset.name)
        throw new Error("Asset name must be a filename");
      const folder = path.join(destination, "assets", id);
      await mkdir(folder, { recursive: true });
      const bytes = new Uint8Array(
        await (await request(`exports/${job.id}/${id}`)).arrayBuffer(),
      );
      await writeFile(path.join(folder, asset.name), bytes, { flag: "wx" });
    }
    await writeFile(
      path.join(destination, "workspace.json"),
      JSON.stringify(manifest.workspace, null, 2),
      { flag: "wx" },
    );
    const player = Bun.file(
      path.resolve(import.meta.dir, "../web/public/scene-player.js"),
    );
    if (!(await player.exists()))
      throw new Error("Run bun run build to produce the portable scene player");
    await writeFile(
      path.join(destination, "scene-player.js"),
      new Uint8Array(await player.arrayBuffer()),
      { flag: "wx" },
    );
    await writeFile(
      path.join(destination, "index.html"),
      `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>image-to-world · Scene</title><style>html,body,#scene{margin:0;width:100%;height:100%;overflow:hidden;background:#171717}body{font:12px system-ui;color:#eee}#controls{position:absolute;bottom:16px;left:16px;display:flex;gap:12px;align-items:center}button{background:#222;color:#ddd;border:1px solid #444;border-radius:4px;padding:8px 12px;cursor:pointer}#status{position:absolute;top:16px;left:16px;padding:8px;background:#222;max-width:80vw}</style></head><body><div id="scene"></div><div id="controls"><button id="play">Pause</button><span>Drag to orbit · scroll to zoom</span></div><pre id="status" hidden></pre><script type="module" src="./scene-player.js"></script></body></html>`,
      { flag: "wx" },
    );
    await writeFile(
      path.join(destination, "README.txt"),
      "Created with image-to-world. Serve this folder over HTTP (for example: python3 -m http.server 8080), then open index.html. All runtime files are local; no provider keys are required. Procedural modules are trusted executable project code. Source and assets are in assets/. You may adapt or rebuild this page for your destination.\n",
      { flag: "wx" },
    );
    output({
      directory: destination,
      assets: manifest.assets.length,
      snapshotJobId: job.id,
      entry: path.join(destination, "index.html"),
    });
  } else if (action === "module") {
    if (sub === "add" || sub === "update") {
      const source = need(
        sub === "add" ? rest[0] : rest[1],
        "module source file",
      );
      const nodeId =
        sub === "update"
          ? need(rest[0], "node ID")
          : `node_${values["request-id"] ? createHash("sha256").update(values["request-id"]).digest("hex").slice(0, 24) : crypto.randomUUID()}`;
      let previous = "",
        dirty = true;
      const watchers = new Map<string, ReturnType<typeof watchFiles>>();
      const watchDirectory = (directory: string) => {
        if (!values.watch || watchers.has(directory)) return;
        watchers.set(
          directory,
          watchFiles(directory, { recursive: true }, (_event, file) => {
            if (
              file &&
              !/(^|[/\\])(node_modules|\.git)([/\\]|$)/.test(String(file))
            )
              dirty = true;
          }),
        );
      };
      watchDirectory(path.dirname(path.resolve(source)));
      let runtimeAssets: string[] | undefined;

      const build = async () => {
        const compiled = await compileModule(source);
        for (const file of compiled.sources.keys())
          watchDirectory(path.dirname(file));
        const signature = createHash("sha256")
          .update(JSON.stringify([...compiled.sources]))
          .update(compiled.code)
          .digest("hex");
        if (signature === previous) return;
        const sourceAssets: Array<{ path: string; assetId: string }> = [];
        for (const [file, text] of compiled.sources) {
          const asset = await uploadBytes(
            new Blob([text], { type: "text/plain" }),
            path.basename(file),
          );
          sourceAssets.push({
            path: path.relative(path.dirname(compiled.source), file),
            assetId: asset.id,
          });
        }
        const sourceAsset = sourceAssets.find(
          (item) => item.path === path.basename(compiled.source),
        );
        if (!sourceAsset) throw new Error("Entry source was not captured");
        const bundle = await uploadBytes(
          new Blob([compiled.code], { type: "text/javascript" }),
          `${path.basename(source)}-${compiled.hash.slice(0, 12)}.js`,
        );
        const recipe = await uploadBytes(
          new Blob(
            [
              JSON.stringify(
                {
                  compiler: compiled.compiler,
                  entry: path.basename(source),
                  sources: sourceAssets,
                  bundleAssetId: bundle.id,
                },
                null,
                2,
              ),
            ],
            { type: "application/json" },
          ),
          "module-sources.json",
        );
        requestSuffix = `:sources:${bundle.id}`;
        await command({
          type: "assets.update",
          id: bundle.id,
          patch: {
            sourceAssetIds: [
              ...sourceAssets.map((item) => item.assetId),
              recipe.id,
            ],
          },
        });
        let workspace = await state();
        if (!workspace.nodes[nodeId]) {
          if (sub === "update")
            throw new Error("Procedural destination does not exist");
          requestSuffix = `:create:${nodeId}`;
          await command({
            type: "nodes.put",
            nodes: [
              nodeSchema.parse({
                id: nodeId,
                name:
                  values.name ?? path.basename(source, path.extname(source)),
                kind: "procedural",
                parentId: values.parent ?? null,
                transform: identity(),
              }),
            ],
          });
          workspace = await state();
        }
        if (workspace.nodes[nodeId].kind !== "procedural")
          throw new Error("Choose a procedural node");
        const previousNode = workspace.nodes[nodeId].procedural;
        runtimeAssets ??=
          values.assets?.split(",") ?? previousNode?.assetIds ?? [];
        requestSuffix = `:build:${nodeId}:${signature}`;
        const result = await command({
          type: "generation.submit",
          request: {
            kind: "module",
            nodeId,
            sourceAssetId: sourceAsset.assetId,
            bundleAssetId: bundle.id,
            assetIds: [...new Set(runtimeAssets)],
            parameters: values.file
              ? await jsonFile(values.file)
              : (previousNode?.parameters ?? {}),
            seed: finite(values.seed, previousNode?.seed ?? 1),
          },
        });
        const job = await wait(result.jobId!);
        if (job.applicationError) throw new Error(job.applicationError);
        previous = signature;
        output({
          nodeId,
          jobId: job.id,
          bundleAssetId: bundle.id,
          sourceAssetId: sourceAsset.assetId,
        });
      };
      try {
        dirty = false;
        try {
          await build();
        } catch (error) {
          if (!values.watch) throw error;
          process.stderr.write(`${String(error)}\n`);
        }
        if (values.watch) {
          process.stderr.write(
            "Watching module sources; Ctrl+C stops watching.\n",
          );
          for (;;) {
            await Bun.sleep(300);
            if (!dirty) continue;
            dirty = false;
            try {
              await build();
            } catch (error) {
              process.stderr.write(`${String(error)}\n`);
            }
          }
        }
      } finally {
        for (const watcher of watchers.values()) watcher.close();
      }
    } else if (sub === "params") {
      const id = need(rest[0], "node ID"),
        node = (await state()).nodes[id];
      if (!node?.procedural) throw new Error("Choose a built procedural node");
      output(
        await command({
          type: "nodes.patch",
          id,
          patch: {
            procedural: {
              ...node.procedural,
              parameters: {
                ...node.procedural.parameters,
                ...(await jsonFile(values.file)),
              },
            },
          },
        }),
      );
    } else if (sub === "inspect") {
      const node = (await state()).nodes[need(rest[0], "node ID")];
      output(node?.procedural ?? null);
    } else if (sub === "bake") {
      const workspace = await state();
      await generate({
        kind: "render",
        camera: workspace.settings.viewportCamera,
        nodeIds: [need(rest[0], "node ID")],
        time: finite(values.time, 0),
        bake: true,
      });
    } else throw new Error("Use module add, update, params, inspect, or bake");
  } else if (action === "art") {
    const workspace = await state();
    if (!sub && !values.file && !values.preset) output(workspace.settings.art);
    else {
      const preset = values.preset ?? sub;
      const base =
        preset && preset in artPresets
          ? artPresets[preset as keyof typeof artPresets].settings
          : workspace.settings.art;
      output(
        await command({
          type: "workspace.update",
          settings: {
            art: artDirectionSchema.parse({
              ...base,
              ...(values.file ? await jsonFile(values.file) : {}),
            }),
          },
        }),
      );
    }
  } else if (action === "schema") {
    const schemas = {
      nodes: nodeSchema,
      modules: proceduralSchema,
      art: artDirectionSchema,
      commands: commandSchema,
      generation: generationSchema,
      context: commandContextSchema,
      jobs: jobInputSchema,
      aim: cameraAimSchema,
      inspection: inspectionSchema,
      workspace: workspaceSchema,
      draft: imageDraftSchema,
      camera: cameraSchema,
    };
    const schema = schemas[sub as keyof typeof schemas];
    if (!schema)
      throw new Error(`Choose schema ${Object.keys(schemas).join(", ")}`);
    output(zodToJsonSchema(schema));
  } else if (action === "activity") {
    output(
      await (await request(`activity?after=${finite(values.after, 0)}`)).json(),
    );
  } else if (action === "generate") {
    await generate(generationSchema.parse(await jsonFile(values.file)));
  } else if (action === "models") {
    output(
      await (
        await request(
          `models?${new URLSearchParams(sub ? { endpoint: sub } : values.search ? { q: values.search } : {})}`,
        )
      ).json(),
    );
  } else if (action === "model") {
    await generate({
      kind: "model",
      model: need(sub, "model endpoint"),
      input: await jsonFile(values.file),
    });
  } else if (action === "mask") {
    await generate({
      kind: "mask",
      assetIds: positionals.slice(1),
      operation: values.operation as "union" | "intersection" | undefined,
      invert: values.invert,
      dilate: finite(values.dilate, 0),
      feather: finite(values.feather, 0),
    });
  } else if (action === "observe") {
    const region = need(values.region, "--region x,y,width,height")
      .split(",")
      .map(Number);
    if (region.length !== 4)
      throw new Error(
        "Region requires x,y,width,height in normalized coordinates",
      );
    await generate({
      kind: "observe",
      nodeId: need(sub, "capture ID"),
      region: {
        x: region[0],
        y: region[1],
        width: region[2],
        height: region[3],
      },
      maskAssetId: values.mask,
      polygon: values.polygon ? await jsonFile(values.polygon) : undefined,
      padding: finite(values.padding, 0.1),
    });
  } else if (action === "fit") {
    const quaternion = values.quaternion?.split(",").map(Number) as
      [number, number, number, number] | undefined;
    await generate({
      kind: "fit",
      nodeId: need(sub, "mesh node ID"),
      observationAssetId: need(values.observation, "--observation asset ID"),
      quaternion,
    });
  } else if (action === "render") {
    const w = await state();
    const camera = values.camera
      ? cameraSchema.parse(await jsonFile(values.camera))
      : sub
        ? sceneCamera(w, sub)
        : undefined;
    if (!camera)
      throw new Error(
        "Supply a camera/capture ID or --camera file.json; render never borrows the live viewport",
      );
    await generate({
      kind: "render",
      camera,
      nodeIds: values.targets?.split(","),
      passes: (values.passes?.split(",") ??
        (values.rgbd ? ["color", "depth"] : undefined)) as
        ("color" | "depth" | "mask" | "ids")[] | undefined,
      referenceAssetId: values.reference,
      time: values.time ? finite(values.time, 0) : undefined,
      presentation: values.presentation,
      bake: values.bake,
      integrate: values.rgbd,
    });
  } else if (action === "revert") {
    output(
      await command({ type: "history.revert", editId: need(sub, "edit ID") }),
    );
  } else if (action === "status")
    output(await (await request("status")).json());
  else if (action === "state") output(await state());
  else if (action === "assets" && !sub)
    output(
      Object.values((await state()).assets).filter(
        (asset) =>
          (asset.trashedAt !== undefined) === Boolean(values.trash) &&
          collectionMatches(values.search ?? "", [
            asset.name,
            asset.kind,
            asset.path,
          ]),
      ),
    );
  else if (action === "import") {
    if (positionals.length < 2)
      throw new Error("Supply local files or direct HTTP asset URLs");
    const imported = [];
    for (const file of positionals.slice(1)) {
      const remote = /^https?:\/\//i.test(file);
      let blob: Blob;
      if (remote) {
        const response = await fetch(file, {
          signal: AbortSignal.timeout(120000),
        });
        if (!response.ok)
          throw new Error(`Asset download failed: ${response.status}`);
        blob = await response.blob();
      } else {
        blob = Bun.file(file);
        if (!(await Bun.file(file).exists()))
          throw new Error(`File does not exist: ${file}`);
      }
      const name =
        values.name ??
        (remote ? path.basename(new URL(file).pathname) : path.basename(file));
      if (!name)
        throw new Error("Supply --name with a supported filename extension");
      const asset = await uploadBytes(blob, name);
      if (remote || values.creator || values.license) {
        requestSuffix = `:provenance:${asset.id}`;
        await command({
          type: "assets.update",
          id: asset.id,
          patch: {
            provenance: {
              ...(remote ? { url: file } : {}),
              ...(values.creator ? { creator: values.creator } : {}),
              ...(values.license ? { license: values.license } : {}),
            },
          },
        });
      }
      imported.push((await state()).assets[asset.id]);
    }
    output(imported);
  } else if (action === "export") {
    const file = need(rest[0], "output file");
    if (await Bun.file(file).exists())
      throw new Error(`Output already exists: ${file}`);
    await Bun.write(
      file,
      await request(`assets/${encodeURIComponent(need(sub, "asset ID"))}`),
    );
    output({ file: path.resolve(file) });
  } else if (
    action === "assets" &&
    ["trash", "restore", "reveal"].includes(sub)
  ) {
    output(
      await command(
        sub === "reveal"
          ? { type: "assets.reveal", id: need(rest[0], "asset ID") }
          : {
              type: sub === "trash" ? "assets.trash" : "assets.restore",
              ids: rest,
            },
      ),
    );
  } else if (action === "image" && sub === "create") {
    await generate({
      kind: "image.create",
      outputMode: values.mode as "asset" | "reference" | "pose" | undefined,
      prompt: need(values.prompt, "--prompt"),
      model: resolveImageModel(
        values.model,
        "create",
      ) as ImageModelFor<"create">,
      ...(values.camera
        ? { placement: cameraSchema.parse(await jsonFile(values.camera)) }
        : {}),
      ...(values.seed ? { seed: finite(values.seed, 42) } : {}),
    });
  } else if (action === "image") {
    const id = need(rest[0], "asset ID");
    const workspace = await state();
    if (workspace.assets[id]?.kind !== "image")
      throw new Error("Choose an image asset");
    if (sub === "history") output(imageHistory(workspace, id));
    else if (sub === "undo" || sub === "redo")
      output(
        await command({
          type: sub === "undo" ? "history.undo" : "history.redo",
          assetId: id,
        }),
      );
    else if (sub === "open")
      output(
        await command({
          type: "workspace.update",
          settings: {
            editor2d: { ...workspace.settings.editor2d, activeAssetId: id },
          },
        }),
      );
    else if (sub === "activate")
      output(
        await command({
          type: "image.activate",
          assetId: id,
          ...(rest.length > 1 ? { nodeIds: rest.slice(1) } : {}),
        }),
      );
    else if (sub === "draft")
      output(
        await command({
          type: "image.draft",
          assetId: id,
          draft: imageDraftSchema.parse(await jsonFile(values.file)),
        }),
      );
    else if (sub === "edit") {
      const settings = nanoSettingsSchema.parse({
        model: resolveImageModel(values.model, "edit"),
        resolution: values.resolution ?? "1K",
        aspectRatio: values.ratio ?? "auto",
        numImages: finite(values.count, 1),
        ...(values.seed ? { seed: finite(values.seed, 42) } : {}),
      });
      await generate({
        kind: "image.edit",
        sourceAssetId: id,
        referenceAssetIds: values.reference?.split(",").filter(Boolean) ?? [],
        prompt: need(values.prompt, "--prompt"),
        settings,
        applyToScene: !values["asset-only"],
        targetNodeIds: values.targets?.split(","),
        unchangedMaskAssetId: values["unchanged-mask"],
        reconstruct: !values["no-reconstruct"],
        ...(values.draft
          ? { draft: imageDraftSchema.parse(await jsonFile(values.draft)) }
          : {}),
      });
    } else throw new Error("Use image open, activate, history, draft, or edit");
  } else if (action === "select")
    output(await command({ type: "selection.set", ids: positionals.slice(1) }));
  else if (action === "camera") {
    if (
      sub === "solve" ||
      (sub === "place" &&
        (values.position ||
          values["look-at"] ||
          values["relative-to"] ||
          values.up ||
          values.fov))
    ) {
      if (values.file) throw new Error("Choose aim flags or --file, not both");
      const aim = cameraAimSchema.parse({
        position: need(values.position, "--position").split(",").map(Number),
        target: need(values["look-at"], "--look-at").split(",").map(Number),
        frameId: values["relative-to"] ?? null,
        ...(values.up ? { up: values.up.split(",").map(Number) } : {}),
        ...(values.fov ? { fov: finite(values.fov, 60) } : {}),
      });
      if (sub === "solve") {
        const workspace = await state();
        const camera = aimCamera(
          workspace,
          aim,
          currentCamera(workspace).intrinsics,
        );
        if (values.out)
          await writeFile(
            path.resolve(values.out),
            JSON.stringify(camera, null, 2) + "\n",
            { flag: "wx" },
          );
        output(camera);
      } else
        output(await command({ type: "camera.aim", aim, name: values.name }));
    } else if (sub === "place")
      output(
        await command({
          type: "camera.place",
          name: values.name,
          ...(values.file
            ? { camera: cameraSchema.parse(await jsonFile(values.file)) }
            : {}),
        }),
      );
    else if (sub === "view")
      output(
        await command({
          type: "camera.view",
          nodeId: need(rest[0], "node ID"),
        }),
      );
    else if (sub === "free") output(await command({ type: "camera.release" }));
    else if (values.file)
      output(
        await command({
          type: "workspace.update",
          settings: {
            viewportCamera: cameraSchema.parse(await jsonFile(values.file)),
          },
        }),
      );
    else output((await state()).settings.viewportCamera);
  } else if (action === "undo" || action === "redo") {
    output(
      await command({
        type: action === "undo" ? "history.undo" : "history.redo",
      }),
    );
  } else if (action === "scene") {
    const workspace = await state();
    if (!sub) output(Object.values(workspace.nodes));
    else if (sub === "inspect") {
      if (values.out && (await Bun.file(values.out).exists()))
        throw new Error(`Output already exists: ${values.out}`);
      let report;
      if (values.rendered) {
        const submitted = await command({
          type: "generation.submit",
          request: {
            kind: "render",
            camera: currentCamera(workspace),
            ...(rest.length ? { nodeIds: rest } : {}),
            time: finite(values.time, workspace.settings.art.time),
          },
        });
        const job = await wait(submitted.jobId!);
        const assets = (await state()).assets;
        const manifestId = job.outputAssetIds.find((id) =>
          assets[id]?.name.endsWith(".json"),
        );
        if (!manifestId)
          throw new Error("Renderer did not return an inspection manifest");
        report = await (await request(`assets/${manifestId}`)).json();
        if (values.out)
          await writeFile(
            path.resolve(values.out),
            JSON.stringify(report, null, 2) + "\n",
            { flag: "wx" },
          );
        output(report);
        return;
      } else if (values.headless) {
        const query = new URLSearchParams(rest.map((id) => ["nodeId", id]));
        report = await (await request(`scene/inspect?${query}`)).json();
      } else {
        const submitted = await command({
          type: "jobs.submit",
          input: { kind: "inspect", ...(rest.length ? { nodeIds: rest } : {}) },
        });
        const job = await wait(submitted.jobId!, 30);
        report = await (
          await request(`assets/${encodeURIComponent(job.outputAssetIds[0])}`)
        ).json();
      }
      const parsed = inspectionSchema.parse(report);
      if (values.out)
        await writeFile(
          path.resolve(values.out),
          JSON.stringify(parsed, null, 2) + "\n",
          { flag: "wx" },
        );
      output(parsed);
    } else if (sub === "preview") {
      if (values.out && (await Bun.file(values.out).exists()))
        throw new Error(`Output already exists: ${values.out}`);
      const submitted = await command({
        type: "jobs.submit",
        input: {
          kind: "contactSheet",
          ...(rest.length ? { nodeIds: rest } : {}),
          ...(values.jobs ? { jobIds: values.jobs.split(",") } : {}),
          ...(values.assets ? { assetIds: values.assets.split(",") } : {}),
          columns: finite(values.columns, 3),
          width: finite(values.width, 384),
        },
      });
      const job = await wait(submitted.jobId!);
      const assetId = job.outputAssetIds[0];
      if (values.out)
        await writeFile(
          path.resolve(values.out),
          new Uint8Array(
            await (
              await request(`assets/${encodeURIComponent(assetId)}`)
            ).arrayBuffer(),
          ),
          { flag: "wx" },
        );
      output({
        jobId: job.id,
        assetId,
        manifestAssetId: job.outputAssetIds[1],
        ...(values.out ? { file: path.resolve(values.out) } : {}),
      });
    } else if (sub === "place") {
      output(
        await command({
          type: "assets.place",
          mode: values.reconstruct
            ? "reconstruct"
            : (values.mode as "reference" | "individual" | undefined),
          assetIds: rest,
          ...(values.parent
            ? { parentId: values.parent === "root" ? null : values.parent }
            : {}),
          ...(values.camera
            ? { camera: cameraSchema.parse(await jsonFile(values.camera)) }
            : {}),
        }),
      );
    } else if (sub === "put") {
      const input = await jsonFile(values.file);
      output(
        await command({
          type: "nodes.put",
          nodes: Array.isArray(input) ? input : [input],
        }),
      );
    } else if (sub === "add") {
      const kind = need(rest[0], "node kind");
      const node = nodeSchema.parse({
        id: `node_${crypto.randomUUID()}`,
        kind,
        name: values.name ?? kind,
        assetId: values.asset,
        parentId: values.parent ?? null,
        transform: identity(),
        ...(kind === "primitive"
          ? {
              primitive: primitiveSchema.parse({
                shape: values.shape ?? "box",
                size: values.size?.split(",").map(Number),
              }),
              surface: surfaceSchema.parse({
                color: values.color,
                shading: values.shading,
              }),
            }
          : {}),
        ...(kind === "light"
          ? {
              light: lightSchema.parse({
                type: values.mode ?? "point",
                color: values.color,
              }),
            }
          : {}),
        ...(kind === "camera"
          ? cameraNodeData(workspace.settings.viewportCamera)
          : {}),
        ...(kind === "path" ? { keyframes: [] } : {}),
        ...(kind === "clip"
          ? {
              clip: {
                scope: values.local ? "local" : "global",
                invert: !!values.invert,
                softness: 0,
              },
            }
          : {}),
      });
      await command({ type: "nodes.put", nodes: [node] });
      output(node);
    } else if (sub === "move") {
      const parent = need(values.parent, "--parent id or root");
      output(
        await command({
          type: "nodes.move",
          ids: rest,
          parentId: parent === "root" ? null : parent,
          beforeId: values.before,
        }),
      );
    } else if (sub === "duplicate") {
      output(await command({ type: "nodes.duplicate", ids: rest }));
    } else if (sub === "remove")
      output(await command({ type: "nodes.remove", ids: rest }));
    else if (sub === "transform") {
      const parentId = values.parent === "root" ? null : values.parent;
      const transform: Record<string, number[]> = {};
      for (const key of ["position", "scale", "quaternion"] as const)
        if (values[key]) transform[key] = values[key]!.split(",").map(Number);
      output(
        await command({
          type: "edit.batch",
          commands: [
            ...(values.parent
              ? [
                  {
                    type: "nodes.move" as const,
                    ids: rest,
                    parentId: parentId!,
                  },
                ]
              : []),
            { type: "nodes.transform", ids: rest, transform },
          ],
        }),
      );
    } else
      throw new Error(
        "Use scene inspect, preview, add, put, move, duplicate, transform, or remove",
      );
  } else if (action === "context") {
    const workspace = await state();
    if (values.path && workspace.nodes[values.path]?.kind !== "path")
      throw new Error("Choose a camera path");
    const context = contextSettings(workspace, values.path);
    const frames = spatialContextFrames(workspace);
    const active = new Set(
      atlasContext(workspace, undefined, values.path).map(
        (frame) => frame.node.id,
      ),
    );
    if (!sub || sub === "list")
      output({
        ...context,
        order: frames.map((node) => node.id),
        captures: frames,
        activeIds: frames
          .filter((node) => active.has(node.id))
          .map((node) => node.id),
      });
    else {
      const captures = frames;
      if (rest.some((id) => !captures.some((node) => node.id === id)))
        throw new Error("Choose capture IDs from context list");
      if (sub === "show" || sub === "hide")
        output(
          await command({
            type: "nodes.put",
            nodes: rest.map((id) => ({
              ...workspace.nodes[id],
              visible: sub === "show",
            })),
          }),
        );
      else if (sub === "freeze" || sub === "unfreeze")
        output(
          await command({
            type: "nodes.put",
            nodes: rest.map((id) => ({
              ...workspace.nodes[id],
              contextFrozen: sub === "freeze",
            })),
          }),
        );
      else {
        const patch =
          sub === "solo"
            ? { soloIds: rest }
            : sub === "include"
              ? {
                  excludedIds: context.excludedIds.filter(
                    (id) => !rest.includes(id),
                  ),
                }
              : sub === "exclude"
                ? {
                    excludedIds: [
                      ...new Set([...context.excludedIds, ...rest]),
                    ],
                  }
                : undefined;
        if (!patch)
          throw new Error(
            "Use context list, include, exclude, solo, show, hide, freeze, or unfreeze",
          );
        output(
          await command(
            values.path
              ? {
                  type: "nodes.put",
                  nodes: [
                    {
                      ...workspace.nodes[values.path],
                      context: { ...context, ...patch },
                    },
                  ],
                }
              : {
                  type: "workspace.update",
                  settings: { atlas: { ...context, ...patch } },
                },
          ),
        );
      }
    }
  } else if (action === "path" && sub === "create") {
    output(
      await command({
        type: "path.fromCameras",
        nodeIds: rest,
        targetFrameCount: finite(values["target-frames"], 36),
      }),
    );
  } else if (action === "path" && sub === "update") {
    output(
      await command({
        type: "path.update",
        pathId: need(rest[0], "path ID"),
        ...(values.fov ? { fov: Number(values.fov) } : {}),
        ...(values["target-frames"]
          ? { targetFrameCount: Number(values["target-frames"]) }
          : {}),
      }),
    );
  } else if (action === "path" && sub === "keyframe") {
    const workspace = await state();
    const id = need(rest[0], "path ID");
    if (workspace.nodes[id]?.kind !== "path")
      throw new Error("Choose a path node");
    const camera = values.file
      ? cameraSchema.parse(await jsonFile(values.file))
      : undefined;
    output(
      await command({
        type: "path.keyframe",
        pathId: id,
        id: values.id,
        remove: values.remove,
        index: values.index === undefined ? undefined : finite(values.index, 0),
        camera,
      }),
    );
  } else if (action === "pose")
    await generate({
      kind: "pose",
      assetIds: positionals.slice(1),
      ...(values.camera
        ? { placement: cameraSchema.parse(await jsonFile(values.camera)) }
        : {}),
    });
  else if (action === "atlas")
    await generate({
      kind: "view",
      contextPathId: values.path,
      ...(positionals.length > 1 ? { nodeIds: positionals.slice(1) } : {}),
      ...(values.camera
        ? { camera: cameraSchema.parse(await jsonFile(values.camera)) }
        : {}),
      prompt: values.prompt,
      seed: finite(values.seed, 42),
    });
  else if (action === "splats")
    await generate({
      kind: "splats",
      contextPathId: values.path,
      ...(positionals.length > 1 ? { nodeIds: positionals.slice(1) } : {}),
      prompt: values.prompt,
      refine: values.refine,
    });
  else if (
    action === "video" &&
    !["frames", "view", "integrate", "reconstruct"].includes(sub)
  )
    await generate({
      kind: "video",
      pathId: values.path,
      ...(positionals.length > 1 ? { nodeIds: positionals.slice(1) } : {}),
      fps: values.fps ? finite(values.fps, 12) : undefined,
      targetFrameCount: values["target-frames"]
        ? finite(values["target-frames"], 36)
        : undefined,
      prompt: values.prompt,
      seed: values.seed === undefined ? undefined : finite(values.seed, 42),
      mode: values.keyframes ? "keyframes" : "dense",
      keyframeCount: finite(values.keyframes, 4),
      sourceJobId: values["source-job"],
    });
  else if (action === "video") {
    const jobId = need(rest[0], "job ID");
    const workspace = await state();
    const job = workspace.jobs[jobId];
    if (!job || !["video", "atlas", "reconstruct"].includes(job.input.kind))
      throw new Error("Choose a video job");
    if (sub === "frames") {
      const assetIds = frameAssets(workspace, job).map((asset) => asset.id);
      output(
        assetIds.map((assetId, position) => ({
          index:
            workspace.assets[assetId]?.frameIndex ??
            job.frameIndices?.[position] ??
            position,
          asset: workspace.assets[assetId],
          camera:
            job.cameras?.[
              workspace.assets[assetId]?.frameIndex ??
                job.frameIndices?.[position] ??
                position
            ] ?? workspace.assets[assetId]?.camera,
        })),
      );
    } else if (sub === "view")
      output(
        await command({
          type: "frames.view",
          jobId,
          index: finite(need(rest[1], "frame index"), 0),
        }),
      );
    else if (sub === "integrate")
      output(
        await command({
          type: "frames.integrate",
          jobId,
          ...(indices() ? { indices: indices() } : {}),
        }),
      );
    else if (sub === "reconstruct") {
      await generate({ kind: "reconstruct", jobId, indices: indices() });
    } else throw new Error("Use video frames, view, integrate, or reconstruct");
  } else if (action === "reconstruct")
    await generate({
      kind: "reconstruct",
      assetIds: positionals.slice(1),
      videoAssetId: values.video,
      fps: finite(values.fps, 1),
      maxFrames: finite(values["max-frames"], 60),
    });
  else if (action === "fal")
    await generate({
      kind: "model",
      model: need(sub, "endpoint"),
      input: await jsonFile(values.file),
    });
  else if (action === "capture")
    await submit({
      kind: "capture",
      ...(values.camera
        ? { camera: cameraSchema.parse(await jsonFile(values.camera)) }
        : {}),
    });
  else if (action === "jobs") {
    if (!sub || sub === "list") output(Object.values((await state()).jobs));
    else {
      const id = need(rest[0], "job ID");
      if (sub === "show") {
        const job = (await state()).jobs[id];
        if (!job) throw new Error(`Unknown job ${id}`);
        output(job);
      } else if (sub === "wait") output(await wait(id));
      else if (sub === "cancel" || sub === "retry")
        output(
          await command({
            type: sub === "cancel" ? "jobs.cancel" : "jobs.retry",
            id,
          }),
        );
      else throw new Error("Use jobs list, show, wait, cancel, or retry");
    }
  } else if (action === "command") {
    const source = need(sub, "command JSON or @file");
    output(
      await command(
        source.startsWith("@") ? await jsonFile(source) : JSON.parse(source),
      ),
    );
  } else if (action === "events") {
    const response = await request("events");
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = event
          .split("\n")
          .find((line) => line.startsWith("data: "));
        if (data)
          process.stdout.write(
            JSON.stringify(JSON.parse(data.slice(6))) + "\n",
          );
      }
    }
  } else throw new Error(`Unknown command.\n${HELP}`);
}
if (import.meta.main)
  run(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }) + "\n",
    );
    process.exitCode = 1;
  });
