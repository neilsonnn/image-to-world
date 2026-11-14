import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pixelReference } from "./pixel-reference";
import { identity, type Workspace } from "../core/schema";

// Run against a fresh project: bun examples/create-demo.ts http://127.0.0.1:4320
const url = process.argv[2] ?? "http://127.0.0.1:4310";
const root = path.resolve(import.meta.dir, "..");
const temporary = await mkdtemp(path.join(tmpdir(), "image-to-world-demo-"));
let sequence = 0;
async function cli(...args: string[]) {
  const child = Bun.spawn(
    [
      process.execPath,
      "cli/index.ts",
      ...args,
      "--url",
      url,
      "--actor",
      "Demo artist",
    ],
    { cwd: root, stdout: "pipe", stderr: "pipe" },
  );
  const [out, error, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code) throw new Error(error);
  return JSON.parse(out);
}
async function json(value: unknown) {
  const file = path.join(temporary, `${sequence++}.json`);
  await writeFile(file, JSON.stringify(value));
  return file;
}
async function command(value: unknown) {
  return cli("command", `@${await json(value)}`);
}
try {
  const workspace = (await cli("state")) as Workspace;
  if (
    Object.keys(workspace.nodes).length ||
    Object.keys(workspace.assets).length
  )
    throw new Error(
      "Use an empty disposable project; this recipe never replaces an existing scene",
    );
  const reference = path.join(temporary, "moon-keeper-pixels.png");
  await writeFile(reference, pixelReference());
  const [asset] = await cli(
    "import",
    reference,
    "--creator",
    "image-to-world demo",
    "--license",
    "Apache-2.0",
  );
  const garden = await cli(
    "module",
    "add",
    "examples/moon-garden.ts",
    "--name",
    "Moon garden · authored scene",
  );
  const modules: string[] = [];
  for (const representation of ["voxels", "splats"]) {
    const file = await json({
      image: asset.id,
      representation,
      resolution: 16,
      width: 0.9,
      thickness: 2,
    });
    const module = await cli(
      "module",
      "add",
      "examples/pixel-sculpture.ts",
      "--file",
      file,
      "--name",
      `Pixel keeper · ${representation}`,
    );
    modules.push(module.nodeId);
  }
  await command({
    type: "edit.batch",
    commands: [
      {
        type: "nodes.transform",
        ids: [modules[0]],
        transform: { position: [-1.2, 0.36, 1.15] },
      },
      {
        type: "nodes.transform",
        ids: [modules[1]],
        transform: { position: [1.65, 0.36, -1.75] },
      },
      {
        type: "nodes.put",
        nodes: [
          {
            id: "node_pixel_plinth",
            name: "Pixel keeper plinth",
            kind: "primitive",
            transform: { ...identity(), position: [-1.2, 0.24, 1.15] },
            primitive: {
              shape: "cylinder",
              size: [1.1, 0.25, 1.1],
              segments: 24,
            },
            surface: { color: "#927ea8" },
          },
          {
            id: "node_soft_rim",
            name: "Warm rim light",
            kind: "light",
            transform: { ...identity(), position: [-3, 4, -2] },
            light: {
              type: "point",
              color: "#edc58d",
              intensity: 8,
              distance: 12,
              shadows: false,
            },
          },
        ],
      },
    ],
  });
  const camera = await cli(
    "camera",
    "solve",
    "--position",
    "7.6,5.4,8.9",
    "--look-at",
    "0,1.65,0",
    "--fov",
    "42",
  );
  await cli("camera", "--file", await json(camera));
  await cli(
    "camera",
    "place",
    "--file",
    await json(camera),
    "--name",
    "Garden portrait",
  );
  await cli("scene", "place", asset.id, "--camera", await json(camera));
  await cli(
    "art",
    "cinematic",
    "--file",
    await json({ background: "#181f2d", time: 2 }),
  );
  await command({
    type: "workspace.update",
    name: "Moon Garden · image-to-world",
    settings: { workflow: "build" },
  });
  const render = await cli(
    "render",
    "--camera",
    await json(camera),
    "--presentation",
    "--time",
    "2",
    "--bake",
    "--wait",
  );
  console.log(
    JSON.stringify(
      {
        garden: garden.nodeId,
        pixelNodes: modules,
        render: render.id,
        outputAssetIds: render.outputAssetIds,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
