const result = await Bun.build({
  entrypoints: ["web/src/render/worker.ts"],
  outdir: "web/public",
  naming: "render-worker.js",
  target: "browser",
  minify: true,
});
if (!result.success) throw new Error(result.logs.join("\n"));
console.info("Built isolated scene renderer");
