import { useState } from "react";
import { ConfirmActionDialog } from "./ConfirmActionDialog";
import {
  ArrowClockwise,
  Cube,
  DownloadSimple,
  Eye,
  EyeSlash,
  Gear,
  Plus,
  SpinnerGap,
  Trash,
  X,
} from "@phosphor-icons/react";
import { Button, Flex, IconButton, Switch, Text } from "@radix-ui/themes";
import {
  atlasContextNodes,
  isVisible,
  selectedPath,
} from "../../../core/captures";
import { generationInput } from "../../../core/generation";
import { assetUrl, type Command, type Job } from "../../../core/schema";
import { useImageToWorldClient, useWorkspaceData } from "../lib/client";
import { Hint, PanelHeader, ToolbarPopover } from "./ui";

export function SplatPanel() {
  const workspace = useWorkspaceData(
    [
      "nodes",
      "assets",
      "jobs",
      "selection",
      "primaryId",
      "imageDrafts",
      "imageVersions",
    ],
    [
      "splatDraft",
      "atlas",
      "atlasPanel",
      "prompt",
      "enhancePrompt",
      "viewingCameraId",
      "viewportCamera",
      "editor2d",
      "atlasReturnDepth",
      "fps",
      "targetFrameCount",
      "seed",
    ],
  );
  const { command, safeCommand, getWorkspace } = useImageToWorldClient();
  const [pending, setPending] = useState<{
    command: Command;
    description: string;
  } | null>(null);
  const confirmReconstruction = () => {
    const current = getWorkspace();
    const input = generationInput(current, {
      kind: "splats",
      refine: !current.settings.splatDraft,
    });
    if (input.kind !== "splats") return;
    setPending({
      command: {
        type: "generation.submit",
        request: {
          kind: "splats",
          nodeIds: input.nodeIds,
          contextPathId: selectedPath(current)?.id ?? null,
          prompt: input.prompt,
          refine: input.refine,
        },
      },
      description: `Create ${input.refine ? "refined" : "draft"} splats from ${input.nodeIds.length} context Frames? This submits a paid World Labs reconstruction. The result will join the scene automatically.`,
    });
  };
  const confirmRetry = (job: Job) => {
    if (job.input.kind !== "splats") return;
    setPending({
      command: { type: "jobs.retry", id: job.id },
      description: `Retry ${job.input.refine ? "refined" : "draft"} splat reconstruction from ${job.input.nodeIds.length} context Frames? This submits another paid World Labs reconstruction.`,
    });
  };
  const jobs = Object.values(workspace.jobs)
    .filter((job) => job.input.kind === "splats")
    .sort((a, b) => b.createdAt - a.createdAt);
  const draft = workspace.settings.splatDraft;
  const path = selectedPath(workspace);
  const count = atlasContextNodes(
    workspace,
    workspace.settings.atlasPanel.selectedOnly
      ? workspace.selection
      : undefined,
    path?.id,
  ).length;
  const limit = draft ? 32 : 512;
  let blocked: string | undefined =
    count < 2 || count > limit
      ? `${draft ? "Draft" : "Refined"} splats need 2–${limit} usable context Frames; ${count} available`
      : undefined;
  try {
    generationInput(workspace, { kind: "splats", refine: !draft });
  } catch (error) {
    blocked = error instanceof Error ? error.message : String(error);
  }
  return (
    <section className="splat-panel" aria-label="Splat reconstruction">
      <PanelHeader
        title={
          <span>
            Splats <span className="quiet">{jobs.length}</span>
          </span>
        }
      />
      <div className="splat-create-row">
        <Hint
          label={
            blocked ??
            `Reconstruct ${draft ? "draft" : "refined"} splats from ${count} context Frames; adds the result to the scene`
          }
        >
          <Button
            size="1"
            variant="surface"
            color="gray"
            disabled={!!blocked}
            className="splat-create"
            onClick={confirmReconstruction}
          >
            Make splats
          </Button>
        </Hint>
        <ToolbarPopover
          label="Splat generation settings"
          icon={<Gear />}
          width={240}
        >
          <PanelHeader title="Splat generation" />
          <div className="settings-popover">
            <Flex direction="column" gap="3">
              <Flex justify="between" align="center">
                <Text size="1">Draft</Text>
                <Switch
                  size="1"
                  aria-label="Draft reconstruction"
                  checked={draft}
                  onCheckedChange={(splatDraft) =>
                    void safeCommand({
                      type: "workspace.update",
                      settings: { splatDraft },
                    })
                  }
                />
              </Flex>
              <Flex justify="between" align="center">
                <Text size="1">Enhance prompt</Text>
                <Switch
                  size="1"
                  aria-label="Enhance splat prompt"
                  checked={workspace.settings.enhancePrompt}
                  onCheckedChange={(enhancePrompt) =>
                    void safeCommand({
                      type: "workspace.update",
                      settings: { enhancePrompt },
                    })
                  }
                />
              </Flex>
              <Text size="1" color="gray">
                Uses the shared Prompt and spatial context. Draft supports up to
                32 Frames; refined supports up to 512. Results join the scene
                automatically.
              </Text>
            </Flex>
          </div>
        </ToolbarPopover>
      </div>
      {!!jobs.length && (
        <div className="splat-jobs" role="list" aria-label="Splat jobs">
          {jobs.map((job, index) => {
            const nodes = Object.values(workspace.nodes).filter(
              (node) =>
                node.kind === "splat" &&
                (node.jobId === job.id ||
                  (node.assetId &&
                    workspace.assets[node.assetId]?.jobId === job.id)),
            );
            const assets = job.outputAssetIds.flatMap((id) =>
              workspace.assets[id]?.kind === "splat" &&
              !workspace.assets[id].missing
                ? [workspace.assets[id]]
                : [],
            );
            const visible = nodes.some((node) => isVisible(workspace, node));
            const active = job.status === "queued" || job.status === "running";
            const name =
              nodes[0]?.name ??
              `${job.input.kind === "splats" && job.input.refine ? "Refined" : "Draft"} ${jobs.length - index}`;
            const detail =
              job.error || job.applicationError || job.message || job.status;
            return (
              <article
                className={`splat-job status-${job.status}`}
                key={job.id}
                role="listitem"
              >
                <Hint
                  label={`${name} · ${new Date(job.createdAt).toLocaleString()} · ${detail}`}
                >
                  <button
                    className="splat-job-name"
                    disabled={!nodes.length}
                    onClick={() =>
                      void safeCommand({
                        type: "selection.set",
                        ids: nodes.map((node) => node.id),
                      })
                    }
                  >
                    {active ? <SpinnerGap className="spin" /> : <Cube />}
                    <span>{name}</span>
                  </button>
                </Hint>
                <div className="splat-job-bottom">
                  <Hint label={detail}>
                    <span className="splat-job-status" role="status">
                      {job.status}
                    </span>
                  </Hint>
                  <div className="splat-job-actions">
                    {!!nodes.length && (
                      <>
                        <Hint label={visible ? "Hide splats" : "Show splats"}>
                          <button
                            aria-label={visible ? "Hide splats" : "Show splats"}
                            onClick={() => {
                              const current = getWorkspace();
                              const updated = nodes.flatMap((node) =>
                                current.nodes[node.id]
                                  ? [
                                      {
                                        ...current.nodes[node.id],
                                        visible: !visible,
                                      },
                                    ]
                                  : [],
                              );
                              if (updated.length)
                                void safeCommand({
                                  type: "nodes.put",
                                  nodes: updated,
                                });
                            }}
                          >
                            {visible ? <Eye /> : <EyeSlash />}
                          </button>
                        </Hint>
                        <Hint label="Delete splats from scene">
                          <button
                            aria-label="Delete splats from scene"
                            onClick={() =>
                              void safeCommand({
                                type: "nodes.remove",
                                ids: nodes.map((node) => node.id),
                              })
                            }
                          >
                            <Trash />
                          </button>
                        </Hint>
                      </>
                    )}
                    {!nodes.length && !!assets.length && (
                      <Hint label="Add splats to scene">
                        <button
                          aria-label="Add splats to scene"
                          onClick={() =>
                            void safeCommand({
                              type: "assets.place",
                              assetIds: assets.map((asset) => asset.id),
                            })
                          }
                        >
                          <Plus />
                        </button>
                      </Hint>
                    )}
                    {!!assets.length && (
                      <Hint label="Download splat">
                        <a
                          aria-label="Download splat"
                          href={assetUrl(assets[0])}
                          download={assets[0].name}
                        >
                          <DownloadSimple />
                        </a>
                      </Hint>
                    )}
                    {active && (
                      <Hint label="Cancel reconstruction">
                        <button
                          aria-label="Cancel reconstruction"
                          onClick={() =>
                            void safeCommand({
                              type: "jobs.cancel",
                              id: job.id,
                            })
                          }
                        >
                          <X />
                        </button>
                      </Hint>
                    )}
                    {(job.status === "failed" ||
                      job.status === "cancelled") && (
                      <Hint label="Retry reconstruction">
                        <button
                          aria-label="Retry reconstruction"
                          onClick={() => confirmRetry(job)}
                        >
                          <ArrowClockwise />
                        </button>
                      </Hint>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {pending && (
        <ConfirmActionDialog
          open
          title="Make splats?"
          description={pending.description}
          delaySeconds={5}
          onOpenChange={(open) => {
            if (!open) setPending(null);
          }}
          onConfirm={async () => {
            await command(pending.command);
          }}
        />
      )}
    </section>
  );
}
