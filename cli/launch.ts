import { createHash } from "node:crypto";
import { access, mkdir, readFile, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";

const root = path.resolve(import.meta.dir, "..");

async function launchEnvironment() {
  const config = path.join(
    process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config"),
    "worldbash",
    "env",
  );
  const read = async (file: string) => {
    try {
      return parseEnv(await readFile(file, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return {};
    }
  };
  return {
    config,
    env: {
      ...(await read(config)),
      ...(await read(path.join(root, ".env"))),
      ...process.env,
    },
  };
}

export async function buildFingerprint(directory = root) {
  const hash = createHash("sha256")
    .update(Bun.version)
    .update(process.platform)
    .update(process.arch);
  for (const pattern of [
    "*.json",
    "*.lock",
    "web/*.ts",
    "web/*.json",
    "core/**/*",
    "cli/**/*",
    "web/src/**/*",
    "web/public/**/*",
  ]) {
    const files = [];
    for await (const file of new Bun.Glob(pattern).scan({
      cwd: directory,
      onlyFiles: true,
    })) {
      if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
      files.push(file);
    }
    for (const file of files.sort())
      hash.update(file).update(await readFile(path.join(directory, file)));
  }
  return hash.digest("hex");
}

export async function doctor(project?: string) {
  const { env, config } = await launchEnvironment();
  const workspace = path.resolve(
    project || env.WORLDBASH_WORKSPACE || path.join(root, ".worldbash"),
  );
  let existing = workspace;
  let directoryExists = false;
  for (;;) {
    try {
      directoryExists = (await stat(existing)).isDirectory();
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      existing = path.dirname(existing);
    }
  }
  const writable = await access(existing, constants.W_OK).then(
    () => true,
    () => false,
  );
  const checks = [
    {
      name: "bun",
      ok: Bun.semver.satisfies(Bun.version, ">=1.3.10"),
      fix: "Install Bun 1.3.10 or newer.",
    },
    {
      name: "dependencies",
      ok: await Bun.file(
        path.join(root, "node_modules/vite/package.json"),
      ).exists(),
      fix: "Run bun install --frozen-lockfile.",
    },
    {
      name: "workspace",
      ok: directoryExists && writable,
      fix: `Choose a writable project directory: ${workspace}`,
    },
    {
      name: "worldLabs",
      ok: !!env.WLT_API_KEY,
      optional: true,
      fix: `Set WLT_API_KEY in ${config} or .env for posing and Atlas.`,
    },
    {
      name: "fal",
      ok: !!env.FAL_KEY,
      optional: true,
      fix: `Set FAL_KEY in ${config} or .env for image edits.`,
    },
    {
      name: "ffmpeg",
      ok: !!Bun.which(env.FFMPEG_PATH || "ffmpeg"),
      optional: true,
      fix: "Install FFmpeg or set FFMPEG_PATH for video encoding.",
    },
    {
      name: "ffprobe",
      ok: !!Bun.which(env.FFPROBE_PATH || "ffprobe"),
      optional: true,
      fix: "Install ffprobe or set FFPROBE_PATH for video reconstruction.",
    },
  ];
  return {
    workspace,
    config,
    checks,
    ok: checks.every((check) => check.ok || check.optional),
  };
}

export async function openProject(
  project?: string,
  options: { port?: string; noBrowser?: boolean } = {},
) {
  const { env } = await launchEnvironment();
  const port = Number(options.port ?? 4310);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Port must be an integer from 1 to 65535");
  const workspace = path.resolve(
    project || env.WORLDBASH_WORKSPACE || path.join(root, ".worldbash"),
  );
  await mkdir(workspace, { recursive: true });
  const canonical = await realpath(workspace);
  const url = `http://127.0.0.1:${port}`;
  const status = async () => {
    const response = await fetch(`${url}/api/status`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok)
      throw new Error(`Port ${port} is occupied. Choose --port <number>.`);
    const result = (await response.json()) as {
      application?: string;
      workspacePath?: string;
    };
    if (
      result.application !== "worldbash" ||
      !result.workspacePath ||
      (await realpath(result.workspacePath)) !== canonical
    )
      throw new Error(
        `Port ${port} serves another app or project. Choose --port <number>.`,
      );
  };
  const show = async () => {
    process.stdout.write(JSON.stringify({ url, workspace: canonical }) + "\n");
    if (options.noBrowser) return;
    const command =
      process.platform === "darwin"
        ? ["open", url]
        : process.platform === "win32"
          ? ["explorer.exe", url]
          : ["xdg-open", url];
    try {
      const child = Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
      if ((await child.exited) !== 0) throw new Error("Browser opener failed");
    } catch {
      process.stderr.write(`Open ${url} in your browser.\n`);
    }
  };
  try {
    await status();
    await show();
    return;
  } catch (error) {
    if (
      !["ECONNREFUSED", "ConnectionRefused"].includes(
        (error as NodeJS.ErrnoException).code || "",
      )
    )
      throw error;
  }
  const stamp = Bun.file(path.join(root, "web/dist/.worldbash-build"));
  const fingerprint = await buildFingerprint();
  if (
    !(await stamp.exists()) ||
    (await stamp.text()) !== fingerprint ||
    !(await Bun.file(path.join(root, "web/dist/server/server.js")).exists())
  ) {
    process.stderr.write("Building worldbash…\n");
    const build = Bun.spawn([process.execPath, "run", "build"], {
      cwd: root,
      env,
      stdout: "inherit",
      stderr: "inherit",
    });
    if ((await build.exited) !== 0)
      throw new Error(
        "Build failed. Run bun install --frozen-lockfile, then try again.",
      );
    await Bun.write(stamp, await buildFingerprint());
  }
  const child = Bun.spawn([process.execPath, "server.ts"], {
    cwd: path.join(root, "web"),
    env: { ...env, WORLDBASH_WORKSPACE: canonical, PORT: String(port) },
    stdout: "inherit",
    stderr: "inherit",
  });
  const stop = () => child.kill("SIGTERM");
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null)
        throw new Error(
          `Server exited (${child.exitCode}). Check the output above.`,
        );
      try {
        await status();
        ready = true;
        break;
      } catch (error) {
        if (
          !["ECONNREFUSED", "ConnectionRefused"].includes(
            (error as NodeJS.ErrnoException).code || "",
          )
        )
          throw error;
      }
      await Bun.sleep(100);
    }
    if (!ready)
      throw new Error("Server did not become ready within 10 seconds.");
    await show();
    process.stderr.write("Keep this terminal open; Ctrl+C stops worldbash.\n");
    const code = await child.exited;
    if (code !== 0 && code !== 143) throw new Error(`Server exited (${code}).`);
  } finally {
    if (child.exitCode === null) {
      stop();
      await child.exited;
    }
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}
