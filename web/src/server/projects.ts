import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { configFile } from "./environment";
import { z } from "zod";

const entrySchema = z.object({
  path: z.string(),
  origin: z.string().url(),
  at: z.number(),
  name: z.string(),
});
type Entry = z.infer<typeof entrySchema>;
const projectId = (folder: string) =>
  createHash("sha256").update(folder).digest("hex");
const openRequest = z.object({
  path: z.string().trim().min(1),
  create: z.boolean().default(false),
});

export class ProjectLibrary {
  constructor(
    readonly directory = path.join(path.dirname(configFile()), "projects"),
  ) {}

  async remember(entry: Entry) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const file = path.join(this.directory, projectId(entry.path) + ".json");
    const tmp = file + "." + randomUUID() + ".tmp";
    await writeFile(tmp, JSON.stringify(entry), { mode: 0o600 });
    await rename(tmp, file);
  }

  async get(id: string) {
    if (!/^[0-9a-f]{64}$/.test(id)) throw new Error("Invalid project ID");
    const entry = entrySchema.parse(
      JSON.parse(
        await readFile(path.join(this.directory, id + ".json"), "utf8"),
      ),
    );
    if (projectId(entry.path) !== id)
      throw new Error("Invalid saved project path");
    return entry;
  }

  async list() {
    const files = await readdir(this.directory).catch((e) => {
      if (e.code === "ENOENT") return [];
      throw e;
    });
    const entries = await Promise.all(
      files
        .filter((f) => /^[a-f0-9]{64}\.json$/.test(f))
        .map((f) => this.get(f.slice(0, -5))),
    );
    return entries
      .sort((a, b) => b.at - a.at)
      .map((e) => ({ path: e.path, name: e.name }));
  }
}

async function projectFolder(
  input: z.infer<typeof openRequest>,
  current: string,
) {
  const given = input.path.startsWith("~/")
    ? path.join(homedir(), input.path.slice(2))
    : input.path;
  const folder = path.resolve(path.dirname(current), given);
  if (input.create) {
    // Exclusive creation prevents a typo from adopting an existing non-project folder.
    await mkdir(folder);
  } else {
    if (
      !(
        await stat(path.join(folder, "workspace.json")).catch(() => null)
      )?.isFile()
    )
      throw new Error("Choose a project folder containing workspace.json.");
  }
  return realpath(folder);
}

type OpenService = typeof import("./http").createService;

// Each mounted folder keeps its own command queue, workers, watchers and SSE stream.
export async function createProjectHost(
  root: string,
  open: OpenService,
  library = new ProjectLibrary(),
) {
  const initial = await open(root);
  const home = await realpath(initial.store.root);
  const primary = projectId(home);
  const mounted = new Map([[primary, Promise.resolve(initial)]]);
  let registered: Promise<void> | undefined;
  function mount(id: string, folder: string) {
    let service = mounted.get(id);
    if (!service) {
      service = open(folder).catch((error) => {
        mounted.delete(id);
        throw error;
      });
      mounted.set(id, service);
    }
    return service;
  }
  return {
    async handle(request: Request) {
      const url = new URL(request.url);
      const active = /^\/api\/projects\/active\/([a-f0-9]{64})$/.exec(
        url.pathname,
      );
      if (active && request.method === "GET") {
        const service = mounted.get(active[1]);
        return Response.json({
          path: service ? await realpath((await service).store.root) : null,
        });
      }
      if (!registered)
        registered = library
          .remember({
            path: home,
            origin: url.origin,
            name: initial.store.current.name,
            at: Date.now(),
          })
          .catch((e) => {
            registered = undefined;
            throw e;
          });
      await registered;
      const scoped = /^\/api\/p\/([a-f0-9]{64})\/(.*)$/.exec(url.pathname);
      let service = initial;
      if (scoped) {
        const id = scoped[1];
        const existing = mounted.get(id);
        if (existing) service = await existing;
        else {
          const entry = await library.get(id);
          const folder = await projectFolder(
            { path: entry.path, create: false },
            home,
          );
          if (projectId(folder) !== id)
            throw new Error("Saved project folder has changed.");
          service = await mount(id, folder);
        }
      }
      const route = scoped?.[2] ?? url.pathname.slice("/api/".length);
      if (route === "projects" && request.method === "GET")
        return Response.json(
          await Promise.all(
            (await library.list()).map(async (e) => {
              const live = mounted.get(projectId(e.path));
              return live ? { ...e, name: (await live).store.current.name } : e;
            }),
          ),
        );
      if (route === "projects/folders" && request.method === "POST") {
        const { directory } = z
          .object({ directory: z.string().optional() })
          .parse(await request.json());
        const parent = await realpath(
          directory ?? path.dirname(service.store.root),
        );
        const folders = (await readdir(parent, { withFileTypes: true }))
          .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
          .map((entry) => entry.name)
          .sort((a, b) => a.localeCompare(b));
        return Response.json({
          directory: parent,
          parent: path.dirname(parent),
          folders,
          isProject:
            (
              await stat(path.join(parent, "workspace.json")).catch(() => null)
            )?.isFile() ?? false,
        });
      }
      if (route === "projects/open" && request.method === "POST") {
        const input = openRequest.parse(await request.json());
        const folder = await projectFolder(input, service.store.root);
        const id = projectId(folder);
        let origin = url.origin;
        let name = path.basename(folder);
        if (!mounted.has(id)) {
          const entry = await library.get(id).catch((e) => {
            if (e.code !== "ENOENT") throw e;
          });
          if (
            entry &&
            entry.origin !== origin &&
            /^http:\/\/(?:localhost|127\.0\.0\.1)(?::[0-9]+)?$/.test(
              entry.origin,
            )
          ) {
            const owner = await fetch(
              entry.origin + "/api/projects/active/" + id,
              { signal: AbortSignal.timeout(1500), redirect: "error" },
            )
              .then((r) => (r.ok ? r.json() : null))
              .catch(() => null);
            if (owner?.path === folder) {
              origin = entry.origin;
              name = entry.name;
            }
          }
        }
        if (origin === url.origin)
          name = (await mount(id, folder)).store.current.name;
        await library.remember({ path: folder, origin, name, at: Date.now() });
        return Response.json({ url: origin + "/?project=" + id });
      }
      return service.handle(request, route);
    },
    async close() {
      await Promise.allSettled(
        [...mounted.values()].map(async (service) => (await service).close()),
      );
    },
  };
}
