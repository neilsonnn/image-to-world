import {
  cameraNode,
  captureNodes,
  isGeneratedGuide,
} from "../../../core/captures";
import { clipsForNode, isNodeInSubtree } from "../../../core/clips";
import type { Asset, Job, JobInput, Workspace } from "../../../core/schema";

// Keep world transforms, clip masks and the lighting Frame when isolating a shot.
export function inputNodes(w: Workspace, input: JobInput, targets: string[]) {
  const nodes: Workspace["nodes"] = {};
  const keep = (id?: string) => {
    let node = id ? w.nodes[id] : undefined;
    while (node && !nodes[node.id]) {
      nodes[node.id] = node;
      node = node.parentId ? w.nodes[node.parentId] : undefined;
    }
  };
  if (input.kind === "fit") return w.nodes; // Observation guards can name any Frame or ancestor.
  if (input.kind === "render" || input.kind === "probe") {
    if (!input.nodeIds) return w.nodes;
    for (const n of Object.values(w.nodes)) {
      if (input.nodeIds.some((id) => isNodeInSubtree(w, id, n.id))) keep(n.id);
    }
    if (input.kind === "probe") {
      keep(input.nodeId);
      keep(cameraNode(w, input.nodeId)?.id);
    } else {
      keep(input.lightingViewId);
      Object.keys(input.overrides).forEach(keep);
    }
  } else if (
    input.kind === "atlas" ||
    input.kind === "splats" ||
    input.kind === "video" ||
    input.kind === "observe"
  ) {
    for (const id of "nodeIds" in input ? input.nodeIds : [input.nodeId]) {
      Object.values(captureNodes(w, id)).forEach((n) => keep(n.id));
    }
    if (input.kind === "video") keep(input.pathId);
  } else if (input.kind === "nano" || input.kind === "reconstruct") {
    for (const id of targets) {
      // Broken components still have to be reported by result application.
      for (const n of Object.values(w.nodes))
        if (isNodeInSubtree(w, id, n.id)) keep(n.id);
    }
  }
  for (const node of Object.values(nodes)) {
    if (node.kind === "points")
      clipsForNode(w, node.id).forEach((clip) => keep(clip.id));
  }
  return nodes;
}

export function frozenContext(
  w: Workspace,
  nodes: Workspace["nodes"],
  pins: NonNullable<Job["pinnedAssets"]>,
) {
  const assets: Record<string, Asset> = {};
  for (const id of Object.keys(pins)) {
    let asset: Asset | undefined = w.assets[id];
    while (asset && !assets[asset.id]) {
      assets[asset.id] = asset;
      // Image ancestry is metadata used for version and provenance resolution.
      asset = asset.parentAssetId ? w.assets[asset.parentAssetId] : undefined;
    }
  }
  const generatedGuideIds = Object.values(nodes)
    .filter((n) => n.kind === "capture" && isGeneratedGuide(w, n))
    .map((n) => n.id);
  return { nodes, assets, generatedGuideIds, settings: w.settings };
}
