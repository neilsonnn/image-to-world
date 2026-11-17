/** Model IDs, labels, defaults, and aliases shared by UI, CLI, and validation. */
export const imageModels = {
  "fal-ai/flux/schnell": {
    label: "FLUX Schnell",
    operation: "create",
    aliases: ["schnell"],
    defaults: { num_inference_steps: 4, num_images: 1, output_format: "png" },
  },
  "fal-ai/nano-banana-2/edit": {
    label: "Nano Banana 2",
    operation: "edit",
    aliases: ["2"],
    defaults: {},
  },
  "fal-ai/nano-banana-pro/edit": {
    label: "Nano Banana Pro",
    operation: "edit",
    aliases: ["pro"],
    defaults: {},
  },
} as const;
export type ImageModelId = keyof typeof imageModels;
export const defaultImageModels = {
  create: "fal-ai/flux/schnell",
  edit: "fal-ai/nano-banana-2/edit",
} as const;
export type ImageModelFor<T extends "create" | "edit"> = {
  [K in ImageModelId]: (typeof imageModels)[K]["operation"] extends T
    ? K
    : never;
}[ImageModelId];
export function modelIds<T extends "create" | "edit">(operation: T) {
  type Id = ImageModelFor<T>;
  return (Object.keys(imageModels) as ImageModelId[]).filter(
    (id) => imageModels[id].operation === operation,
  ) as [Id, ...Id[]];
}
export function resolveImageModel(
  value: string | undefined,
  operation: "create" | "edit",
) {
  if (!value) return defaultImageModels[operation];
  return (
    modelIds(operation).find(
      (id) =>
        id === value ||
        (imageModels[id].aliases as readonly string[]).includes(value),
    ) ?? value
  );
}
export const imageEditResolutions = ["1K", "2K", "4K"] as const;
export const imageEditRatios = [
  "auto",
  "21:9",
  "16:9",
  "3:2",
  "4:3",
  "5:4",
  "1:1",
  "4:5",
  "3:4",
  "2:3",
  "9:16",
] as const;

/** Suggestions, not an endpoint allowlist. General calls preserve arbitrary model JSON. */
export const modelSuggestions = [
  ...Object.entries(imageModels).map(([id, value]) => ({
    id,
    label: value.label,
    operation: value.operation,
    defaults: value.defaults,
  })),
  {
    id: "fal-ai/hunyuan3d-v3/image-to-3d",
    label: "Hunyuan 3D v3",
    operation: "mesh",
    defaults: { generate_type: "Normal", face_count: 40000, enable_pbr: true },
  },
];
