const spark = import.meta.resolve("@sparkjsdev/spark");
const fflateLicense = new URL(
  "../LICENSE",
  import.meta.resolve("fflate", spark),
);
const licenses = await Promise.all(
  [
    ["image-to-world", "LICENSE"],
    ["Three.js", "node_modules/three/LICENSE"],
    ["Spark", "node_modules/@sparkjsdev/spark/LICENSE"],
    ["Rapier", "node_modules/@dimforge/rapier3d-compat/LICENSE"],
    ["Zod", "node_modules/zod/LICENSE"],
    ["fflate", fflateLicense],
  ].map(async ([name, file]) => name + "\n" + (await Bun.file(file).text())),
);

for (const [entry, filename] of [
  ["worker", "render-worker"],
  ["player", "scene-player"],
]) {
  const result = await Bun.build({
    entrypoints: [`web/src/render/${entry}.ts`],
    outdir: "web/public",
    naming: `${filename}.js`,
    target: "browser",
    minify: true,
    ...(entry === "player" && {
      footer: "/*!\n" + licenses.join("\n\n") + "\n*/",
    }),
  });
  if (!result.success) throw new Error(result.logs.join("\n"));
}
console.info("Built scene renderer and standalone player");
