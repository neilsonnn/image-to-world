import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildFingerprint, doctor, openProject } from "./launch";
import { run } from "./index";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), "worldbash-launch-"));
  directories.push(directory);
  return directory;
}

test("build fingerprint tracks source, lockfile, and public assets but ignores project data and outputs", async () => {
  const directory = await temporaryDirectory();
  await Bun.write(path.join(directory, "bun.lock"), "lock");
  await Bun.write(path.join(directory, "web/src/editor.tsx"), "editor");
  const first = await buildFingerprint(directory);
  await Bun.write(path.join(directory, ".worldbash/workspace.json"), "project");
  await Bun.write(path.join(directory, "web/dist/server/server.js"), "output");
  expect(await buildFingerprint(directory)).toBe(first);
  await Bun.write(path.join(directory, "web/src/editor.tsx"), "changed editor");
  const second = await buildFingerprint(directory);
  expect(second).not.toBe(first);
  await Bun.write(path.join(directory, "bun.lock"), "changed lock");
  const third = await buildFingerprint(directory);
  expect(third).not.toBe(second);
  await Bun.write(
    path.join(directory, "web/public/icon.png"),
    new Uint8Array([1, 2, 3]),
  );
  expect(await buildFingerprint(directory)).not.toBe(third);
});

test("launcher refuses a port serving another project", async () => {
  const directory = await temporaryDirectory();
  const other = path.join(directory, "other");
  await mkdir(other);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () =>
      Response.json({ application: "worldbash", workspacePath: other }),
  });
  try {
    await expect(
      openProject(directory, { port: String(server.port), noBrowser: true }),
    ).rejects.toThrow("another app or project");
  } finally {
    await server.stop(true);
  }
});

test("doctor rejects a file as a project without creating directories", async () => {
  const directory = await temporaryDirectory();
  const file = path.join(directory, "file");
  await Bun.write(file, "data");
  const report = await doctor(file);
  expect(report.checks.find((check) => check.name === "workspace")?.ok).toBe(
    false,
  );
  const missing = path.join(directory, "new-project");
  expect(
    (await doctor(missing)).checks.find((check) => check.name === "workspace")
      ?.ok,
  ).toBe(true);
  expect(await Bun.file(missing).exists()).toBe(false);
});

test("launcher and CLI keep port 4310 when another app sets PORT", async () => {
  const directory = await temporaryDirectory();
  const previousPort = process.env.PORT;
  const previousUrl = process.env.WORLDBASH_URL;
  process.env.PORT = "3000";
  delete process.env.WORLDBASH_URL;
  const requests: string[] = [];
  const fetchMock = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: Parameters<typeof fetch>[0]) => {
        requests.push(String(input));
        return Response.json({
          application: "worldbash",
          workspacePath: directory,
        });
      },
      { preconnect: fetch.preconnect },
    ),
  );
  const output = spyOn(process.stdout, "write").mockReturnValue(true);
  try {
    await openProject(directory, { noBrowser: true });
    await run(["status"]);
    expect(requests).toEqual([
      "http://127.0.0.1:4310/api/status",
      "http://127.0.0.1:4310/api/status",
    ]);
  } finally {
    fetchMock.mockRestore();
    output.mockRestore();
    if (previousPort === undefined) delete process.env.PORT;
    else process.env.PORT = previousPort;
    if (previousUrl === undefined) delete process.env.WORLDBASH_URL;
    else process.env.WORLDBASH_URL = previousUrl;
  }
});
