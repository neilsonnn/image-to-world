import { z } from "zod";

const finite = z.number().finite();
export const colorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color");
export const primitiveShapes = {
  box: "Box",
  plane: "Plane",
  sphere: "Sphere",
  cylinder: "Cylinder",
  cone: "Cone",
  capsule: "Capsule",
} as const;
export const primitiveSchema = z
  .object({
    shape: z.enum(["box", "plane", "sphere", "cylinder", "cone", "capsule"]),
    size: z
      .tuple([finite.positive(), finite.positive(), finite.positive()])
      .default([1, 1, 1]),
    segments: finite.int().min(3).max(128).default(24),
  })
  .strict();
export const surfaceSchema = z
  .object({
    shading: z.enum(["standard", "unlit", "toon"]).default("standard"),
    color: colorSchema.default("#d1bba0"),
    roughness: finite.min(0).max(1).default(0.65),
    metalness: finite.min(0).max(1).default(0),
    emissive: colorSchema.default("#000000"),
    emissiveIntensity: finite.min(0).max(20).default(0),
    opacity: finite.min(0).max(1).default(1),
    textureAssetId: z.string().optional(),
    nearest: z.boolean().default(false),
    doubleSided: z.boolean().default(false),
  })
  .strict();
export const lightSchema = z
  .object({
    type: z.enum(["ambient", "directional", "point"]),
    color: colorSchema.default("#ffffff"),
    intensity: finite.min(0).max(10000).default(3),
    distance: finite.min(0).max(100000).default(0),
    shadows: z.boolean().default(true),
  })
  .strict();
export const parameterValue = z.union([z.string(), finite, z.boolean()]);
export const parameterField = z
  .object({
    type: z.enum(["number", "string", "boolean", "color", "select", "asset"]),
    label: z.string().optional(),
    default: parameterValue,
    min: finite.optional(),
    max: finite.optional(),
    step: finite.positive().optional(),
    options: z.array(z.string()).optional(),
  })
  .strict();
export type ParameterField = z.infer<typeof parameterField>;
export const proceduralSchema = z
  .object({
    sourceAssetId: z.string(),
    bundleAssetId: z.string(),
    assetIds: z.array(z.string()).default([]),
    parameters: z.record(parameterValue).default({}),
    fields: z.record(parameterField).default({}),
    seed: finite.int().default(1),
    enabled: z.boolean().default(true),
  })
  .strict();
export const imageSurfaceSchema = z
  .object({
    mode: z.enum(["reference", "surface", "sprite"]).default("reference"),
    width: finite.positive().default(2),
    nearest: z.boolean().default(false),
    alphaTest: finite.min(0).max(1).default(0.01),
  })
  .strict();
export const animationSchema = z
  .object({
    clip: z.string(),
    speed: finite.default(1),
    offset: finite.default(0),
    loop: z.boolean().default(true),
  })
  .strict();

export const artDirectionSchema = z
  .object({
    preset: z
      .enum(["studio", "cinematic", "pixel", "custom"])
      .default("studio"),
    background: colorSchema.default("#20242d"),
    environment: z.enum(["studio", "none", "asset"]).default("studio"),
    environmentAssetId: z.string().optional(),
    environmentIntensity: finite.min(0).max(10).default(0.5),
    exposure: finite.min(0.05).max(10).default(1),
    ambient: finite.min(0).max(10).default(0.8),
    key: finite.min(0).max(20).default(2),
    shadows: z.boolean().default(true),
    bloom: finite.min(0).max(3).default(0),
    bloomThreshold: finite.min(0).max(5).default(1),
    pixelSize: finite.int().min(1).max(16).default(1),
    lensDistortion: finite.min(-0.8).max(0.8).default(0),
    vignette: finite.min(0).max(1).default(0),
    time: finite.min(0).default(0),
  })
  .strict();
export type ArtDirection = z.infer<typeof artDirectionSchema>;
export const artPresets = {
  studio: { label: "Studio", settings: artDirectionSchema.parse({}) },
  cinematic: {
    label: "Cinematic",
    settings: artDirectionSchema.parse({
      preset: "cinematic",
      background: "#10131c",
      ambient: 0.3,
      key: 2,
      environmentIntensity: 0.35,
      exposure: 0.8,
      bloom: 0.12,
      bloomThreshold: 2.5,
      vignette: 0.18,
    }),
  },
  pixel: {
    label: "Pixel diorama",
    settings: artDirectionSchema.parse({
      preset: "pixel",
      background: "#b8c9df",
      environment: "none",
      ambient: 2,
      key: 3,
      bloom: 0,
      pixelSize: 3,
      shadows: false,
    }),
  },
} as const;
export const artFields = {
  background: { label: "Background", type: "color" },
  environmentIntensity: {
    label: "Environment",
    type: "number",
    min: 0,
    max: 10,
    step: 0.1,
  },
  exposure: {
    label: "Exposure",
    type: "number",
    min: 0.05,
    max: 10,
    step: 0.05,
  },
  ambient: { label: "Fill light", type: "number", min: 0, max: 10, step: 0.1 },
  key: { label: "Key light", type: "number", min: 0, max: 20, step: 0.1 },
  shadows: { label: "Shadows", type: "boolean" },
  bloom: { label: "Bloom", type: "number", min: 0, max: 3, step: 0.05 },
  bloomThreshold: {
    label: "Bloom threshold",
    type: "number",
    min: 0,
    max: 5,
    step: 0.1,
  },
  pixelSize: { label: "Pixel size", type: "number", min: 1, max: 16, step: 1 },
  lensDistortion: {
    label: "Lens distortion",
    type: "number",
    min: -0.8,
    max: 0.8,
    step: 0.05,
  },
  vignette: { label: "Vignette", type: "number", min: 0, max: 1, step: 0.05 },
  time: { label: "Time", type: "number", min: 0, step: 0.1 },
} as const;

export function resolveParameters(
  fields: Record<string, ParameterField>,
  values: Record<string, string | number | boolean>,
) {
  const result: Record<string, string | number | boolean> = {};
  for (const [key, raw] of Object.entries(fields)) {
    const field = parameterField.parse(raw),
      value = values[key] ?? field.default;
    if (field.type === "number") {
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        (field.min !== undefined && value < field.min) ||
        (field.max !== undefined && value > field.max)
      )
        throw new Error(`Invalid numeric parameter ${key}`);
    } else if (field.type === "boolean") {
      if (typeof value !== "boolean")
        throw new Error(`Invalid boolean parameter ${key}`);
    } else if (
      typeof value !== "string" ||
      (field.type === "color" && !colorSchema.safeParse(value).success) ||
      (field.type === "select" && !field.options?.includes(value))
    )
      throw new Error(`Invalid parameter ${key}`);
    result[key] = value;
  }
  for (const key of Object.keys(values))
    if (!fields[key]) throw new Error(`Unknown procedural parameter ${key}`);
  return result;
}

export const materialFields = {
  shading: {
    label: "Shading",
    type: "select",
    options: ["standard", "unlit", "toon"],
  },
  color: { label: "Color", type: "color" },
  roughness: { label: "Roughness", type: "number", min: 0, max: 1, step: 0.05 },
  metalness: { label: "Metalness", type: "number", min: 0, max: 1, step: 0.05 },
  emissive: { label: "Emission", type: "color" },
  emissiveIntensity: {
    label: "Glow",
    type: "number",
    min: 0,
    max: 20,
    step: 0.1,
  },
  opacity: { label: "Opacity", type: "number", min: 0, max: 1, step: 0.05 },
  nearest: { label: "Pixel texture", type: "boolean" },
  doubleSided: { label: "Double sided", type: "boolean" },
};

export const lightFields = {
  type: { type: "select", options: ["ambient", "directional", "point"] },
  color: { type: "color" },
  intensity: { type: "number", min: 0, max: 10000, step: 0.1 },
  distance: { type: "number", min: 0 },
  shadows: { type: "boolean" },
} as const;
