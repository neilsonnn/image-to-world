import { useImageToWorldClient, useWorkspaceData } from "../lib/client";
import { useCollection } from "../lib/useCollection";
import type { SelectionState } from "../../../core/selection";
import { frameAssets } from "../../../core/frames";
import {
  CaretLeft,
  CaretRight,
  Check,
  FilmStrip,
  Cube,
  ImageSquare,
  SpinnerGap,
  X,
} from "@phosphor-icons/react";
import { Button } from "@radix-ui/themes";
import { useEffect, useState } from "react";
import { assetUrl, type JobSummary } from "../../../core/schema";
import { openImage } from "./panelShared";
import { Hint } from "./ui";

type GenerationJob = JobSummary & {
  input: Extract<
    JobSummary["input"],
    { kind: "atlas" | "video" | "reconstruct" }
  >;
};

export function AtlasHistory() {
  const { command, safeCommand, setError: onError } = useImageToWorldClient();
  const workspace = useWorkspaceData(
    ["jobs", "assets", "nodes", "imageVersions"],
    ["atlasPanel", "editor2d"],
  );
  const jobs = Object.values(workspace.jobs)
    .filter(
      (job): job is GenerationJob =>
        job.input.kind === "atlas" ||
        job.input.kind === "video" ||
        job.input.kind === "reconstruct",
    )
    .sort((a, b) => b.createdAt - a.createdAt);
  const selectedJob =
    jobs.find((job) => job.id === workspace.settings.atlasPanel.jobId) ??
    jobs[0];
  const [framePosition, setFramePosition] = useState(0);
  const [videoSelected, setVideoSelected] = useState(true);
  const [selection, setSelection] = useState<SelectionState>({
    ids: [],
    primaryId: null,
    anchorId: null,
  });
  const selectedIndices = selection.ids.map(Number);

  useEffect(() => {
    if (!selectedJob || workspace.settings.atlasPanel.jobId === selectedJob.id)
      return;
    void safeCommand({
      type: "workspace.update",
      settings: {
        atlasPanel: {
          ...workspace.settings.atlasPanel,
          jobId: selectedJob.id,
        },
      },
    });
  }, [selectedJob?.id, workspace.settings.atlasPanel.jobId]);

  useEffect(() => {
    setFramePosition(0);
    setVideoSelected(true);
    setSelection({ ids: [], primaryId: null, anchorId: null });
  }, [selectedJob?.id]);

  const setJob = (jobId: string) =>
    void safeCommand({
      type: "workspace.update",
      settings: {
        atlasPanel: { ...workspace.settings.atlasPanel, jobId },
      },
    });
  const act = (input: Parameters<typeof command>[0]) =>
    void command(input).catch((cause) =>
      onError(cause instanceof Error ? cause.message : String(cause)),
    );
  const imageIds = selectedJob
    ? frameAssets(workspace, selectedJob).map((asset) => asset.id)
    : [];
  const frameIndex = (position: number) =>
    workspace.assets[imageIds[position]]?.frameIndex ??
    selectedJob?.frameIndices?.[position] ??
    position;
  const collection = useCollection({
    id: "generation-frames",
    visibleIds: imageIds.map((_, position) => String(frameIndex(position))),
    layout: "grid",
    selection,
    onSelectionChange: setSelection,
    onOpen: (id) => {
      const position = imageIds.findIndex(
        (_, p) => frameIndex(p) === Number(id),
      );
      if (position >= 0)
        void openImage(workspace, safeCommand, imageIds[position]);
    },
    onNavigate: (id) => {
      const position = imageIds.findIndex(
        (_, candidate) => frameIndex(candidate) === Number(id),
      );
      if (position >= 0) {
        setFramePosition(position);
        setVideoSelected(false);
      }
    },
  });
  const video = selectedJob?.outputAssetIds
    .map((id) => workspace.assets[id])
    .find((asset) => asset?.kind === "video");
  const currentImage = imageIds.length
    ? workspace.assets[imageIds[Math.min(framePosition, imageIds.length - 1)]]
    : undefined;

  return (
    <section className="atlas-history">
      <h3>Generations</h3>
      {jobs.length ? (
        <>
          <select
            aria-label="Generation"
            value={selectedJob?.id ?? ""}
            onChange={(event) => setJob(event.target.value)}
          >
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.input.kind === "video"
                  ? `Video (${job.input.mode})`
                  : job.input.kind === "reconstruct"
                    ? "Reconstruction"
                    : "View"}{" "}
                ·{" "}
                {new Date(job.createdAt).toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </option>
            ))}
          </select>
          {selectedJob && (
            <article>
              <Hint
                label={
                  selectedJob.error || selectedJob.message || selectedJob.status
                }
              >
                <span
                  className={`atlas-history-status status-${selectedJob.status}`}
                >
                  {selectedJob.status === "succeeded" ? (
                    <Check />
                  ) : selectedJob.status === "failed" ? (
                    <X />
                  ) : (
                    <SpinnerGap className="spin" />
                  )}
                  {selectedJob.status}
                </span>
              </Hint>
              <div className="atlas-output-viewer">
                {video && videoSelected ? (
                  <video controls preload="metadata" src={assetUrl(video)} />
                ) : currentImage?.kind === "image" ? (
                  <img src={assetUrl(currentImage)} alt={currentImage.name} />
                ) : (
                  <span>
                    <ImageSquare />
                    {selectedJob.status === "failed"
                      ? "Generation failed"
                      : selectedJob.status === "cancelled"
                        ? "Generation cancelled"
                        : selectedJob.status === "succeeded"
                          ? "No visual output"
                          : "Output will appear here"}
                  </span>
                )}
              </div>
              {!!imageIds.length && (
                <>
                  <div className="atlas-output-navigation">
                    <Hint label="Previous output">
                      <button
                        aria-label="Previous output"
                        disabled={framePosition <= 0}
                        onClick={() => {
                          setVideoSelected(false);
                          setFramePosition((position) =>
                            Math.max(0, position - 1),
                          );
                        }}
                      >
                        <CaretLeft />
                      </button>
                    </Hint>
                    <span>
                      {Math.min(framePosition + 1, imageIds.length)} /{" "}
                      {imageIds.length}
                    </span>
                    <Hint label="Next output">
                      <button
                        aria-label="Next output"
                        disabled={framePosition >= imageIds.length - 1}
                        onClick={() => {
                          setVideoSelected(false);
                          setFramePosition((position) =>
                            Math.min(imageIds.length - 1, position + 1),
                          );
                        }}
                      >
                        <CaretRight />
                      </button>
                    </Hint>
                  </div>
                  <span
                    className="atlas-history-outputs"
                    role="listbox"
                    aria-label="Generated frames"
                    aria-multiselectable="true"
                    {...collection.paneProps}
                  >
                    {video && (
                      <Hint label="Video output">
                        <button
                          className={videoSelected ? "selected" : ""}
                          aria-label="Show video output"
                          onClick={() => setVideoSelected(true)}
                        >
                          <FilmStrip />
                        </button>
                      </Hint>
                    )}
                    {imageIds.map((id, position) => {
                      const asset = workspace.assets[id];
                      const index = frameIndex(position);
                      if (asset?.kind !== "image") return null;
                      return (
                        <Hint key={`${id}-${index}`} label={`Frame ${index}`}>
                          <button
                            className={
                              selectedIndices.includes(index) ? "selected" : ""
                            }
                            role="option"
                            {...collection.getItemProps(String(index))}
                            onClick={(event) => {
                              setFramePosition(position);
                              setVideoSelected(false);
                              collection.select(String(index), event);
                            }}
                            onDoubleClick={() =>
                              void openImage(workspace, safeCommand, id)
                            }
                          >
                            <img src={assetUrl(asset)} alt={asset.name} />
                          </button>
                        </Hint>
                      );
                    })}
                  </span>
                  <Hint label="Browse generated frames">
                    <input
                      className="atlas-seek"
                      type="range"
                      min="0"
                      max={Math.max(0, imageIds.length - 1)}
                      value={Math.min(framePosition, imageIds.length - 1)}
                      onChange={(event) => {
                        setVideoSelected(false);
                        setFramePosition(Number(event.target.value));
                      }}
                    />
                  </Hint>
                  <div className="atlas-history-actions">
                    <Button
                      size="1"
                      variant="surface"
                      color="gray"
                      disabled={selectedJob.status !== "succeeded"}
                      onClick={() =>
                        act({
                          type: "frames.integrate",
                          jobId: selectedJob.id,
                          ...(selectedIndices.length
                            ? { indices: selectedIndices }
                            : {}),
                        })
                      }
                    >
                      <Check /> Integrate {selectedIndices.length || "all"}
                    </Button>
                    <Button
                      size="1"
                      variant="surface"
                      color="gray"
                      disabled={selectedJob.status !== "succeeded"}
                      onClick={() =>
                        act({
                          type: "generation.submit",
                          request: {
                            kind: "reconstruct",
                            jobId: selectedJob.id,
                            ...(selectedIndices.length
                              ? { indices: selectedIndices }
                              : {}),
                          },
                        })
                      }
                    >
                      <Cube /> Reconstruct {selectedIndices.length || "all"}
                    </Button>
                  </div>
                </>
              )}
              {selectedJob.input.kind === "video" &&
                selectedJob.input.mode === "keyframes" &&
                selectedJob.status === "succeeded" && (
                  <Button
                    size="1"
                    variant="surface"
                    color="gray"
                    onClick={() =>
                      act({
                        type: "generation.submit",
                        request: {
                          kind: "video",
                          sourceJobId: selectedJob.id,
                          mode: "dense",
                        },
                      })
                    }
                  >
                    <FilmStrip /> Generate dense video
                  </Button>
                )}
              {selectedJob.error && <small>{selectedJob.error}</small>}
            </article>
          )}
        </>
      ) : (
        <p>No generations yet.</p>
      )}
    </section>
  );
}
