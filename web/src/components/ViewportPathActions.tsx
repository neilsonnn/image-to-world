import type { SharedProps } from "./panelShared";
import { Button, Slider } from "@radix-ui/themes";
import { Play, Stop, VideoCamera } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { samplePath } from "../../../core/cameras";
import { atlasContext, selectedPath } from "../../../core/captures";
import type { SceneNode, Workspace } from "../../../core/schema";
import type { ViewportProps } from "./Viewport";
import { Hint } from "./ui";

type Props = Pick<ViewportProps, "onPreviewCamera"> &
  Pick<SharedProps, "command" | "onError"> & {
    workspace: Pick<
      Workspace,
      "nodes" | "assets" | "selection" | "primaryId"
    > & {
      settings: Pick<
        Workspace["settings"],
        "targetFrameCount" | "fps" | "atlas" | "atlasPanel"
      >;
    };
  };

export function ViewportPathActions(props: Props) {
  const path = selectedPath(props.workspace);
  return path ? <PathActions key={path.id} {...props} path={path} /> : null;
}

function PathActions({
  workspace,
  command,
  onError,
  onPreviewCamera,
  path,
}: Props & { path: SceneNode }) {
  const [playing, setPlaying] = useState(false);
  const [frame, setFrame] = useState(0);
  const targetFrameCount =
    path.targetFrameCount ?? workspace.settings.targetFrameCount;
  const duration = targetFrameCount / workspace.settings.fps;
  const sampled = useMemo(() => {
    try {
      return {
        cameras: samplePath(path, workspace.nodes, targetFrameCount),
        error: undefined,
      };
    } catch (error) {
      return {
        cameras: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [path, workspace.nodes, targetFrameCount]);
  const frames = useRef(sampled.cameras);
  frames.current = sampled.cameras;
  const cursor = useRef(0);
  const preview = useRef(onPreviewCamera);
  preview.current = onPreviewCamera;
  const contextError = useMemo(() => {
    try {
      if (
        !atlasContext(
          workspace,
          workspace.settings.atlasPanel.selectedOnly
            ? workspace.selection
            : undefined,
          path.id,
        ).length
      )
        return "Add visible posed images to Atlas context";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }, [
    workspace.nodes,
    workspace.assets,
    workspace.selection,
    workspace.settings.atlas,
    workspace.settings.atlasPanel.selectedOnly,
    path.id,
  ]);
  useEffect(() => () => preview.current(null), []);
  useEffect(() => {
    if (!playing || !frames.current.length) return;
    const started =
      performance.now() - (cursor.current / workspace.settings.fps) * 1000;
    let raf = 0;
    const tick = () => {
      const elapsed = (performance.now() - started) / 1000;
      const index = Math.min(
        frames.current.length - 1,
        Math.floor(elapsed * workspace.settings.fps),
      );
      cursor.current = index;
      setFrame(index);
      preview.current(frames.current[index] ?? null);
      if (elapsed >= duration) setPlaying(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, duration, workspace.settings.fps, sampled.cameras]);
  const stop = () => {
    setPlaying(false);
    cursor.current = 0;
    setFrame(0);
    onPreviewCamera(null);
  };
  const generate = (mode: "dense" | "keyframes") => {
    void command({
      type: "generation.submit",
      request: {
        kind: "video",
        pathId: path.id,
        mode,
        keyframeCount: workspace.settings.atlasPanel.keyframeCount,
      },
    }).catch((error) =>
      onError(error instanceof Error ? error.message : String(error)),
    );
  };
  return (
    <div className="viewport-path-actions">
      <Hint label={sampled.error ?? `Preview ${path.name}`}>
        <Button
          size="1"
          variant="surface"
          color="gray"
          disabled={!sampled.cameras.length}
          onClick={() => {
            if (playing) {
              setPlaying(false);
              return;
            }
            if (cursor.current >= frames.current.length - 1) cursor.current = 0;
            setPlaying(true);
          }}
        >
          <Play /> {playing ? "Pause" : "Preview path"}
        </Button>
      </Hint>
      <Hint label="Stop path preview and return to the free camera">
        <Button
          size="1"
          variant="surface"
          color="gray"
          aria-label="Stop path preview"
          onClick={stop}
        >
          <Stop />
        </Button>
      </Hint>
      <Hint label={sampled.error ?? "Scrub the selected camera path"}>
        <Slider
          aria-label="Camera path position"
          size="1"
          min={0}
          max={Math.max(1, sampled.cameras.length - 1)}
          step={1}
          disabled={!sampled.cameras.length}
          value={[Math.min(frame, Math.max(0, sampled.cameras.length - 1))]}
          onValueChange={([index]) => {
            setPlaying(false);
            cursor.current = index;
            setFrame(index);
            onPreviewCamera(sampled.cameras[index] ?? null);
          }}
        />
      </Hint>
      <Hint
        label={
          sampled.error ??
          contextError ??
          "Generate sparse keyframes along this path using Atlas context and settings"
        }
      >
        <Button
          size="1"
          variant="surface"
          color="gray"
          disabled={!!contextError || !sampled.cameras.length}
          onClick={() => generate("keyframes")}
        >
          Generate keyframes
        </Button>
      </Hint>
      <Hint
        label={
          sampled.error ??
          contextError ??
          "Render video along this path using Atlas context and settings"
        }
      >
        <Button
          size="1"
          variant="surface"
          color="gray"
          disabled={!!contextError || !sampled.cameras.length}
          onClick={() => generate("dense")}
        >
          <VideoCamera /> Render video
        </Button>
      </Hint>
    </div>
  );
}
