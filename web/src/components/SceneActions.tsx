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
        onClick={() => input.current?.click()}
      >
        <UploadSimple />
        Import
      </Button>
      <span className="frame-count" aria-live="polite">
        Images <b>{count}</b>
      </span>
      <Button
        size="1"
        variant="surface"
        color="gray"
        aria-pressed={playing}
        onClick={onPlay}
      >
        {playing ? <Stop /> : <Play />}
        {playing ? "Stop" : "Play"}
      </Button>
      <Button asChild size="1" variant="surface" color="gray">
        <a
          href={projectApi("player/index.html")}
          target="_blank"
          rel="noopener"
        >
          <ArrowSquareOut />
          Open in web
        </a>
      </Button>
    </div>
  );
}
