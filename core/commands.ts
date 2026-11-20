import { availableSlug, frameSlugs } from "./frame-work";
import { frameAt } from "./frames";
import { activateImage } from "./images";
import { currentCamera } from "./generation";
import {
  worldMatrix,
  transformCamera,
  cameraNodeData,
  aimCamera,
} from "./cameras";
import { sceneCamera, pathFromCameras, cameraNode } from "./captures";
import { moveNodes, orderedChildren, selectedRoots } from "./scene";
import { editChanges, editSelection, restoreEdit } from "./undo";
import { transformCapabilities } from "./node-capabilities";
import { supportsNodePhysics } from "./physics";
import {
  commandSchema,
  type Command,
  type SceneNode,
  type Workspace,
} from "./schema";

export function validateScene(nodes: Record<string, SceneNode>) {
  const slugs = new Set<string>();
  for (const [id, node] of Object.entries(nodes)) {
    if (node.frameSlug || node.frameWorkers) {
      if (node.kind !== "capture")
        throw new Error("Frame metadata requires an image Frame");
      if (node.frameSlug && slugs.has(node.frameSlug))
        throw new Error("Frame slug is already in use");
      if (node.frameSlug) slugs.add(node.frameSlug);
    }
    if (id !== node.id) throw new Error("Scene node key must match its ID");
    const ancestors = new Set([node.id]);
    let parentId = node.parentId;
    while (parentId) {
      if (ancestors.has(parentId))
        throw new Error("Scene parenting would create a cycle");
      const parent = nodes[parentId];
      if (!parent) throw new Error(`Parent ${parentId} does not exist`);
      ancestors.add(parentId);
      parentId = parent.parentId;
    }
    if (node.lighting && node.kind !== "capture")
      throw new Error("Reference lighting belongs to a Frame");
    if (node.physics && !supportsNodePhysics(node.kind))
      throw new Error("Physics needs mesh or procedural geometry");
    if (node.kind === "camera" && !node.projection)
      throw new Error("Camera nodes need projection intrinsics");
    if (node.kind === "clip" && !node.clip)
      throw new Error("Clip nodes need clip settings");
    if (node.kind === "path") {
      const frames = node.keyframes ?? [];
      if (new Set(frames.map((f) => f.id)).size !== frames.length)
        throw new Error("Keyframe IDs must be unique");
    }
  }
}
function mutate(workspace: Workspace, input: Command) {
  const command = commandSchema.parse(input);
  switch (command.type) {
    case "frame.work": {
      const frame = workspace.nodes[command.id];
      if (frame?.kind !== "capture") throw new Error("Choose an image Frame");
      frame.frameWorkers = (frame.frameWorkers ?? []).filter(
        (worker) => worker.actor !== command.actor,
      );
      if (command.description)
        frame.frameWorkers.push({
          actor: command.actor,
          description: command.description,
        });
      break;
    }
    case "selection.visibility": {
      const nodes = workspace.selection.flatMap(
        (id) => workspace.nodes[id] ?? [],
      );
      const visible = !nodes.some((node) => node.visible);
      for (const node of nodes) node.visible = visible;
      break;
    }
    case "image.activate":
      activateImage(
        workspace,
        command.assetId,
        command.nodeIds,
        command.setDefault,
      );
      break;
    case "frames.view": {
      const job = workspace.jobs[command.jobId];
      const asset = job && frameAt(workspace, job, command.index);
      if (!asset?.camera) throw new Error("Frame has no camera");
      workspace.settings.viewportCamera = asset.camera;
      workspace.settings.viewingCameraId = null;
      workspace.settings.freeCamera = null;
      break;
    }
    case "path.update": {
      const node = workspace.nodes[command.pathId];
      if (node?.kind !== "path") throw new Error("Choose a camera path");
      if (command.fov !== undefined) node.fov = command.fov;
      if (command.targetFrameCount !== undefined)
        node.targetFrameCount = command.targetFrameCount;
      break;
    }
    case "path.keyframe": {
      const node = workspace.nodes[command.pathId];
      if (node?.kind !== "path") throw new Error("Choose a camera path");
      const frames = [...(node.keyframes ?? [])];
      const index = command.id
        ? frames.findIndex((f) => f.id === command.id)
        : -1;
      if (command.id && index < 0) throw new Error("Keyframe does not exist");
      if (command.remove) {
        if (index < 0) throw new Error("Choose a keyframe to remove");
        frames.splice(index, 1);
      } else {
        const camera =
          command.camera || index < 0 || command.index === undefined
            ? transformCamera(
                command.camera ?? currentCamera(workspace),
                worldMatrix(node, workspace.nodes).invert(),
              )
            : frames[index].camera;
        const frame = { id: command.id ?? crypto.randomUUID(), camera };
        if (index >= 0) frames.splice(index, 1);
        const destination =
          command.index ?? (index >= 0 ? index : frames.length);
        if (destination > frames.length)
          throw new Error("Keyframe index is outside the path");
        frames.splice(destination, 0, frame);
      }
      node.keyframes = frames;
      break;
    }
    case "camera.aim":
      mutate(workspace, {
        type: "camera.place",
        name: command.name,
        camera: aimCamera(
          workspace,
          command.aim,
          currentCamera(workspace).intrinsics,
        ),
      });
      break;
    case "camera.place": {
      const id = `node_${crypto.randomUUID()}`;
      mutate(workspace, {
        type: "nodes.put",
        nodes: [
          {
            id,
            name: command.name ?? "Camera",
            kind: "camera",
            parentId: null,
            visible: true,
            ...cameraNodeData(command.camera ?? currentCamera(workspace)),
          },
        ],
      });
      workspace.selection = [
        ...workspace.selection.filter((id) => cameraNode(workspace, id)),
        id,
      ];
      workspace.primaryId = id;
      workspace.selectionAnchor = id;
      break;
    }
    case "camera.view": {
      const camera = sceneCamera(workspace, command.nodeId);
      if (!camera) throw new Error("This node has no camera");
      if (!workspace.settings.viewingCameraId)
        workspace.settings.freeCamera = workspace.settings.viewportCamera;
      workspace.settings.viewingCameraId = command.nodeId;
      workspace.settings.viewportCamera = camera;
      break;
    }
    case "camera.release":
      if (command.camera) workspace.settings.viewportCamera = command.camera;
      else if (workspace.settings.freeCamera)
        workspace.settings.viewportCamera = workspace.settings.freeCamera;
      workspace.settings.viewingCameraId = null;
      workspace.settings.freeCamera = null;
      break;
    case "path.fromCameras": {
      const node = pathFromCameras(
        workspace,
        command.nodeIds,
        command.targetFrameCount,
      );
      node.context = structuredClone(workspace.settings.atlas);
      mutate(workspace, { type: "nodes.put", nodes: [node] });
      workspace.selection = [node.id];
      workspace.primaryId = node.id;
      workspace.selectionAnchor = node.id;
      break;
    }
    case "edit.batch":
      for (const edit of command.commands) mutate(workspace, edit);
      break;
    case "image.draft":
      if (workspace.assets[command.assetId]?.kind !== "image")
        throw new Error("Image draft needs an image asset");
      for (const layer of command.draft.layers)
        if (workspace.assets[layer.assetId]?.kind !== "image")
          throw new Error("Layers need image assets");
      workspace.imageDrafts[command.assetId] = command.draft;
      break;
    case "workspace.update":
      if (command.name !== undefined) workspace.name = command.name;
      if (command.settings) {
        const { collections, display, ...settings } = command.settings;
        if (
          settings.prompt !== undefined &&
          settings.prompt !== workspace.settings.prompt
        ) {
          workspace.settings.enhancedCaption = null;
          workspace.settings.captionEpoch =
            (workspace.settings.captionEpoch ?? 0) + 1;
        }
        Object.assign(workspace.settings, settings);
        if (display) Object.assign(workspace.settings.display, display);
        if (collections)
          Object.assign(workspace.settings.collections, collections);
      }
      break;
    case "selection.set": {
      const ids = [...new Set(command.ids)];
      if (ids.some((id) => !workspace.nodes[id] && !workspace.assets[id]))
        throw new Error("Selection contains an unknown object");
      const primary =
        command.primaryId === undefined
          ? (ids.at(-1) ?? null)
          : command.primaryId;
      if (primary && !ids.includes(primary))
        throw new Error("Primary item must be selected");
      workspace.selection = ids;
      workspace.primaryId = primary;
      workspace.selectionAnchor =
        command.anchorId === undefined ? primary : command.anchorId;
      if (
        workspace.selectionAnchor &&
        !workspace.nodes[workspace.selectionAnchor] &&
        !workspace.assets[workspace.selectionAnchor]
      )
        throw new Error("Selection anchor is unknown");
      break;
    }
    case "nodes.patch": {
      const node = workspace.nodes[command.id];
      if (!node) throw new Error(`Unknown node ${command.id}`);
      mutate(workspace, {
        type: "nodes.put",
        nodes: [{ ...node, ...command.patch }],
      });
      break;
    }
    case "nodes.transform": {
      const nodes = command.ids.map((id) => {
        const node = workspace.nodes[id];
        if (!node) throw new Error(`Unknown node ${id}`);
        return {
          ...node,
          transform: { ...node.transform, ...command.transform },
        };
      });
      mutate(workspace, { type: "nodes.put", nodes });
      break;
    }
    case "history.revert": {
      const edit = workspace.undo.find((edit) => edit.id === command.editId);
      if (!edit) throw new Error("Edit is no longer available to revert");
      restoreEdit(workspace, { ...edit, selection: undefined }, "undo");
      break;
    }
    case "nodes.put": {
      const nodes = { ...workspace.nodes };
      for (const node of command.nodes) {
        const previous = nodes[node.id];
        const supported = transformCapabilities([node]);
        for (const [operation, field, label] of [
          ["translate", "position", "translation"],
          ["rotate", "quaternion", "rotation"],
          ["scale", "scale", "scaling"],
        ] as const) {
          // Initial placement can establish a pose; disabled scaling always starts at unity.
          const baseline =
            previous?.transform[field] ??
            (operation === "scale" ? [1, 1, 1] : node.transform[field]);
          if (
            !supported[operation] &&
            node.transform[field].some(
              (value, index) => Math.abs(value - baseline[index]) > 1e-8,
            )
          )
            throw new Error(`${node.name} does not support ${label}`);
        }
        for (const id of node.observationAssetIds ?? []) {
          if (previous?.observationAssetIds?.includes(id)) continue;
          const asset = workspace.assets[id];
          if (
            asset?.role !== "observation" ||
            asset.trashedAt !== undefined ||
            asset.missing
          )
            throw new Error(`Choose an available observation: ${id}`);
        }
        if (workspace.assets[node.id])
          throw new Error("Node IDs cannot collide with asset IDs");
        if (node.assetId && !workspace.assets[node.assetId])
          throw new Error(`Unknown asset ${node.assetId}`);
        const siblings = orderedChildren(nodes, node.parentId);
        nodes[node.id] = {
          ...node,
          ...(node.kind === "capture" &&
            !node.frameSlug && {
              frameSlug:
                frameSlugs(nodes).get(node.id) ??
                availableSlug(node.name, new Set(frameSlugs(nodes).values())),
            }),
          order:
            node.order ??
            nodes[node.id]?.order ??
            (siblings.at(-1)?.order ?? siblings.length - 1) + 1,
        };
      }
      validateScene(nodes);
      workspace.nodes = nodes;
      break;
    }
    case "nodes.move":
    case "nodes.reparent": {
      const nodes = moveNodes(
        workspace.nodes,
        command.ids,
        command.parentId,
        command.type === "nodes.move" ? command.beforeId : undefined,
      );
      validateScene(nodes);
      workspace.nodes = nodes;
      break;
    }
    case "nodes.duplicate": {
      const ids = new Map<string, string>();
      const collect = (id: string) => {
        ids.set(id, `node_${crypto.randomUUID()}`);
        for (const child of orderedChildren(workspace.nodes, id))
          collect(child.id);
      };
      const roots = selectedRoots(workspace.nodes, command.ids);
      roots.forEach(collect);
      for (const [id, newId] of ids) {
        const original = workspace.nodes[id];
        workspace.nodes[newId] = {
          ...structuredClone(original),
          ...(original.kind === "capture" && {
            frameWorkers: [],
            frameSlug: availableSlug(
              original.frameSlug ?? original.name,
              new Set(frameSlugs(workspace.nodes).values()),
            ),
          }),
          id: newId,
          name: roots.includes(id) ? `${original.name} copy` : original.name,
          parentId: original.parentId
            ? (ids.get(original.parentId) ?? original.parentId)
            : null,
          order: roots.includes(id)
            ? orderedChildren(workspace.nodes, original.parentId).length
            : original.order,
        };
      }
      workspace.selection = roots.map((id) => ids.get(id)!);
      workspace.primaryId = workspace.selection.at(-1) ?? null;
      workspace.selectionAnchor = workspace.primaryId;
      break;
    }
    case "history.undo":
    case "history.redo": {
      const direction = command.type === "history.undo" ? "undo" : "redo";
      const source = workspace[direction];
      const index = source.findLastIndex(
        (edit) => edit.scope === command.assetId,
      );
      const edit = source[index];
      if (!edit) break;
      restoreEdit(workspace, edit, direction);
      source.splice(index, 1);
      workspace[direction === "undo" ? "redo" : "undo"].push(edit);
      break;
    }
    case "nodes.remove": {
      const removed = new Set(command.ids);
      let count = 0;
      while (count !== removed.size) {
        count = removed.size;
        for (const node of Object.values(workspace.nodes))
          if (node.parentId && removed.has(node.parentId)) removed.add(node.id);
      }
      for (const id of removed) delete workspace.nodes[id];
      workspace.selection = workspace.selection.filter(
        (id) => !removed.has(id),
      );
      break;
    }
    case "assets.update": {
      const asset = workspace.assets[command.id];
      if (!asset) throw new Error("Asset does not exist");
      for (const id of [
        command.patch.depthAssetId,
        command.patch.confidenceAssetId,
        command.patch.maskAssetId,
      ]) {
        if (id && !workspace.assets[id]) throw new Error(`Unknown asset ${id}`);
      }
      for (const [key, value] of Object.entries(command.patch)) {
        if (value === null) delete (asset as Record<string, unknown>)[key];
        else if (value !== undefined) Object.assign(asset, { [key]: value });
      }
      break;
    }
    default:
      throw new Error("Job commands must be handled by the job runner");
  }
}

export function isNavigation(input: Command) {
  return (
    ["selection.set", "camera.view", "camera.release", "frames.view"].includes(
      input.type,
    ) ||
    (input.type === "workspace.update" &&
      input.name === undefined &&
      !!input.settings &&
      Object.keys(input.settings).every((k) =>
        ["viewportCamera", "viewingCameraId", "freeCamera"].includes(k),
      ))
  );
}

// Navigation changes only session fields. Reuse the scene and job records.
export function navigate(workspace: Workspace, command: Command): Workspace {
  if (!isNavigation(command)) throw new Error("Expected navigation command");
  const next = { ...workspace, settings: { ...workspace.settings } };
  mutate(next, command);
  return next;
}

export function applyCommand(
  workspace: Workspace,
  input: Command,
  options: { preserveSelection?: boolean } = {},
) {
  const { jobs, receipts, ...editable } = workspace;
  const next = { ...structuredClone(editable), jobs, receipts };
  mutate(next, input);
  if (
    options.preserveSelection &&
    ![
      "selection.set",
      "selection.visibility",
      "nodes.remove",
      "history.undo",
      "history.redo",
    ].includes(input.type)
  )
    Object.assign(next, editSelection(workspace));
  next.selection = next.selection.filter(
    (id) => next.nodes[id] || next.assets[id],
  );
  if (!next.primaryId || !next.selection.includes(next.primaryId))
    next.primaryId = next.selection.at(-1) ?? null;
  if (
    next.selectionAnchor &&
    !next.nodes[next.selectionAnchor] &&
    !next.assets[next.selectionAnchor]
  )
    next.selectionAnchor = next.primaryId;
  for (const key of ["order", "excludedIds", "soloIds"] as const)
    next.settings.atlas[key] = next.settings.atlas[key].filter(
      (id) => next.nodes[id],
    );
  if (
    next.settings.viewingCameraId &&
    !next.nodes[next.settings.viewingCameraId]
  ) {
    if (next.settings.freeCamera)
      next.settings.viewportCamera = next.settings.freeCamera;
    next.settings.viewingCameraId = null;
    next.settings.freeCamera = null;
  }
  for (const node of Object.values(next.nodes))
    if (node.context)
      for (const key of ["order", "excludedIds", "soloIds"] as const)
        node.context[key] = node.context[key].filter((id) => next.nodes[id]);
  validateScene(next.nodes);
  const panorama = next.settings.lighting?.environmentAssetId;
  if (panorama && next.assets[panorama]?.kind !== "image")
    throw new Error("Choose an image asset for the scene environment");
  for (const node of Object.values(next.nodes))
    for (const id of [
      node.assetId,
      node.geometryAssetId,
      node.procedural?.sourceAssetId,
      node.procedural?.bundleAssetId,
      ...(node.procedural?.sourceAssetIds ?? []),
      ...(node.procedural?.assetIds ?? []),
    ])
      if (id && !next.assets[id]) throw new Error(`Unknown asset ${id}`);
  if (!input.type.startsWith("history.") || input.type === "history.revert") {
    const changes = editChanges(workspace, next);
    if (changes.length) {
      const scope = input.type === "image.draft" ? input.assetId : undefined;
      const selection = changes.some((change) => change.path[0] === "nodes")
        ? { before: editSelection(workspace), after: editSelection(next) }
        : undefined;
      next.undo = [
        ...next.undo,
        {
          id: crypto.randomUUID(),
          label: input.type,
          scope,
          changes,
          selection,
        },
      ].slice(-100);
      next.redo = next.redo.filter((edit) => edit.scope !== scope);
    }
  }
  Object.assign(workspace, next);
}
