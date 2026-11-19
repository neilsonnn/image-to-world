import { moduleEngine } from "../core/module-engine";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { realpath } from "node:fs/promises";
import { createHash } from "node:crypto";

const engineImports: Record<string, keyof typeof moduleEngine> = {
  three: "THREE",
  "three/webgpu": "webgpu",
  "three/tsl": "tsl",
  "@sparkjsdev/spark": "spark",
};
const runtimeEntry = path.resolve(
  import.meta.dir,
  "../core/module-contract.ts",
);

/** Compiles local trusted scene code without executing it on the server. */
export async function compileModule(file: string) {
  const source = await realpath(path.resolve(file)),
    sources = new Map<string, string>();
  const result = await Bun.build({
    entrypoints: [source],
    target: "browser",
    format: "esm",
    minify: false,
    plugins: [
      {
        name: "scene-runtime",
        setup(build) {
          build.onResolve(
            { filter: /^(three|@sparkjsdev\/spark)(\/|$)/ },
            (args) => {
              const hostNamespace = engineImports[args.path];
              if (hostNamespace)
                return { path: hostNamespace, namespace: "scene-engine" };
              if (args.path.startsWith("three/"))
                return { path: fileURLToPath(import.meta.resolve(args.path)) };
            },
          );
          build.onLoad({ filter: /.*/, namespace: "scene-engine" }, (args) => ({
            // The host namespace is immutable during each import. Mark reads as
            // pure so a two-function TSL import doesn't retain 600 unused exports.
            contents:
              "const read = key => globalThis.__imageToWorldModuleHost." +
              args.path +
              "[key];\n" +
              Object.keys(moduleEngine[args.path as keyof typeof moduleEngine])
                .filter((key) => /^[A-Za-z_$][\w$]*$/.test(key))
                .map(
                  (key) =>
                    `export const ${key} = /* @__PURE__ */ read("${key}");`,
                )
                .join("\n"),
            loader: "js",
          }));
          build.onResolve({ filter: /^image-to-world\/runtime$/ }, () => ({
            path: runtimeEntry,
          }));
          build.onLoad(
            { filter: /\.(ts|tsx|js|jsx|mjs|json)$/ },
            async (args) => {
              if (
                args.path === runtimeEntry ||
                args.path.includes(`${path.sep}node_modules${path.sep}`)
              )
                return;
              const contents = await Bun.file(args.path).text();
              sources.set(args.path, contents);
              const ext = path.extname(args.path).slice(1);
              return {
                contents,
                loader: (ext === "mjs" ? "js" : ext) as
                  "ts" | "tsx" | "js" | "jsx" | "json",
              };
            },
          );
        },
      },
    ],
  });
  if (!result.success)
    throw new Error(result.logs.map((log) => log.message).join("\n"));
  if (result.outputs.length !== 1)
    throw new Error(
      "Module must compile to a self-contained JavaScript bundle; declare runtime images as asset dependencies",
    );
  const code = await result.outputs[0].text();
  return {
    source,
    sources,
    code,
    hash: createHash("sha256").update(code).digest("hex"),
    compiler: Bun.version,
  };
}
