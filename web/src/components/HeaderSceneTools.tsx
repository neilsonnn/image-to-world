import { projectApi } from "../../../core/project-url";
import {
  Camera,
  DownloadSimple,
  FilmStrip,
  SpinnerGap,
  Wrench,
} from "@phosphor-icons/react";
import { Button } from "@radix-ui/themes";
import {
  useImageToWorldClient,
  useClientState,
  useWorkspace,
} from "../lib/client";
import { liveViewportCamera } from "../lib/viewport-camera";
import { AtlasHistory } from "./AtlasHistory";
import { GeneratePanel, JobsPanel } from "./Panels";
import { PanelHeader, ToolbarIconButton, ToolbarPopover } from "./ui";
export function HeaderSceneTools() {
  const client = useImageToWorldClient();
  const status = useClientState((s) => s.status);
  const activeJobs = useWorkspace(
    (state) =>
      Object.values(state.jobs).filter(
        (job) => job.status === "running" || job.status === "queued",
      ).length,
  );
  return (
    <div className="header-scene-tools" role="toolbar" aria-label="Scene tools">
      <ToolbarPopover label="Generation tools" icon={<Wrench />} width={330}>
        <PanelHeader title="Generate" />
        <GeneratePanel status={status} />
      </ToolbarPopover>
      <ToolbarPopover
        label="Generation history"
        icon={<FilmStrip />}
        width={420}
      >
        <PanelHeader title="Generations" />
        <div className="history-popover">
          <AtlasHistory />
        </div>
      </ToolbarPopover>
      <ToolbarPopover
        label={activeJobs ? `Jobs, ${activeJobs} active` : "Jobs"}
        icon={
          <span className="jobs-trigger">
            <SpinnerGap className={activeJobs ? "spin" : undefined} />
            {activeJobs > 0 && <i>{activeJobs}</i>}
          </span>
        }
        width={320}
      >
        <PanelHeader title="Jobs" />
        <JobsPanel />
      </ToolbarPopover>
      <ToolbarIconButton
        label="Capture viewport"
        onClick={() =>
          void client.safeCommand({
            type: "jobs.submit",
            input: {
              kind: "capture",
              camera:
                liveViewportCamera() ??
                client.getWorkspace().settings.viewportCamera,
            },
          })
        }
      >
        <Camera />
      </ToolbarIconButton>

      <Button asChild size="1" color="gray" variant="surface">
        <a
          href={projectApi("player/export.zip")}
          aria-label="Export"
          title="Export"
          download
        >
          <DownloadSimple />
          <span className="toolbar-label">Export</span>
        </a>
      </Button>
    </div>
  );
}
