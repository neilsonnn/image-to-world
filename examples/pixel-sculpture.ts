import { defineSceneModule } from "image-to-world/runtime";
import {
  Group,
  Mesh,
  BoxGeometry,
  MeshBasicMaterial,
  Vector3,
  Quaternion,
  Color,
} from "three";
import { SplatMesh } from "@sparkjsdev/spark";

/** A small editable recipe, not a compulsory image-to-3D pipeline. */
export default defineSceneModule({
  parameters: {
    image: { type: "asset", label: "Pixel image", default: "" },
    representation: {
      type: "select",
      default: "voxels",
      options: ["voxels", "splats"],
    },
    resolution: { type: "number", default: 32, min: 4, max: 96, step: 1 },
    width: { type: "number", default: 2, min: 0.01, max: 100 },
    thickness: { type: "number", default: 2, min: 1, max: 8, step: 1 },
  },
  async create({ params, assetUrl, signal }) {
    if (!params.image) throw new Error("Set the image asset parameter");
    const response = await fetch(assetUrl(String(params.image)), { signal });
    if (!response.ok) throw new Error("Could not load pixel image");
    const bitmap = await createImageBitmap(await response.blob());
    const width = Math.round(Number(params.resolution));
    const height = Math.max(
      1,
      Math.round((width * bitmap.height) / bitmap.width),
    );
    if (height > 192) {
      bitmap.close();
      throw new Error("Use an image with an aspect ratio below 2:1 vertically");
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    context.imageSmoothingEnabled = false;
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const pixels = context.getImageData(0, 0, width, height).data;
    const size = Number(params.width) / width,
      layers = Math.round(Number(params.thickness));
    const object = new Group(),
      samples: Array<{ position: Vector3; color: Color; alpha: number }> = [];
    const geometry = new BoxGeometry(size, size, size),
      materials = new Map<string, MeshBasicMaterial>();
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4,
          alpha = pixels[offset + 3] / 255;
        if (alpha < 0.5) continue;
        const rgb = `#${[...pixels.slice(offset, offset + 3)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
        const color = new Color(rgb);
        for (let z = 0; z < layers; z++) {
          const position = new Vector3(
            (x - (width - 1) / 2) * size,
            (height - y - 0.5) * size,
            (z - (layers - 1) / 2) * size,
          );
          if (params.representation === "splats")
            samples.push({ position, color, alpha });
          else {
            let material = materials.get(rgb);
            if (!material) {
              material = new MeshBasicMaterial({ color });
              materials.set(rgb, material);
            }
            const cube = new Mesh(geometry, material);
            cube.position.copy(position);
            object.add(cube);
          }
        }
      }
    if (params.representation === "splats") {
      geometry.dispose();
      const splats = new SplatMesh({
        raycastable: true,
        constructSplats(data) {
          for (const item of samples)
            data.pushSplat(
              item.position,
              new Vector3(size * 0.4, size * 0.4, size * 0.4),
              new Quaternion(),
              item.alpha,
              item.color,
            );
        },
      });
      await splats.initialized;
      object.add(splats);
    }
    signal.throwIfAborted();
    return { object };
  },
});
