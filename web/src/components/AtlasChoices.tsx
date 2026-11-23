import { Images, SpinnerGap } from "@phosphor-icons/react";
import { Button, Dialog, Flex, Text } from "@radix-ui/themes";
import { useEffect, useState } from "react";
import { atlasReview } from "../../../core/atlas-review";
import { assetUrl } from "../../../core/schema";
import { useImageToWorldClient, useWorkspaceData } from "../lib/client";
import { ToolbarIconButton } from "./ui";

export function AtlasChoices() {
  const workspace = useWorkspaceData(["atlasRound", "jobs", "assets"], []);
  const { command } = useImageToWorldClient();
  const round = atlasReview(workspace);
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
        <Dialog.Content maxWidth="960px" className="atlas-choices">
          <Dialog.Title mb="1">Choose the next view</Dialog.Title>
          <Dialog.Description size="2" color="gray" mb="3">
            {round.caption}
          </Dialog.Description>
          <div className="atlas-choice-grid">
            {round.candidates.map((candidate, index) => {
              const label = index === 0 ? "View A" : "View B";
              const asset = candidate.assetId
                ? workspace.assets[candidate.assetId]
                : undefined;
              return (
                <section
                  className="atlas-choice"
                  aria-label={label}
                  key={candidate.id}
                >
                  {asset ? (
                    <img
                      src={assetUrl(asset)}
                      alt={label}
                      className="atlas-choice-image"
                    />
                  ) : (
                    <div
                      className="atlas-choice-image atlas-choice-status"
                      role="status"
                    >
                      {candidate.status === "running" && (
                        <SpinnerGap className="spin" aria-hidden />
                      )}
                      <Text size="2">
                        {candidate.error ??
                          candidate.message ??
                          candidate.status}
                      </Text>
                    </div>
                  )}
                  <Flex justify="end" align="center">
                    {["failed", "cancelled"].includes(candidate.status) ? (
                      <Button
                        size="1"
                        color="gray"
                        variant="surface"
                        disabled={busy}
                        onClick={() =>
                          void run({ type: "jobs.retry", id: candidate.id })
                        }
                      >
                        Retry {label}
                      </Button>
                    ) : (
                      <Button
                        size="1"
                        color="gray"
                        variant="surface"
                        disabled={busy || round.phase !== "review"}
                        onClick={() =>
                          void run({
                            type: "atlas.review",
                            id: round.id,
                            decision: { kind: "keep", jobId: candidate.id },
                          })
                        }
                      >
                        Keep {label}
                      </Button>
                    )}
                  </Flex>
                </section>
              );
            })}
          </div>
          {error && (
            <Text as="p" color="red" size="2" role="alert">
              {error}
            </Text>
          )}
          <Flex mt="3" justify="end" gap="2">
            <Button
              size="1"
              color="gray"
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
              Discard both
            </Button>
            <Dialog.Close>
              <Button size="1" color="gray" variant="surface">
                Close
              </Button>
            </Dialog.Close>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}
