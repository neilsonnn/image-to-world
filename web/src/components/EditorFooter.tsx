import {
  SidebarSimple,
  SlidersHorizontal,
  SpinnerGap,
} from "@phosphor-icons/react";
import { jobNames } from "../../../core/activity";
import { useClientState, useWorkspaceData } from "../lib/client";
import { Hint } from "./ui";

export function EditorFooter({
  navigationOpen,
  propertiesOpen,
  onNavigation,
  onProperties,
}: {
  navigationOpen: boolean;
  propertiesOpen: boolean;
  onNavigation: () => void;
  onProperties: () => void;
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
      <Hint
        label={
          navigationOpen ? "Hide outline and assets" : "Show outline and assets"
        }
      >
        <button
          className="footer-panel-toggle"
          aria-expanded={navigationOpen}
          aria-controls="workspace-navigation"
          onClick={onNavigation}
        >
          <SidebarSimple />
          <span>Outline / assets</span>
        </button>
      </Hint>
      <Hint label={activity}>
        <div className="footer-operation" role="status">
          {active && <SpinnerGap className="spin" />}
          <span>{activity}</span>
        </div>
      </Hint>
      <Hint label={names || "No selection"}>
        <div className="footer-selection">
          <span className="footer-selection-name">{names}</span>
          <span>{selected.length} selected</span>
        </div>
      </Hint>
      <Hint label={propertiesOpen ? "Hide properties" : "Show properties"}>
        <button
          className="footer-panel-toggle"
          aria-expanded={propertiesOpen}
          aria-controls="workspace-properties"
          onClick={onProperties}
        >
          <SlidersHorizontal />
          <span>Properties</span>
        </button>
      </Hint>
    </footer>
  );
}
