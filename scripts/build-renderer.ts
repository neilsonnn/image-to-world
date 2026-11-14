const result = await Bun.build({
  entrypoints: ["web/src/render/worker.ts"],
  outdir: "web/public",
  naming: "render-worker.js",
  target: "browser",
  minify: true,
});
if (!result.success) throw new Error(result.logs.join("\n"));
console.info("Built isolated scene renderer");
const player = await Bun.build({
  entrypoints: ["web/src/render/player.ts"],
  outdir: "web/public",
  naming: "scene-player.js",
  target: "browser",
  minify: true,
});
if (!player.success) throw new Error(player.logs.join("\n"));
console.info("Built portable scene player");
