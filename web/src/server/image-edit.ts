import { createCanvas, loadImage } from "@napi-rs/canvas";
import type { ImageDraft } from "../../../core/schema";
import type { WorkspaceStore } from "./store";

export async function renderImageDraft(
  store: WorkspaceStore,
  assetId: string,
  draft: ImageDraft,
  signal: AbortSignal,
): Promise<Blob> {
  const { file } = await store.assetFile(assetId);
  const source = await loadImage(file);
  signal.throwIfAborted();
  const canvas = createCanvas(source.width, source.height);
  const context = canvas.getContext("2d");
  context.drawImage(source, 0, 0);
  for (const layer of draft.layers) {
    if (!layer.visible) continue;
    const { file } = await store.assetFile(layer.assetId);
    const image = await loadImage(file);
    signal.throwIfAborted();
    context.globalAlpha = layer.opacity;
    context.drawImage(
      image,
      layer.x * source.width,
      layer.y * source.height,
      layer.width * source.width,
      layer.height * source.height,
    );
  }
  context.globalAlpha = 1;
  const annotations = createCanvas(source.width, source.height);
  const ink = annotations.getContext("2d");
  ink.lineCap = "round";
  ink.lineJoin = "round";
  for (const stroke of draft.strokes) {
    ink.globalCompositeOperation = stroke.erase
      ? "destination-out"
      : "source-over";
    ink.strokeStyle = ink.fillStyle = stroke.color;
    ink.lineWidth = stroke.size * source.width;
    ink.beginPath();
    const first = stroke.points[0];
    if (stroke.points.length === 1) {
      ink.arc(
        first[0] * source.width,
        first[1] * source.height,
        ink.lineWidth / 2,
        0,
        Math.PI * 2,
      );
      ink.fill();
    } else {
      ink.moveTo(first[0] * source.width, first[1] * source.height);
      for (const point of stroke.points.slice(1))
        ink.lineTo(point[0] * source.width, point[1] * source.height);
      ink.stroke();
    }
  }
  context.drawImage(annotations, 0, 0);
  return new Blob([new Uint8Array(await canvas.encode("png"))], {
    type: "image/png",
  });
}
