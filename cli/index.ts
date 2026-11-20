#!/usr/bin/env bun
import { projectApi } from "../core/project-url";
import { objectInventory } from "../core/object-inventory";
import {
  defaultLighting,
  frameRig,
  lightRigSchema,
  projectLightSchema,
} from "../core/lighting";
import { compileModule } from "./modules";
import { proceduralSchema, moduleParameters } from "../core/procedural";
import { commandContextSchema } from "../core/command-context";
import { generationSchema } from "../core/schema";
import { sceneCamera } from "../core/captures";
import { resolveImageModel, type ImageModelFor } from "../core/models";
import { writeFile } from "node:fs/promises";
import { aimCamera } from "../core/cameras";
import { currentCamera } from "../core/generation";
import { inspectionSchema } from "../core/inspection";
import { doctor, openProject } from "./launch";
import { collectionMatches } from "../core/collections";
import { frameAssets } from "../core/frames";
import {
  atlasContextNodes,
  captureFrameStatus,
  frameGuideDisplay,
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
  vec3,
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
  bun run image-to-world import <file>...                Import binary files
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
  bun run image-to-world module add <source.ts> [--parent frame-id] [--assets id,id] [--file params.json] [--seed 1]
  bun run image-to-world module update <node-id> <source.ts>   Recompile and replace code undoably
  bun run image-to-world module params <node-id> --file params.json
  bun run image-to-world frame work <frame-id> "<two to four words>"|done --actor <name>
  bun run image-to-world lighting [frame-id] [--file rig.json | --inherit]   Inspect or set lighting; omitting Frame edits the scene
  bun run image-to-world module inspect <node-id>
  bun run image-to-world scene                          List scene objects
  bun run image-to-world scene inspect [node-id...] [--headless] [--out report.json]
                   Inspect cameras, context, errors and renderer bounds (open viewport required)
  bun run image-to-world scene preview [node-id...] [--jobs id,id | --assets id,id]
                   [--columns 3] [--width 384] [--out preview.png]  Headless contact sheet
  bun run image-to-world scene add image --asset <id> [--name 'Image'] [--parent id]
  bun run image-to-world scene add camera|group|path|clip [--name '...'] [--parent id]
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
  bun run image-to-world scene place <asset-id>... [--parent frame-id] [--camera camera.json] [--reference-only | --reconstruct]  Place a local reference Frame, jointly pose images, or place assets
  bun run image-to-world camera solve --position x,y,z --look-at x,y,z [--relative-to node-id]
                   [--up x,y,z] [--fov 60] [--out camera.json]  Calculate orientation from your position/target; no scene edit
  bun run image-to-world camera place [--position x,y,z --look-at x,y,z --relative-to node-id]
                   [--name 'Camera'] [--file camera.json]  Record your chosen camera, undoably; extend selection (viewport C)
  bun run image-to-world camera view <node-id> | camera free
  bun run image-to-world context guides on|off            Show depth guides for layout or hide them for modeling
  bun run image-to-world context [list|include|exclude|solo|show|hide|freeze|unfreeze] <capture-id>...
  bun run image-to-world path create <camera-id>... [--target-frames 36]
  bun run image-to-world pose <asset-id>... [--camera camera.json]
  bun run image-to-world atlas [--depth] [--camera camera.json] [--path path-id] [--prompt '...']
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
  bun run image-to-world probe <camera-or-frame-id> [--position x,y,z] [--width 1024] [--targets id,id] [--wait]   Capture local LDR environment PNG
  bun run image-to-world render <camera-or-capture-id> [--set] [--camera file.json] [--targets id,id]
                   [--passes color,mask,depth,ids] [--reference image-id]  Independent headless renderer
  bun run image-to-world mask <asset-id>... [--operation union|intersection] [--invert] [--dilate pixels] [--feather pixels]
  bun run image-to-world observe <capture-id> --region x,y,w,h [--mask asset-id] [--padding .1]
                   Save crop, masks, camera and scene-depth observation (normalized top-left coordinates)
  bun run image-to-world fit <mesh-node-id> --observation manifest-asset-id [--quaternion x,y,z,w]
                   Read-only placement proposal; use its command and preconditions after reviewing
  bun run image-to-world models [endpoint] [--search text]  Suggestions or live provider schema
  bun run image-to-world inventory                        List reference Frames, instances and shared builds
  bun run image-to-world model <endpoint> [--build-key key] --file input.json  General image/3D model call; {"$asset":"id"}
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
      set: { type: "boolean" },
      inherit: { type: "boolean" },
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
      "build-key": { type: "string" },
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
      "reference-only": { type: "boolean" },
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
  const base = new URL(
    values.url || process.env.IMAGE_TO_WORLD_URL || "http://127.0.0.1:4310",
  );
  const output = (value: unknown) =>
    process.stdout.write(JSON.stringify(value, null, 2) + "\n");
  let modulePreconditions: Array<{
    collection: "nodes";
    id: string;
    field?: string;
    expected: unknown;
  }> = [];
  const thread = process.env.CODEX_THREAD_ID ?? process.env.CODEX_SESSION_ID;
  const actorId =
    values.actor ??
    process.env.IMAGE_TO_WORLD_ACTOR ??
    (thread ? `Agent ${thread.slice(-12)}` : "CLI session");
  const request = async (route: string, init?: RequestInit) => {
    const response = await fetch(
      new URL(projectApi(route, base.search), base).href,
      {
        ...init,
        headers: {
          "X-Image-To-World-Client": "cli",
          "X-Image-To-World-Context": JSON.stringify({
            actorId,
            requestId: values["request-id"] ?? crypto.randomUUID(),
            preconditions: [
              ...modulePreconditions,
              ...(values.expect ? await Bun.file(values.expect).json() : []),
            ],
          }),
          ...init?.headers,
        },
      },
    );
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
  } else if (action === "module") {
    const workspace = await state();
    const id =
      sub === "add" ? `node_${crypto.randomUUID()}` : need(rest[0], "node ID");
    const existing = workspace.nodes[id];
    if (sub !== "add" && existing?.kind !== "procedural")
      throw new Error("Choose an existing procedural node");
    if (sub === "inspect") {
      output(existing.procedural);
      return;
    }
    if (sub === "params") {
      if (!existing.procedural) throw new Error("Node has no module");
      modulePreconditions = [
        {
          collection: "nodes",
          id,
          field: "procedural",
          expected: existing.procedural,
        },
      ];
      output(
        await command({
          type: "nodes.patch",
          id,
          patch: {
            procedural: {
              ...existing.procedural,
              parameters: moduleParameters.parse(await jsonFile(values.file)),
            },
          },
        }),
      );
      return;
    }
    if (sub !== "add" && sub !== "update")
      throw new Error("Use module add, update, params, or inspect");
    const source = need(rest[sub === "add" ? 0 : 1], "source.ts");
    const compiled = await compileModule(source);
    const upload = async (text: string, name: string, type = "text/plain") => {
      const form = new FormData();
      form.append("files", new Blob([text], { type }), name);
      const result = (await (
        await request("assets", { method: "POST", body: form })
      ).json()) as Array<{ id: string }>;
      return result[0].id;
    };
    const sources = [];
    for (const [file, text] of compiled.sources)
      sources.push({
        path: path.relative(path.dirname(compiled.source), file),
        assetId: await upload(text, path.basename(file)),
      });
    const sourceAssetId = sources.find(
      (item) => item.path === path.basename(compiled.source),
    )!.assetId;
    const bundleAssetId = await upload(
      compiled.code,
      `${path.basename(source)}-${compiled.hash.slice(0, 12)}.js`,
      "text/javascript",
    );
    const manifest = await upload(
      JSON.stringify({
        entry: path.basename(compiled.source),
        sources,
        compiler: compiled.compiler,
      }),
      "module-sources.json",
      "application/json",
    );
    const procedural = proceduralSchema.parse({
      sourceAssetId,
      bundleAssetId,
      sourceAssetIds: [...sources.map((item) => item.assetId), manifest],
      assetIds:
        values.assets?.split(",").filter(Boolean) ??
        existing?.procedural?.assetIds ??
        [],
      parameters: values.file
        ? await jsonFile(values.file)
        : (existing?.procedural?.parameters ?? {}),
      seed: finite(values.seed, existing?.procedural?.seed ?? 1),
      enabled: existing?.procedural?.enabled ?? true,
    });
    modulePreconditions = [
      {
        collection: "nodes",
        id,
        ...(existing
          ? { field: "procedural", expected: existing.procedural }
          : { expected: null }),
      },
    ];
    const result = await command(
      existing
        ? { type: "nodes.patch", id, patch: { procedural } }
        : {
            type: "nodes.put",
            nodes: [
              nodeSchema.parse({
                id,
                name: values.name ?? path.basename(source),
                kind: "procedural",
                parentId: values.parent ?? null,
                transform: identity(),
                procedural,
              }),
            ],
          },
    );
    output({ ...result, nodeId: id, sourceAssetId, bundleAssetId });
  } else if (action === "schema") {
    const schemas = {
      lighting: projectLightSchema,
      modules: proceduralSchema,
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
  } else if (action === "inventory") {
    output(objectInventory(await state()));
  } else if (action === "model" || action === "fal") {
    await generate({
      kind: "model",
      model: need(sub, "model endpoint"),
      buildKey: values["build-key"],
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
  } else if (action === "frame" && sub === "work") {
    const [id, ...words] = rest;
    const task = words.join(" ");
    output(
      await command({
        type: "frame.work",
        id: need(id, "Frame ID"),
        actor: actorId,
        description: task === "done" ? null : task,
      }),
    );
  } else if (action === "lighting") {
    const w = await state();
    if (sub && w.nodes[sub]?.kind !== "capture")
      throw new Error("Choose a Frame for reference lighting");
    if (values.inherit && (!sub || values.file))
      throw new Error("--inherit requires a Frame and no --file");
    if (values.file || values.inherit) {
      const data = values.file ? await jsonFile(values.file) : undefined;
      output(
        sub
          ? await command({
              type: "nodes.patch",
              id: sub,
              patch: {
                lighting: values.inherit ? null : lightRigSchema.parse(data),
              },
            })
          : await command({
              type: "workspace.update",
              settings: { lighting: projectLightSchema.parse(data) },
            }),
      );
    } else if (sub) {
      const project = w.settings.lighting ?? defaultLighting;
      output({
        frameId: sub,
        inherited: !w.nodes[sub].lighting,
        lighting: w.nodes[sub].lighting ?? frameRig(project),
      });
    } else output(w.settings.lighting ?? defaultLighting);
  } else if (action === "probe") {
    await generate({
      kind: "probe",
      position: values.position
        ? vec3.parse(values.position.split(",").map(Number))
        : undefined,
      nodeId: need(sub, "camera or Frame ID"),
      width: finite(values.width, 1024),
      nodeIds: values.targets?.split(","),
    });
  } else if (action === "render") {
    if (values.set && !sub)
      throw new Error("Pass a reference Frame or its camera with --set");
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
      lightingViewId: sub,
      setOnly: values.set,
      camera,
      nodeIds: values.targets?.split(","),
      passes: values.passes?.split(",") as
        ("color" | "depth" | "mask" | "ids")[] | undefined,
      referenceAssetId: values.reference,
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
      throw new Error("Supply at least one local file");
    const form = new FormData();
    for (const file of positionals.slice(1)) {
      const blob = Bun.file(file);
      if (!(await blob.exists()))
        throw new Error(`File does not exist: ${file}`);
      form.append("files", blob, path.basename(file));
    }
    output(
      await (await request("assets", { method: "POST", body: form })).json(),
    );
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
      if (values.headless) {
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
      if (values["reference-only"] && values.reconstruct)
        throw new Error("Choose either --reference-only or --reconstruct");
      output(
        await command({
          type: "assets.place",
          mode: values["reference-only"]
            ? "reference"
            : values.reconstruct
              ? "reconstruct"
              : "individual",
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
        ...(kind === "camera"
          ? { camera: workspace.settings.viewportCamera }
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
  } else if (action === "context" && sub === "guides") {
    if (rest.length !== 1 || !["on", "off"].includes(rest[0]))
      throw new Error("Use context guides on or off");
    output(
      await command({
        type: "workspace.update",
        settings: { display: frameGuideDisplay(rest[0] === "on") },
      }),
    );
  } else if (action === "context") {
    const workspace = await state();
    if (values.path && workspace.nodes[values.path]?.kind !== "path")
      throw new Error("Choose a camera path");
    const context = contextSettings(workspace, values.path);
    const frames = spatialContextFrames(workspace);
    if (!sub || sub === "list")
      output({
        ...context,
        order: frames.map((node) => node.id),
        captures: frames,
        activeIds: atlasContextNodes(workspace, undefined, values.path)
          .filter((frame) => captureFrameStatus(workspace, frame.id).frame)
          .map((frame) => frame.id),
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
            type: "edit.batch",
            commands: rest.map((id) => ({
              type: "nodes.patch",
              id,
              patch: { contextFrozen: sub === "freeze" },
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
      returnDepth: values.depth || undefined,
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
      const cameras: Workspace["settings"]["viewportCamera"][] = await (
        await request(`jobs/${encodeURIComponent(jobId)}/cameras`)
      ).json();
      const assetIds = frameAssets(workspace, job).map((asset) => asset.id);
      output(
        assetIds.map((assetId, position) => ({
          index:
            workspace.assets[assetId]?.frameIndex ??
            job.frameIndices?.[position] ??
            position,
          asset: workspace.assets[assetId],
          camera:
            cameras[
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
