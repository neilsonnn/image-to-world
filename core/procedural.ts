import { z } from "zod";
type ParameterValue =
  | null
  | boolean
  | number
  | string
  | ParameterValue[]
  | { [key: string]: ParameterValue };

const parameterValue: z.ZodType<ParameterValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(parameterValue),
    z.record(parameterValue),
  ]),
);
export const moduleParameters = z.record(parameterValue);
export type ModuleParameters = z.infer<typeof moduleParameters>;
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
