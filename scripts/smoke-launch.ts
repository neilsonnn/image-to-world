import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Exercise the normal launcher in a fresh project without touching user config.
const directory = await mkdtemp(path.join(tmpdir(), "image-to-world-launch-"));
const probe = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: () => new Response(),
});
const port = probe.port;
await probe.stop(true);
const project = path.join(directory, "project");
const child = Bun.spawn(
  [
    process.execPath,
    "cli/index.ts",
    "open",
    project,
    "--port",
    String(port),
    "--no-browser",
  ],
  {
    cwd: path.resolve(import.meta.dir, ".."),
    env: {
      ...process.env,
      XDG_CONFIG_HOME: path.join(directory, "config"),
      WLT_API_KEY: "",
      FAL_KEY: "",
    },
    stdout: "inherit",
    stderr: "inherit",
  },
);
try {
  const deadline = Date.now() + 180_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`Launcher exited: ${child.exitCode}`);
    const response = await fetch(`http://127.0.0.1:${port}/api/status`, {
      signal: AbortSignal.timeout(1000),
    }).catch(() => null);
    if (response?.ok) {
      const status = await response.json();
      if (
        status.application !== "image-to-world" ||
        status.worldLabsConfigured ||
        status.falConfigured
      )
        throw new Error("Expected image-to-world without provider credentials");
      const page = await fetch(`http://127.0.0.1:${port}/`);
      if (!page.ok || !(await page.text()).includes("image-to-world"))
        throw new Error("Editor page did not load");
      ready = true;
      break;
    }
    await Bun.sleep(200);
  }
  if (!ready)
    throw new Error("Launcher did not become ready within three minutes");
  console.log(
    "Fresh project launch and editor page passed without provider credentials.",
  );
} finally {
  child.kill("SIGTERM");
  await child.exited;
  await rm(directory, { recursive: true, force: true });
}
