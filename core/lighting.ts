import { z } from "zod";

const color = z.string().regex(/^#[0-9a-f]{6}$/i, "Use a six-digit hex color");
export const lightNumbers = {
  fillIntensity: {
    label: "Fill intensity",
    min: 0,
    max: 20,
    step: 0.1,
    initial: 2,
  },
  keyIntensity: {
    label: "Key intensity",
    min: 0,
    max: 20,
    step: 0.1,
    initial: 3,
  },
  azimuth: {
    label: "Key azimuth (°)",
    min: -180,
    max: 180,
    step: 1,
    initial: (Math.atan2(4, 5) * 180) / Math.PI,
  },
  elevation: {
    label: "Key elevation (°)",
    min: -90,
    max: 90,
    step: 1,
    initial: (Math.atan2(8, Math.hypot(4, 5)) * 180) / Math.PI,
  },
} as const;
function setting({
  min,
  max,
  initial,
}: (typeof lightNumbers)[keyof typeof lightNumbers]) {
  return z.number().finite().min(min).max(max).default(initial);
}
export const lightColors = {
  fillColor: "Fill color",
  keyColor: "Key color",
} as const;
export const lightRigSchema = z
  .object({
    fillColor: color.default("#ffffff"),
    fillIntensity: setting(lightNumbers.fillIntensity),
    keyColor: color.default("#ffffff"),
    keyIntensity: setting(lightNumbers.keyIntensity),
    keyShadows: z
      .boolean()
      .default(false)
      .describe("Cast directional key-light shadows on scene meshes"),
    azimuth: setting(lightNumbers.azimuth),
    elevation: setting(lightNumbers.elevation),
    background: color.nullable().default(null),
  })
  .strict();
export const projectLightSchema = lightRigSchema.extend({
  environmentAssetId: z
    .string()
    .min(1)
    .nullable()
    .default(null)
    .describe(
      "Equirectangular panorama image used for reflections and diffuse illumination",
    ),
  environmentIntensity: z.number().finite().min(0).max(20).default(1),
  environmentYaw: z.number().finite().min(-180).max(180).default(0),
});
export const defaultLighting = projectLightSchema.parse({});
export type LightRig = z.infer<typeof lightRigSchema>;
export type ProjectLighting = z.infer<typeof projectLightSchema>;

/** A Frame may override the lamps and backdrop; the panorama belongs to the scene. */
export function frameRig(project: ProjectLighting): LightRig {
  return lightRigSchema.strip().parse(project);
}
