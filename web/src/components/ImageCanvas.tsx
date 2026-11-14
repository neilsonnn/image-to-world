import {
  ArrowsOutSimple,
  Hand,
  Minus,
  PencilSimple,
  Plus,
  SelectionBackground,
  SpinnerGap,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { assetUrl, type Asset, type ImageDraft } from "../../../core/schema";
import { Hint } from "./ui";
import { loadDepthGrid } from "../lib/depth";
import { renderClipMask, type CaptureMask } from "../lib/clip-mask";
import type { DepthGrid } from "../../../core/depth";

type Tool = "pan" | "draw" | "erase";

type ImageCanvasProps = {
  source: Asset | null;
  operation?: { pending: boolean; message?: string; error?: string } | null;
  parent: Asset | null;
  assets: Record<string, Asset>;
  draft: ImageDraft;
  tool: Tool;
  brushColor: string;
  brushSize: number;
  zoom: number;
  compare: boolean;
  mask: CaptureMask | null;
  fitNonce: number;
  onToolChange: (tool: Tool) => void;
  onZoomChange: (zoom: number) => void;
  onStroke: (stroke: ImageDraft["strokes"][number]) => void;
  onImport: () => void;
  onError: (message: string) => void;
};

type Size = { width: number; height: number };

async function loadBitmap(asset: Asset): Promise<ImageBitmap> {
  const response = await fetch(assetUrl(asset));
  if (!response.ok) throw new Error(`Could not load ${asset.name}`);
  return createImageBitmap(await response.blob());
}

export function ImageCanvas({
  source,
  operation,
  parent,
  assets,
  draft,
  tool,
  brushColor,
  brushSize,
  zoom,
  compare,
  mask,
  fitNonce,
  onToolChange,
  onZoomChange,
  onStroke,
  onImport,
  onError,
}: ImageCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement>(null);
  const annotationCanvasRef = useRef<HTMLCanvasElement>(null);
  const baseBitmapRef = useRef<ImageBitmap | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [maskDepth, setMaskDepth] = useState<{
    key: string;
    depth: DepthGrid;
  } | null>(null);
  const depthKey = mask
    ? `${mask.depthUrl}:${JSON.stringify(mask.encoding)}`
    : "";
  const layerBitmapsRef = useRef(new Map<string, ImageBitmap>());
  const panRef = useRef({ x: 0, y: 0 });
  const gestureRef = useRef<{
    pointerId: number;
    lastX: number;
    lastY: number;
    stroke?: ImageDraft["strokes"][number];
  } | null>(null);
  const paintRef = useRef<() => void>(() => undefined);
  const onErrorRef = useRef(onError);
  const [size, setSize] = useState<Size>({ width: 1, height: 1 });
  const [loading, setLoading] = useState(false);
  const visibleAsset = compare && parent ? parent : source;
  const visibleAssetKey = visibleAsset
    ? `${visibleAsset.id}:${visibleAsset.modifiedAt}`
    : "";
  const layerAssets = compare
    ? []
    : [
        ...new Set(
          draft.layers
            .filter((layer) => layer.visible)
            .map((layer) => assets[layer.assetId])
            .filter(Boolean),
        ),
      ];
  const layerAssetKey = layerAssets
    .map((asset) => `${asset.id}:${asset.modifiedAt}`)
    .sort()
    .join("|");
  const resourcesRef = useRef({ visibleAsset, layerAssets });
  resourcesRef.current = { visibleAsset, layerAssets };

  const transform = useCallback(() => {
    const bitmap = baseBitmapRef.current;
    if (!bitmap) return null;
    const fit = Math.min(
      size.width / bitmap.width,
      size.height / bitmap.height,
    );
    const scale = fit * zoom;
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    return {
      scale,
      width,
      height,
      x: (size.width - width) / 2 + panRef.current.x,
      y: (size.height - height) / 2 + panRef.current.y,
    };
  }, [size, zoom]);

  const paint = useCallback(() => {
    const base = baseCanvasRef.current;
    const annotation = annotationCanvasRef.current;
    const bitmap = baseBitmapRef.current;
    if (!base || !annotation) return;
    const ratio = window.devicePixelRatio || 1;
    for (const canvas of [base, annotation]) {
      if (canvas.width !== Math.round(size.width * ratio))
        canvas.width = Math.round(size.width * ratio);
      if (canvas.height !== Math.round(size.height * ratio))
        canvas.height = Math.round(size.height * ratio);
      canvas.style.width = `${size.width}px`;
      canvas.style.height = `${size.height}px`;
    }
    const baseContext = base.getContext("2d");
    const annotationContext = annotation.getContext("2d");
    if (!baseContext || !annotationContext) return;
    baseContext.setTransform(ratio, 0, 0, ratio, 0, 0);
    annotationContext.setTransform(ratio, 0, 0, ratio, 0, 0);
    baseContext.clearRect(0, 0, size.width, size.height);
    annotationContext.clearRect(0, 0, size.width, size.height);
    if (!bitmap) return;
    const view = transform();
    if (!view) return;
    baseContext.imageSmoothingEnabled = true;
    baseContext.imageSmoothingQuality = "high";
    baseContext.drawImage(bitmap, view.x, view.y, view.width, view.height);

    if (!compare) {
      for (const layer of draft.layers) {
        if (!layer.visible) continue;
        const layerBitmap = layerBitmapsRef.current.get(layer.assetId);
        if (!layerBitmap) continue;
        baseContext.save();
        baseContext.globalAlpha = layer.opacity;
        baseContext.drawImage(
          layerBitmap,
          view.x + layer.x * view.width,
          view.y + layer.y * view.height,
          layer.width * view.width,
          layer.height * view.height,
        );
        baseContext.restore();
      }

      if (mask && maskCanvasRef.current) {
        const c = mask.camera.intrinsics;
        const cover = Math.max(
          c.width / bitmap.width,
          c.height / bitmap.height,
        );
        const width = (c.width / cover) * view.scale;
        const height = (c.height / cover) * view.scale;
        baseContext.save();
        baseContext.beginPath();
        baseContext.rect(view.x, view.y, view.width, view.height);
        baseContext.clip();
        baseContext.globalAlpha = Number(
          getComputedStyle(hostRef.current!).getPropertyValue(
            "--clip-mask-opacity",
          ),
        );
        baseContext.drawImage(
          maskCanvasRef.current,
          view.x + (view.width - width) / 2,
          view.y + (view.height - height) / 2,
          width,
          height,
        );
        baseContext.restore();
      }

      annotationContext.lineCap = "round";
      annotationContext.lineJoin = "round";
      const activeStroke = gestureRef.current?.stroke;
      const strokes = activeStroke
        ? [...draft.strokes, activeStroke]
        : draft.strokes;
      for (const stroke of strokes) {
        if (!stroke.points.length) continue;
        annotationContext.save();
        annotationContext.globalCompositeOperation = stroke.erase
          ? "destination-out"
          : "source-over";
        annotationContext.strokeStyle = stroke.color;
        annotationContext.fillStyle = stroke.color;
        annotationContext.lineWidth = Math.max(1, stroke.size * view.width);
        annotationContext.beginPath();
        const [firstX, firstY] = stroke.points[0];
        annotationContext.moveTo(
          view.x + firstX * view.width,
          view.y + firstY * view.height,
        );
        for (const [x, y] of stroke.points.slice(1)) {
          annotationContext.lineTo(
            view.x + x * view.width,
            view.y + y * view.height,
          );
        }
        if (stroke.points.length === 1) {
          annotationContext.arc(
            view.x + firstX * view.width,
            view.y + firstY * view.height,
            annotationContext.lineWidth / 2,
            0,
            Math.PI * 2,
          );
          annotationContext.fill();
        } else {
          annotationContext.stroke();
        }
        annotationContext.restore();
      }
    }
  }, [compare, draft.layers, draft.strokes, size, transform, mask]);
  paintRef.current = paint;
  onErrorRef.current = onError;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(([entry]) => {
      const rect = entry.contentRect;
      setSize({
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height),
      });
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const ownedBitmaps: ImageBitmap[] = [];
    const resources = resourcesRef.current;
    const { visibleAsset, layerAssets } = resources;
    setLoading(Boolean(visibleAsset));
    baseBitmapRef.current = null;
    layerBitmapsRef.current = new Map();
    void (async () => {
      try {
        if (!visibleAsset) return;
        const baseBitmap = await loadBitmap(visibleAsset);
        if (cancelled) {
          baseBitmap.close();
          return;
        }
        ownedBitmaps.push(baseBitmap);
        baseBitmapRef.current = baseBitmap;
        paintRef.current();
        if (layerAssets.length) {
          const loadedLayers = await Promise.allSettled(
            layerAssets.map(async (asset) => ({
              id: asset.id,
              bitmap: await loadBitmap(asset),
            })),
          );
          let loadError: unknown;
          for (const result of loadedLayers) {
            if (result.status === "rejected") {
              loadError ??= result.reason;
              continue;
            }
            const { id, bitmap } = result.value;
            if (cancelled) bitmap.close();
            else {
              ownedBitmaps.push(bitmap);
              layerBitmapsRef.current.set(id, bitmap);
            }
          }
          if (loadError) throw loadError;
          if (!cancelled) {
            paintRef.current();
          }
        } else if (!cancelled) {
          paintRef.current();
        }
      } catch (error) {
        if (!cancelled)
          onErrorRef.current(
            error instanceof Error ? error.message : String(error),
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      for (const bitmap of ownedBitmaps) bitmap.close();
    };
  }, [visibleAssetKey, layerAssetKey]);

  useEffect(() => paint(), [paint]);

  useEffect(() => {
    maskCanvasRef.current = null;
    setMaskDepth(null);
    if (!mask) return;
    const controller = new AbortController();
    void loadDepthGrid(mask.depthUrl, mask.encoding, controller.signal)
      .then((depth) => {
        if (!controller.signal.aborted) setMaskDepth({ key: depthKey, depth });
      })
      .catch((error) => {
        if (!controller.signal.aborted) onErrorRef.current(String(error));
      });
    return () => controller.abort();
  }, [depthKey]);

  useEffect(() => {
    if (!mask || maskDepth?.key !== depthKey) {
      maskCanvasRef.current = null;
      paintRef.current();
      return;
    }
    const animation = requestAnimationFrame(() => {
      const pixels = renderClipMask(maskDepth.depth, mask);
      const canvas = maskCanvasRef.current ?? document.createElement("canvas");
      canvas.width = pixels.width;
      canvas.height = pixels.height;
      canvas
        .getContext("2d")!
        .putImageData(
          new ImageData(pixels.data, pixels.width, pixels.height),
          0,
          0,
        );
      maskCanvasRef.current = canvas;
      paintRef.current();
    });
    return () => cancelAnimationFrame(animation);
  }, [mask, maskDepth, depthKey]);

  useEffect(() => {
    panRef.current = { x: 0, y: 0 };
    paintRef.current();
  }, [fitNonce]);

  const pointForEvent = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const view = transform();
      const rect = event.currentTarget.getBoundingClientRect();
      if (!view) return null;
      const x = (event.clientX - rect.left - view.x) / view.width;
      const y = (event.clientY - rect.top - view.y) / view.height;
      if (x < 0 || x > 1 || y < 0 || y > 1) return null;
      return [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))] as [
        number,
        number,
      ];
    },
    [transform],
  );

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!source || compare) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === "pan") {
      gestureRef.current = {
        pointerId: event.pointerId,
        lastX: event.clientX,
        lastY: event.clientY,
      };
      return;
    }
    const point = pointForEvent(event);
    if (!point) return;
    gestureRef.current = {
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
      stroke: {
        id: crypto.randomUUID(),
        points: [point],
        color: brushColor,
        size: brushSize,
        erase: tool === "erase",
      },
    };
    paint();
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (!gesture.stroke) {
      panRef.current.x += event.clientX - gesture.lastX;
      panRef.current.y += event.clientY - gesture.lastY;
      gesture.lastX = event.clientX;
      gesture.lastY = event.clientY;
      paint();
      return;
    }
    const point = pointForEvent(event);
    if (!point) return;
    const previous = gesture.stroke.points.at(-1);
    if (
      previous &&
      Math.hypot(point[0] - previous[0], point[1] - previous[1]) < 0.001
    )
      return;
    gesture.stroke.points.push(point);
    paint();
  };

  const finishGesture = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    if (gesture.stroke) onStroke(gesture.stroke);
  };

  return (
    <section className="ie-canvas-shell" aria-label="Image canvas">
      <div className="ie-canvas-tools" role="toolbar" aria-label="Canvas tools">
        <Hint label="Pan">
          <button
            className={tool === "pan" ? "is-active" : ""}
            aria-label="Pan"
            onClick={() => onToolChange("pan")}
          >
            <Hand size={16} />
          </button>
        </Hint>
        <Hint label="Draw guidance">
          <button
            className={tool === "draw" ? "is-active" : ""}
            aria-label="Draw guidance"
            onClick={() => onToolChange("draw")}
          >
            <PencilSimple size={16} />
          </button>
        </Hint>
        <Hint label="Erase guidance">
          <button
            className={tool === "erase" ? "is-active" : ""}
            aria-label="Erase guidance"
            onClick={() => onToolChange("erase")}
          >
            <SelectionBackground size={16} />
          </button>
        </Hint>
        <span className="ie-toolbar-rule" />
        <Hint label="Zoom out">
          <button
            aria-label="Zoom out"
            onClick={() =>
              onZoomChange(Math.max(0.1, Number((zoom - 0.1).toFixed(1))))
            }
          >
            <Minus size={16} />
          </button>
        </Hint>
        <output>{Math.round(zoom * 100)}%</output>
        <Hint label="Zoom in">
          <button
            aria-label="Zoom in"
            onClick={() =>
              onZoomChange(Math.min(8, Number((zoom + 0.1).toFixed(1))))
            }
          >
            <Plus size={16} />
          </button>
        </Hint>
        <Hint label="Fit image">
          <button aria-label="Fit image" onClick={() => onZoomChange(1)}>
            <ArrowsOutSimple size={16} />
          </button>
        </Hint>
      </div>
      <div
        ref={hostRef}
        className={`ie-canvas-stage ie-tool-${tool}${compare ? " is-comparing" : ""}`}
      >
        {source ? (
          <>
            <canvas ref={baseCanvasRef} aria-hidden="true" />
            <canvas
              ref={annotationCanvasRef}
              aria-label={
                tool === "pan" ? "Pan image" : `${tool} edit guidance`
              }
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={finishGesture}
              onPointerCancel={finishGesture}
            />
            {loading && (
              <div className="ie-canvas-loading">
                <span /> Loading image
              </div>
            )}
            {compare && parent && (
              <span className="ie-before-badge">Before</span>
            )}
          </>
        ) : operation ? (
          !operation.pending &&
          !operation.error && (
            <div className="ie-empty-canvas" role="status">
              <span>This Frame has no image.</span>
            </div>
          )
        ) : (
          <div className="ie-empty-canvas">
            <div className="ie-empty-mark">
              <Plus size={22} />
            </div>
            <strong>Choose a source image</strong>
            <span>Import an image or select one from Assets to begin.</span>
            <button className="ie-button ie-button-primary" onClick={onImport}>
              Import image
            </button>
          </div>
        )}
        {operation?.pending && (
          <div
            className="ie-operation-overlay"
            role="status"
            aria-label="Pending image operation"
          >
            <SpinnerGap className="spin" size={28} />
            <span>{operation.message || "Generating image"}</span>
          </div>
        )}
        {!operation?.pending && operation?.error && (
          <div className="ie-operation-overlay is-error" role="status">
            <WarningCircle size={24} />
            <span>{operation.error}</span>
          </div>
        )}
      </div>
    </section>
  );
}
