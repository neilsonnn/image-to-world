import { useWorldbashClient, useWorkspaceData } from "../lib/client";
import { Button } from "@radix-ui/themes";
import {
  ArrowClockwise,
  Check,
  DownloadSimple,
  SpinnerGap,
  X,
} from "@phosphor-icons/react";
import type { Command, Job } from "../../../core/schema";
import { assetUrl } from "../../../core/schema";
import { Hint } from "./ui";

function jobLabel(job: Job) {
  return job.input.kind === "fal" ? job.input.model : job.input.kind;
}

export function JobsPanel() {
  const { command, setError: onError } = useWorldbashClient();
  const workspace = useWorkspaceData(["jobs", "assets"], []);
  const jobs = Object.values(workspace.jobs).sort(
    (a, b) => b.createdAt - a.createdAt,
  );
  const assets = workspace.assets;
  const act = async (value: Command) => {
    try {
      await command(value);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return (
    <div className="panel-body jobs-panel">
      {jobs.length ? (
        jobs.map((job) => (
          <article className="job-card" key={job.id}>
            <div className="job-head">
              <span className={`status status-${job.status}`}>
                {job.status === "succeeded" ? (
                  <Check />
                ) : job.status === "running" ? (
                  <SpinnerGap className="spin" />
                ) : job.status === "failed" ? (
                  <X />
                ) : null}
                {job.status}
              </span>
              <time>
                {new Date(job.createdAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
            </div>
            <strong>{jobLabel(job)}</strong>
            <p>{job.error || job.message || "Waiting for a worker"}</p>
            {!!job.outputAssetIds.length && (
              <div className="job-outputs">
                {job.outputAssetIds.map(
                  (id) =>
                    assets[id] && (
                      <a
                        key={id}
                        href={assetUrl(assets[id])}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <DownloadSimple /> {assets[id].name}
                      </a>
                    ),
                )}
              </div>
            )}
            <div className="job-actions">
              {(job.status === "queued" || job.status === "running") && (
                <Hint label={`Cancel ${jobLabel(job)} job`}>
                  <Button
                    size="1"
                    variant="surface"
                    color="gray"
                    className="button compact"
                    onClick={() =>
                      void act({ type: "jobs.cancel", id: job.id })
                    }
                  >
                    <X /> Cancel
                  </Button>
                </Hint>
              )}
              {(job.status === "failed" || job.status === "cancelled") && (
                <Hint label={`Retry ${jobLabel(job)} job`}>
                  <Button
                    size="1"
                    variant="surface"
                    color="gray"
                    className="button compact"
                    onClick={() => void act({ type: "jobs.retry", id: job.id })}
                  >
                    <ArrowClockwise /> Retry
                  </Button>
                </Hint>
              )}
            </div>
          </article>
        ))
      ) : (
        <div className="empty-state tall">
          <SpinnerGap size={24} />
          <strong>No jobs yet</strong>
          <span>
            Pose an image or generate a world. Work continues here in the
            background.
          </span>
        </div>
      )}
    </div>
  );
}
