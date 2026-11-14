import { inspectScene, inspectionSchema } from "../../../core/inspection";
import path from "node:path";
import { CommandService } from "./commands";
import { cameraSchema } from "../../../core/schema";
import { JobRunner } from "./jobs";
import { WorkspaceStore } from "./store";
import { ffmpegPath } from "./video";
import { environmentValue, environmentStatus } from "./environment";

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
          { error: "worldbash serves loopback requests only" },
          { status: 403 },
        );
      if (origin && origin !== url.origin)
        return Response.json(
          { error: "Cross-origin requests are not allowed" },
          { status: 403 },
        );
      if (
        request.method !== "GET" &&
        !request.headers.get("x-worldbash-client")
      )
        return Response.json(
          { error: "X-Worldbash-Client header is required" },
          { status: 403 },
        );
      try {
        const route = url.pathname.replace(/^\/api\/?/, "");
        if (request.method === "GET" && route === "workspace")
          return Response.json(store.snapshot());
        if (request.method === "GET" && route === "scene/inspect") {
          const ids = url.searchParams.getAll("nodeId");
          return Response.json(
            inspectScene(store.snapshot(), ids.length ? ids : undefined),
          );
        }
        if (request.method === "GET" && route === "status")
          return Response.json({
            application: "worldbash",
            workspacePath: store.root,
            worldLabsConfigured: !!environmentValue("WLT_API_KEY"),
            falConfigured: !!environmentValue("FAL_KEY"),
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
              send("change", { revision: store.snapshot().revision });
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
          return Response.json(await commands.execute(await request.json()));
        }
        if (request.method === "GET" && route.startsWith("assets/")) {
          const id = decodeURIComponent(route.slice(7));
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
          return Response.json(assets);
        }
        const capture = /^viewport-jobs\/([^/]+)(?:\/(claim|fail))?$/.exec(
          route,
        );
        if (request.method === "POST" && capture) {
          const [, id, action] = capture;
          const job = store.snapshot().jobs[id];
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
            await store.update((state) => {
              if (state.jobs[id].status === "cancelled") return;
              state.jobs[id].status = "running";
              state.jobs[id].message =
                job.input.kind === "inspect"
                  ? "Inspecting scene"
                  : "Capturing viewport";
              state.jobs[id].updatedAt = Date.now();
            });
            return Response.json({ claimed: true });
          }
          if (action === "fail") {
            const { error } = (await request.json()) as { error: string };
            claims.delete(id);
            await store.update((state) => {
              if (state.jobs[id].status === "cancelled") return;
              state.jobs[id].status = "failed";
              state.jobs[id].error = String(error);
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
            await store.update((state) => {
              if (state.jobs[id].status === "cancelled") return;
              Object.assign(state.jobs[id], {
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
          await store.update((state) => {
            if (state.jobs[id].status === "cancelled") return;
            Object.assign(state.jobs[id], {
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
          { status: 400 },
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
  worldbashService?: ReturnType<typeof createService>;
  worldbashClosing?: Promise<void>;
};
export function service() {
  singleton.worldbashService ??= (async () => {
    await singleton.worldbashClosing;
    return createService(
      process.env.WORLDBASH_WORKSPACE ||
        path.resolve(process.cwd(), "../.worldbash"),
    );
  })();
  return singleton.worldbashService;
}
export async function handleRequest(request: Request) {
  return (await service()).handle(request);
}

if (import.meta.hot)
  import.meta.hot.dispose(() => {
    singleton.worldbashClosing = singleton.worldbashService?.then((instance) =>
      instance.close(),
    );
    singleton.worldbashService = undefined;
  });
