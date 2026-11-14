import { SplatMesh } from "@sparkjsdev/spark";
import { Texture, type Object3D, type Mesh } from "three";

export function disposeObject(object: Object3D) {
  const disposed = new Set<Texture>();
  object.traverse((child) => {
    if ("shadow" in child)
      (
        child as unknown as { shadow?: { dispose: () => void } }
      ).shadow?.dispose();
    if (child instanceof SplatMesh) child.dispose();
    const video = child.userData.video as HTMLVideoElement | undefined;
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
    const mesh = child as Mesh;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (!(value instanceof Texture) || disposed.has(value)) continue;
        disposed.add(value);
        const source = value.image as { close?: () => void } | undefined;
        value.dispose();
        source?.close?.();
      }
      material.dispose();
    }
  });
}
