import { defaults } from "./defaults.mjs";
import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";
import { Matrix4, Quaternion, Vector3 } from "three";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { url: { type: "string" } },
});
if (positionals.length !== 1 || !values.url)
  throw Error(
    "Usage: bun examples/moonlit-workshop/build.mjs REFERENCE.png --url http://127.0.0.1:PORT",
  );
const url = new URL(values.url);
if (
  url.protocol !== "http:" ||
  !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
)
  throw Error("Open a local image-to-world project.");
const input = await realpath(positionals[0]),
  cliPath = path.resolve(import.meta.dir, "../../cli/index.ts");
async function cli(...args) {
  const p = Bun.spawn(
    [
      process.execPath,
      cliPath,
      ...args,
      "--url",
      url.origin,
      "--actor",
      "Moonlit Workshop",
    ],
    { stdout: "pipe", stderr: "inherit" },
  );
  const result = await new Response(p.stdout).text();
  if (await p.exited) throw Error("CLI failed while running " + args[0]);
  return JSON.parse(result);
}
const cmd = (c) => cli("command", JSON.stringify(c));
const w = await cli("state");
if (
  Object.keys(w.nodes).length ||
  Object.keys(w.assets).length ||
  Object.keys(w.jobs).length
)
  throw Error("This example requires a fresh, empty project.");
const tmp = await mkdtemp(path.join(tmpdir(), "moonlit-workshop-"));
async function json(name, data) {
  const f = path.join(tmp, name + ".json");
  await writeFile(f, JSON.stringify(data));
  return f;
}
const identity = (position = [0, 0, 0], quaternion = [0, 0, 0, 1]) => ({
  position,
  quaternion,
  scale: [1, 1, 1],
});
const aim = (position, target) =>
  identity(
    position,
    new Quaternion()
      .setFromRotationMatrix(
        new Matrix4().lookAt(
          new Vector3(...position),
          new Vector3(...target),
          new Vector3(0, 1, 0),
        ),
      )
      .toArray(),
  );
function projection(fov) {
  const width = 1280,
    height = 720,
    fy = height / (2 * Math.tan((fov * Math.PI) / 360));
  return { width, height, fx: fy, fy, cx: width / 2, cy: height / 2 };
}
const nodes = (id, name, kind, parentId, extra = {}) => ({
  id,
  name,
  kind,
  parentId,
  visible: true,
  transform: identity(),
  ...extra,
});
const frame = "workshop-frame",
  hero = "workshop-camera",
  reverse = "workshop-reading-nook";
const referencePose = aim([0.02, 1.49, 5.55], [0.005, 1.48, -0.4]);
await cmd({ type: "workspace.update", name: "Moonlit Workshop" });
const [reference] = await cli("import", input);
const lighting = {
  fillColor: "#b6cced",
  fillIntensity: 1.14,
  keyColor: "#fce9c9",
  keyIntensity: 1.27,
  keyShadows: true,
  azimuth: 63,
  elevation: 27,
  background: "#233344",
};
await cli("lighting", "--file", await json("lighting", lighting));
await cmd({
  type: "nodes.put",
  nodes: [
    nodes(frame, "Moonlit Workshop", "capture", null, {
      assetId: reference.id,
      lighting,
    }),
    nodes(hero, "Through the doorway", "camera", frame, {
      transform: referencePose,
      projection: projection(42),
    }),
    nodes(
      "workshop-reference",
      "Original illustration · comparison",
      "image",
      hero,
      { assetId: reference.id, visible: false, projection: projection(42) },
    ),
    nodes("workshop-points", "Points", "points", frame, {
      visible: false,
      transform: referencePose,
    }),
    nodes("workshop-inspection", "Inspection cameras", "group", frame),
    nodes(reverse, "From the reading nook", "camera", "workshop-inspection", {
      transform: aim([-1.5, 1.4, 1.69], [0.45, 0.98, -0.96]),
      projection: projection(65),
      visible: false,
    }),
  ],
});
const modules = [
  ["room", "Joinery · shoji, rafters and lamplight", [0, 0, 0]],
  ["cabinet", "Alcove · oak cupboards and clock", [0.02, 0, -2.37]],
  ["bed", "Cloud linen · rumpled duvet and pillows", [-0.24, 0, -0.94]],
  ["desk", "Drafting desk · enamel task lamp", [1.95, 0, 0.43]],
  ["stool", "Turned stool · midnight reading", [0.92, 0.05, 0.78]],
  ["garden", "Herbarium · drawers and window plants", [-2.18, 0, 0.88]],
];
for (const [source, name, position] of modules) {
  const r = await cli(
    "module",
    "add",
    path.join(import.meta.dir, source + ".mjs"),
    "--parent",
    frame,
    "--name",
    name,
    "--file",
    await json(source, defaults[source]),
    "--seed",
    "73",
  );
  await cmd({
    type: "nodes.transform",
    ids: [r.nodeId],
    transform: { position },
  });
  console.error("Placed " + name);
}
await cli("camera", "view", hero);
console.log(
  JSON.stringify(
    {
      url: url.origin,
      frame,
      hero,
      reverse,
      reference: reference.id,
      modules: modules.length,
    },
    null,
    2,
  ),
);
