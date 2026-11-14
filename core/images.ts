import { captureRoot, captureNodes } from "./captures";
import type { Asset, SceneNode, Workspace, Command } from "./schema";

type ImageIndex = {
  roots: Map<string, string>;
  capturesByRoot: Map<string, string[]>;
  capturesByAsset: Map<string, string[]>;
};
const indices = new WeakMap<
  Workspace["nodes"],
  { assets: Workspace["assets"]; index: ImageIndex }
>();

export function imageIndex(
  workspace: Pick<Workspace, "assets" | "nodes">,
): ImageIndex {
  const cached = indices.get(workspace.nodes);
  if (cached?.assets === workspace.assets) return cached.index;
  const roots = new Map<string, string>();
  for (const asset of Object.values(workspace.assets)) {
    const chain: string[] = [];
    const seen = new Set<string>();
    let current: Asset | undefined = asset;
    while (current && !roots.has(current.id)) {
      if (seen.has(current.id))
        throw new Error("Image history contains a cycle");
      seen.add(current.id);
      chain.push(current.id);
      current = current.parentAssetId
        ? workspace.assets[current.parentAssetId]
        : undefined;
    }
    const root = current ? roots.get(current.id)! : chain.at(-1)!;
    for (const id of chain) roots.set(id, root);
  }
  const index: ImageIndex = {
    roots,
    capturesByRoot: new Map(),
    capturesByAsset: new Map(),
  };
  const append = <T>(map: Map<string, T[]>, key: string, value: T) => {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };
  for (const node of Object.values(workspace.nodes)) {
    if (node.kind === "capture" && node.assetId) {
      append(index.capturesByAsset, node.assetId, node.id);
      append(
        index.capturesByRoot,
        roots.get(node.assetId) ?? node.assetId,
        node.id,
      );
    }
  }
  indices.set(workspace.nodes, { assets: workspace.assets, index });
  return index;
}

// RGB versions and reconstructed geometry have independent lifetimes.
export function nodeImageAsset(
  workspace: Pick<Workspace, "assets">,
  node: SceneNode,
): Asset | undefined {
  const image = node.assetId ? workspace.assets[node.assetId] : undefined;
  if (!image) return;
  const geometry = node.geometryAssetId
    ? workspace.assets[node.geometryAssetId]
    : image;
  return {
    ...image,
    missing: image.missing || geometry?.missing,
    camera: geometry?.camera,
    depthAssetId: geometry?.depthAssetId,
    depthEncoding: geometry?.depthEncoding,
    confidenceAssetId: geometry?.confidenceAssetId,
    maskAssetId: geometry?.maskAssetId,
  };
}

export function activateImage(
  workspace: Workspace,
  assetId: string,
  nodeIds?: string[],
  setDefault = nodeIds === undefined,
) {
  const asset = workspace.assets[assetId];
  if (!asset || asset.kind !== "image" || asset.missing)
    throw new Error("Choose an available image version");
  const index = imageIndex(workspace);
  const rootId = index.roots.get(assetId)!;
  const targets = nodeIds
    ? [
        ...new Set(
          nodeIds.map((id) => {
            const root = captureRoot(workspace, id);
            if (!root || index.roots.get(root.assetId!) !== rootId)
              throw new Error("Capture belongs to a different image history");
            return root.id;
          }),
        ),
      ]
    : (index.capturesByRoot.get(rootId) ?? []);
  const nodes = {
    ...workspace.nodes,
    ...Object.fromEntries(
      imageVersionNodes(workspace, assetId, targets).map((node) => [
        node.id,
        node,
      ]),
    ),
  };
  if (setDefault) workspace.imageVersions[rootId] = assetId;
  workspace.nodes = nodes;
  return targets;
}

export function imageVersionNodes(
  workspace: Pick<Workspace, "nodes" | "assets">,
  assetId: string,
  nodeIds: string[],
) {
  const asset = workspace.assets[assetId];
  if (!asset || asset.kind !== "image" || asset.missing)
    throw new Error("Choose an available image version");
  const nodes: Record<string, SceneNode> = {};
  for (const id of nodeIds) {
    const {
      root: capture,
      camera,
      image,
      points,
    } = captureNodes(workspace, id);
    const previousGeometry = points.geometryAssetId ?? points.assetId;
    const geometryAssetId =
      asset.camera && asset.depthAssetId ? asset.id : previousGeometry;
    const geometry = geometryAssetId
      ? workspace.assets[geometryAssetId]
      : undefined;
    nodes[id] = { ...capture, assetId, geometryAssetId };
    nodes[points.id] = { ...points, assetId, geometryAssetId };
    nodes[image.id] = {
      ...image,
      assetId,
      geometryAssetId,
      ...(geometry?.camera
        ? { projection: { ...geometry.camera.intrinsics } }
        : {}),
    };
    nodes[camera.id] = {
      ...camera,
      ...(geometry?.camera
        ? { projection: { ...geometry.camera.intrinsics } }
        : {}),
    };
  }
  return Object.values(nodes);
}

export function imageReplacementCommands(
  workspace: Workspace,
  assetId: string,
  nodeIds: string[],
  setDefault: boolean,
): Extract<Command, { type: "edit.batch" }>["commands"] {
  const commands: Extract<Command, { type: "edit.batch" }>["commands"] = [];
  if (nodeIds.length)
    commands.push({
      type: "nodes.put",
      nodes: imageVersionNodes(workspace, assetId, nodeIds),
    });
  if (setDefault)
    commands.push({
      type: "image.activate",
      assetId,
      nodeIds: [],
      setDefault: true,
    });
  return commands;
}

/** Available versions of one image family, in creation order for previous/next navigation. */
export function imageVersionsFor(
  workspace: Pick<Workspace, "assets" | "nodes">,
  assetId: string | null,
) {
  if (!assetId) return [];
  const roots = imageIndex(workspace).roots;
  const rootId = roots.get(assetId);
  if (!rootId) return [];
  return Object.values(workspace.assets)
    .filter(
      (asset) =>
        asset.kind === "image" &&
        !asset.missing &&
        !asset.trashedAt &&
        roots.get(asset.id) === rootId,
    )
    .sort((a, b) => a.modifiedAt - b.modifiedAt || a.id.localeCompare(b.id));
}
