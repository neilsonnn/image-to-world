import { chromium, type Browser, type Page } from "playwright-core";
import path from "node:path";
import { existsSync } from "node:fs";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import type { Asset, Job, Workspace } from "../../../core/schema";
import type { WorkspaceStore } from "./store";
import { encodeDepth } from "./depth";
import { environmentValue } from "./environment";

export function rendererExecutable() {
  return [
    environmentValue("CHROMIUM_PATH"),
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    process.env.LOCALAPPDATA &&
      path.join(
        process.env.LOCALAPPDATA,
        "Google/Chrome/Application/chrome.exe",
      ),
  ].find((p): p is string => !!p && existsSync(p));
}

type RenderResult = {
  outputs: Record<string, string>;
  report: unknown;
  ids: Record<string, string>;
  camera: unknown;
  near: number;
  far: number;
  revision: number;
};
export class RenderWorker {
  private browser?: Browser;
  private page?: Page;
  private server?: ReturnType<typeof Bun.serve>;
  private active?: Job;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private store: WorkspaceStore) {}
  private async init() {
    if (this.page && !this.page.isClosed()) return;
    await this.browser?.close();
    await this.server?.stop(true);
    const executablePath = rendererExecutable();
    if (!executablePath)
      throw new Error(
        "Install Chrome/Chromium or set CHROMIUM_PATH for independent rendering. Startup never downloads a browser.",
      );
    const bundle = [
      path.resolve("web/public/render-worker.js"),
      path.resolve("public/render-worker.js"),
      path.resolve("dist/client/render-worker.js"),
    ].find(existsSync);
    if (!bundle) throw new Error("Renderer bundle missing; run bun run build");
    this.server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (request) => {
        const url = new URL(request.url);
        if (url.pathname === "/render-worker.js")
          return new Response(Bun.file(bundle));
        if (url.pathname.startsWith("/api/assets/") && this.active) {
          const id = decodeURIComponent(url.pathname.slice(12));
          if (!this.active.pinnedAssets?.[id])
            return new Response("Asset not in render snapshot", {
              status: 404,
            });
          return this.store.withJobAssets(this.active, async () => {
            const { asset, file } = await this.store.assetFile(id);
            return new Response(Bun.file(file), {
              headers: { "Content-Type": asset.mimeType },
            });
          });
        }
        if (url.pathname === "/")
          return new Response(
            '<!doctype html><html><body><script type="module" src="/render-worker.js"></script></body></html>',
            { headers: { "Content-Type": "text/html" } },
          );
        return new Response("Not found", { status: 404 });
      },
    });
    this.browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
    });
    this.page = await this.browser.newPage();
    await this.page.route("**/*", (route) => {
      const url = route.request().url();
      return url.startsWith(String(this.server!.url)) ||
        url.startsWith("blob:") ||
        url.startsWith("data:")
        ? route.continue()
        : route.abort();
    });
    await this.page.goto(String(this.server.url));
    await this.page.waitForFunction(
      () => "imageToWorldRender" in globalThis,
      {},
      { timeout: 30000 },
    );
  }
  render(job: Job, signal: AbortSignal): Promise<Asset[]> {
    const task = this.tail.then(() => this.run(job, signal));
    this.tail = task.catch(() => {});
    return task;
  }
  private async run(job: Job, signal: AbortSignal) {
    if (job.input.kind !== "render")
      throw new Error("Expected a render request");
    const input = job.input;
    if (
      input.integrate &&
      (input.presentation ||
        !input.passes.includes("color") ||
        !input.passes.includes("depth"))
    )
      throw new Error(
        "RGBD capture requires color and depth passes without presentation effects",
      );
    if (
      input.camera.intrinsics.width * input.camera.intrinsics.height >
        16_000_000 ||
      input.far <= input.near
    )
      throw new Error("Invalid render size or clipping planes");
    signal.throwIfAborted();
    await this.init();
    this.active = job;
    if (job.snapshotRevision === undefined || !job.contextSnapshot)
      throw new Error("Render requires a frozen scene snapshot");
    const snapshot = {
      ...this.store.snapshot(),
      ...job.contextSnapshot,
      revision: job.snapshotRevision,
    } as Workspace;
    const abort = () => {
      void this.page?.close();
      this.page = undefined;
    };
    signal.addEventListener("abort", abort, { once: true });
    const renderTimeout = setTimeout(abort, 60000);
    try {
      const result = await this.page!.evaluate(
        async ({ workspace, input }) => {
          return (
            globalThis as unknown as {
              imageToWorldRender: (
                w: unknown,
                i: unknown,
              ) => Promise<RenderResult>;
            }
          ).imageToWorldRender(workspace, input);
        },
        { workspace: snapshot, input },
      );
      signal.throwIfAborted();
      const outputs: Asset[] = [];
      for (const [pass, data] of Object.entries(result.outputs)) {
        let blob = new Blob([Buffer.from(data, "base64")], {
          type:
            pass === "mesh"
              ? "model/gltf-binary"
              : pass === "splats"
                ? "application/octet-stream"
                : "image/png",
        });
        if (pass === "depth") {
          const { width, height } = input.camera.intrinsics;
          const pixels = Buffer.from(data, "base64");
          const depths = new Float32Array(width * height);
          if (pixels.length !== depths.length * 4)
            throw new Error("Invalid depth render buffer");
          for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++) {
              const at = ((height - 1 - y) * width + x) * 4;
              const r = pixels[at],
                g = pixels[at + 1],
                b = pixels[at + 2],
                a = pixels[at + 3];
              const d =
                r / 256 + g / 65536 + b / 16777216 + a / (255 * 16777216);
              depths[y * width + x] =
                r === 0 && g === 0 && b === 0 && a === 0
                  ? NaN
                  : (input.near * input.far) /
                    (input.far - d * (input.far - input.near));
            }
          blob = await encodeDepth({ data: depths, width, height, stride: 1 });
        }
        outputs.push(
          await this.store.importFile(
            blob,
            `${job.id}-${pass}.${pass === "depth" ? "exr" : pass === "mesh" ? "glb" : pass === "splats" ? "ply" : "png"}`,
            {
              jobId: job.id,
              role:
                pass === "mesh"
                  ? "mesh"
                  : pass === "depth"
                    ? "depth"
                    : pass === "mask"
                      ? "mask"
                      : "render",
              camera: input.camera,
            },
          ),
        );
      }
      if (input.referenceAssetId && result.outputs.color) {
        const { file } = await this.store.assetFile(input.referenceAssetId);
        const ref = await loadImage(file),
          render = await loadImage(Buffer.from(result.outputs.color, "base64"));
        const canvas = createCanvas(render.width * 2, render.height),
          ctx = canvas.getContext("2d");
        ctx.drawImage(ref, 0, 0, render.width, render.height);
        ctx.drawImage(render, render.width, 0);
        outputs.push(
          await this.store.importFile(
            new Blob([new Uint8Array(canvas.toBuffer("image/png"))], {
              type: "image/png",
            }),
            `${job.id}-comparison.png`,
            { jobId: job.id, role: "render" },
          ),
        );
      }
      if (input.referenceAssetId && result.outputs.color) {
        const { file } = await this.store.assetFile(input.referenceAssetId);
        const ref = await loadImage(file),
          render = await loadImage(Buffer.from(result.outputs.color, "base64"));
        const canvas = createCanvas(render.width, render.height),
          ctx = canvas.getContext("2d");
        ctx.drawImage(ref, 0, 0, render.width, render.height);
        ctx.globalAlpha = 0.65;
        ctx.drawImage(render, 0, 0);
        outputs.push(
          await this.store.importFile(
            new Blob([new Uint8Array(canvas.toBuffer("image/png"))], {
              type: "image/png",
            }),
            `${job.id}-overlay.png`,
            { jobId: job.id, role: "render" },
          ),
        );
      }
      const { outputs: _pixels, ...manifest } = result;
      outputs.push(
        await this.store.importFile(
          new Blob(
            [
              JSON.stringify(
                {
                  ...manifest,
                  outputAssetIds: outputs.map((a) => a.id),
                  depthConvention:
                    "positive camera-forward scene units; top-left pixels; 0 invalid",
                },
                null,
                2,
              ),
            ],
            { type: "application/json" },
          ),
          `${job.id}-render.json`,
          { jobId: job.id, role: "raw-result" },
        ),
      );
      return outputs;
    } finally {
      clearTimeout(renderTimeout);
      signal.removeEventListener("abort", abort);
      this.active = undefined;
    }
  }
  async close() {
    await this.tail;
    await this.browser?.close();
    await this.server?.stop(true);
  }
}
