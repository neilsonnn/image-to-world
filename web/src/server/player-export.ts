import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Zip, ZipPassThrough } from "three/examples/jsm/libs/fflate.module.js";
import { currentCamera } from "../../../core/generation";
import { sessionFormat } from "../../../core/formats";
import { frameSourceIds } from "../../../core/reference-comparison";
import type { PlayerScene } from "../../../core/player-scene";
import type { Asset, Workspace } from "../../../core/schema";
import { viewfinderCamera } from "../lib/viewport-projection";
import type { WorkspaceStore } from "./store";

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Scene player</title><style>html,body,main{margin:0;width:100%;height:100%;background:#17191e;color:#fff}body{font:15px system-ui}</style>
</head><body><main aria-label="3D scene"></main><script type="module">
import { mountScene } from "./scene-player.js";
const host = document.querySelector("main");
try {
  const player = await mountScene(host, "./scene.json");
  document.title = player.name;
} catch (error) {
  host.textContent = error.message || String(error);
}
</script></body></html>`;

const readme = `# Your scene on the web

Upload this folder intact to a static HTTP(S) host. Open index.html to view the scene. For a local preview, run python3 -m http.server in this directory and open http://localhost:8000/. The player uses the packaged Three.js renderer, simulation, module bundles and assets.

Embed the page in an iframe.

~~~html
<iframe src="./scene/index.html" title="Interactive 3D scene" allow="fullscreen" allowfullscreen style="width:100%;height:75vh;border:0"></iframe>
~~~

To use the JavaScript API, mount the player in an element with a defined width and height.

~~~html
<div id="scene" style="height:75vh"></div>
<script type="module">
  import { mountScene } from "./scene/scene-player.js";
  const player = await mountScene(document.querySelector("#scene"), "./scene/scene.json");
  // player.scene and player.camera are the live Three.js objects.
  // Import { THREE } from the same module to extend them with the host engine.
  // Optional: start simulation directly.
  await player.play();
  // player.stop() resets simulated objects. await player.dispose() releases resources.
</script>
~~~

Use Play to start the simulation and drag a movable object to grab it. Right-drag to look, WASD or arrow keys to move, and Q/E to descend or ascend.

scene.json contains the hierarchy, transforms, runtime node data, initial camera, display settings and scene lighting. Asset paths resolve relative to scene.json. Authored modules use the bundled host engine and their declared asset dependencies.
`;

function bundleFile() {
  const location = [
    "web/public/scene-player.js",
    "public/scene-player.js",
    "dist/client/scene-player.js",
  ]
    .map((file) => path.resolve(file))
    .find(existsSync);
  if (!location)
    throw new Error("Scene player bundle missing. Run bun run build.");
  return Bun.file(location);
}

/** Stable filesystem-safe sibling URLs, including for IDs or labels with URL delimiters. */
function playerPath(asset: Asset) {
  const id = Buffer.from(asset.id).toString("base64url");
  const ext = path
    .extname(asset.path)
    .toLowerCase()
    .replace(/[^a-z0-9.]/g, "");
  const label =
    path
      .parse(asset.name)
      .name.replace(/[^a-z0-9_-]/gi, "_")
      .slice(0, 100) || "asset";
  return `assets/${id}/${label}${ext}`;
}

export function playerManifest(workspace: Workspace): PlayerScene {
  const { lighting, viewingCameraId, display, pointSize, viewportOptions } =
    workspace.settings;
  const sources = new Set(frameSourceIds(workspace));
  const assets: Workspace["assets"] = Object.create(null);
  const nodes: Workspace["nodes"] = Object.create(null);
  function include(id: string | undefined) {
    if (!id || assets[id]) return;
    const asset = workspace.assets[id];
    if (!asset || asset.missing || asset.trashedAt !== undefined)
      throw new Error(`Scene asset unavailable: ${asset?.name ?? id}`);
    const {
      name,
      kind,
      mimeType,
      size,
      modifiedAt,
      camera,
      depthEncoding,
      depthAssetId,
      confidenceAssetId,
    } = asset;
    assets[id] = {
      id,
      name,
      kind,
      mimeType,
      size,
      modifiedAt,
      missing: false,
      path: playerPath(asset),
      camera,
      depthEncoding,
      depthAssetId,
      confidenceAssetId,
    };
  }
  include(lighting?.environmentAssetId ?? undefined);
  for (const node of Object.values(workspace.nodes)) {
    const {
      jobId,
      observationAssetIds,
      context,
      contextFrozen,
      frameWorkers,
      ...renderNode
    } = node;
    if (node.kind === "capture" || sources.has(node.id)) {
      // Keep the transform hierarchy (including authored children), with no reference pixels or depth.
      delete renderNode.assetId;
      delete renderNode.geometryAssetId;
    }
    nodes[node.id] = renderNode;
    include(renderNode.assetId);
    include(renderNode.geometryAssetId);
    if (renderNode.kind === "points") {
      const geometry =
        workspace.assets[
          renderNode.geometryAssetId ?? renderNode.assetId ?? ""
        ];
      include(geometry?.depthAssetId);
      include(geometry?.confidenceAssetId);
    }
    if (node.procedural?.enabled) {
      include(node.procedural.bundleAssetId);
      for (const id of node.procedural.assetIds) include(id);
    }
  }
  return {
    version: 1,
    name: workspace.name,
    revision: workspace.revision,
    nodes,
    assets,
    camera: viewfinderCamera(
      currentCamera(workspace),
      sessionFormat(workspace),
    ),
    settings: {
      lighting,
      viewingCameraId,
      display,
      pointSize,
      viewportOptions,
    },
  };
}

type ArchiveEntry = { name: string; blob: Blob; verify?: () => Promise<void> };

/** Pass through already-compressed scene assets in bounded chunks with browser backpressure. */
async function* zipEntries(entries: ArchiveEntry[]) {
  const chunks: Uint8Array[] = [];
  const zip = new Zip((error, chunk) => {
    if (error) throw error;
    chunks.push(chunk);
  });
  try {
    for (const { name, blob, verify } of entries) {
      const file = new ZipPassThrough(name);
      zip.add(file);
      const reader = blob.stream().getReader();
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          file.push(chunk.value);
          yield* chunks.splice(0);
        }
      } finally {
        await reader.cancel();
      }
      await verify?.();
      file.push(new Uint8Array(), true);
      yield* chunks.splice(0);
    }
    zip.end();
    yield* chunks;
  } finally {
    zip.terminate();
  }
}

export async function playerResponse(route: string, store: WorkspaceStore) {
  if (route === "player/index.html")
    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  if (route === "player/scene-player.js")
    return new Response(bundleFile(), {
      headers: { "Content-Type": "text/javascript" },
    });
  if (route !== "player/scene.json" && route !== "player/export.zip")
    return new Response("Unknown player resource", { status: 404 });
  const workspace = store.snapshot();
  const manifest = playerManifest(workspace);
  if (route === "player/scene.json")
    return Response.json(manifest, {
      headers: { "Cache-Control": "no-store" },
    });
  const entries: ArchiveEntry[] = [
    { name: "index.html", blob: new Blob([html]) },
    { name: "scene.json", blob: new Blob([JSON.stringify(manifest, null, 2)]) },
    { name: "scene-player.js", blob: bundleFile() },
    { name: "README.md", blob: new Blob([readme]) },
  ];
  for (const asset of Object.values(manifest.assets)) {
    const { file } = await store.assetFile(asset.id, { state: workspace });
    const verify = async () => {
      const info = await stat(file);
      if (info.size !== asset.size || info.mtimeMs !== asset.modifiedAt)
        throw new Error(
          `Asset changed since the last project scan: ${asset.name}`,
        );
    };
    await verify();
    entries.push({ name: asset.path, blob: Bun.file(file), verify });
  }
  // fflate writes classic ZIP offsets; fail explicitly before sending an invalid archive.
  const upperBound = entries.reduce(
    (sum, item) => sum + item.blob.size + item.name.length * 2 + 128,
    22,
  );
  if (entries.length >= 65535 || upperBound >= 0xffffffff)
    throw new Error("Scene exceeds the 4 GiB or 65,534-file ZIP limit.");
  const archive = zipEntries(entries);
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await archive.next();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    async cancel() {
      await archive.return();
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${workspace.name.replace(/[^a-z0-9_-]/gi, "_").slice(0, 100) || "scene"}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
