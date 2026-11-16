import { z } from "zod";
export const moduleParameters = z.record(
  z.union([z.string(), z.number().finite(), z.boolean()]),
);
export const proceduralSchema = z
  .object({
    sourceAssetId: z.string(),
    bundleAssetId: z.string(),
    sourceAssetIds: z.array(z.string()).default([]),
    assetIds: z.array(z.string()).default([]),
    parameters: moduleParameters.default({}),
    seed: z.number().int().default(1),
    enabled: z.boolean().default(true),
  })
  .strict();
