import {
  activitySchema,
  isAgentActivity,
  type Activity,
  type Operation,
} from "../../../core/activity";
import { createStore } from "zustand/vanilla";
import type { EnvironmentStatus } from "../../../core/environment";
import type {
  Asset,
  Command,
  CommandResult,
  Workspace,
} from "../../../core/schema";

export type Status = {
  workspacePath: string;
  worldLabsConfigured: boolean;
  falConfigured: boolean;
  ffmpegAvailable: boolean;
  environment: EnvironmentStatus;
};

export type ClientState = {
  workspace: Workspace | null;
  status: Status | null;
  loading: boolean;
  connected: boolean;
  hoveredNodeId: string | null;
  lastOperation: Operation | null;
  activity?: Activity[];
  showPresence?: boolean;
  followAgentEdits?: boolean;
  liveSceneChange?: Activity;
  error: string | null;
};

// Workspace snapshots contain only JSON data. Reuse equal branches so entity
// and panel selectors keep their references after a full snapshot refresh.
function reconcile<T>(previous: T, next: T): T {
  if (Object.is(previous, next)) return previous;
  if (
    !previous ||
    !next ||
    typeof previous !== "object" ||
    typeof next !== "object" ||
    Array.isArray(previous) !== Array.isArray(next)
  )
    return next;
  const before = previous as Record<string, unknown>;
  const after = next as Record<string, unknown>;
  const keys = Object.keys(after);
  let equal = Object.keys(before).length === keys.length;
  const entries = keys.map((key) => {
    const value = reconcile(before[key], after[key]);
    equal &&= Object.hasOwn(before, key) && value === before[key];
    return [key, value] as const;
  });
  if (equal) return previous;
  return (
    Array.isArray(next)
      ? entries.map(([, value]) => value)
      : Object.fromEntries(entries)
  ) as T;
}

function changeRevision(event: Event) {
  try {
    const { revision } = JSON.parse(String((event as MessageEvent).data)) as {
      revision?: unknown;
    };
    return typeof revision === "number" ? revision : Infinity;
  } catch {
    return Infinity;
  }
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.text();
    let message = body;
    try {
      const parsed = JSON.parse(body);
      if (typeof parsed.error === "string") message = parsed.error;
    } catch {}
    throw new Error(message || `${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export function createImageToWorldClient() {
  const store = createStore<ClientState>(() => ({
    workspace: null,
    status: null,
    loading: true,
    connected: false,
    hoveredNodeId: null,
    lastOperation: null,
    activity: [],
    showPresence: true,
    error: null,
  }));
  const setHoveredNode = (hoveredNodeId: string | null) => {
    if (store.getState().hoveredNodeId !== hoveredNodeId)
      store.setState({ hoveredNodeId });
  };
  const setError = (error: string | null) => store.setState({ error });
  const acceptWorkspace = (next: Workspace) => {
    const previous = store.getState().workspace;
    if (previous && next.revision < previous.revision) return;
    store.setState({ workspace: reconcile(previous, next), loading: false });
  };
  const getWorkspace = () => {
    const workspace = store.getState().workspace;
    if (!workspace) throw new Error("Workspace is not loaded");
    return workspace;
  };
  let connection = 0;
  let requested = false;
  let refreshing: Promise<void> | undefined;
  const refresh = () => {
    requested = true;
    if (!refreshing) {
      const epoch = connection;
      refreshing = Promise.resolve().then(async () => {
        try {
          while (requested && epoch === connection) {
            requested = false;
            try {
              const next = await readJson<Workspace>(
                await fetch("/api/workspace"),
              );
              if (epoch !== connection) return;
              acceptWorkspace(next);
              if (store.getState().error === "Live updates disconnected")
                setError(null);
            } catch (cause) {
              if (epoch === connection)
                setError(
                  cause instanceof Error ? cause.message : String(cause),
                );
            } finally {
              if (epoch === connection) store.setState({ loading: false });
            }
          }
        } finally {
          if (epoch === connection) refreshing = undefined;
        }
      });
    }
    return refreshing;
  };
  const refreshStatus = async () => {
    const epoch = connection;
    const status = await readJson<Status>(await fetch("/api/status"));
    if (epoch === connection) store.setState({ status });
  };
  const command = async (value: Command) => {
    setError(null);
    const result = await readJson<CommandResult>(
      await fetch("/api/commands", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Image-To-World-Client": "web",
          "X-Image-To-World-Context": JSON.stringify({
            actorId: "You",
            requestId: crypto.randomUUID(),
          }),
        },
        body: JSON.stringify(value),
      }),
    );
    if (value.type === "environment.configure") await refreshStatus();
    else await refresh();
    return result;
  };
  const safeCommand = async (value: Command) => {
    try {
      return await command(value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const upload = async (files: File[]) => {
    const data = new FormData();
    for (const file of files) data.append("files", file);
    const assets = await readJson<Asset[]>(
      await fetch("/api/assets", {
        method: "POST",
        headers: { "X-Image-To-World-Client": "web" },
        body: data,
      }),
    );
    await refresh();
    return assets;
  };
  const connect = () => {
    const epoch = ++connection;
    refreshing = undefined;
    void refresh();
    void fetch("/api/status")
      .then(readJson<Status>)
      .then((status) => {
        if (epoch === connection) store.setState({ status });
      })
      .catch(() => undefined);
    const events = new EventSource("/api/events");
    events.addEventListener("open", () => {
      if (epoch !== connection) return;
      store.setState({ connected: true });
      if (store.getState().error === "Live updates disconnected")
        setError(null);
      void refresh();
    });
    events.addEventListener("activity-history", (event) => {
      if (epoch !== connection) return;
      try {
        const data = JSON.parse((event as MessageEvent).data);
        store.setState({
          activity: data.events
            .map((e: unknown) => activitySchema.parse(e))
            .slice(-1000),
        });
      } catch {}
    });
    events.addEventListener("activity", (event) => {
      if (epoch !== connection) return;
      try {
        const activity = activitySchema.parse(
          JSON.parse((event as MessageEvent).data),
        );
        store.setState((state) => ({
          ...(state.followAgentEdits &&
          activity.phase === "succeeded" &&
          activity.sceneChange?.major &&
          isAgentActivity(activity)
            ? { liveSceneChange: activity }
            : {}),
          activity: [
            ...(state.activity ?? []).filter((e) => e.id !== activity.id),
            activity,
          ].slice(-1000),
        }));
      } catch {}
    });
    events.addEventListener("operation", (event) => {
      if (epoch !== connection) return;
      try {
        store.setState({
          lastOperation: JSON.parse((event as MessageEvent).data),
        });
      } catch {}
    });
    events.addEventListener("change", (event) => {
      // Commands already fetch their own result; skip revisions the client has.
      const current = store.getState().workspace?.revision;
      if (current !== undefined && changeRevision(event) <= current) return;
      void refresh();
    });
    events.addEventListener("error", (event) => {
      if (epoch !== connection) return;
      store.setState({ connected: false });
      setError(
        event instanceof MessageEvent && event.data
          ? String(event.data)
          : "Live updates disconnected",
      );
    });
    return () => {
      events.close();
      store.setState({ connected: false });
      connection++;
      requested = false;
      refreshing = undefined;
    };
  };
  return {
    store,
    getWorkspace,
    acceptWorkspace,
    setError,
    setHoveredNode,
    refresh,
    command,
    safeCommand,
    upload,
    connect,
  };
}
