export const worldLabsKeyUrl = "https://atlas.worldlabs.ai/api-keys";
import { z } from "zod";

// Suggestions for an empty config, not an allowlist of supported variable names.
export const environmentDefaults: Record<string, string> = {
  WLT_API_KEY: "",
  FAL_KEY: "",
};

export const environmentNameSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Use a valid environment variable name")
  .max(128);
export const environmentPatchSchema = z
  .record(
    environmentNameSchema,
    z
      .string()
      .max(32768)
      .regex(/^[^\0\r\n]*$/, "Use a single-line value")
      .nullable(),
  )
  .refine(
    (values) => Object.keys(values).length > 0,
    "Enter at least one variable",
  );

export type EnvironmentStatus = Record<
  string,
  {
    configured: boolean;
    source: "saved" | "process" | "unset";
  }
>;
