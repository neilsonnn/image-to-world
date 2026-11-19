import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";
import { heroCamera, inspectionCamera, lighting, modules } from "./studio.mjs";
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { url: { type: "string" } },
});
if (!values.url || positionals.length !== 1)
  throw Error(
    "Usage: bun examples/canopy-studio/build.mjs REFERENCE.png --url http://127.0.0.1:PORT",
  );
const url = new URL(values.url);
if (
  url.protocol !== "http:" ||
  !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
)
  throw Error("Supply the loopback URL of a fresh local project.");
const temp = await mkdtemp(path.join(tmpdir(), "canopy-studio-"));
async function file(name, value) {
  const f = path.join(temp, name + ".json");
  await writeFile(f, JSON.stringify(value));
  return f;
}
async function cli(...args) {
  const p = Bun.spawn(
    [
      process.execPath,
      path.join(import.meta.dir, "../../cli/index.ts"),
      ...args,
      "--url",
      url.origin,
      "--actor",
      "Canopy Studio",
    ],
    { stdout: "pipe", stderr: "inherit" },
  );
  const result = await new Response(p.stdout).text();
  if (await p.exited) throw Error("Editor command failed: " + args[0]);
  return JSON.parse(result);
}
const state = await cli("state");
if (
  [state.assets, state.nodes, state.jobs].some(
    (data) => Object.keys(data).length,
  )
)
  throw Error("Open an empty project for this scene.");
await cli(
  "command",
  JSON.stringify({ type: "workspace.update", name: "Canopy Studio" }),
);
const [image] = await cli("import", path.resolve(positionals[0]));
const {
  nodeIds: [frame],
} = await cli(
  "scene",
  "place",
  image.id,
  "--reference-only",
  "--camera",
  await file("hero", heroCamera),
);
const placed = Object.values((await cli("state")).nodes);
const camera = placed.find((n) => n.parentId === frame && n.kind === "camera");
const points = placed.find((n) => n.parentId === frame && n.kind === "points");
const imagePlane = placed.find(
  (n) => n.parentId === camera.id && n.kind === "image",
);
await cli(
  "command",
  JSON.stringify({
    type: "edit.batch",
    commands: [
      {
        type: "nodes.transform",
        ids: [frame],
        transform: { position: [0, 0, 0] },
      },
      {
        type: "nodes.transform",
        ids: [camera.id, points.id],
        transform: { position: heroCamera.extrinsics.position },
      },
      ...[
        [frame, "Canopy Studio"],
        [camera.id, "Studio window · hero camera"],
        [imagePlane.id, "Original illustration"],
      ].map(([id, name]) => ({ type: "nodes.patch", id, patch: { name } })),
    ],
  }),
);
await cli("lighting", "--file", await file("lighting", lighting));
for (const [source, name, seed, params] of modules) {
  await cli(
    "module",
    "add",
    path.join(import.meta.dir, source + ".mjs"),
    "--parent",
    frame,
    "--name",
    name,
    "--seed",
    String(seed),
    "--file",
    await file(source, params),
  );
}
await inspectionCamera(cli, frame);
await cli("camera", "view", camera.id);
console.log(
  JSON.stringify(
    { frame, hero: camera.id, oblique: "canopy-oblique", reference: image.id },
    null,
    2,
  ),
);
