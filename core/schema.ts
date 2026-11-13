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
  model: z
    .enum(["fal-ai/nano-banana-2/edit", "fal-ai/nano-banana-pro/edit"])
    .default("fal-ai/nano-banana-2/edit"),
  resolution: z.enum(["1K", "2K", "4K"]).default("1K"),
  aspectRatio: z
    .enum([
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
    ])
    .default("auto"),
  numImages: number.int().min(1).max(4).default(1),
  seed: number.int().optional(),
});
export const assetSchema = z.object({
  parentAssetId: z.string().optional(),
  referenceAssetIds: z.array(z.string()).optional(),
  id: z.string(),
  name: z.string(),
  path: z.string(),
  kind: z.enum(["image", "depth", "splat", "video", "file"]),
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
      "camera",
      "path",
      "clip",
      "video",
    ]),
    parentId: z.string().nullable().default(null),
    order: number.int().nonnegative().optional(),
    visible: z.boolean().default(true),
    transform: transformSchema.default(identity),
    assetId: z.string().optional(),
    locked: z.boolean().optional(),
    geometryAssetId: z.string().optional(),
    jobId: z.string().optional(),
    clipInitialized: z.boolean().optional(),
    context: atlasContextSchema.optional(),
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
  rightWidth: number.min(220).max(600).default(280),
  leftSplit: number.min(0.2).max(0.8).default(0.6),
  historyWidth: number.min(110).max(320).default(160),
});
export const displaySchema = z.object({
  showImages: z.boolean().default(true),
  imageOpacity: number.min(0).max(1).default(0.35),
  imageDistance: number.min(0.1).max(10).default(0.25),
  showPoints: z.boolean().default(true),
  pointStyle: z.enum(["gaussian", "points"]).default("gaussian"),
  showFrustums: z.boolean().default(true),
});
export const collectionSettingsSchema = z.object({
  assetSearch: z.string().default(""),
  sceneSearch: z.string().default(""),
  assetTrash: z.boolean().default(false),
  expandedNodeIds: z.array(z.string()).default([]),
  assetView: z.enum(["list", "grid"]).default("list"),
  assetKinds: z
    .array(z.enum(["image", "depth", "splat", "video", "file"]))
    .default(["image", "splat", "video", "file"]),
});
export const settingsSchema = z.object({
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
        model: "fal-ai/nano-banana-2/edit",
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
  grid: z.boolean(),
  pointSize: number.positive().max(20),
  atlasReturnDepth: z.boolean().default(true),
  prompt: z.string(),
  falModel: z.string(),
  falInput: z.string(),
  fps: number.int().min(1).max(60),
  targetFrameCount: number.int().min(2).max(600),
});
export const jobInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("pose"),
    assetIds: z.array(z.string()).min(1),
    canonicalize: z.boolean().default(false),
    placement: cameraSchema.optional(),
    nodeIds: z.array(z.string()).optional(),
  }),
  z.object({
    kind: z.literal("atlas"),
    contextPathId: z.string().optional(),
    nodeIds: z.array(z.string()).min(1),
    cameras: z.array(cameraSchema).min(1),
    prompt: z.string().default(""),
    enhancePrompt: z.boolean().default(true),
    returnDepth: z.boolean().default(true),
    seed: number.int().default(42),
  }),
  z.object({
    kind: z.literal("splats"),
    nodeIds: z.array(z.string()).min(1),
    prompt: z.string().default(""),
    enhancePrompt: z.boolean().default(true),
    refine: z.boolean().default(false),
  }),
  z.object({
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
  }),
  z.object({
    kind: z.literal("fal"),
    model: z.string().min(1),
    input: z.record(z.unknown()),
  }),
  z.object({
    kind: z.literal("nano"),
    applyToScene: z.boolean().default(true),
    reconstruct: z.boolean().default(true),
    sourceAssetId: z.string(),
    referenceAssetIds: z.array(z.string()).default([]),
    prompt: z.string().trim().min(1),
    settings: nanoSettingsSchema.default({}),
    draft: imageDraftSchema.optional(),
  }),
  z.object({
    kind: z.literal("reconstruct"),
    assetIds: z.array(z.string()).default([]),
    placement: cameraSchema.optional(),
    parentId: z.string().nullable().optional(),
    beforeId: z.string().nullable().optional(),
    videoAssetId: z.string().optional(),
    fps: number.positive().max(30).default(1),
    maxFrames: number.int().min(2).max(120).default(60),
    integrate: z.boolean().default(true),
  }),
  z.object({ kind: z.literal("capture"), camera: cameraSchema.optional() }),
]);
export type JobInput = z.infer<typeof jobInputSchema>;
export const jobSchema = z.object({
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
  applyTargets: z
    .array(
      z.union([
        z.object({
          nodeId: z.string(),
          assetId: z.string(),
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
  sourceFrameAssetIds: z.array(z.string()).optional(),
  frameIndices: z.array(number.int().nonnegative()).optional(),
  cameras: z.array(cameraSchema).optional(),
  reconstructionScale: number.positive().optional(),
  contextSnapshot: z
    .object({
      nodes: z.record(nodeSchema),
      assets: z.record(assetSchema),
      settings: settingsSchema,
    })
    .optional(),
});
export type Job = z.infer<typeof jobSchema>;
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
  version: z.literal(4),
  revision: number.int().nonnegative(),
  name: z.string().min(1),
  imageDrafts: z.record(imageDraftSchema).default({}),
  imageVersions: z.record(z.string()).default({}),
  resultOwners: z.record(z.string()).default({}),
  assets: z.record(assetSchema),
  nodes: z.record(nodeSchema),
  jobs: z.record(jobSchema),
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
    version: 4,
    revision: 0,
    name: "Untitled workspace",
    imageDrafts: {},
    imageVersions: {},
    resultOwners: {},
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
      grid: true,
      pointSize: 2,
      atlasReturnDepth: true,
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
      falModel: "fal-ai/flux/dev",
      falInput: '{"prompt":"A sunlit architectural courtyard"}',
      fps: 12,
      targetFrameCount: 36,
    },
  };
}
const localEditSchema = z.discriminatedUnion("type", [
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
  z.object({
    kind: z.literal("image.edit"),
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
    mode: z.enum(["individual", "reconstruct"]).optional(),
    assetIds: z.array(z.string()).min(1),
    camera: cameraSchema.optional(),
    parentId: z.string().nullable().optional(),
    beforeId: z.string().nullable().optional(),
  }),
  z.object({
    type: z.literal("camera.place"),
    camera: cameraSchema.optional(),
  }),
  z.object({ type: z.literal("camera.view"), nodeId: z.string() }),
  z.object({ type: z.literal("camera.release") }),
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
  jobId?: string;
  jobIds?: string[];
};
export const assetUrl = (asset: Asset) =>
  `/api/assets/${encodeURIComponent(asset.id)}?v=${asset.modifiedAt}`;
