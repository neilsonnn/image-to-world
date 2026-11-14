import { readFileSync } from "node:fs";
import { mkdir, writeFile, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";
import {
  environmentDefaults,
  environmentPatchSchema,
  type EnvironmentStatus,
} from "../../../core/environment";

export function configFile() {
  return path.join(
    process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config"),
    "image-to-world",
    "env",
  );
}

function configText() {
  try {
    return readFileSync(configFile(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw new Error("Could not read the image-to-world user configuration");
  }
}

// Read on demand so saving in one local editor also updates other projects.
export function environmentValue(name: string) {
  const saved = parseEnv(configText());
  return Object.hasOwn(saved, name) ? saved[name] : process.env[name];
}

export function environmentStatus(): EnvironmentStatus {
  const saved = parseEnv(configText());
  return Object.fromEntries(
    Object.keys({ ...environmentDefaults, ...saved }).map((name) => {
      const stored = Object.hasOwn(saved, name);
      const value = stored ? saved[name] : process.env[name];
      return [
        name,
        {
          configured: Boolean(value),
          source: stored ? "saved" : value !== undefined ? "process" : "unset",
        },
      ];
    }),
  );
}

function dotenvValue(value: string) {
  for (const quote of ['"', "'", "`"])
    if (!value.includes(quote)) return `${quote}${value}${quote}`;
  if (value.trim() === value && !value.includes("#") && !/^["'`]/.test(value))
    return value;
  throw new Error(
    "Cannot represent this value in dotenv: use a value without at least one of the three quote styles.",
  );
}

let writing: Promise<void> = Promise.resolve();
export function saveEnvironment(input: Record<string, string | null>) {
  const values = environmentPatchSchema.parse(input);
  const save = writing
    .catch(() => {})
    .then(async () => {
      let text = configText();
      for (const [name, value] of Object.entries(values)) {
        // Match a complete dotenv assignment, including a previously quoted value.
        const assignment = new RegExp(
          "^[ \\t]*(?:export[ \\t]+)?" +
            name +
            "[ \\t]*=[ \\t]*(?:\"[^\"]*\"|'[^']*'|`[^`]*`|[^\\r\\n]*)[^\\r\\n]*(?:\\r?\\n|$)",
          "gm",
        );
        text = text.replace(assignment, "");
        if (text && !text.endsWith("\n")) text += "\n";
        if (value !== null) text += `${name}=${dotenvValue(value)}\n`;
      }
      const file = configFile();
      const temporary = `${file}.${crypto.randomUUID()}.tmp`;
      try {
        await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
        await writeFile(temporary, text, { mode: 0o600, flag: "wx" });
        await rename(temporary, file);
      } catch {
        throw new Error(
          "Could not save environment variables. Check permissions on the image-to-world configuration folder.",
        );
      } finally {
        await rm(temporary, { force: true });
      }
    });
  writing = save;
  return save;
}
