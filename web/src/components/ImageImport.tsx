import {
  CaretLeft,
  CaretRight,
  Lock,
  Pause,
  Play,
} from "@phosphor-icons/react";
import { Button, Dialog, Flex, Select } from "@radix-ui/themes";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ATLAS_FORMATS,
  closestFormat,
  importCropRect,
  lockedFormat,
  type CropPosition,
  type Resolution,
} from "../../../core/formats";
import {
  assetUrl,
  type Asset,
  type Camera,
  type CommandResult,
  type PlacementMode,
} from "../../../core/schema";
import { useImageToWorldClient, useWorkspace } from "../lib/client";

export const ASSET_CLIPBOARD_TYPE = "application/x-image-to-world-assets+json";

export type PlacementDestination = {
  parentId?: string | null;
  beforeId?: string | null;
};

export type RequestPlacement = (
  assets: Asset[],
  camera?: Camera,
  destination?: PlacementDestination,
) => void;

type PendingPlacement = {
  images: Asset[];
  posedIds: string[];
  camera?: Camera;
  destination?: PlacementDestination;
};

type PreviewImage = {
  asset: Asset;
  url: string;
  width: number;
  height: number;
};

async function loadPreview(asset: Asset): Promise<PreviewImage> {
  const image = new Image();
  image.src = assetUrl(asset);
  await image.decode();
  return {
    asset,
    url: image.src,
    width: image.naturalWidth,
    height: image.naturalHeight,
  };
}

/** Crop an image to the session grid at its chosen position, as posing expects. */
async function cropToFormat(
  image: PreviewImage,
  format: Resolution,
  position?: CropPosition,
): Promise<File> {
  const source = new Image();
  source.src = image.url;
  await source.decode();
  const crop = importCropRect(image, format, position);
  const canvas = document.createElement("canvas");
  canvas.width = format.width;
  canvas.height = format.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not prepare the imported image");
  context.imageSmoothingQuality = "high";
  context.drawImage(
    source,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    format.width,
    format.height,
  );
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) =>
        value
          ? resolve(value)
          : reject(new Error("Could not encode the image")),
      "image/jpeg",
      0.95,
    ),
  );
  const stem = image.asset.name.replace(/\.[^.]+$/, "");
  return new File([blob], `${stem}-${format.width}x${format.height}.jpg`, {
    type: "image/jpeg",
  });
}

export function useImageImport() {
  const client = useImageToWorldClient();
  const locked = useWorkspace(lockedFormat);
  const [pending, setPending] = useState<PendingPlacement[]>([]);
  const active = pending[0];
  const [layouts, setLayouts] = useState<string[]>([]);
  const askLayout = useCallback(
    (frameIds: string[], jointJobs: string[] = []) => {
      if (frameIds.length < 2 && !jointJobs.length) return;
      const targets = [
        frameIds.length ? "Frames " + frameIds.join(", ") : "",
        jointJobs.length
          ? "Frames from reconstruction jobs " + jointJobs.join(", ")
          : "",
      ]
        .filter(Boolean)
        .join(" and ");
      setLayouts((queue) => [
        ...queue,
        `In my image-to-world project at ${window.location.origin}, arrange ${targets}. Wait for posed depth, inspect the point clouds from above and from the side, ground the Frames, and space disconnected views so their observed volumes do not overlap. Preserve the relative poses of any jointly reconstructed photos. Verify the layout before generating connecting views.`,
      ]);
    },
    [],
  );

  const place = useCallback(
    async (
      assets: Asset[],
      mode: PlacementMode,
      camera?: Camera,
      destination?: PlacementDestination,
    ) => {
      if (!assets.length) return;
      return client.command({
        type: "assets.place",
        assetIds: assets.map((asset) => asset.id),
        mode,
        camera,
        ...destination,
      });
    },
    [client],
  );

  const requestPlacement = useCallback<RequestPlacement>(
    (assets, camera, destination) => {
      const unique = [
        ...new Map(assets.map((asset) => [asset.id, asset])).values(),
      ];
      const others = unique.filter((asset) => asset.kind !== "image");
      const images = unique.filter(
        (asset) =>
          asset.kind === "image" && !(asset.camera && asset.depthAssetId),
      );
      const posed = unique.filter(
        (asset) => asset.kind === "image" && asset.camera && asset.depthAssetId,
      );
      void (async () => {
        await place(others, "individual", camera, destination);
        const posedResult = await place(
          posed,
          "individual",
          camera,
          destination,
        );
        const posedIds = posedResult?.nodeIds ?? [];
        if (images.length) {
          setPending((queue) => [
            ...queue,
            { images, camera, destination, posedIds },
          ]);
        } else askLayout(posedIds);
      })().catch((cause) =>
        client.setError(cause instanceof Error ? cause.message : String(cause)),
      );
    },
    [client, place, askLayout],
  );

  const choose = async (
    mode: PlacementMode,
    images: PreviewImage[],
    format: Resolution,
    crops: ReadonlyMap<string, CropPosition>,
  ) => {
    if (!active) return;
    const { camera, destination, posedIds } = active;
    const offerLayout = (result?: CommandResult) =>
      askLayout(
        [...posedIds, ...(result?.nodeIds ?? [])],
        mode === "reconstruct" ? result?.jobIds : undefined,
      );
    setPending((queue) => queue.slice(1));
    try {
      if (mode === "reference") {
        const references = await Promise.all(
          images.map(async (image) => {
            const position = crops.get(image.asset.id);
            const crop = importCropRect(image, format, position);
            if (
              Math.abs(crop.width - image.width) < 0.5 &&
              Math.abs(crop.height - image.height) < 0.5
            )
              return image.asset;
            const file = await cropToFormat(
              image,
              {
                width: Math.round(crop.width),
                height: Math.round(crop.height),
              },
              position,
            );
            return (await client.upload([file]))[0];
          }),
        );
        await place(references, mode, camera, destination);
        askLayout(posedIds);
        return;
      }
      if (!locked)
        await client.command({
          type: "workspace.update",
          settings: { format: { width: format.width, height: format.height } },
        });
      const files = await Promise.all(
        images.map((image) =>
          cropToFormat(image, format, crops.get(image.asset.id)),
        ),
      );
      offerLayout(
        await place(await client.upload(files), mode, camera, destination),
      );
    } catch (cause) {
      client.setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const dismissLayout = () => setLayouts((queue) => queue.slice(1));
  const dialog = (
    <>
      <Dialog.Root
        open={Boolean(active)}
        onOpenChange={(open) => {
          if (!open) setPending((queue) => queue.slice(1));
        }}
      >
        <Dialog.Content className="image-import-dialog" maxWidth="720px">
          <Dialog.Title className="image-import-title">Add images</Dialog.Title>
          <Dialog.Description className="image-import-description">
            Choose a crop and pose the images to begin the world layout.
          </Dialog.Description>
          {pending.length > 1 && (
            <p className="image-import-queued">
              {pending.length - 1} more import
              {pending.length === 2 ? " is" : "s are"} waiting.
            </p>
          )}
          {active && (
            <ImportBody
              key={active.images.map((asset) => asset.id).join()}
              assets={active.images}
              locked={locked}
              onChoose={(mode, images, format, crops) =>
                void choose(mode, images, format, crops)
              }
            />
          )}
        </Dialog.Content>
      </Dialog.Root>
      <Dialog.Root
        open={!active && layouts.length > 0}
        onOpenChange={(open) => {
          if (!open) dismissLayout();
        }}
      >
        <Dialog.Content size="2" maxWidth="420px">
          <Dialog.Title size="3">Who will arrange these views?</Dialog.Title>
          <Dialog.Description size="2">
            Move the Frames yourself, or copy the arrangement request into your
            agent chat.
          </Dialog.Description>
          <Flex justify="end" gap="2" mt="4">
            <Button
              size="1"
              color="gray"
              variant="surface"
              onClick={dismissLayout}
            >
              I’ll arrange them
            </Button>
            <Button
              size="1"
              color="gray"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(layouts[0]);
                  dismissLayout();
                } catch {
                  client.setError("Could not copy the arrangement request.");
                }
              }}
            >
              Copy request for agent
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );

  return { requestPlacement, dialog };
}

function ImportBody({
  assets,
  locked,
  onChoose,
}: {
  assets: Asset[];
  locked: Resolution | null;
  onChoose: (
    mode: PlacementMode,
    images: PreviewImage[],
    format: Resolution,
    crops: ReadonlyMap<string, CropPosition>,
  ) => void;
}) {
  const [images, setImages] = useState<PreviewImage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Resolution | null>(null);
  const [crops, setCrops] = useState<ReadonlyMap<string, CropPosition>>(
    new Map(),
  );
  useEffect(() => {
    let active = true;
    Promise.all(assets.map(loadPreview)).then(
      (loaded) => active && setImages(loaded),
      (cause) =>
        active &&
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not open these images",
        ),
    );
    return () => {
      active = false;
    };
  }, [assets]);
  const format =
    locked ?? chosen ?? (images?.[0] ? closestFormat(images[0]) : null);
  const count = assets.length;
  return (
    <div className="image-import-body">
      <div className="image-import-preview-shell">
        {images && format ? (
          <ImportPreview
            images={images}
            format={format}
            locked={Boolean(locked)}
            crops={crops}
            onFormat={setChosen}
            onCrop={(id, position) =>
              setCrops((previous) => new Map([...previous, [id, position]]))
            }
          />
        ) : error ? (
          <p className="image-import-error" role="alert">
            {error}
          </p>
        ) : (
          <p className="image-import-status" role="status">
            Reading image formats
          </p>
        )}
      </div>
      <div className="image-import-choices">
        <button
          className="image-import-choice"
          type="button"
          disabled={!images || !format}
          onClick={() =>
            images && format && onChoose("individual", images, format, crops)
          }
        >
          <span className="image-import-art is-single" aria-hidden>
            <img src={assetUrl(assets[0])} alt="" draggable={false} />
          </span>
          <strong>{count === 1 ? "Pose image" : "Pose individually"}</strong>
          <span>Estimate a camera and depth per image with Atlas.</span>
        </button>
        <button
          className="image-import-choice"
          type="button"
          disabled={!images || !format || count < 2}
          onClick={() =>
            images && format && onChoose("reconstruct", images, format, crops)
          }
        >
          <span className="image-import-art is-stack" aria-hidden>
            {assets.slice(0, 3).map((asset) => (
              <img
                key={asset.id}
                src={assetUrl(asset)}
                alt=""
                draggable={false}
              />
            ))}
          </span>
          <strong>Reconstruct</strong>
          <span>
            {count === 1
              ? "Reconstruct needs at least two overlapping photos."
              : "Overlapping photos of one place"}
          </span>
        </button>
        <button
          className="image-import-choice"
          type="button"
          disabled={!images || !format}
          onClick={() =>
            images && format && onChoose("reference", images, format, crops)
          }
        >
          <span className="image-import-art is-single" aria-hidden>
            <img src={assetUrl(assets[0])} alt="" draggable={false} />
          </span>
          <strong>Reference only</strong>
          <span>Place a movable Frame at this camera. Runs locally.</span>
        </button>
      </div>
    </div>
  );
}

function ImportPreview({
  images,
  format,
  locked,
  crops,
  onFormat,
  onCrop,
}: {
  images: PreviewImage[];
  format: Resolution;
  locked: boolean;
  crops: ReadonlyMap<string, CropPosition>;
  onFormat: (format: Resolution) => void;
  onCrop: (assetId: string, position: CropPosition) => void;
}) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(images.length > 1);
  const drag = useRef<{
    pointerId: number;
    x: number;
    y: number;
    position: CropPosition;
    scale: number;
  } | null>(null);
  const image = images[index];
  const aspect = closestFormat(format).aspectRatio;
  const position = crops.get(image.asset.id) ?? { x: 0.5, y: 0.5 };
  const crop = importCropRect(image, format, position);
  const travelX = Math.max(0, image.width - crop.width);
  const travelY = Math.max(0, image.height - crop.height);
  const movable = travelX > 0 || travelY > 0;
  useEffect(() => {
    if (!playing || images.length < 2) return;
    const timer = window.setTimeout(
      () => setIndex((current) => (current + 1) % images.length),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [images.length, index, playing]);
  const move = (x: number, y: number) =>
    onCrop(image.asset.id, {
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
    });
  const step = (direction: number) => {
    setPlaying(false);
    setIndex(
      (current) => (current + direction + images.length) % images.length,
    );
  };
  return (
    <section className="image-import-preview" aria-label="Import preview">
      <div className="image-import-formats">
        <span className="format-pill">
          {image.width} × {image.height}
        </span>
        <span aria-hidden>→</span>
        {locked ? (
          <span
            className="format-pill"
            title="The output format is locked while the spatial context contains images."
          >
            <Lock size={11} />
            {aspect} · {format.width} × {format.height}
          </span>
        ) : (
          <Select.Root
            size="1"
            value={aspect}
            onValueChange={(value) => {
              const next = ATLAS_FORMATS.find((f) => f.aspectRatio === value);
              if (next) onFormat(next);
            }}
          >
            <Select.Trigger
              className="format-pill"
              variant="ghost"
              aria-label="Output aspect ratio"
            />
            <Select.Content position="popper">
              {ATLAS_FORMATS.map((option) => (
                <Select.Item
                  key={option.aspectRatio}
                  value={option.aspectRatio}
                >
                  {option.aspectRatio} · {option.width} × {option.height}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        )}
      </div>
      <div className="image-import-frame">
        <img src={image.url} alt={image.asset.name} draggable={false} />
        <svg viewBox={`0 0 ${image.width} ${image.height}`}>
          <path
            d={`M0 0H${image.width}V${image.height}H0Z M${crop.x} ${crop.y}h${crop.width}v${crop.height}h${-crop.width}Z`}
            fill="black"
            fillOpacity={0.5}
            fillRule="evenodd"
          />
          <rect
            aria-label="Crop position"
            role={movable ? "slider" : undefined}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(
              (travelX > 0 ? position.x : position.y) * 100,
            )}
            tabIndex={movable ? 0 : undefined}
            className={movable ? "is-movable" : undefined}
            x={crop.x}
            y={crop.y}
            width={crop.width}
            height={crop.height}
            fill="transparent"
            stroke="white"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            onPointerDown={(event) => {
              const bounds =
                event.currentTarget.ownerSVGElement?.getBoundingClientRect();
              if (!movable || event.button !== 0 || !bounds) return;
              drag.current = {
                pointerId: event.pointerId,
                x: event.clientX,
                y: event.clientY,
                position,
                scale: Math.min(
                  bounds.width / image.width,
                  bounds.height / image.height,
                ),
              };
              event.currentTarget.setPointerCapture(event.pointerId);
              setPlaying(false);
              event.preventDefault();
            }}
            onPointerMove={(event) => {
              const start = drag.current;
              if (!start || start.pointerId !== event.pointerId) return;
              move(
                travelX
                  ? start.position.x +
                      (event.clientX - start.x) / start.scale / travelX
                  : 0.5,
                travelY
                  ? start.position.y +
                      (event.clientY - start.y) / start.scale / travelY
                  : 0.5,
              );
            }}
            onLostPointerCapture={() => {
              drag.current = null;
            }}
            onKeyDown={(event) => {
              const delta = {
                ArrowLeft: -0.05,
                ArrowRight: 0.05,
                ArrowUp: -0.05,
                ArrowDown: 0.05,
              }[event.key];
              if (!movable || !delta) return;
              event.preventDefault();
              event.stopPropagation();
              setPlaying(false);
              move(
                travelX ? position.x + delta : position.x,
                travelY ? position.y + delta : position.y,
              );
            }}
          />
        </svg>
        {images.length > 1 && (
          <div className="image-import-nav">
            <button
              type="button"
              aria-label="Previous image"
              onClick={() => step(-1)}
            >
              <CaretLeft size={12} />
            </button>
            <button
              type="button"
              aria-label="Next image"
              onClick={() => step(1)}
            >
              <CaretRight size={12} />
            </button>
            <button
              type="button"
              aria-label={
                playing ? "Pause import preview" : "Play import preview"
              }
              onClick={() => setPlaying(!playing)}
            >
              {playing ? <Pause size={12} /> : <Play size={12} />}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

export function clipboardAssetIds(data: DataTransfer) {
  const value = data.getData(ASSET_CLIPBOARD_TYPE);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as { assetIds?: unknown };
    return Array.isArray(parsed.assetIds)
      ? [
          ...new Set(
            parsed.assetIds.filter(
              (id): id is string => typeof id === "string",
            ),
          ),
        ]
      : [];
  } catch {
    return [];
  }
}
