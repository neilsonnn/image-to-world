#!/usr/bin/env bun
import { doctor, openProject } from "./launch";
import { collectionMatches } from "../core/collections";
import { frameAssets } from "../core/frames";
import {
  atlasContext,
  orderedCaptures,
  contextSettings,
} from "../core/captures";
import path from "node:path";
import { parseArgs } from "node:util";
import { zodToJsonSchema } from "zod-to-json-schema";
import { moveNodes } from "../core/scene";
import { imageHistory } from "../core/history";
import {
  cameraSchema,
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

const HELP = `worldbash controls the same filesystem workspace as the browser.

  bun run worldbash open [project] [--port 4310] [--no-browser]  Build and launch locally
  bun run worldbash doctor [project]                Check local setup without API requests
  bun run worldbash schema commands|workspace|draft|camera  JSON Schema for agents
  bun run worldbash status                         Provider configuration and workspace path
  bun run worldbash state                          Full workspace JSON
  bun run worldbash import <file>...                Import binary files
  bun run worldbash assets [--trash] [--search text] List assets
  bun run worldbash assets trash|restore <asset-id>...
  bun run worldbash assets reveal <asset-id>
  bun run worldbash image open <asset-id>           Open an image in the bottom editor
  bun run worldbash image activate <asset-id> [node-id...]  Use this version in scene captures
  bun run worldbash image history <asset-id>        Branching assets, prompts, and jobs
  bun run worldbash image edit <asset-id> --prompt '...' [--reference id,id]
                   [--model 2|pro] [--resolution 1K|2K|4K] [--ratio auto|16:9]
                   [--count 1] [--seed 42] [--draft draft.json]
  bun run worldbash image draft <asset-id> --file draft.json
  bun run worldbash image undo|redo <asset-id>       Undo/redo this image's draft
  bun run worldbash export <asset-id> <file>        Write binary output to a local file
  bun run worldbash scene                          List scene objects
  bun run worldbash scene add image --asset <id> [--name 'Image'] [--parent id]
  bun run worldbash scene add camera|group|path|clip [--name '...'] [--parent id]
  bun run worldbash scene put --file nodes.json    Create/update complete node records
  bun run worldbash scene transform <id>... [--position x,y,z] [--scale x,y,z]
                   [--quaternion x,y,z,w] [--parent id|root]
  bun run worldbash scene move <id>... --parent <id|root> [--before <sibling-id>]
  bun run worldbash scene duplicate <id>...
  bun run worldbash undo|redo                     Undo/redo scene, camera, display, or property edits
  bun run worldbash scene remove <id>...           Remove objects and their descendants
  bun run worldbash select <id>...                 Select any mixture of assets and nodes
  bun run worldbash camera [--file camera.json]    Read/set viewport camera
  bun run worldbash path update <path-id> [--fov 60] [--target-frames 36]
  bun run worldbash path keyframe <path-id> [--index 0] [--file camera.json] [--id keyframe-id] [--remove]
  bun run worldbash scene place <asset-id>... [--camera camera.json] [--reconstruct]  Place images individually or reconstruct together
  bun run worldbash camera place [--file camera.json]  Place a camera and extend selection (viewport C)
  bun run worldbash camera view <node-id> | camera free
  bun run worldbash context [list|include|exclude|solo|show|hide|order] <capture-id>...
  bun run worldbash path create <camera-id>... [--target-frames 36]
  bun run worldbash pose <asset-id>... [--camera camera.json]
  bun run worldbash atlas [--camera camera.json] [--path path-id] [--prompt '...']
  bun run worldbash splats [capture-id...] [--path path-id] [--prompt '...'] [--refine]
                   Reconstruct splats from posed captures (draft unless --refine)
  bun run worldbash video [--path path-id] [--fps 12] [--target-frames 36]
                   [--keyframes count] [--source-job job-id]
  bun run worldbash video frames <job-id>
  bun run worldbash video view <job-id> <frame-index>
  bun run worldbash video integrate <job-id> [--indices 0,4,8]
  bun run worldbash video reconstruct <job-id> [--indices 0,4,8]
  bun run worldbash reconstruct <asset-id>... [--video video-asset-id]
                   [--fps 1] [--max-frames 60]
  bun run worldbash fal <endpoint> --file input.json  Asset input: {"$asset":"asset-id"}
  bun run worldbash capture [--camera camera.json]   Requires an open browser viewport
  bun run worldbash jobs [show|wait|cancel|retry] [job-id] [--timeout 300]
  bun run worldbash command '<JSON>'|@file.json    Every UI command, including panel/settings changes
  bun run worldbash events                        Stream workspace revisions as JSON lines

All responses are JSON. Errors use stderr and exit 1. Generation returns a job ID
immediately; --wait waits for completion. --url defaults to http://127.0.0.1:4310
(or WORLDBASH_URL). No API credentials are needed by the CLI.
`;

export async function run(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
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
    process.env.WORLDBASH_URL ||
    "http://127.0.0.1:4310"
  ).replace(/\/$/, "");
  const output = (value: unknown) =>
    process.stdout.write(JSON.stringify(value, null, 2) + "\n");
  const request = async (route: string, init?: RequestInit) => {
    const response = await fetch(`${base}/api/${route}`, {
      ...init,
      headers: { "X-Worldbash-Client": "cli", ...init?.headers },
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
  const wait = async (id: string) => {
    const deadline = Date.now() + finite(values.timeout, 300) * 1000;
    for (;;) {
      const job = (await state()).jobs[id];
      if (!job) throw new Error(`Unknown job ${id}`);
      if (job.status === "succeeded") return job;
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
  } else if (action === "schema") {
    const schemas = {
      commands: commandSchema,
      workspace: workspaceSchema,
      draft: imageDraftSchema,
      camera: cameraSchema,
    };
    const schema = schemas[sub as keyof typeof schemas];
    if (!schema)
      throw new Error("Choose schema commands, workspace, draft, or camera");
    output(zodToJsonSchema(schema));
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
        model:
          values.model === "pro"
            ? "fal-ai/nano-banana-pro/edit"
            : values.model === "2" || !values.model
              ? "fal-ai/nano-banana-2/edit"
              : values.model,
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
        applyToScene: true,
        reconstruct: !values["no-reconstruct"],
        ...(values.draft
          ? { draft: imageDraftSchema.parse(await jsonFile(values.draft)) }
          : {}),
      });
    } else throw new Error("Use image open, activate, history, draft, or edit");
  } else if (action === "select")
    output(await command({ type: "selection.set", ids: positionals.slice(1) }));
  else if (action === "camera") {
    if (sub === "place")
      output(
        await command({
          type: "camera.place",
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
    else if (sub === "place") {
      output(
        await command({
          type: "assets.place",
          mode: values.reconstruct ? "reconstruct" : "individual",
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
      const base = values.parent
        ? moveNodes(workspace.nodes, rest, parentId!)
        : workspace.nodes;
      const nodes = rest.map((id) => {
        const node = structuredClone(base[id]);
        if (!node) throw new Error(`Unknown node ${id}`);
        for (const key of ["position", "scale", "quaternion"] as const)
          if (values[key])
            Object.assign(node.transform, {
              [key]: values[key]!.split(",").map(Number),
            });
        return node;
      });
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
            { type: "nodes.put", nodes },
          ],
        }),
      );
    } else
      throw new Error(
        "Use scene add, put, move, duplicate, transform, or remove",
      );
  } else if (action === "context") {
    const workspace = await state();
    if (values.path && workspace.nodes[values.path]?.kind !== "path")
      throw new Error("Choose a camera path");
    const context = contextSettings(workspace, values.path);
    if (!sub || sub === "list")
      output({
        captures: orderedCaptures(workspace, values.path),
        activeIds: atlasContext(workspace, undefined, values.path).map(
          (frame) => frame.node.id,
        ),
        ...context,
      });
    else {
      const captures = orderedCaptures(workspace);
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
      else {
        const patch =
          sub === "solo"
            ? { soloIds: rest }
            : sub === "order"
              ? { order: rest }
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
            "Use context list, include, exclude, solo, show, hide, or order",
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
    await submit({
      kind: "fal",
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
