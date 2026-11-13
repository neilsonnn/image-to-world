import type { Camera } from "../../../core/schema";

let read: (() => Camera | null) | null = null;

/**
 * The open viewport's live camera, which runs ahead of the persisted
 * `viewportCamera` while the user flies. Null when no viewport is mounted.
 */
export const liveViewportCamera = () => read?.() ?? null;

export function registerViewportCamera(getter: () => Camera | null) {
  read = getter;
  return () => {
    if (read === getter) read = null;
  };
}
