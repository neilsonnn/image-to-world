import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { unzipSync } from "three/examples/jsm/libs/fflate.module.js";
import { createCapture } from "../../../core/captures";
import { defaultCamera, nodeSchema, type Asset } from "../../../core/schema";
import { defaultLighting } from "../../../core/lighting";
import type { PlayerScene } from "../../../core/player-scene";
import { rendererExecutable } from "./render-worker";
import { createService } from "./http";

test("web export includes runtime dependencies and strips Frame reference pixels without losing descendants", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "scene-export-"));
  const api = await createService(root);
  try {
    const add = (name: string, data: string, metadata?: Partial<Asset>) =>
      api.store.importFile(new Blob([data]), name, metadata);
    const photo = await add("private-reference.png", "reference");
    const environment = await add("sky.jpg", "panorama");
    const rgb = await add("active-image.png", "rgb");
    const depth = await add("z.exr", "depth");
    const confidence = await add("confidence.png", "confidence");
    const geometry = await add("geometry.png", "basis", {
      camera: defaultCamera(),
      depthAssetId: depth.id,
      confidenceAssetId: confidence.id,
    });
    const dependency = await add("surface.png", "surface bytes");
    const code = await add("bundle.js", "bundled code");
    const source = await add("authoring.ts", "module source");
    const unrelated = await add("unrelated.png", "library only");
    await api.store.update((workspace) => {
      workspace.settings.prompt = "private generation prompt";
      workspace.settings.lighting = {
        ...defaultLighting,
        environmentAssetId: environment.id,
      };
      for (const node of createCapture(photo, "frame"))
        workspace.nodes[node.id] = node;
      workspace.nodes.props = nodeSchema.parse({
        id: "props",
        name: "Props",
        kind: "procedural",
        parentId: "frame_image",
        procedural: {
          sourceAssetId: source.id,
          bundleAssetId: code.id,
          assetIds: [dependency.id],
        },
      });
      workspace.nodes.cloud = nodeSchema.parse({
        id: "cloud",
        name: "Custom points",
        kind: "points",
        assetId: rgb.id,
        geometryAssetId: geometry.id,
      });
    });
    const get = (name: string) =>
      api.handle(new Request(`http://localhost/api/player/${name}`));
    const scene: PlayerScene = await (await get("scene.json")).json();
    expect(scene.nodes.props.parentId).toBe("frame_image");
    expect(scene.nodes.frame_image.assetId).toBeUndefined();
    expect(scene.nodes.frame_points.assetId).toBeUndefined();
    expect(scene.assets[photo.id]).toBeUndefined();
    expect(scene.assets[source.id]).toBeUndefined();
    expect(scene.assets[unrelated.id]).toBeUndefined();
    expect(Object.keys(scene.assets).sort()).toEqual(
      [environment, rgb, geometry, confidence, depth, code, dependency]
        .map((a) => a.id)
        .sort(),
    );
    expect(JSON.stringify(scene)).not.toContain("private generation prompt");
    const download = await get("export.zip");
    expect(download.headers.get("content-disposition")).toContain("attachment");
    const files = unzipSync(new Uint8Array(await download.arrayBuffer()));
    expect(JSON.parse(new TextDecoder().decode(files["scene.json"]))).toEqual(
      scene,
    );
    expect(Object.keys(files).sort()).toEqual(
      [
        "index.html",
        "scene.json",
        "scene-player.js",
        "README.md",
        ...Object.values(scene.assets).map((a) => a.path),
      ].sort(),
    );
    expect(
      new TextDecoder().decode(files[scene.assets[dependency.id].path]),
    ).toBe("surface bytes");
    expect(await (await get(scene.assets[dependency.id].path)).text()).toBe(
      "surface bytes",
    );
    const partial = await api.handle(
      new Request(
        `http://localhost/api/player/${scene.assets[dependency.id].path}`,
        { headers: { Range: "bytes=0-2" } },
      ),
    );
    expect(partial.status).toBe(206);
    expect(await partial.text()).toBe("sur");
  } finally {
    await api.close();
    await rm(root, { recursive: true, force: true });
  }
});

test.skipIf(!rendererExecutable())(
  "downloaded player renders and simulates from a static subdirectory with the editor offline",
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), "scene-static-"));
    const api = await createService(root);
    let files: ReturnType<typeof unzipSync>;
    try {
      const color = await api.store.importFile(
        new Blob(["#ff2929"]),
        "red.txt",
      );
      const code = await api.store.importFile(
        new Blob([
          `
      export default { async create({ THREE, params, assetUrl }) {
        const color = await (await fetch(assetUrl(params.color))).text();
        return { object: new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ color })) };
      } };`,
        ]),
        "box.js",
      );
      await api.store.update((workspace) => {
        workspace.name = "Portable scene";
        workspace.settings.viewportCamera.extrinsics = {
          position: [0, 0, 3],
          quaternion: [0, 0, 0, 1],
          coordinateSystem: "rub",
        };
        workspace.nodes.box = nodeSchema.parse({
          kind: "procedural",
          id: "box",
          name: "Box",
          physics: { type: "dynamic", collider: "box" },
          procedural: {
            sourceAssetId: code.id,
            bundleAssetId: code.id,
            assetIds: [color.id],
            parameters: { color: color.id },
          },
        });
      });
      const download = await api.handle(
        new Request("http://localhost/api/player/export.zip"),
      );
      files = unzipSync(new Uint8Array(await download.arrayBuffer()));
    } finally {
      await api.close();
      await rm(root, { recursive: true, force: true });
    }
    const prefix = "/gallery/world/";
    const staticSite = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const pathname = new URL(request.url).pathname;
        const name = pathname.slice(prefix.length);
        if (!pathname.startsWith(prefix) || !files[name])
          return new Response(null, { status: 404 });
        return new Response(new Blob([files[name]]), {
          headers: { "Content-Type": Bun.file(name).type },
        });
      },
    });
    let browser;
    try {
      browser = await chromium.launch({
        executablePath: rendererExecutable(),
        headless: true,
        args: ["--enable-unsafe-swiftshader"],
      });
      const page = await browser.newPage({
        viewport: { width: 400, height: 300 },
      });
      const blocked: string[] = [];
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const base = new URL(prefix, staticSite.url).href;
      await page.route("**/*", (route) => {
        const url = route.request().url();
        if (
          url.startsWith(base) ||
          url.startsWith("blob:") ||
          url.startsWith("data:")
        )
          return route.continue();
        blocked.push(url);
        return route.abort();
      });
      await page.goto(base + "index.html");
      await page.waitForFunction(() => document.title === "Portable scene");
      const center = async () => {
        const image = await loadImage(
          await page.locator("canvas").screenshot(),
        );
        const ctx = createCanvas(image.width, image.height).getContext("2d");
        ctx.drawImage(image, 0, 0);
        return [
          ...ctx.getImageData(image.width / 2, image.height / 2, 1, 1).data,
        ];
      };
      expect((await center())[0]).toBeGreaterThan(220);
      await page.getByRole("button", { name: "Play", exact: true }).click();
      await page.getByRole("button", { name: "Stop", exact: true }).waitFor();
      const deadline = Date.now() + 10000;
      let red = (await center())[0];
      while (red >= 100 && Date.now() < deadline) red = (await center())[0];
      expect(red).toBeLessThan(100);
      await page.getByRole("button", { name: "Stop" }).click();
      expect((await center())[0]).toBeGreaterThan(220);
      expect(await page.locator("output").textContent()).toBe("");
      // Embedded host pages can resolve relative URLs against a different directory.
      const mounted = await page.evaluate(async (url) => {
        const hostBase = document.createElement("base");
        hostBase.href = "/another-page/";
        document.head.append(hostBase);
        const { mountScene, THREE } = await import(url + "scene-player.js");
        const host = document.createElement("div");
        host.style.cssText = "width:96px;height:96px";
        document.body.append(host);
        const player = await mountScene(host, url + "scene.json");
        const ownEngine =
          player.scene instanceof THREE.Scene &&
          player.camera instanceof THREE.PerspectiveCamera;
        await player.play();
        player.stop();
        await player.dispose();
        const removed = host.childElementCount === 0;
        host.remove();
        hostBase.remove();
        return { ownEngine, removed };
      }, base);
      expect(mounted).toEqual({ ownEngine: true, removed: true });
      expect(errors).toEqual([]);
      expect(blocked).toEqual([]);
    } finally {
      await browser?.close();
      await staticSite.stop(true);
    }
  },
  60000,
);
