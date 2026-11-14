import { createCanvas, loadImage } from "@napi-rs/canvas";
import type { Job, Workspace } from "../../../core/schema";
import type { WorkspaceStore } from "./store";
export async function renderContactSheet(
  store: WorkspaceStore,
  job: Job,
  signal: AbortSignal,
) {
  if (job.input.kind !== "contactSheet" || !job.contextSnapshot)
    throw new Error("Contact sheet snapshot is missing");
  const snapshot = { ...store.snapshot(), ...job.contextSnapshot } as Workspace;
  const items = job.previewItems;
  if (!items?.length) throw new Error("Contact sheet items are missing");
  const columns = Math.min(job.input.columns, items.length),
    width = job.input.width,
    height = Math.round((width * 9) / 16),
    footer = 44;
  const rows = Math.ceil(items.length / columns);
  const canvas = createCanvas(columns * width, rows * (height + footer));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#181a1c";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < items.length; i++) {
    signal.throwIfAborted();
    const item = items[i],
      expected = snapshot.assets[item.assetId];
    const { file, asset } = await store.assetFile(item.assetId);
    if (
      asset.modifiedAt !== expected.modifiedAt ||
      asset.size !== expected.size
    )
      throw new Error(`Preview source changed: ${item.label}`);
    const image = await loadImage(file);
    const x = (i % columns) * width,
      y = Math.floor(i / columns) * (height + footer);
    const scale = Math.min(
      (width - 8) / image.width,
      (height - 8) / image.height,
    );
    ctx.drawImage(
      image,
      x + (width - image.width * scale) / 2,
      y + (height - image.height * scale) / 2,
      image.width * scale,
      image.height * scale,
    );
    const text = (value: string, top: number, color: string, size: number) => {
      ctx.fillStyle = color;
      ctx.font = `${size}px sans-serif`;
      let line = value;
      while (line.length && ctx.measureText(line).width > width - 16)
        line = line.slice(0, -1);
      if (line !== value) line = line.slice(0, -1) + "…";
      ctx.fillText(line, x + 8, top);
    };
    text(item.label, y + height + 16, "#eeeeee", 13);
    text(item.status ?? item.assetId, y + height + 33, "#aaaeb4", 10);
  }
  signal.throwIfAborted();
  const image = await store.importFile(
    new Blob([new Uint8Array(canvas.toBuffer("image/png"))], {
      type: "image/png",
    }),
    `${job.id}-contact-sheet.png`,
    {
      jobId: job.id,
      name: "Scene contact sheet",
      referenceAssetIds: items.map((item) => item.assetId),
    },
  );
  const manifest = await store.importFile(
    new Blob(
      [
        JSON.stringify(
          { items, columns, width: canvas.width, height: canvas.height },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    ),
    `${job.id}-contact-sheet.json`,
    { jobId: job.id },
  );
  return [image, manifest];
}
