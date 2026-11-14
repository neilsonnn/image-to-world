import { useState } from "react";
import { Button, Popover, TextArea, Text, Flex } from "@radix-ui/themes";
import { Copy, Export } from "@phosphor-icons/react";
import { PanelHeader, ToolbarIconButton } from "./ui";
export function ExportHandoff() {
  const [prompt, setPrompt] = useState(""),
    [copied, setCopied] = useState(false),
    [error, setError] = useState("");
  return (
    <Popover.Root
      onOpenChange={(open) => {
        if (open && !prompt)
          setPrompt(
            `Take the scene in my image-to-world project at ${window.location.origin} and turn it into: [describe the website, game, interactive scene, asset pack, or other thing I want].\n\nRead skills/image-to-world/SKILL.md. Inspect the actual scene and its art direction, then render and review it. Use all relevant assets, procedural source, materials, environment maps, lighting, animation, particles, camera framing, and visual effects. Preserve the intended aesthetic—crisp pixel art should stay crisp.\n\nUse image-to-world export project --out <new-directory> to collect portable files and a web player. You are free to rebundle, adapt, or rewrite the implementation for the destination. Create a beautiful, polished result that accomplishes my goal, and refine it after visual review. Keep provider credentials out of the deliverable. Show me the finished result and explain how to run or share it.`,
          );
      }}
    >
      <Popover.Trigger>
        <Button size="1" variant="surface" color="gray">
          <Export /> Export
        </Button>
      </Popover.Trigger>
      <Popover.Content width="460px" className="export-handoff">
        <PanelHeader title="Make something with this">
          <ToolbarIconButton
            label="Copy export prompt"
            onClick={() => {
              void navigator.clipboard.writeText(prompt).then(
                () => {
                  setCopied(true);
                  setError("");
                },
                () =>
                  setError(
                    "Couldn't copy. Select the text and copy it manually.",
                  ),
              );
            }}
          >
            <Copy />
          </ToolbarIconButton>
        </PanelHeader>
        <Text as="p" size="1" color="gray">
          Tell your agent what to make. The scene, assets, and source are yours
          to reshape.
        </Text>
        <TextArea
          aria-label="Export prompt for agent"
          size="1"
          rows={13}
          value={prompt}
          onChange={(event) => {
            setPrompt(event.target.value);
            setCopied(false);
          }}
        />
        <Flex justify="end" mt="2">
          <Text size="1" color={error ? "red" : "gray"}>
            {error ||
              (copied
                ? "Copied — paste into your agent"
                : "Edit the destination, then copy into your agent")}
          </Text>
        </Flex>
      </Popover.Content>
    </Popover.Root>
  );
}
