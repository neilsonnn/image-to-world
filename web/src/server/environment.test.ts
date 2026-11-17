import { afterEach, expect, spyOn, test } from "bun:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";
import { createService } from "./http";
import { configFile, environmentValue } from "./environment";
import { worldLabs } from "./providers";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function setup() {
  const root = await mkdtemp(
    path.join(tmpdir(), "image-to-world-credentials-"),
  );
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(root, "config");
  cleanups.push(async () => {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    await rm(root, { recursive: true, force: true });
  });
  const service = await createService(path.join(root, "project"));
  cleanups.push(() => service.close());
  return service;
}
function request(values: unknown, origin?: string, header = true) {
  return new Request("http://127.0.0.1:4310/api/commands", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(header ? { "X-Image-To-World-Client": "test" } : {}),
      ...(origin ? { origin } : {}),
    },
    body: JSON.stringify({ type: "environment.configure", values }),
  });
}

test("provider configuration persists privately, takes effect live, and never enters project state", async () => {
  const service = await setup();
  await mkdir(path.dirname(configFile()), { recursive: true });
  await writeFile(
    configFile(),
    '# Keep this comment\nOTHER="a value"\nexport WLT_API_KEY="old\nkey"\nFAL_KEY=keep-fal\n',
    { mode: 0o644 },
  );
  const before = JSON.stringify(service.store.snapshot());
  const response = await service.handle(
    request({ WLT_API_KEY: "new-test-key" }),
  );
  expect(response.status).toBe(200);
  expect(await response.text()).not.toContain("new-test-key");
  const text = await readFile(configFile(), "utf8");
  expect(text).toContain("# Keep this comment");
  expect(parseEnv(text)).toEqual({
    OTHER: "a value",
    WLT_API_KEY: "new-test-key",
    FAL_KEY: "keep-fal",
  });
  expect((await stat(configFile())).mode & 0o777).toBe(0o600);
  expect(environmentValue("WLT_API_KEY")).toBe("new-test-key");
  expect(JSON.stringify(service.store.snapshot())).toBe(before);
  const status = await (
    await service.handle(new Request("http://127.0.0.1:4310/api/status"))
  ).json();
  expect(status.worldLabsConfigured).toBe(true);
  expect(status.falConfigured).toBe(true);
  expect(JSON.stringify(status)).not.toContain("new-test-key");
  await service.handle(request({ FAL_KEY: "replacement-fal" }));
  expect(environmentValue("WLT_API_KEY")).toBe("new-test-key");
  expect(environmentValue("FAL_KEY")).toBe("replacement-fal");
  // Another process or an external editor's save is seen without a restart.
  await writeFile(configFile(), "WLT_API_KEY=external-replacement\n");
  expect(environmentValue("WLT_API_KEY")).toBe("external-replacement");
});

test("provider configuration rejects cross-origin, missing-header and dotenv injection requests", async () => {
  const service = await setup();
  expect(
    (
      await service.handle(
        request({ WLT_API_KEY: "secret" }, "https://other.example"),
      )
    ).status,
  ).toBe(403);
  expect(
    (await service.handle(request({ WLT_API_KEY: "secret" }, undefined, false)))
      .status,
  ).toBe(403);
  for (const values of [
    {},
    { WLT_API_KEY: "secret\nWLT_API_BASE_URL=https://other.example" },
    { "INVALID-NAME": "secret" },
  ]) {
    const response = await service.handle(request(values));
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("secret");
  }
  expect(await Bun.file(configFile()).exists()).toBe(false);
  expect(
    (await service.handle(request({ WLT_API_KEY: "fresh-key" }))).status,
  ).toBe(200);
  expect(environmentValue("WLT_API_KEY")).toBe("fresh-key");
});

test("arbitrary variables round-trip quoted values, empty values, and removal without leaking values", async () => {
  const service = await setup();
  const original = process.env.IMAGE_TO_WORLD_TEST_SETTING;
  process.env.IMAGE_TO_WORLD_TEST_SETTING = "inherited";
  try {
    const variables = {
      CUSTOM_TOKEN: "token with spaces # and 'quotes'",
      EMPTY_SETTING: "",
      IMAGE_TO_WORLD_TEST_SETTING: "saved",
    };
    expect((await service.handle(request(variables))).status).toBe(200);
    expect(parseEnv(await readFile(configFile(), "utf8"))).toEqual(variables);
    expect(environmentValue("EMPTY_SETTING")).toBe("");
    const status = await (
      await service.handle(new Request("http://127.0.0.1:4310/api/status"))
    ).json();
    expect(status.environment.CUSTOM_TOKEN).toEqual({
      configured: true,
      source: "saved",
    });
    expect(JSON.stringify(status)).not.toContain(variables.CUSTOM_TOKEN);
    expect(
      (
        await service.handle(
          request({ CUSTOM_TOKEN: null, IMAGE_TO_WORLD_TEST_SETTING: null }),
        )
      ).status,
    ).toBe(200);
    expect(environmentValue("CUSTOM_TOKEN")).toBeUndefined();
    expect(environmentValue("IMAGE_TO_WORLD_TEST_SETTING")).toBe("inherited");
    expect(parseEnv(await readFile(configFile(), "utf8"))).toEqual({
      EMPTY_SETTING: "",
    });
  } finally {
    if (original === undefined) delete process.env.IMAGE_TO_WORLD_TEST_SETTING;
    else process.env.IMAGE_TO_WORLD_TEST_SETTING = original;
  }
});

test("failed credential writes report an error and preserve the existing config", async () => {
  const service = await setup();
  await mkdir(configFile(), { recursive: true });
  const response = await service.handle(
    request({ WLT_API_KEY: "do-not-leak" }),
  );
  expect(response.status).toBe(400);
  expect(await response.text()).not.toContain("do-not-leak");
  expect((await stat(configFile())).isDirectory()).toBe(true);
});

test("the provider client uses a replaced key on its next request without restart", async () => {
  const service = await setup();
  const authorization: (string | null)[] = [];
  const network = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        authorization.push(request.headers.get("WLT-Api-Key"));
        return Response.json({ readUrl: "https://example.com/test.png" });
      },
      { preconnect: fetch.preconnect },
    ),
  );
  try {
    await service.handle(request({ WLT_API_KEY: "first-test-key" }));
    await worldLabs().assets.createReadUrl("test-asset");
    await service.handle(request({ WLT_API_KEY: "second-test-key" }));
    await worldLabs().assets.createReadUrl("test-asset");
    expect(authorization).toEqual(["first-test-key", "second-test-key"]);
  } finally {
    network.mockRestore();
  }
});
