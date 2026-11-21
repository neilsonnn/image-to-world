import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createService } from "./http";
import { createProjectHost, ProjectLibrary } from "./projects";
import { projectApi } from "../../../core/project-url";

test("two editor tabs keep separate assets and commands, and a saved link reopens after restart", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "i2w-project-library-"));
  const primary = path.join(dir, "first");
  const library = new ProjectLibrary(path.join(dir, "config"));
  const open = () => createProjectHost(primary, createService, library);
  let host = await open();
  const send = (route: string, body?: unknown) =>
    host.handle(
      new Request(
        "http://localhost" + route,
        body === undefined
          ? {}
          : {
              method: "POST",
              headers: { "X-Image-To-World-Client": "test" },
              body: JSON.stringify(body),
            },
      ),
    );
  try {
    const second = path.join(dir, "second");
    const clicked = await (
      await send("/api/projects/open", { path: "second", create: true })
    ).json();
    const scope = (route: string) =>
      projectApi(route, new URL(clicked.url).search);
    const added = await send(scope("commands"), {
      type: "workspace.update",
      name: "Night market",
    });
    expect(added.ok).toBe(true);
    expect((await (await send("/api/workspace")).json()).name).toBe(
      "Untitled workspace",
    );
    expect((await (await send(scope("workspace"))).json()).name).toBe(
      "Night market",
    );
    expect(
      (await (await send(scope("projects/folders"), { directory: dir })).json())
        .folders,
    ).toContain("second");
    expect(
      (await (await send(scope("projects"))).json()).map(
        (p: { name: string }) => p.name,
      ),
    ).toContain("Night market");
    const form = new FormData();
    form.append("files", new File(["only in second"], "notes.txt"));
    const uploaded = await host.handle(
      new Request("http://localhost" + scope("assets"), {
        method: "POST",
        headers: { "X-Image-To-World-Client": "test" },
        body: form,
      }),
    );
    const [asset] = await uploaded.json();
    expect(await (await send(scope("assets/" + asset.id))).text()).toBe(
      "only in second",
    );
    expect((await send("/api/assets/" + asset.id)).ok).toBe(false);
    await expect(
      send("/api/projects/open", { path: "second", create: true }),
    ).rejects.toThrow();
    await mkdir(path.join(dir, "unrelated"));
    await expect(
      send("/api/projects/open", { path: "unrelated" }),
    ).rejects.toThrow("workspace.json");
    await host.close();
    host = await open();
    expect((await (await send(scope("workspace"))).json()).name).toBe(
      "Night market",
    );
    await host.close();
    await rename(second, path.join(dir, "moved"));
    host = await open();
    await expect(send(scope("workspace"))).rejects.toThrow("workspace.json");
    expect(await Bun.file(path.join(second, "workspace.json")).exists()).toBe(
      false,
    );
  } finally {
    await host.close();
    await rm(dir, { recursive: true, force: true });
  }
});
