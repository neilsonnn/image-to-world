import { ArrowUp, SlidersHorizontal } from "@phosphor-icons/react";
import { TextField } from "@radix-ui/themes";
import { useRef, useState } from "react";
import {
  defaultImageModels,
  imageModels,
  modelIds,
  type ImageModelFor,
} from "../../../core/models";
import type { Camera } from "../../../core/schema";
import { useWorldbashClient } from "../lib/client";
import { PanelHeader, ToolbarIconButton, ToolbarPopover } from "./ui";

export function NewImagePrompt({ camera }: { camera: () => Camera }) {
  const { command, setError } = useWorldbashClient();
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<ImageModelFor<"create">>(
    defaultImageModels.create,
  );
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef(false);
  return (
    <form
      className="viewport-prompt"
      aria-label="Create an image and place at view"
      onSubmit={async (event) => {
        event.preventDefault();
        if (pending.current || !prompt.trim()) return;
        pending.current = true;
        setSubmitting(true);
        try {
          await command({
            type: "generation.submit",
            request: {
              kind: "image.create",
              prompt,
              model,
              placement: camera(),
            },
          });
          setPrompt((current) => (current === prompt ? "" : current));
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
          pending.current = false;
          setSubmitting(false);
        }
      }}
    >
      <TextField.Root
        size="1"
        aria-label="New image prompt"
        placeholder="Create an image and place at view"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && event.nativeEvent.isComposing)
            event.preventDefault();
          event.stopPropagation();
        }}
      />
      <ToolbarPopover
        label="New image settings"
        icon={<SlidersHorizontal />}
        width={240}
      >
        <PanelHeader title="New image" />
        <div className="settings-popover">
          <label>
            Model{" "}
            <select
              aria-label="Image generation model"
              value={model}
              onChange={(event) =>
                setModel(event.target.value as ImageModelFor<"create">)
              }
            >
              {modelIds("create").map((id) => (
                <option key={id} value={id}>
                  {imageModels[id].label}
                </option>
              ))}
            </select>
          </label>
          <small>
            Creates a Frame here, then poses the generated image automatically.
          </small>
        </div>
      </ToolbarPopover>
      <ToolbarIconButton
        label="Create image (Enter)"
        type="submit"
        disabled={submitting || !prompt.trim()}
      >
        <ArrowUp />
      </ToolbarIconButton>
    </form>
  );
}
