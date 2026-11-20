import { playerResponse } from "./player-export";
import { modelSuggestions } from "../../../core/models";
import { rendererExecutable } from "./render-worker";
import { inspectScene, inspectionSchema } from "../../../core/inspection";
import path from "node:path";
import { CommandService } from "./commands";
import { cameraSchema } from "../../../core/schema";
import { JobRunner } from "./jobs";
import { WorkspaceStore } from "./store";
import { ffmpegPath } from "./video";
import { environmentValue, environmentStatus } from "./environment";
import {
  commandContextSchema,
  CommandConflict,
} from "../../../core/command-context";

export async function createService(root: string) {
  const store = await new WorkspaceStore(root).init();
  const jobs = new JobRunner(store);
  await jobs.init();
  const commands = new CommandService(store, jobs);
  const claims = new Map<string, number>();
  return {
    store,
    jobs,
    async handle(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const origin = request.headers.get("origin");
      const host = request.headers.get("host")?.split(":")[0];
      if (host && !["127.0.0.1", "localhost"].includes(host))
        return Response.json(
          { error: "image-to-world serves loopback requests only" },
          { status: 403 },
        );
      if (origin && origin !== url.origin)
        return Response.json(
          { error: "Cross-origin requests are not allowed" },
          { status: 403 },
        );
      if (
        request.method !== "GET" &&
        !request.headers.get("x-image-to-world-client")
      )
        return Response.json(
          { error: "X-Image-To-World-Client header is required" },
          { status: 403 },
        );
      try {
        const route = url.pathname.replace(/^\/api\/?/, "");
        const playerAsset =
          /^player\/assets\/([A-Za-z0-9_-]+)\/[A-Za-z0-9_.-]+$/.exec(route);
        if (
          request.method === "GET" &&
          route.startsWith("player/") &&
          !playerAsset
        )
          return await playerResponse(route, store);
        if (request.method === "GET" && route === "models") {
          const query = url.searchParams.get("q"),
            endpoint = url.searchParams.get("endpoint");
          if (!query && !endpoint)
            return Response.json({
              suggestions: modelSuggestions,
              provider: "fal",
              assetReference: { $asset: "asset-id" },
              discovery: "models?endpoint=... or models?q=...",
            });
          const key = environmentValue("FAL_KEY");
          if (!key)
            throw new Error("Configure FAL_KEY for live model discovery");
          const search = new URL("https://api.fal.ai/v1/models");
          if (endpoint) {
            search.searchParams.set("endpoint_id", endpoint);
            search.searchParams.set("expand", "openapi-3.0");
          }
          if (query) search.searchParams.set("q", query);
          const response = await fetch(search, {
            headers: { Authorization: `Key ${key}` },
            signal: AbortSignal.timeout(30000),
          });
          if (!response.ok)
            throw new Error(
              `Model discovery failed (${response.status}); raw endpoint calls remain available`,
            );
          return Response.json(await response.json());
        }
        const cameras = /^jobs\/([a-zA-Z0-9_-]+)\/cameras$/.exec(route);
        if (request.method === "GET" && cameras)
          return Response.json((await store.loadJob(cameras[1])).cameras ?? []);
        if (request.method === "GET" && route === "workspace")
          return Response.json(store.liveSnapshot(), {
            headers: { "X-Workspace-Stream": store.streamId },
          });
        if (request.method === "GET" && route === "activity")
          return Response.json(
            store.activitySnapshot(Number(url.searchParams.get("after") ?? 0)),
          );
        if (request.method === "GET" && route === "scene/inspect") {
          const ids = url.searchParams.getAll("nodeId");
          return Response.json(
            inspectScene(store.snapshot(), ids.length ? ids : undefined),
          );
        }
        if (request.method === "GET" && route === "status")
          return Response.json({
            application: "image-to-world",
            workspacePath: store.root,
            worldLabsConfigured: !!environmentValue("WLT_API_KEY"),
            falConfigured: !!environmentValue("FAL_KEY"),
            rendererAvailable: !!rendererExecutable(),
            ffmpegAvailable: !!ffmpegPath(),
            environment: environmentStatus(),
          });
        if (request.method === "GET" && route === "events") {
          const encoder = new TextEncoder();
          let dispose: () => void = () => {};
          const stream = new ReadableStream({
            start(controller) {
              const send = (event: string, value: unknown) =>
                controller.enqueue(
                  encoder.encode(
                    `event: ${event}\ndata: ${JSON.stringify(value)}\n\n`,
                  ),
                );
              const unsubscribe = store.subscribe(send);
              const timer = setInterval(
                () => controller.enqueue(encoder.encode(": keepalive\n\n")),
                15000,
              );
              dispose = () => {
                clearInterval(timer);
                unsubscribe();
                request.signal.removeEventListener("abort", abort);
              };
              const abort = () => {
                dispose();
                try {
                  controller.close();
                } catch {}
              };
              request.signal.addEventListener("abort", abort, { once: true });
              send("change", {
                stream: store.streamId,
                revision: store.revision,
              });
              if (store.lastOperation) send("operation", store.lastOperation);
              send("activity-history", store.activitySnapshot());
            },
            cancel() {
              dispose();
            },
          });
          return new Response(stream, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            },
          });
        }
        if (request.method === "POST" && route === "commands") {
          const context = commandContextSchema.parse({
            ...JSON.parse(
              request.headers.get("X-Image-To-World-Context") ?? "{}",
            ),
            interactive:
              request.headers.get("X-Image-To-World-Client") === "web",
          });
          return Response.json(
            await commands.execute(await request.json(), context),
          );
        }
        if (
          request.method === "GET" &&
          (route.startsWith("assets/") || playerAsset)
        ) {
          const id = playerAsset
            ? Buffer.from(playerAsset[1], "base64url").toString("utf8")
            : decodeURIComponent(route.slice(7));
          const { asset, file } = await store.assetFile(id, {
            includeTrashed: true,
          });
          const headers: Record<string, string> = {
            "Content-Type": asset.mimeType,
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "no-cache",
          };
          if (!["image", "video", "depth"].includes(asset.kind))
            headers["Content-Disposition"] = "attachment";
          const blob = Bun.file(file);
          const range = request.headers.get("range");
          if (range) {
            const match = /^bytes=(\d*)-(\d*)$/.exec(range);
            if (!match) return new Response(null, { status: 416 });
            const start = match[1]
              ? Number(match[1])
              : Math.max(0, blob.size - Number(match[2]));
            const end =
              match[1] && match[2]
                ? Math.min(Number(match[2]), blob.size - 1)
                : blob.size - 1;
            if (start > end || start >= blob.size)
              return new Response(null, {
                status: 416,
                headers: { "Content-Range": `bytes */${blob.size}` },
              });
            return new Response(blob.slice(start, end + 1), {
              status: 206,
              headers: {
                ...headers,
                "Content-Range": `bytes ${start}-${end}/${blob.size}`,
                "Accept-Ranges": "bytes",
              },
            });
          }
          return new Response(blob, {
            headers: { ...headers, "Accept-Ranges": "bytes" },
          });
        }
        if (request.method === "POST" && route === "assets") {
          const form = await request.formData();
          const files = form.getAll("files");
          if (!files.length || files.some((file) => !(file instanceof File)))
            throw new Error('Supply files in multipart field "files"');
          const assets = [];
          for (const file of files as File[])
            assets.push(await store.importFile(file, file.name));
          return Response.json(assets, {
            headers: { "X-Workspace-Revision": String(store.revision) },
          });
        }
        const capture = /^viewport-jobs\/([^/]+)(?:\/(claim|fail))?$/.exec(
          route,
        );
        if (request.method === "POST" && capture) {
          const [, id, action] = capture;
          const job = store.current.jobs[id];
          if (
            !job ||
            !["capture", "inspect"].includes(job.input.kind) ||
            !["queued", "running"].includes(job.status)
          )
            throw new Error("Capture job is not active");
          if (action === "claim") {
            if (
              (claims.get(id) ??
                (job.status === "running" ? job.updatedAt + 60000 : 0)) >
              Date.now()
            )
              return Response.json({ claimed: false });
            claims.set(id, Date.now() + 60000);
            await store.updateJob(id, (current) => {
              if (current.status === "cancelled") return;
              current.status = "running";
              current.message =
                job.input.kind === "inspect"
                  ? "Inspecting scene"
                  : "Capturing viewport";
              current.updatedAt = Date.now();
            });
            return Response.json({ claimed: true });
          }
          if (action === "fail") {
            const { error } = (await request.json()) as { error: string };
            claims.delete(id);
            await store.updateJob(id, (current) => {
              if (current.status === "cancelled") return;
              current.status = "failed";
              current.error = String(error);
            });
            return Response.json({ ok: true });
          }
          const form = await request.formData();
          const file = form.get("files");
          if (job.input.kind === "inspect") {
            if (
              !(file instanceof File) ||
              file.type.split(";")[0] !== "application/json"
            )
              throw new Error("Inspection must be JSON");
            const report = inspectionSchema.parse(
              JSON.parse(await file.text()),
            );
            if (report.source !== "viewport")
              throw new Error("Expected a viewport inspection");
            const asset = await store.importFile(
              new Blob([JSON.stringify(report, null, 2)], {
                type: "application/json",
              }),
              `${id}-inspection.json`,
              { jobId: id, name: "Scene inspection" },
            );
            await store.updateJob(id, (current) => {
              if (current.status === "cancelled") return;
              Object.assign(current, {
                status: "succeeded",
                outputAssetIds: [asset.id],
                message: "Saved scene inspection",
                updatedAt: Date.now(),
              });
            });
            claims.delete(id);
            return Response.json(asset);
          }
          if (!(file instanceof File) || file.type !== "image/png")
            throw new Error("Capture must be a PNG file");
          const camera = cameraSchema.parse(
            JSON.parse(String(form.get("camera"))),
          );
          const asset = await store.importFile(file, `${id}-capture.png`, {
            camera,
            jobId: id,
            name: "Viewport image",
          });
          await store.updateJob(id, (current) => {
            if (current.status === "cancelled") return;
            Object.assign(current, {
              status: "succeeded",
              outputAssetIds: [asset.id],
              message: "Saved viewport image",
              updatedAt: Date.now(),
            });
          });
          claims.delete(id);
          return Response.json(asset);
        }
        return Response.json({ error: "Route not found" }, { status: 404 });
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : String(error) },
          { status: error instanceof CommandConflict ? 409 : 400 },
        );
      }
    },
    async close() {
      await jobs.close();
      await store.close();
    },
  };
}
const singleton = globalThis as typeof globalThis & {
  imageToWorldService?: ReturnType<typeof createService>;
  imageToWorldClosing?: Promise<void>;
};
export function service() {
  singleton.imageToWorldService ??= (async () => {
    await singleton.imageToWorldClosing;
    return createService(
      process.env.IMAGE_TO_WORLD_WORKSPACE ||
        path.resolve(process.cwd(), "../.image-to-world"),
    );
  })();
  return singleton.imageToWorldService;
}
export async function handleRequest(request: Request) {
  return (await service()).handle(request);
}

if (import.meta.hot)
  import.meta.hot.dispose(() => {
    singleton.imageToWorldClosing = singleton.imageToWorldService?.then(
      (instance) => instance.close(),
    );
    singleton.imageToWorldService = undefined;
  });
