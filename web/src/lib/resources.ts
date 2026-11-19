import { SplatMesh } from "@sparkjsdev/spark";
import {
  Texture,
  type Object3D,
  type Mesh,
  type Material,
  type BufferGeometry,
} from "three";
import { Node, TextureNode } from "three/webgpu";

export function disposeObject(object: Object3D) {
  const textures = new Set<Texture>();
  const materials = new Set<Material>();
  const geometries = new Set<BufferGeometry>();
  const shaderNodes = new Set<Node>();
  function releaseTexture(texture: Texture) {
    if (textures.has(texture)) return;
    textures.add(texture);
    const image = texture.image as { close?: () => void } | undefined;
    texture.dispose();
    image?.close?.();
  }
  function releaseShaderTextures(node: Node) {
    if (shaderNodes.has(node)) return;
    shaderNodes.add(node);
    if (node instanceof TextureNode && node.value instanceof Texture)
      releaseTexture(node.value);
    for (const child of node.getChildren()) releaseShaderTextures(child);
  }
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
    if (mesh.geometry && !geometries.has(mesh.geometry)) {
      geometries.add(mesh.geometry);
      mesh.geometry.dispose();
    }
    const meshMaterials = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];
    for (const material of meshMaterials) {
      if (materials.has(material)) continue;
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof Texture) releaseTexture(value);
        if (value instanceof Node) releaseShaderTextures(value);
      }
      material.dispose();
    }
  });
}
