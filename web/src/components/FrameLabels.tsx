import { Check, SpinnerGap } from "@phosphor-icons/react";
import { Button, Popover, TextArea, Tooltip } from "@radix-ui/themes";
import { useState } from "react";
import {
  Vector3,
  WebGPUCoordinateSystem,
  type Object3D,
  type PerspectiveCamera,
} from "three";
import type { SceneGraph } from "../lib/scene";
import { useImageToWorldClient } from "../lib/client";
import type { Asset } from "../../../core/schema";
import { assetUrl } from "../../../core/schema";

export function FrameState({ tasks }: { tasks: string[] }) {
  const label = tasks.length ? tasks.join(" · ") : "Work complete";
  return (
    <Tooltip content={label} delayDuration={0}>
      <span className="frame-state" aria-label={label} tabIndex={0}>
        {tasks.length ? <SpinnerGap className="spin" /> : <Check />}
      </span>
    </Tooltip>
  );
}

const position = new Vector3();
function onScreen(point: Vector3, camera: PerspectiveCamera) {
  return (
    Math.abs(point.x) < 1 &&
    Math.abs(point.y) < 1 &&
    point.z >= (camera.coordinateSystem === WebGPUCoordinateSystem ? 0 : -1) &&
    point.z < 1
  );
}
export function positionFrameLabels(
  layer: HTMLElement,
  graph: SceneGraph,
  camera: PerspectiveCamera,
) {
  const width = layer.clientWidth,
    height = layer.clientHeight;
  const placed: { left: number; top: number; right: number; bottom: number }[] =
    [];
  for (const child of layer.children) {
    const label = child as HTMLElement;
    const anchor = graph.entries.get(label.dataset.anchor!)?.root;
    let visible = !!anchor;
    if (anchor) {
      for (let p: Object3D | null = anchor; p; p = p.parent)
        if (!p.visible) visible = false;
      position.set(0, 0, -0.3).applyMatrix4(anchor.matrixWorld).project(camera);
      if (visible && !onScreen(position, camera)) {
        // From inside a built set its source camera can be behind the visitor.
        // Keep the badge on the set's own pivot when that is in view.
        const frame = graph.entries.get(label.dataset.frame!)?.root;
        if (frame)
          position.setFromMatrixPosition(frame.matrixWorld).project(camera);
      }
      visible &&= onScreen(position, camera);
    }
    label.hidden = !visible;
    if (!visible) continue;
    const w = label.offsetWidth,
      h = label.offsetHeight;
    const left = Math.max(
      0,
      Math.min(width - w, ((1 + position.x) * width) / 2 - w / 2),
    );
    const origin = Math.max(
      0,
      Math.min(height - h, ((1 - position.y) * height) / 2),
    );
    const column = placed.filter((r) => r.left < left + w && r.right > left);
    const candidates = [
      origin,
      ...column.flatMap((r) => [r.bottom + 3, r.top - h - 3]),
    ].sort((a, b) => Math.abs(a - origin) - Math.abs(b - origin));
    const top =
      candidates.find(
        (y) =>
          y >= 0 &&
          y + h <= height &&
          column.every((r) => y + h <= r.top || y >= r.bottom),
      ) ?? origin;
    placed.push({ left, top, right: left + w, bottom: top + h });
    label.style.transform = `translate(${left}px,${top}px)`;
  }
}

export function FrameEdit({
  frameId,
  asset,
}: {
  frameId: string;
  asset: Asset;
}) {
  const [prompt, setPrompt] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { command, setError, getWorkspace } = useImageToWorldClient();
  async function submit() {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    try {
      await command({
        type: "generation.submit",
        request: {
          kind: "image.edit",
          sourceAssetId: asset.id,
          targetNodeIds: [frameId],
          referenceAssetIds: [],
          draft: { strokes: [], layers: [] },
          settings: getWorkspace().settings.editor2d.settings,
          prompt: prompt.trim(),
          applyToScene: true,
          reconstruct: true,
        },
      });
      setOpen(false);
      setPrompt("");
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger>
        <Button
          size="1"
          color="gray"
          variant="surface"
          aria-label="Describe edit"
        >
          <span className="toolbar-label">Describe edit</span>
        </Button>
      </Popover.Trigger>
      <Popover.Content width="280px" side="top" size="1">
        <form
          className="frame-edit"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <TextArea
            autoFocus
            aria-label="Describe the frame edit"
            placeholder="Describe the edit…"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <Button size="1" type="submit" disabled={busy || !prompt.trim()}>
            Edit image
          </Button>
        </form>
      </Popover.Content>
    </Popover.Root>
  );
}
export function FrameLabel({
  slug,
  tasks,
  selected,
  onSelect,
  thumbnail,
}: {
  slug: string;
  tasks: string[];
  selected: boolean;
  onSelect: () => void;
  thumbnail?: Asset;
}) {
  return (
    <>
      <div className="frame-badge">
        <FrameState tasks={tasks} />
        <button title={slug} aria-pressed={selected} onClick={onSelect}>
          {slug}
        </button>
      </div>
      {thumbnail && (
        <img className="frame-thumb" src={assetUrl(thumbnail)} alt="" />
      )}
    </>
  );
}
