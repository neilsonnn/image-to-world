import { stat } from "node:fs/promises";
import path from "node:path";

const port = Number(process.env.PORT || 4310);
const clientRoot = path.resolve(import.meta.dir, "dist/client");
const entryPath = path.resolve(import.meta.dir, "dist/server/server.js");
const { default: app } = await import(entryPath);
const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  idleTimeout: 60,
  async fetch(request) {
    const url = new URL(request.url);
    const requested = path.resolve(
      clientRoot,
      "." + decodeURIComponent(url.pathname),
    );
    if (requested.startsWith(clientRoot + path.sep)) {
      try {
        if ((await stat(requested)).isFile())
          return new Response(Bun.file(requested));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return app.fetch(request);
  },
});
console.info(`worldbash is running at ${server.url}`);

let closing = false;
async function stop() {
  if (closing) return;
  closing = true;
  await server.stop(true);
  const runtime = globalThis as typeof globalThis & {
    worldbashService?: Promise<{ close(): Promise<void> }>;
  };
  await (await runtime.worldbashService)?.close();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
