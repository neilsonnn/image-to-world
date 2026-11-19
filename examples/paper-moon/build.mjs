// Run with Bun from any directory. Only the specified, empty editor project is eligible.
import path from "node:path";
import { mkdir, realpath } from "node:fs/promises";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { buildRoomMeshes, projection } from "./meshes.mjs";
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { url: { type: "string" }, out: { type: "string" } },
});
if (positionals.length !== 1 || !values.url || !values.out)
  throw new Error(
    "Usage: bun examples/paper-moon/build.mjs SOURCE.png --url http://127.0.0.1:PORT --out NEW_OUTPUT_DIRECTORY",
  );
const url = new URL(values.url),
  input = await realpath(positionals[0]),
  out = path.resolve(values.out);
if (
  url.protocol !== "http:" ||
  !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
)
  throw new Error("Use a loopback image-to-world server.");
const expected =
  "c3238fe6c137fa2dd001e6cfb7d99d2f521a0bcd746965e5f8cebdb352577455";
if (
  createHash("sha256")
    .update(
      await Bun.file(input)
        .arrayBuffer()
        .then((a) => new Uint8Array(a)),
    )
    .digest("hex") !== expected
)
  throw new Error(
    "This hand-authored eval requires the original anime-room-3 PNG.",
  );
const cliPath = path.resolve(import.meta.dir, "../../cli/index.ts");
async function cli(...args) {
  const proc = Bun.spawn(
    [
      process.execPath,
      cliPath,
      ...args,
      "--url",
      url.origin,
      "--actor",
      "Paper Moon builder",
    ],
    { stdout: "pipe", stderr: "inherit" },
  );
  const output = await new Response(proc.stdout).text();
  if (await proc.exited) throw Error("CLI failed: " + args[0]);
  return JSON.parse(output);
}
const w = await cli("state");
if (
  Object.keys(w.nodes).length ||
  Object.keys(w.assets).length ||
  Object.keys(w.jobs).length
)
  throw Error("Open a fresh empty project before running this eval.");
await mkdir(out);
const { placements, depth } = await buildRoomMeshes(input, out);
const command = (c) => cli("command", JSON.stringify(c)),
  ident = (position = [0, 0, 0]) => ({
    position,
    quaternion: [0, 0, 0, 1],
    scale: [1, 1, 1],
  });
const src = (await cli("import", input))[0],
  dep = (await cli("import", depth))[0];
await command({
  type: "assets.update",
  id: src.id,
  patch: {
    name: "Paper Moon · original painted reference",
    depthAssetId: dep.id,
    depthEncoding: { type: "linear" },
    camera: {
      extrinsics: {
        position: [0, 0, 0],
        quaternion: [0, 0, 0, 1],
        coordinateSystem: "rub",
      },
      intrinsics: projection,
    },
  },
});
const frame = "attic-frame",
  camera = "attic-camera";
const node = (id, name, kind, parentId, extra = {}) => ({
  id,
  name,
  kind,
  parentId,
  visible: true,
  transform: ident(),
  ...extra,
});
await command({
  type: "nodes.put",
  nodes: [
    node(frame, "Paper Moon · attic bedroom", "capture", null, {
      lighting: {
        fillColor: "#c7d6ff",
        fillIntensity: 1.55,
        keyColor: "#ffe0b5",
        keyIntensity: 2.65,
        azimuth: 63,
        elevation: 36,
        background: "#171c28",
      },
      assetId: src.id,
    }),
    node(camera, "Illustration camera", "camera", frame, {
      projection,
      transform: ident([0, 1.58, 0]),
    }),
    node("attic-print", "Original · toggle to compare", "image", camera, {
      assetId: src.id,
      projection,
      visible: false,
    }),
    node("attic-points", "Authored depth study", "points", frame, {
      assetId: src.id,
      transform: ident([0, 1.58, 0]),
      visible: false,
    }),
  ],
});
for (const obj of placements) {
  const asset = (await cli("import", obj.file))[0];
  await command({
    type: "nodes.put",
    nodes: [
      node(obj.id, obj.name, "mesh", frame, {
        assetId: asset.id,
        transform: ident(obj.center),
      }),
    ],
  });
}
await cli(
  "module",
  "add",
  path.resolve(import.meta.dir, "case.mjs"),
  "--parent",
  frame,
  "--name",
  "Walnut shadowbox · brass fittings",
);
await cli("camera", "view", camera);
console.log(
  JSON.stringify(
    { url: url.origin, frame, camera, glbs: placements.length, output: out },
    null,
    2,
  ),
);
