import { useEffect, useRef, useState } from "react";
import { Button, Dialog, Flex, Text } from "@radix-ui/themes";
import { Aperture, Pause, Play, X } from "@phosphor-icons/react";
import { useImageToWorldClient, useWorkspace } from "../lib/client";
import { ScenePlayer } from "../lib/scene-player";
import { ArtControls } from "./CreationControls";
import { PanelHeader, ToolbarIconButton } from "./ui";
function PresentationContent() {
  const workspace = useWorkspace((state) => state),
    client = useImageToWorldClient();
  const host = useRef<HTMLDivElement>(null),
    player = useRef<ScenePlayer | null>(null);
  const [playing, setPlaying] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const view = new ScenePlayer(
      host.current!,
      client.getWorkspace(),
      setError,
    );
    player.current = view;
    return () => {
      player.current = null;
      view.dispose();
    };
  }, [client]);
  useEffect(() => {
    player.current?.sync(workspace);
  }, [workspace]);
  return (
    <>
      <PanelHeader title="Presentation">
        <ToolbarIconButton
          label={playing ? "Pause animation" : "Play animation"}
          onClick={() => {
            const next = !playing;
            setPlaying(next);
            if (player.current) player.current.playing = next;
          }}
        >
          {playing ? <Pause /> : <Play />}
        </ToolbarIconButton>
        <ToolbarIconButton
          label="Save presentation camera"
          onClick={() => {
            if (player.current)
              void client.safeCommand({
                type: "camera.place",
                name: "Presentation camera",
                camera: player.current.cameraData(),
              });
          }}
        >
          <Aperture />
        </ToolbarIconButton>
        <Dialog.Close>
          <ToolbarIconButton label="Close presentation">
            <X />
          </ToolbarIconButton>
        </Dialog.Close>
      </PanelHeader>
      <div className="presentation-layout">
        <div ref={host} className="presentation-canvas" />
        <aside>
          <ArtControls />
        </aside>
      </div>
      {error && (
        <Text className="presentation-error" size="1" color="red">
          {error}
        </Text>
      )}
      <Text className="presentation-caption" size="1" color="gray">
        Orbit to compose your shot. This view leaves the editing camera alone.
      </Text>
    </>
  );
}
export function PresentationView() {
  return (
    <Dialog.Root>
      <Dialog.Trigger>
        <Button size="1" color="gray" variant="surface">
          <Aperture /> Present
        </Button>
      </Dialog.Trigger>
      <Dialog.Content
        className="presentation-dialog"
        aria-label="Presentation view"
      >
        <Dialog.Title style={{ position: "absolute", clipPath: "inset(50%)" }}>
          Presentation view
        </Dialog.Title>
        <Dialog.Description
          style={{ position: "absolute", clipPath: "inset(50%)" }}
        >
          Compose and beautify the scene with independent camera controls.
        </Dialog.Description>
        <PresentationContent />
      </Dialog.Content>
    </Dialog.Root>
  );
}
