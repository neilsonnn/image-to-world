import { lightRigSchema, projectLightSchema } from "./lighting";
import { proceduralSchema } from "./procedural";
import { nodePhysicsSchema } from "./physics";
import {
  defaultImageModels,
  modelIds,
  imageEditResolutions,
  imageEditRatios,
} from "./models";
import { environmentPatchSchema } from "./environment";
import { z } from "zod";

const number = z.number().finite();
export const vec3 = z.tuple([number, number, number]);
export const quaternion = z
  .tuple([number, number, number, number])
  .refine(
    (q) => Math.abs(Math.hypot(...q) - 1) < 0.01,
    "Use a unit quaternion",
  );
export const projectionSchema = z
  .object({
    fx: number.positive(),
    fy: number.positive(),
    cx: number,
    cy: number,
    width: number.int().positive(),
    height: number.int().positive(),
  })
  .strict();
export type Projection = z.infer<typeof projectionSchema>;
export const cameraSchema = z.object({
  extrinsics: z.object({
    position: vec3,
    quaternion,
    coordinateSystem: z.enum(["rub", "rdf"]).default("rub"),
  }),
  intrinsics: projectionSchema,
});
export type Camera = z.infer<typeof cameraSchema>;
export const cameraAimSchema = z
  .object({
    position: vec3,
    target: vec3,
    up: vec3.default([0, 1, 0]),
    frameId: z.string().nullable().default(null),
    projection: projectionSchema.optional(),
    fov: number.min(10).max(120).optional(),
  })
  .strict();
export type CameraAim = z.input<typeof cameraAimSchema>;

export const transformSchema = z.object({
  position: vec3,
  quaternion,
  scale: vec3.refine((v) => v.every((n) => n > 0), "Scale must be positive"),
});
export const identity = () => ({
  position: [0, 0, 0] as [number, number, number],
  quaternion: [0, 0, 0, 1] as [number, number, number, number],
  scale: [1, 1, 1] as [number, number, number],
});
export const defaultCamera = (): Camera => ({
  extrinsics: {
    position: [4, 3, 6],
    quaternion: [-0.18, 0.29, 0.055, 0.938549412],
    coordinateSystem: "rub",
  },
  intrinsics: { fx: 850, fy: 850, cx: 640, cy: 360, width: 1280, height: 720 },
});
export const strokeSchema = z.object({
  id: z.string(),
  points: z
    .array(z.tuple([number.min(0).max(1), number.min(0).max(1)]))
    .min(1)
    .max(10000),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  size: number.min(0.001).max(0.2),
  erase: z.boolean().default(false),
});
export const imageDraftSchema = z.object({
  strokes: z.array(strokeSchema).max(1000).default([]),
  layers: z
    .array(
      z.object({
        id: z.string(),
        assetId: z.string(),
        x: number,
        y: number,
        width: number.positive(),
        height: number.positive(),
        opacity: number.min(0).max(1),
        visible: z.boolean(),
      }),
    )
    .max(100)
    .default([]),
});
export type ImageDraft = z.infer<typeof imageDraftSchema>;
export const nanoSettingsSchema = z.object({
  model: z.enum(modelIds("edit")).default(defaultImageModels.edit),
  resolution: z.enum(imageEditResolutions).default("1K"),
  aspectRatio: z.enum(imageEditRatios).default("auto"),
  numImages: number.int().min(1).max(4).default(1),
  seed: number.int().optional(),
});
export const assetSchema = z.object({
  sourceAssetIds: z.array(z.string()).optional(),
  role: z
    .enum([
      "image",
      "mesh",
      "mask",
      "depth",
      "thumbnail",
      "observation",
      "render",
      "raw-result",
    ])
    .optional(),
  providerOutputPaths: z.array(z.string()).optional(),
  contentHash: z.string().optional(),
  parentAssetId: z.string().optional(),
  referenceAssetIds: z.array(z.string()).optional(),
  id: z.string(),
  name: z.string(),
  path: z.string(),
  kind: z.enum(["image", "depth", "splat", "mesh", "video", "file"]),
  mimeType: z.string(),
  size: number,
  modifiedAt: number,
  missing: z.boolean().default(false),
  trashedAt: number.optional(),
  depthEncoding: z
    .discriminatedUnion("type", [
      z.object({ type: z.literal("linear") }),
      z.object({
        type: z.literal("log"),
        zMin: number.positive(),
        zMax: number.positive(),
      }),
    ])
    .optional(),
  camera: cameraSchema.optional(),
  centroidWorld: vec3.optional(),
  depthAssetId: z.string().optional(),
  confidenceAssetId: z.string().optional(),
  maskAssetId: z.string().optional(),
  jobId: z.string().optional(),
  frameIndex: number.int().nonnegative().optional(),
  frameTime: number.nonnegative().optional(),
  sourceVideoId: z.string().optional(),
  geometrySourceAssetId: z.string().optional(),
});
export type Asset = z.infer<typeof assetSchema>;
export const atlasContextSchema = z.object({
  order: z.array(z.string()).default([]),
  excludedIds: z.array(z.string()).default([]),
  soloIds: z.array(z.string()).default([]),
});
export const placementModeSchema = z.enum([
  "individual",
  "reconstruct",
  "reference",
]);
export type PlacementMode = z.infer<typeof placementModeSchema>;

const frameActor = z.string().trim().min(1).max(120);
const frameDescription = z
  .string()
  .trim()
  .max(80)
  .regex(/^\S+(?: \S+){1,3}$/, "Describe the task in two to four words");

export const nodeSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    kind: z.enum([
      "group",
      "capture",
      "points",
      "image",
      "splat",
      "mesh",
      "camera",
      "path",
      "clip",
      "video",
      "procedural",
    ]),
    parentId: z.string().nullable().default(null),
    order: number.int().nonnegative().optional(),
    visible: z.boolean().default(true),
    transform: transformSchema.default(identity),
    assetId: z.string().optional(),
    locked: z.boolean().optional(),
    transformPermissions: z
      .object({
        translate: z.boolean().optional(),
        rotate: z.boolean().optional(),
        scale: z.boolean().optional(),
      })
      .strict()
      .optional(),
    procedural: proceduralSchema.optional(),
    frameSlug: z
      .string()
      .max(80)
      .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+){1,2}$/)
      .optional(),
    frameWorkers: z
      .array(z.object({ actor: frameActor, description: frameDescription }))
      .optional(),
    physics: nodePhysicsSchema.nullish(),
    lighting: lightRigSchema
      .nullish()
      .describe("Light rig while looking through this Frame"),
    observationAssetIds: z.array(z.string()).optional(),
    geometryAssetId: z.string().optional(),
    jobId: z.string().optional(),
    clipInitialized: z.boolean().optional(),
    context: atlasContextSchema.optional(),
    contextFrozen: z
      .boolean()
      .optional()
      .describe(
        "Group this Frame with imported context; editing remains enabled.",
      ),
    projection: projectionSchema.optional(),
    fov: number.min(10).max(120).optional(),
    targetFrameCount: number.int().min(2).max(600).optional(),
    keyframes: z
      .array(
        z.object({
          id: z.string(),
          camera: cameraSchema,
        }),
      )
      .optional(),
    clip: z
      .object({
        scope: z.enum(["global", "local"]),
        invert: z.boolean(),
        softness: number.nonnegative(),
      })
      .optional(),
  })
  .strict();
export type SceneNode = z.infer<typeof nodeSchema>;
export const panelIds = [
  "assets",
  "scene",
  "inspector",
  "generate",
  "jobs",
] as const;
export const layoutSchema = z.object({
  agentGuideWidth: number.min(160).max(900).default(240),
  contextHeight: number.min(108).max(360).default(144),
  rightWidth: number.min(220).max(600).default(280),
  leftSplit: number.min(0.2).max(0.8).default(0.6),
  historyWidth: number.min(110).max(320).default(160),
});
export const displaySchema = z.object({
  showImages: z.boolean().default(true),
  imageOpacity: number.min(0).max(1).default(0.35),
  imageDistance: number.min(0.1).max(10).default(0.25),
  showPoints: z.boolean().default(true),
  showFrameGuides: z.boolean().default(true),
  pointStyle: z.enum(["gaussian", "points"]).default("gaussian"),
  showFrustums: z.boolean().default(true),
});
export const viewportOptionsSchema = z
  .object({
    frameThumbnails: z.boolean().optional(),
    passepartout: z.boolean().default(false),
    maskOpacity: number.min(0).max(1).default(0.8),
    near: number.min(0.001).max(1000).default(0.01),
    far: number.min(1).max(1000000).default(10000),
  })
  .refine(
    (value) => value.far > value.near,
    "Far clipping must be beyond near clipping",
  );
export const collectionSettingsSchema = z.object({
  assetSearch: z.string().default(""),
  sceneSearch: z.string().default(""),
  assetTrash: z.boolean().default(false),
  collapsedFrameIds: z.array(z.string()).optional(),
  expandedNodeIds: z.array(z.string()).default([]),
  assetView: z.enum(["list", "grid"]).default("list"),
  assetKinds: z
    .array(z.enum(["image", "depth", "splat", "mesh", "video", "file"]))
    .default(["image", "splat", "mesh", "video", "file"]),
});
export const settingsSchema = z.object({
  lighting: projectLightSchema.optional(),
  atlas: atlasContextSchema.default({}),
  atlasPanel: z
    .object({
      selectedOnly: z.boolean().default(false),
      jobId: z.string().nullable().default(null),
      keyframeCount: number.int().min(2).max(60).default(4),
    })
    .default({}),
  viewingCameraId: z.string().nullable().default(null),
  freeCamera: cameraSchema.nullable().default(null),
  format: z
    .object({ width: number.int().positive(), height: number.int().positive() })
    .nullable()
    .default(null),
  seed: number.int().nonnegative().default(42),
  seedMode: z.enum(["auto", "locked"]).default("auto"),
  enhancePrompt: z.boolean().default(true),
  enhancedCaption: z
    .object({ prompt: z.string(), text: z.string() })
    .nullable()
    .optional(),
  captionEpoch: z.number().int().nonnegative().optional(),
  layout: layoutSchema.default({}),
  display: displaySchema.default({}),
  collections: collectionSettingsSchema.default({}),
  editor2d: z
    .object({
      activeAssetId: z.string().nullable(),
      reconstruct: z.boolean().default(true),
      referenceAssetIds: z.array(z.string()),
      prompt: z.string(),
      settings: nanoSettingsSchema,
      height: number.min(240).max(1000),
      zoom: number.min(0.1).max(8),
      tool: z.enum(["pan", "draw", "erase"]),
      brushColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      brushSize: number.min(0.001).max(0.2),
    })
    .default({
      activeAssetId: null,
      referenceAssetIds: [],
      prompt: "",
      settings: {
        model: defaultImageModels.edit,
        resolution: "1K",
        aspectRatio: "auto",
        numImages: 1,
      },
      height: 400,
      zoom: 1,
      tool: "pan",
      brushColor: "#ff4040",
      brushSize: 0.01,
    }),
  panels: z.array(z.enum(panelIds)),
  activePanel: z.enum(panelIds),
  sidebarWidth: number.min(180).max(600),
  viewportCamera: cameraSchema,
  viewportOptions: viewportOptionsSchema.default({}),
  grid: z.boolean(),
  pointSize: number.positive().max(20),
  atlasReturnDepth: z.boolean().default(true),
  splatDraft: z.boolean().default(false),
  prompt: z.string(),
  falModel: z.string(),
  falInput: z.string(),
  fps: number.int().min(1).max(60),
  targetFrameCount: number.int().min(2).max(600),
});
export const renderInputSchema = z.object({
  setOnly: z
    .boolean()
    .optional()
    .describe(
      "Isolate the viewed Frame’s authored content, with its source RGB and points suppressed",
    ),
  lightingViewId: z
    .string()
    .optional()
    .describe(
      "Camera or Frame whose lighting applies; omit to use scene lighting",
    ),
  kind: z.literal("render"),
  camera: cameraSchema,
  nodeIds: z.array(z.string()).min(1).optional(),
  passes: z
    .array(z.enum(["color", "mask", "depth", "ids"]))
    .min(1)
    .default(["color"]),
  referenceAssetId: z.string().optional(),
  overrides: z.record(transformSchema).default({}),
  near: number.positive().default(0.01),
  far: number.positive().default(10000),
});
export const probeInputSchema = z.object({
  kind: z.literal("probe"),
  nodeId: z.string().min(1).describe("Camera or Frame containing the probe"),
  position: vec3
    .optional()
    .describe(
      "Probe position relative to the named node; defaults to its camera origin",
    ),
  nodeIds: z
    .array(z.string())
    .min(1)
    .optional()
    .describe("Subtrees contributing visible content"),
  width: number.int().min(128).max(4096).multipleOf(4).default(1024),
});
export const maskInputSchema = z.object({
  kind: z.literal("mask"),
  assetIds: z.array(z.string()).min(1),
  operation: z.enum(["union", "intersection"]).default("union"),
  invert: z.boolean().default(false),
  dilate: number.int().min(0).max(32).default(0),
  feather: number.int().min(0).max(64).default(0),
});
export const observeInputSchema = z.object({
  kind: z.literal("observe"),
  nodeId: z.string(),
  region: z.object({
    x: number.min(0).max(1),
    y: number.min(0).max(1),
    width: number.positive().max(1),
    height: number.positive().max(1),
  }),
  polygon: z
    .array(z.tuple([number.min(0).max(1), number.min(0).max(1)]))
    .min(3)
    .optional(),
  maskAssetId: z.string().optional(),
  padding: number.min(0).max(1).default(0.1),
});
export const fitInputSchema = z.object({
  kind: z.literal("fit"),
  nodeId: z.string(),
  observationAssetId: z.string(),
  quaternion: z.tuple([number, number, number, number]).optional(),
});
const buildKey = z.string().trim().min(1).max(160).optional();
export const modelInputSchema = z.object({
  buildKey,
  kind: z.literal("model"),
  model: z.string().min(1),
  input: z.record(z.unknown()),
});
const inspectInputSchema = z.object({
  kind: z.literal("inspect"),
  nodeIds: z.array(z.string()).min(1).optional(),
});
const contactSheetInputSchema = z.object({
  kind: z.literal("contactSheet"),
  nodeIds: z.array(z.string()).min(1).optional(),
  jobIds: z.array(z.string()).min(1).optional(),
  assetIds: z.array(z.string()).min(1).optional(),
  columns: number.int().min(1).max(8).default(3),
  width: number.int().min(160).max(1024).default(384),
});
const imageInputSchema = z.object({
  kind: z.literal("image"),
  prompt: z.string().trim().min(1),
  model: z.enum(modelIds("create")).default(defaultImageModels.create),
  placement: cameraSchema,
  seed: number.int().optional(),
  nodeIds: z.array(z.string()).optional(),
});
const poseInputSchema = z.object({
  kind: z.literal("pose"),
  assetIds: z.array(z.string()).min(1),
  canonicalize: z.boolean().default(false),
  placement: cameraSchema.optional(),
  nodeIds: z.array(z.string()).optional(),
});
const atlasInputSchema = z.object({
  kind: z.literal("atlas"),
  contextPathId: z.string().optional(),
  nodeIds: z.array(z.string()).min(1),
  cameras: z.array(cameraSchema).min(1),
  prompt: z.string().default(""),
  enhancePrompt: z.boolean().default(true),
  returnDepth: z.boolean().default(true),
  seed: number.int().default(42),
});
const splatsInputSchema = z.object({
  kind: z.literal("splats"),
  nodeIds: z.array(z.string()).min(1),
  prompt: z.string().default(""),
  enhancePrompt: z.boolean().default(true),
  refine: z.boolean().default(false),
});
const videoInputSchema = z.object({
  kind: z.literal("video"),
  returnDepth: z.boolean().default(true),
  mode: z.enum(["dense", "keyframes"]).default("dense"),
  keyframeCount: number.int().min(2).max(60).default(4),
  sourceJobId: z.string().optional(),
  nodeIds: z.array(z.string()).min(1),
  pathId: z.string(),
  fps: number.int().min(1).max(60),
  targetFrameCount: number.int().min(2).max(600),
  prompt: z.string().default(""),
  seed: number.int().default(42),
});
const falInputSchema = z.object({
  kind: z.literal("fal"),
  buildKey,
  model: z.string().min(1),
  input: z.record(z.unknown()),
});
const nanoInputSchema = z.object({
  kind: z.literal("nano"),
  applyToScene: z.boolean().default(true),
  reconstruct: z.boolean().default(true),
  targetNodeIds: z.array(z.string()).min(1).optional(),
  unchangedMaskAssetId: z.string().optional(),
  sourceAssetId: z.string(),
  referenceAssetIds: z.array(z.string()).default([]),
  prompt: z.string().trim().min(1),
  settings: nanoSettingsSchema.default({}),
  draft: imageDraftSchema.optional(),
});
const reconstructInputSchema = z.object({
  kind: z.literal("reconstruct"),
  unchangedMaskAssetId: z.string().optional(),
  assetIds: z.array(z.string()).default([]),
  placement: cameraSchema.optional(),
  parentId: z.string().nullable().optional(),
  beforeId: z.string().nullable().optional(),
  videoAssetId: z.string().optional(),
  fps: number.positive().max(30).default(1),
  maxFrames: number.int().min(2).max(120).default(60),
  integrate: z.boolean().default(true),
});
const captureInputSchema = z.object({
  kind: z.literal("capture"),
  camera: cameraSchema.optional(),
});
export const jobInputSchema = z.discriminatedUnion("kind", [
  renderInputSchema,
  probeInputSchema,
  observeInputSchema,
  fitInputSchema,
  maskInputSchema,
  inspectInputSchema,
  contactSheetInputSchema,
  imageInputSchema,
  poseInputSchema,
  atlasInputSchema,
  splatsInputSchema,
  videoInputSchema,
  falInputSchema,
  nanoInputSchema,
  reconstructInputSchema,
  captureInputSchema,
]);
export type JobInput = z.infer<typeof jobInputSchema>;
export const jobSchema = z.object({
  activityCamera: cameraSchema.shape.extrinsics.optional(),
  interactive: z.boolean().optional(),
  snapshotRevision: number.int().optional(),
  actorId: z.string().optional(),
  requestId: z.string().optional(),
  pinnedAssets: z
    .record(z.object({ path: z.string(), hash: z.string() }))
    .optional(),
  id: z.string(),
  input: jobInputSchema,
  status: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]),
  createdAt: number,
  updatedAt: number,
  message: z.string(),
  remoteId: z.string().optional(),
  submittedAt: number.optional(),
  outputAssetIds: z.array(z.string()),
  error: z.string().optional(),
  request: z.unknown().optional(),
  poseOrigin: vec3.optional(),
  previewItems: z
    .array(
      z.object({
        assetId: z.string(),
        label: z.string(),
        nodeId: z.string().optional(),
        jobId: z.string().optional(),
        status: z.string().optional(),
      }),
    )
    .optional(),
  applyTargets: z
    .array(
      z.union([
        z.object({
          nodeId: z.string(),
          assetId: z.string().optional(),
          cameraId: z.string(),
          imageId: z.string(),
          pointsId: z.string(),
        }),
        z.object({
          nodeId: z.string(),
          assetId: z.string(),
          error: z.string(),
        }),
      ]),
    )
    .optional(),
  applyRoots: z.array(z.string()).default([]),
  appliedTargets: z.array(z.string()).default([]),
  applicationError: z.string().optional(),
  resultOwnerId: z.string().optional(),
  applied: z.boolean().optional(),
  childJobId: z.string().optional(),
  frameAssetIds: z.array(z.string()).optional(),
  extractedFrameIds: z.array(z.string()).optional(),
  sourceFrameAssetIds: z.array(z.string()).optional(),
  frameIndices: z.array(number.int().nonnegative()).optional(),
  cameras: z.array(cameraSchema).optional(),
  reconstructionScale: number.positive().optional(),
  contextSnapshot: z
    .object({
      nodes: z.record(nodeSchema),
      generatedGuideIds: z.array(z.string()).optional(),
      assets: z.record(assetSchema),
      settings: settingsSchema,
    })
    .optional(),
});
export type Job = z.infer<typeof jobSchema>;
// Only history, navigation and UI fields travel with the live scene.
export const jobSummarySchema = jobSchema
  .omit({
    contextSnapshot: true,
    pinnedAssets: true,
    request: true,
    previewItems: true,
    cameras: true,
  })
  .extend({
    input: z.discriminatedUnion("kind", [
      renderInputSchema.pick({ kind: true }),
      probeInputSchema.pick({ kind: true, nodeId: true }),
      observeInputSchema.pick({ kind: true, nodeId: true }),
      fitInputSchema.pick({ kind: true, nodeId: true }),
      maskInputSchema.pick({ kind: true }),
      inspectInputSchema,
      contactSheetInputSchema.pick({ kind: true }),
      imageInputSchema.pick({ kind: true, model: true, nodeIds: true }),
      poseInputSchema.pick({ kind: true, nodeIds: true }),
      atlasInputSchema.pick({ kind: true, nodeIds: true }),
      splatsInputSchema.pick({ kind: true, nodeIds: true, refine: true }),
      videoInputSchema,
      falInputSchema.pick({ kind: true, model: true, buildKey: true }),
      nanoInputSchema.omit({ draft: true }),
      reconstructInputSchema.pick({ kind: true }),
      captureInputSchema,
    ]),
  });
export type JobSummary = z.infer<typeof jobSummarySchema>;
const changeSchema = z.object({
  path: z.array(z.string()).min(1),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
});
const editSelectionSchema = z.object({
  selection: z.array(z.string()),
  primaryId: z.string().nullable(),
  selectionAnchor: z.string().nullable(),
});
export const editSchema = z.object({
  id: z.string().optional(),
  actorId: z.string().optional(),
  requestId: z.string().optional(),
  selection: z
    .object({ before: editSelectionSchema, after: editSelectionSchema })
    .optional(),
  scope: z.string().optional(),
  label: z.string(),
  changes: z.array(changeSchema),
});
export type Edit = z.infer<typeof editSchema>;
export const workspaceSchema = z.object({
  primaryId: z.string().nullable().default(null),
  selectionAnchor: z.string().nullable().default(null),
  undo: z.array(editSchema).max(100).default([]),
  redo: z.array(editSchema).max(100).default([]),
  version: z.literal(8),
  revision: number.int().nonnegative(),
  name: z.string().min(1),
  imageDrafts: z.record(imageDraftSchema).default({}),
  imageVersions: z.record(z.string()).default({}),
  receipts: z
    .record(
      z.object({
        body: z.string(),
        result: z
          .object({
            revision: number,
            jobId: z.string().optional(),
            jobIds: z.array(z.string()).optional(),
            nodeIds: z.array(z.string()).optional(),
            editId: z.string().optional(),
          })
          .nullable(),
      }),
    )
    .default({}),
  resultApplications: z.record(z.array(z.string())).default({}),
  resultOwners: z.record(z.string()).default({}),
  assets: z.record(assetSchema),
  nodes: z.record(nodeSchema),
  jobs: z.record(jobSummarySchema),
  selection: z.array(z.string()),
  settings: settingsSchema,
});
export type Workspace = z.infer<typeof workspaceSchema>;
export function emptyWorkspace(): Workspace {
  return {
    primaryId: null,
    selectionAnchor: null,
    undo: [],
    redo: [],
    version: 8,
    revision: 0,
    name: "Untitled workspace",
    imageDrafts: {},
    imageVersions: {},
    resultApplications: {},
    resultOwners: {},
    receipts: {},
    assets: {},
    nodes: {},
    jobs: {},
    selection: [],
    settings: {
      layout: layoutSchema.parse({}),
      display: displaySchema.parse({}),
      collections: collectionSettingsSchema.parse({}),
      editor2d: settingsSchema.shape.editor2d.parse(undefined),
      panels: [...panelIds],
      activePanel: "assets",
      sidebarWidth: 240,
      viewportCamera: defaultCamera(),
      viewportOptions: viewportOptionsSchema.parse({}),
      grid: true,
      pointSize: 3,
      atlasReturnDepth: true,
      splatDraft: false,
      atlas: atlasContextSchema.parse({}),
      atlasPanel: {
        selectedOnly: false,
        jobId: null,
        keyframeCount: 4,
      },
      viewingCameraId: null,
      freeCamera: null,
      format: null,
      seed: 42,
      seedMode: "auto",
      enhancePrompt: true,
      prompt: "",
      falModel: defaultImageModels.create,
      falInput: '{"prompt":"A sunlit architectural courtyard"}',
      fps: 12,
      targetFrameCount: 36,
    },
  };
}
const localEditSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("frame.work"),
    id: z.string(),
    actor: frameActor,
    description: frameDescription.nullable(),
  }),
  z.object({
    type: z.literal("nodes.patch"),
    id: z.string(),
    patch: nodeSchema
      .omit({ id: true, kind: true, parentId: true, transform: true })
      .partial()
      .strict(),
  }),
  z.object({
    type: z.literal("nodes.transform"),
    ids: z.array(z.string()).min(1),
    transform: transformSchema.partial().strict(),
  }),
  z.object({
    type: z.literal("image.activate"),
    assetId: z.string(),
    nodeIds: z.array(z.string()).optional(),
    setDefault: z.boolean().optional(),
  }),

  z.object({ type: z.literal("nodes.put"), nodes: z.array(nodeSchema).min(1) }),
  z.object({
    type: z.literal("nodes.reparent"),
    ids: z.array(z.string()).min(1),
    parentId: z.string().nullable(),
  }),
  z.object({
    type: z.literal("nodes.remove"),
    ids: z.array(z.string()).min(1),
  }),
  z.object({
    type: z.literal("assets.update"),
    id: z.string(),
    patch: assetSchema
      .pick({
        name: true,
        camera: true,
        depthAssetId: true,
        confidenceAssetId: true,
        maskAssetId: true,
        depthEncoding: true,
      })
      .partial()
      .extend({
        depthAssetId: z.string().nullable().optional(),
        confidenceAssetId: z.string().nullable().optional(),
        maskAssetId: z.string().nullable().optional(),
      }),
  }),
  z.object({
    type: z.literal("nodes.move"),
    ids: z.array(z.string()).min(1),
    parentId: z.string().nullable(),
    beforeId: z.string().nullable().optional(),
  }),
]);

export const generationSchema = z.discriminatedUnion("kind", [
  modelInputSchema,
  renderInputSchema,
  probeInputSchema,
  observeInputSchema,
  fitInputSchema,
  maskInputSchema,
  z.object({
    kind: z.literal("image.create"),
    prompt: z.string().trim().min(1),
    model: z.enum(modelIds("create")).default(defaultImageModels.create),
    placement: cameraSchema.optional(),
    seed: number.int().optional(),
  }),
  z.object({
    kind: z.literal("image.edit"),
    targetNodeIds: z.array(z.string()).min(1).optional(),
    unchangedMaskAssetId: z.string().optional(),
    sourceAssetId: z.string().optional(),
    prompt: z.string().optional(),
    referenceAssetIds: z.array(z.string()).optional(),
    settings: nanoSettingsSchema.optional(),
    draft: imageDraftSchema.optional(),
    applyToScene: z.boolean().default(true),
    reconstruct: z.boolean().default(true),
  }),
  z.object({
    kind: z.literal("view"),
    context: z.enum(["active", "selection"]).default("active"),
    nodeIds: z.array(z.string()).optional(),
    camera: cameraSchema.optional(),
    contextPathId: z.string().nullable().optional(),
    prompt: z.string().optional(),
    returnDepth: z.boolean().optional(),
    seed: number.int().optional(),
  }),
  z.object({
    kind: z.literal("splats"),
    nodeIds: z.array(z.string()).optional(),
    contextPathId: z.string().nullable().optional(),
    prompt: z.string().optional(),
    refine: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal("video"),
    pathId: z.string().optional(),
    nodeIds: z.array(z.string()).optional(),
    fps: number.int().min(1).max(60).optional(),
    targetFrameCount: number.int().min(2).max(600).optional(),
    prompt: z.string().optional(),
    seed: number.int().optional(),
    returnDepth: z.boolean().optional(),
    mode: z.enum(["dense", "keyframes"]).default("dense"),
    keyframeCount: number.int().min(2).max(60).default(4),
    sourceJobId: z.string().optional(),
  }),
  z.object({
    kind: z.literal("reconstruct"),
    assetIds: z.array(z.string()).optional(),
    jobId: z.string().optional(),
    indices: z.array(number.int().nonnegative()).optional(),
    videoAssetId: z.string().optional(),
    fps: number.positive().max(30).default(1),
    maxFrames: number.int().min(2).max(120).default(60),
    integrate: z.boolean().default(true),
  }),
  z.object({
    kind: z.literal("pose"),
    assetIds: z.array(z.string()).optional(),
    placement: cameraSchema.optional(),
  }),
]);
export type Generation = z.input<typeof generationSchema>;

export const commandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("camera.aim"),
    aim: cameraAimSchema,
    name: z.string().trim().min(1).optional(),
  }),
  z.object({ type: z.literal("caption.clear") }),
  z.object({
    type: z.literal("environment.configure"),
    values: environmentPatchSchema,
  }),
  z.object({ type: z.literal("selection.visibility") }),
  z.object({
    type: z.literal("assets.trash"),
    ids: z.array(z.string()).min(1),
  }),
  z.object({
    type: z.literal("assets.restore"),
    ids: z.array(z.string()).min(1),
  }),
  z.object({ type: z.literal("assets.reveal"), id: z.string() }),
  z.object({ type: z.literal("generation.submit"), request: generationSchema }),
  z.object({
    type: z.literal("frames.integrate"),
    jobId: z.string(),
    indices: z.array(number.int().nonnegative()).optional(),
  }),
  z.object({
    type: z.literal("frames.view"),
    jobId: z.string(),
    index: number.int().nonnegative(),
  }),
  z.object({
    type: z.literal("path.update"),
    pathId: z.string(),
    fov: number.min(10).max(120).optional(),
    targetFrameCount: number.int().min(2).max(600).optional(),
  }),
  z.object({
    type: z.literal("path.keyframe"),
    pathId: z.string(),
    index: number.int().nonnegative().optional(),
    camera: cameraSchema.optional(),
    id: z.string().optional(),
    remove: z.boolean().default(false),
  }),
  z.object({
    type: z.literal("assets.place"),
    mode: placementModeSchema.optional(),
    assetIds: z.array(z.string()).min(1),
    camera: cameraSchema.optional(),
    parentId: z.string().nullable().optional(),
    beforeId: z.string().nullable().optional(),
  }),
  z.object({
    type: z.literal("camera.place"),
    name: z.string().trim().min(1).optional(),
    camera: cameraSchema.optional(),
  }),
  z.object({ type: z.literal("camera.view"), nodeId: z.string() }),
  z.object({
    type: z.literal("camera.release"),
    // Navigation continues from the visible camera; omission restores the saved view.
    camera: cameraSchema.optional(),
  }),
  z.object({
    type: z.literal("path.fromCameras"),
    nodeIds: z.array(z.string()).min(2),
    targetFrameCount: number.int().min(2).max(600).default(36),
  }),
  z.object({
    type: z.literal("workspace.update"),
    name: z.string().min(1).optional(),
    settings: settingsSchema
      .partial()
      .extend({
        collections: collectionSettingsSchema.partial().optional(),
        display: displaySchema.partial().optional(),
      })
      .optional(),
  }),
  z.object({
    type: z.literal("selection.set"),
    ids: z.array(z.string()),
    primaryId: z.string().nullable().optional(),
    anchorId: z.string().nullable().optional(),
  }),
  z.object({
    type: z.literal("nodes.duplicate"),
    ids: z.array(z.string()).min(1),
  }),
  z.object({ type: z.literal("history.revert"), editId: z.string() }),
  z.object({ type: z.literal("history.undo"), assetId: z.string().optional() }),
  z.object({ type: z.literal("history.redo"), assetId: z.string().optional() }),
  ...localEditSchema.options,
  z.object({
    type: z.literal("edit.batch"),
    commands: z.array(localEditSchema).min(1),
  }),
  z.object({
    type: z.literal("image.draft"),
    assetId: z.string(),
    draft: imageDraftSchema,
  }),
  z.object({ type: z.literal("jobs.submit"), input: jobInputSchema }),
  z.object({ type: z.literal("jobs.cancel"), id: z.string() }),
  z.object({ type: z.literal("jobs.retry"), id: z.string() }),
]);
export type Command = z.input<typeof commandSchema>;
export type CommandResult = {
  revision: number;
  nodeIds?: string[];
  editId?: string;
  jobId?: string;
  jobIds?: string[];
};
export const assetUrl = (asset: Asset) =>
  `/api/assets/${encodeURIComponent(asset.id)}?v=${asset.modifiedAt}`;
