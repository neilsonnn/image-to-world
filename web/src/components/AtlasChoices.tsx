import {
  ArrowClockwise,
  Check,
  Images,
  SpinnerGap,
  TrashSimple,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { Dialog } from "@radix-ui/themes";
import { useEffect, useRef, useState } from "react";
import { atlasReview } from "../../../core/atlas-review";
import { assetUrl } from "../../../core/schema";
import { useImageToWorldClient, useWorkspaceData } from "../lib/client";
import { ToolbarIconButton } from "./ui";

export function AtlasChoices() {
  const workspace = useWorkspaceData(["atlasRound", "jobs", "assets"], []);
  const { command } = useImageToWorldClient();
  const round = atlasReview(workspace);
  const dialog = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const id = round?.id;
  const phase = round?.phase;
  useEffect(() => {
    setError("");
    setOpen(phase === "generating" || phase === "review" || phase === "failed");
  }, [id, phase]);

  if (!round || round.decision) return null;
  const request =
    round.requestText ??
    (round.updateCaption !== false ? round.caption : undefined);

  const run = async (input: Parameters<typeof command>[0]) => {
    setBusy(true);
    setError("");
    try {
      await command(input);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <ToolbarIconButton
        label="Review Atlas views"
        onClick={() => setOpen(true)}
      >
        <Images />
      </ToolbarIconButton>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Content
          ref={dialog}
          maxWidth="min(960px, calc(100vw - 24px))"
          className="atlas-choices"
          tabIndex={-1}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            dialog.current?.focus();
          }}
        >
          <Dialog.Title className="atlas-choice-accessible">
            Choose the next view
          </Dialog.Title>
          <div className="atlas-choice-tools">
            <Dialog.Description
              m="0"
              size="1"
              className={
                request ? "atlas-choice-request" : "atlas-choice-accessible"
              }
              title={request}
            >
              {request || "Compare the Atlas views and choose one to keep."}
            </Dialog.Description>
            {error && (
              <span className="atlas-choice-error" title={error}>
                <WarningCircle aria-hidden="true" />
                <span className="atlas-choice-accessible" role="alert">
                  {error}
                </span>
              </span>
            )}
            <ToolbarIconButton
              label="Discard both"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void run({
                  type: "atlas.review",
                  id: round.id,
                  decision: { kind: "discard" },
                })
              }
            >
              <TrashSimple />
            </ToolbarIconButton>
            <ToolbarIconButton
              label="Close comparison"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              <X />
            </ToolbarIconButton>
          </div>
          <div className="atlas-choice-grid">
            {round.candidates.map((candidate, index) => {
              const label = index === 0 ? "View A" : "View B";
              const asset = candidate.assetId
                ? workspace.assets[candidate.assetId]
                : undefined;
              const projection = asset?.camera?.intrinsics;
              const retryable =
                candidate.status === "failed" ||
                candidate.status === "cancelled";
              const status =
                candidate.error ?? candidate.message ?? candidate.status;
              const loading = !candidate.error && !retryable;
              const Placeholder = loading
                ? SpinnerGap
                : retryable
                  ? ArrowClockwise
                  : WarningCircle;
              return (
                <button
                  key={candidate.id}
                  type="button"
                  className="atlas-choice"
                  aria-label={
                    asset
                      ? `Keep ${label}`
                      : retryable
                        ? `Retry ${label}: ${status}`
                        : `${label}: ${status}`
                  }
                  title={asset ? `Keep ${label}` : status}
                  disabled={busy || (!retryable && round.phase !== "review")}
                  style={
                    projection
                      ? {
                          aspectRatio: `${projection.width} / ${projection.height}`,
                        }
                      : undefined
                  }
                  onClick={() => {
                    if (retryable)
                      void run({ type: "jobs.retry", id: candidate.id });
                    else if (asset)
                      void run({
                        type: "atlas.review",
                        id: round.id,
                        decision: { kind: "keep", jobId: candidate.id },
                      });
                  }}
                >
                  {asset ? (
                    <>
                      <img
                        src={assetUrl(asset)}
                        alt={label}
                        className="atlas-choice-image"
                      />
                      {round.phase === "review" && (
                        <span className="atlas-choice-check" aria-hidden="true">
                          <Check weight="bold" />
                        </span>
                      )}
                    </>
                  ) : (
                    <Placeholder
                      className={loading ? "spin" : undefined}
                      aria-hidden="true"
                    />
                  )}
                  {!asset && (
                    <span className="atlas-choice-accessible" role="status">
                      {status}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}
