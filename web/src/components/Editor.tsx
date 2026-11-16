import { AgentGuide } from "./AgentGuide";
import "../agent-guide.css";
import { EditorFooter } from "./EditorFooter";
import {
  GlobeHemisphereWest,
  PlugsConnected,
  Plugs,
  Camera,
  FilmStrip,
  Gear,
  SpinnerGap,
  ChatCircleText,
  Wrench,
  X,
} from "@phosphor-icons/react";
import { Button, TextField } from "@radix-ui/themes";
import { memo, useRef, useState } from "react";
import type { Camera as CameraData, SceneNode } from "../../../core/schema";
import {
  WorldbashProvider,
  useWorldbashClient,
  useClientState,
  useWorkspace,
  useWorkspaceData,
} from "../lib/client";
import { AtlasDock as AtlasDockView } from "./AtlasDock";
import { AtlasHistory } from "./AtlasHistory";
import { ImageEditor as ImageEditorView } from "./ImageEditor";
import {
  ASSET_CLIPBOARD_TYPE,
  clipboardAssetIds,
  useImageImport,
} from "./ImageImport";
import {
  AssetsPanel,
  GeneratePanel,
  InspectorPanel,
  JobsPanel,
  ScenePanel,
} from "./Panels";
import { ResizableDivider } from "./ResizableDivider";
import { Hint, PanelHeader, ToolbarIconButton, ToolbarPopover } from "./ui";
import { Viewport as ViewportView } from "./Viewport";
import { useGlobalShortcuts } from "../lib/shortcuts";
import { EnvironmentEditor } from "./EnvironmentEditor";

const AtlasDock = memo(AtlasDockView);

const ImageEditor = memo(ImageEditorView);

const Viewport = memo(ViewportView);

const DEFAULT_LAYOUT = {
  sidebarWidth: 240,
  rightWidth: 280,
  leftSplit: 0.6,
  historyWidth: 160,
  editorHeight: 400,
};

export function Editor() {
  return (
    <WorldbashProvider>
      <EditorLoading />
    </WorldbashProvider>
  );
}

function EditorLoading() {
  const ready = useClientState((state) => state.workspace !== null);
  const loading = useClientState((state) => state.loading);
  const error = useClientState((state) => state.error);
  if (ready) return <EditorWorkspace />;
  return (
    <main className="loading-screen">
      <GlobeHemisphereWest className="brand-mark spin-slow" />
      <span>{loading ? "Opening workspace" : "Workspace unavailable"}</span>
      {error && <p>{error}</p>}
    </main>
  );
}

function WorkspaceTitle() {
  const name = useWorkspace((state) => state.name);
  const revision = useWorkspace((state) => state.revision);
  return (
    <div className="project-title">
      <span>{name}</span>
      <small>rev {revision}</small>
    </div>
  );
}

function EditorWorkspace() {
  const connected = useClientState((state) => state.connected);
  const client = useWorldbashClient();
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [agentGuideOpen, setAgentGuideOpen] = useState(true);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const { requestPlacement, dialog: imageImportDialog } = useImageImport();
  const [previewNodes, setPreviewNodes] = useState<SceneNode[] | null>(null);
  const [gizmoNodes, setGizmoNodes] = useState<SceneNode[] | null>(null);
  const [previewCamera, setPreviewCamera] = useState<CameraData | null>(null);
  const editorRef = useRef<HTMLElement>(null);
  const leftColumnRef = useRef<HTMLElement>(null);
  const workspace = useWorkspaceData(
    ["name"],
    ["sidebarWidth", "layout", "editor2d"],
  );
  const status = useClientState((state) => state.status);
  const error = useClientState((state) => state.error);
  const safeCommand = client.safeCommand;
  useGlobalShortcuts((event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "Escape") {
      event.preventDefault();
      void (async () => {
        if (client.getWorkspace().settings.viewingCameraId)
          await safeCommand({ type: "camera.release" });
        await safeCommand({ type: "selection.set", ids: [] });
      })();
    } else if (event.key.toLowerCase() === "h") {
      event.preventDefault();
      if (!event.repeat) void safeCommand({ type: "selection.visibility" });
    }
  });
  const setVariable = (name: string, value: string) =>
    editorRef.current?.style.setProperty(name, value);
  const updateLayout = (patch: Partial<typeof workspace.settings.layout>) =>
    safeCommand({
      type: "workspace.update",
      settings: { layout: { ...workspace.settings.layout, ...patch } },
    });
  const activeJobs = useWorkspace(
    (state) =>
      Object.values(state.jobs).filter(
        (job) => job.status === "running" || job.status === "queued",
      ).length,
  );

  return (
    <main
      ref={editorRef}
      className={`editor${agentGuideOpen ? " agent-guide-open" : ""}`}
      onCopy={(event) => {
        const workspace = client.getWorkspace();
        if (event.defaultPrevented || window.getSelection()?.toString()) return;
        const target = event.target instanceof Element ? event.target : null;
        if (!target?.closest(".assets-panel")) return;
        if (
          target?.closest(
            "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='dialog'], .image-editor",
          )
        )
          return;
        const assetIds = workspace.selection.filter((id) => {
          const asset = workspace.assets[id];
          return asset && !asset.missing && asset.trashedAt === undefined;
        });
        if (!assetIds.length) return;
        event.preventDefault();
        event.clipboardData.setData(
          ASSET_CLIPBOARD_TYPE,
          JSON.stringify({ assetIds }),
        );
      }}
      onPaste={(event) => {
        const workspace = client.getWorkspace();
        if (event.defaultPrevented) return;
        const target = event.target instanceof Element ? event.target : null;
        if (
          target?.closest(
            "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='dialog'], .image-editor",
          )
        )
          return;
        const inLibrary = Boolean(target?.closest(".assets-panel"));
        const assetIds = clipboardAssetIds(event.clipboardData);
        if (inLibrary && assetIds.length) return;
        if (assetIds.length) {
          event.preventDefault();
          const assets = assetIds.map((id) => workspace.assets[id]);
          const missingId = assetIds.find((_, index) => !assets[index]);
          if (missingId) {
            client.setError(`Asset ${missingId} is unavailable`);
            return;
          }
          requestPlacement(
            assets.filter((asset) => asset !== undefined),
            workspace.settings.viewportCamera,
          );
          return;
        }
        const files = Array.from(event.clipboardData.files).filter((file) =>
          file.type.startsWith("image/"),
        );
        if (!files.length) return;
        event.preventDefault();
        const camera = workspace.settings.viewportCamera;
        void client
          .upload(files)
          .then(async (assets) =>
            inLibrary
              ? client.command({
                  type: "selection.set",
                  ids: assets.map((asset) => asset.id),
                })
              : requestPlacement(assets, camera),
          )
          .catch((cause) =>
            client.setError(
              cause instanceof Error ? cause.message : String(cause),
            ),
          );
      }}
      style={
        {
          "--agent-guide-width": `${workspace.settings.layout.agentGuideWidth}px`,
          "--context-column-width": `${workspace.settings.layout.contextWidth}px`,
          "--left-width": `${workspace.settings.sidebarWidth}px`,
          "--right-width": `${workspace.settings.layout.rightWidth}px`,
          "--left-split": workspace.settings.layout.leftSplit,
          "--editor-height": `${workspace.settings.editor2d.height}px`,
        } as React.CSSProperties
      }
    >
      {agentGuideOpen && (
        <>
          <AgentGuide onClose={() => setAgentGuideOpen(false)} />
          <ResizableDivider
            label="Resize agent guide"
            orientation="vertical"
            value={workspace.settings.layout.agentGuideWidth}
            min={160}
            max={900}
            step={16}
            pointerValue={(start, startX, currentX) =>
              start + currentX - startX
            }
            onPreview={(width) =>
              setVariable("--agent-guide-width", `${width}px`)
            }
            onCommit={(agentGuideWidth) =>
              void updateLayout({ agentGuideWidth })
            }
          />
        </>
      )}
      <header className="topbar">
        <div className="wordmark">
          <GlobeHemisphereWest weight="duotone" />
          <Wrench />
          <strong>WORLDBASH</strong>
        </div>
        <WorkspaceTitle />
        <div className="topbar-actions">
          <span className="agent-guide-toggle">
            <ToolbarIconButton
              label={agentGuideOpen ? "Hide agent guide" : "Show agent guide"}
              aria-pressed={agentGuideOpen}
              onClick={() => setAgentGuideOpen((open) => !open)}
            >
              <ChatCircleText />
            </ToolbarIconButton>
          </span>
          <Hint
            label={
              connected
                ? "Connected to the local workspace server"
                : "Reconnecting to the local workspace server"
            }
          >
            <span
              className={`connection ${connected ? "" : "offline"}`}
              role="status"
              aria-label={
                connected ? "Workspace connected" : "Workspace reconnecting"
              }
            >
              {connected ? <PlugsConnected /> : <Plugs />}
            </span>
          </Hint>
          <ToolbarPopover
            label="Generation tools"
            icon={<Wrench />}
            width={330}
          >
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
              void safeCommand({
                type: "jobs.submit",
                input: {
                  kind: "capture",
                  camera: client.getWorkspace().settings.viewportCamera,
                },
              })
            }
          >
            <Camera />
          </ToolbarIconButton>
          <ToolbarPopover
            label="Workspace settings"
            icon={<Gear />}
            width={260}
          >
            <PanelHeader title="Workspace settings" />
            <div className="settings-popover">
              <Hint label="Rename this workspace">
                <label>
                  <span>Workspace name</span>
                  <TextField.Root
                    size="1"
                    value={workspace.name}
                    onChange={(event) => {
                      if (event.target.value)
                        void safeCommand({
                          type: "workspace.update",
                          name: event.target.value,
                        });
                    }}
                  />
                </label>
              </Hint>
              <Button
                size="1"
                variant="surface"
                color="gray"
                onClick={() => setConnectionsOpen(true)}
              >
                Environment variables
              </Button>
              <Hint label="Restore default panel sizes">
                <Button
                  size="1"
                  variant="surface"
                  color="gray"
                  onClick={() => {
                    setVariable(
                      "--left-width",
                      `${DEFAULT_LAYOUT.sidebarWidth}px`,
                    );
                    setVariable(
                      "--right-width",
                      `${DEFAULT_LAYOUT.rightWidth}px`,
                    );
                    setVariable(
                      "--left-split",
                      String(DEFAULT_LAYOUT.leftSplit),
                    );
                    setVariable(
                      "--editor-height",
                      `${DEFAULT_LAYOUT.editorHeight}px`,
                    );
                    void safeCommand({
                      type: "workspace.update",
                      settings: {
                        sidebarWidth: DEFAULT_LAYOUT.sidebarWidth,
                        layout: {
                          rightWidth: DEFAULT_LAYOUT.rightWidth,
                          leftSplit: DEFAULT_LAYOUT.leftSplit,
                          historyWidth: DEFAULT_LAYOUT.historyWidth,
                        },
                        editor2d: {
                          ...workspace.settings.editor2d,
                          height: DEFAULT_LAYOUT.editorHeight,
                        },
                      },
                    });
                  }}
                >
                  Reset layout
                </Button>
              </Hint>
            </div>
          </ToolbarPopover>
        </div>
      </header>

      {connectionsOpen && (
        <EnvironmentEditor onClose={() => setConnectionsOpen(false)} />
      )}

      <div
        className={`editor-workspace${propertiesOpen ? "" : " properties-closed"}${navigationOpen ? "" : " navigation-closed"}`}
      >
        {navigationOpen && (
          <>
            <aside
              id="workspace-navigation"
              ref={leftColumnRef}
              className="left-column"
              aria-label="Workspace navigation"
            >
              <section className="shell-pane outline-pane">
                <ScenePanel requestPlacement={requestPlacement} />
              </section>
              <ResizableDivider
                label="Resize outline and assets"
                orientation="horizontal"
                value={workspace.settings.layout.leftSplit}
                min={0.2}
                max={0.8}
                step={0.05}
                pointerValue={(start, startY, currentY) =>
                  start +
                  (currentY - startY) /
                    (leftColumnRef.current?.clientHeight || 1)
                }
                onPreview={(value) =>
                  setVariable("--left-split", String(value))
                }
                onCommit={(leftSplit) => void updateLayout({ leftSplit })}
              />
              <section className="shell-pane assets-pane">
                <PanelHeader title="Project assets" />
                <AssetsPanel />
              </section>
            </aside>

            <ResizableDivider
              label="Resize navigation"
              orientation="vertical"
              value={workspace.settings.sidebarWidth}
              min={180}
              max={600}
              step={16}
              pointerValue={(start, startX, currentX) =>
                start + currentX - startX
              }
              onPreview={(value) => setVariable("--left-width", `${value}px`)}
              onCommit={(sidebarWidth) =>
                void safeCommand({
                  type: "workspace.update",
                  settings: { sidebarWidth },
                })
              }
            />
          </>
        )}

        <section className="workspace-center">
          <section className="viewport-shell">
            <Viewport
              requestPlacement={requestPlacement}
              previewNodes={previewNodes}
              onPreviewNodes={setGizmoNodes}
              previewCamera={previewCamera}
              onPreviewCamera={setPreviewCamera}
            />
          </section>
          <ResizableDivider
            label="Resize image panel"
            orientation="horizontal"
            value={workspace.settings.editor2d.height}
            min={240}
            max={Math.max(
              240,
              Math.min(1000, (editorRef.current?.clientHeight ?? 720) - 420),
            )}
            step={16}
            pointerValue={(start, startY, currentY) =>
              start + startY - currentY
            }
            onPreview={(value) => setVariable("--editor-height", `${value}px`)}
            onCommit={(height) =>
              void safeCommand({
                type: "workspace.update",
                settings: {
                  editor2d: { ...workspace.settings.editor2d, height },
                },
              })
            }
          />
          <section className="image-panel-shell" aria-label="Image">
            <ImageEditor previewNodes={gizmoNodes ?? previewNodes} />
          </section>
        </section>

        {propertiesOpen && (
          <>
            <ResizableDivider
              label="Resize properties"
              orientation="vertical"
              value={workspace.settings.layout.rightWidth}
              min={220}
              max={600}
              step={16}
              pointerValue={(start, startX, currentX) =>
                start + startX - currentX
              }
              onPreview={(value) => setVariable("--right-width", `${value}px`)}
              onCommit={(rightWidth) => void updateLayout({ rightWidth })}
            />

            <aside
              id="workspace-properties"
              className="right-column shell-pane"
              aria-label="Properties"
            >
              <InspectorPanel onPreview={setPreviewNodes} />
            </aside>
          </>
        )}
      </div>
      <ResizableDivider
        label="Resize spatial context"
        orientation="vertical"
        value={workspace.settings.layout.contextWidth}
        min={96}
        max={500}
        step={16}
        pointerValue={(start, startX, currentX) => start + startX - currentX}
        onPreview={(width) =>
          setVariable("--context-column-width", `${width}px`)
        }
        onCommit={(contextWidth) => void updateLayout({ contextWidth })}
      />
      <aside
        className="spatial-context-column"
        aria-label="Spatial context column"
      >
        <AtlasDock requestPlacement={requestPlacement} />
      </aside>

      <EditorFooter
        navigationOpen={navigationOpen}
        propertiesOpen={propertiesOpen}
        onNavigation={() => {
          setNavigationOpen((open) => !open);
          client.setHoveredNode(null);
        }}
        onProperties={() => {
          setPropertiesOpen((open) => !open);
          setPreviewNodes(null);
        }}
      />

      {error && (
        <div className="error-toast">
          <span>{error}</span>
          <Hint label="Dismiss error">
            <button
              className="icon-button"
              aria-label="Dismiss error"
              onClick={() => client.setError(null)}
            >
              <X />
            </button>
          </Hint>
        </div>
      )}
      {imageImportDialog}
    </main>
  );
}
