import type { DragEvent } from "react";
import {
  claimPaneShortcutGesture,
  releasePaneShortcutGesture,
} from "./shortcuts";

type Payload = { kind: "nodes" | "assets"; ids: string[] };
let active: Payload | undefined;

export function startCollectionDrag(event: DragEvent, payload: Payload) {
  active = payload;
  claimPaneShortcutGesture(payload.kind === "nodes" ? "scene" : "assets");
  event.dataTransfer.effectAllowed = payload.kind === "nodes" ? "move" : "copy";
  event.dataTransfer.setData(
    `application/x-image-to-world-${payload.kind}`,
    JSON.stringify(payload.ids),
  );
  if (payload.kind === "assets")
    event.dataTransfer.setData(
      "application/x-image-to-world-asset",
      payload.ids[0],
    );
}

export function endCollectionDrag() {
  active = undefined;
  releasePaneShortcutGesture();
}

export function collectionDragPayload(event: DragEvent): Payload | undefined {
  // Native dragover protects getData; retain only our own active drag in memory.
  if (active) return active;
  for (const kind of ["nodes", "assets"] as const) {
    const value = event.dataTransfer.getData(
      `application/x-image-to-world-${kind}`,
    );
    if (!value) continue;
    try {
      const ids = JSON.parse(value);
      if (Array.isArray(ids) && ids.every((id) => typeof id === "string"))
        return { kind, ids };
    } catch {
      return undefined;
    }
  }
  return undefined;
}
