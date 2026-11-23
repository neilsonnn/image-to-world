import { projectApi } from "../../../core/project-url";
import {
  ArrowSquareOut,
  Play,
  Stop,
  UploadSimple,
} from "@phosphor-icons/react";
import { Button } from "@radix-ui/themes";
import { useRef } from "react";
import { useWorkspace, useImageToWorldClient } from "../lib/client";
import { liveViewportCamera } from "../lib/viewport-camera";
import type { RequestPlacement } from "./ImageImport";

export function SceneActions({
  playing,
  onPlay,
  requestPlacement,
}: {
  playing: boolean;
  onPlay: () => void;
  requestPlacement: RequestPlacement;
}) {
  const count = useWorkspace(
    (w) => Object.values(w.nodes).filter((n) => n.kind === "capture").length,
  );
  const { upload, setError, getWorkspace } = useImageToWorldClient();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="scene-actions" role="toolbar" aria-label="Scene actions">
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (!files.length) return;
          const camera =
            liveViewportCamera() ?? getWorkspace().settings.viewportCamera;
          void upload(files)
            .then((assets) => requestPlacement(assets, camera))
            .catch((error) => setError(String(error)));
        }}
      />
      <Button
        size="1"
        variant="surface"
        color="gray"
        aria-label="Import"
        title="Import"
        onClick={() => input.current?.click()}
      >
        <UploadSimple />
        <span className="toolbar-label">Import</span>
      </Button>
      <span className="frame-count" aria-live="polite">
        <span className="toolbar-label">Images</span> <b>{count}</b>
      </span>
      <Button
        size="1"
        variant="surface"
        color="gray"
        aria-label={playing ? "Stop" : "Play"}
        title={playing ? "Stop" : "Play"}
        aria-pressed={playing}
        onClick={onPlay}
      >
        {playing ? <Stop /> : <Play />}
        <span className="toolbar-label">{playing ? "Stop" : "Play"}</span>
      </Button>
      <Button asChild size="1" variant="surface" color="gray">
        <a
          href={projectApi("player/index.html")}
          aria-label="Open in web"
          title="Open in web"
          target="_blank"
          rel="noopener"
        >
          <ArrowSquareOut />
          <span className="toolbar-label">Open in web</span>
        </a>
      </Button>
    </div>
  );
}
