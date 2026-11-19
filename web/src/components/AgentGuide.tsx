import { ArrowUp, Copy, X } from "@phosphor-icons/react";
import { Button } from "@radix-ui/themes";
import { useEffect, useRef, useState } from "react";
import { PanelHeader, ToolbarIconButton } from "./ui";

function agentMessage(editorUrl: string) {
  return [
    `Work in my open image-to-world project at ${editorUrl}. Pass --url ${editorUrl} to its CLI and run status to confirm the workspace.`,
    "Use OpenAI’s SVG & 3D Design skill for construction and visual review. Use image-to-world as the authoring tool. Its editor companion is skills/image-to-world/SKILL.md in https://github.com/neilsonnn/worldbash.",
    "Give each Frame a distinct two- or three-word frameSlug. Use frame work <frame-id> with a short task description and --actor as you build. Report done with the same actor when you finish.",
    "Pose and ground the inputs first. For multiple views, ask who will arrange them. Keep disconnected input volumes apart, then use sparse Atlas views to connect the gaps. Turn Frame guides off before building the parametric environment and props. Check the result through several cameras.",
  ].join("\n\n");
}

export function AgentGuide({ onClose }: { onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(agentMessage(window.location.origin));
      setCopied(true);
      setCopyError(false);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(true);
    }
  };
  return (
    <aside
      className="agent-guide"
      aria-label="Use image-to-world with your agent"
    >
      <PanelHeader title="Agent workspace">
        <ToolbarIconButton label="Hide agent guide" onClick={onClose}>
          <X />
        </ToolbarIconButton>
      </PanelHeader>
      <div className="agent-guide-body">
        <div className="agent-chat-ghost">
          <div className="agent-chat-chrome" aria-hidden="true">
            <span />
            <i />
          </div>
          <div className="agent-chat-messages">
            <div
              className="agent-chat-bubble agent-chat-skeleton"
              aria-hidden="true"
            >
              <i />
              <i />
            </div>
            <div
              className="agent-chat-reply agent-chat-skeleton"
              aria-hidden="true"
            >
              <b />
              <div className="agent-chat-reply-lines">
                <i />
                <i />
                <i />
              </div>
            </div>
            <section
              className="agent-chat-bubble agent-copy-message"
              aria-label="Get started with your agent"
            >
              <h2>Use image-to-world in Claude or Codex.</h2>
              <Button
                size="2"
                variant="surface"
                color="gray"
                className="agent-copy-button"
                onClick={() => void copy()}
              >
                <Copy />
                {copied ? "Copied!" : "Copy message for agent"}
              </Button>
              {copyError && (
                <span role="status">Couldn't copy. Please try again.</span>
              )}
            </section>
          </div>
          <div className="agent-run-track" aria-hidden="true">
            <svg
              className="agent-runner"
              viewBox="0 0 80 50"
              shapeRendering="crispEdges"
            >
              <g fill="currentColor">
                <path d="M16 12h48v27H16zM8 21h8v12H8zM64 21h8v12h-8z" />
                <g className="agent-legs-a">
                  <path d="M19 37h7v13h-7zM43 37h7v13h-7z" />
                </g>
                <g className="agent-legs-b">
                  <path d="M31 37h7v13h-7zM55 37h7v13h-7z" />
                </g>
              </g>
              <path className="agent-eyes" d="M27 21h5v7h-5zM49 21h5v7h-5z" />
            </svg>
          </div>
          <div className="agent-chat-composer" aria-hidden="true">
            <div className="agent-composer-lines">
              <i className="agent-composer-line" />
              <i className="agent-composer-line" />
              <i className="agent-composer-line" />
            </div>
            <div className="agent-composer-bottom">
              <span className="agent-composer-blurb">
                Ask your agent to build something.
              </span>
              <span className="agent-chat-send">
                <ArrowUp />
              </span>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
