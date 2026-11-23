import { ProjectSwitcher } from "./ProjectSwitcher";
import { ActivityFeed } from "./ActivityFeed";
import {
  SidebarSimple,
  FilmStrip,
  ImageSquare,
  SlidersHorizontal,
  ChatCircleText,
} from "@phosphor-icons/react";
import { jobNames } from "../../../core/activity";
import { useClientState, useWorkspaceData } from "../lib/client";
import { Hint, ToolbarIconButton } from "./ui";

const icons = {
  "Outline and assets": SidebarSimple,
  "Image panel": ImageSquare,
  "Spatial context": FilmStrip,
  Properties: SlidersHorizontal,
  "Agent guide": ChatCircleText,
};
export function EditorFooter({
  panels,
}: {
  panels: { label: keyof typeof icons; open: boolean; onToggle: () => void }[];
}) {
  const workspace = useWorkspaceData(
    ["nodes", "assets", "selection", "primaryId", "jobs"],
    [],
  );
  const operation = useClientState((state) => state.lastOperation);
  const selected = workspace.selection.flatMap(
    (id) => workspace.nodes[id] ?? workspace.assets[id] ?? [],
  );
  const jobs = Object.values(workspace.jobs).sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );
  const active = jobs.find(
    (job) => job.status === "queued" || job.status === "running",
  );
  const latest = active ?? jobs[0];
  const jobIsLatest =
    latest && (active || latest.updatedAt > (operation?.at ?? 0));
  const activity = jobIsLatest
    ? `${jobNames[latest.input.kind]} · ${latest.message || latest.status}`
    : (operation?.name ?? "Ready");
  const names = selected.map((item) => item.name).join(", ");
  return (
    <footer className="editor-footer" aria-label="Editor status">
      <div className="footer-panels" role="toolbar" aria-label="Editor panels">
        {panels.map(({ label, open, onToggle }) => {
          const Icon = icons[label];
          return (
            <span
              key={label}
              className={
                label === "Agent guide" ? "agent-guide-toggle" : undefined
              }
            >
              <ToolbarIconButton
                label={label}
                aria-pressed={open}
                onClick={onToggle}
              >
                <Icon />
              </ToolbarIconButton>
            </span>
          );
        })}
      </div>
      <ProjectSwitcher />
      <Hint label={names || "No selection"}>
        <div className="footer-selection">
          <span className="footer-selection-name">{names}</span>
          <span>{selected.length} selected</span>
        </div>
      </Hint>
      <ActivityFeed fallback={activity} />
    </footer>
  );
}
