import {
  ArrowUp,
  CaretDown,
  Check,
  FolderOpen,
  Plus,
} from "@phosphor-icons/react";
import { Button, Popover, TextField } from "@radix-ui/themes";
import { useEffect, useState } from "react";
import { projectApi } from "../../../core/project-url";
import { useClientState, useWorkspace } from "../lib/client";

export function ProjectSwitcher() {
  const name = useWorkspace((s) => s.name);
  const revision = useWorkspace((s) => s.revision);
  const current = useClientState((s) => s.status?.workspacePath);
  const title =
    (name === "Untitled workspace" && current?.split(/[\\/]/).pop()) || name;
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<{ path: string; name: string }[]>([]);
  const [mode, setMode] = useState<"open" | "new">("open");
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [browse, setBrowse] = useState<{
    directory: string;
    parent: string;
    folders: string[];
    isProject: boolean;
  } | null>(null);
  async function browseFolders(directory?: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(projectApi("projects/folders"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Image-To-World-Client": "web",
        },
        body: JSON.stringify({ directory }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setBrowse(data);
      setMode("open");
      setFolder(data.directory);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setError("");
    void fetch(projectApi("projects"), { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        setRecent(data);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [open]);

  async function choose(path: string, create = false) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(projectApi("projects/open"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Image-To-World-Client": "web",
        },
        body: JSON.stringify({ path, create }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      window.location.assign(data.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger>
        <button
          className="project-title project-trigger"
          aria-label={"Open projects · " + title}
          title="Open projects"
        >
          <FolderOpen />
          <span>{title}</span>
          <small>rev {revision}</small>
          <CaretDown />
        </button>
      </Popover.Trigger>
      <Popover.Content
        size="1"
        width="330px"
        side="top"
        align="start"
        aria-label="Local projects"
      >
        <div className="project-picker">
          <h3>Recent projects</h3>
          <div className="project-recents">
            {recent.map((item) => (
              <button
                key={item.path}
                title={item.path}
                disabled={busy || item.path === current}
                onClick={() => void choose(item.path)}
              >
                <FolderOpen />
                <span>
                  <strong>
                    {(item.name !== "Untitled workspace" && item.name) ||
                      item.path.split(/[\\/]/).pop() ||
                      item.path}
                  </strong>
                  <small>{item.path}</small>
                </span>
                {item.path === current && (
                  <Check aria-label="Current project" />
                )}
              </button>
            ))}
          </div>
          <div className="project-modes">
            {(["open", "new"] as const).map((value) => (
              <Button
                size="1"
                key={value}
                disabled={busy}
                color="gray"
                variant={mode === value ? "solid" : "surface"}
                aria-pressed={mode === value}
                onClick={() => {
                  setMode(value);
                  setError("");
                  setFolder("");
                  setBrowse(null);
                  if (value === "open") void browseFolders();
                }}
              >
                {value === "open" ? <FolderOpen /> : <Plus />}
                {value === "open" ? "Open folder" : "New project"}
              </Button>
            ))}
          </div>
          {browse && mode === "open" && (
            <div className="folder-browser">
              <button
                type="button"
                title={browse.directory}
                aria-label="Parent folder"
                disabled={busy || browse.parent === browse.directory}
                onClick={() => void browseFolders(browse.parent)}
              >
                <ArrowUp />
                <span>{browse.directory}</span>
              </button>
              <div className="project-recents">
                {browse.folders.map((child) => (
                  <button
                    key={child}
                    disabled={busy}
                    onClick={() =>
                      void browseFolders(
                        browse.directory.replace(/[\\/]$/, "") + "/" + child,
                      )
                    }
                  >
                    <FolderOpen />
                    <span>{child}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (folder.trim() && !busy) void choose(folder, mode === "new");
            }}
          >
            <TextField.Root
              size="1"
              aria-label={
                mode === "open" ? "Project folder path" : "New project folder"
              }
              placeholder={
                mode === "open"
                  ? "~/Projects/my-scene"
                  : "New folder name or path"
              }
              value={folder}
              disabled={busy}
              onChange={(e) => {
                setFolder(e.target.value);
                setBrowse(null);
              }}
            />
            <Button
              size="1"
              color="gray"
              variant="surface"
              disabled={
                busy || !folder.trim() || (browse !== null && !browse.isProject)
              }
            >
              {busy ? "Opening…" : mode === "open" ? "Open" : "Create"}
            </Button>
          </form>
          {error && <small role="alert">{error}</small>}
        </div>
      </Popover.Content>
    </Popover.Root>
  );
}
