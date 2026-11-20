import { projectApi } from "../../../core/project-url";
import { isNavigation, navigate } from "../../../core/commands";
import { applyDelta, type WorkspaceDelta } from "../../../core/workspace-delta";
import {
  activitySchema,
  isAgentActivity,
  latestActivities,
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
  showViewportFeed?: boolean;
  toasts?: Activity[];
  inspectActivity?: string;
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
  const feedPreference = "image-to-world.viewport-feed";
  let feedEnabled = true;
  try {
    feedEnabled = globalThis.localStorage?.getItem(feedPreference) !== "off";
  } catch {}
  const store = createStore<ClientState>(() => ({
    showViewportFeed: feedEnabled,
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
  let live: Workspace | null = null;
  let stream: string | null = null;
  type Notification = {
    stream: string;
    revision: number;
    base?: number;
    patches?: WorkspaceDelta["patches"];
  };
  let buffered: Notification[] = [];
  const pending = new Map<string, { command: Command; revision?: number }>();
  function display() {
    if (!live) return;
    let view = live;
    for (const [id, p] of pending) {
      if (p.revision !== undefined && p.revision <= live.revision) {
        pending.delete(id);
        continue;
      }
      try {
        view = navigate(view, p.command);
      } catch {
        pending.delete(id);
      }
    }
    store.setState({ workspace: view, loading: false });
  }
  const acceptWorkspace = (next: Workspace) => {
    if (live && next.revision < live.revision) return;
    live = reconcile(live, next);
    display();
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
              const response = await fetch(projectApi("workspace"));
              const next = await readJson<Workspace>(response);
              if (epoch !== connection) return;
              const source = response.headers.get("X-Workspace-Stream");
              if (stream !== source) {
                live = null;
                pending.clear();
                stream = source;
              }
              acceptWorkspace(next);
              for (const delta of buffered) {
                if (delta.stream === stream && delta.revision <= live!.revision)
                  continue;
                if (
                  delta.stream !== stream ||
                  !delta.patches ||
                  delta.base !== live!.revision
                ) {
                  requested = true;
                  break;
                }
                live = applyDelta(live!, {
                  base: delta.base,
                  revision: delta.revision,
                  patches: delta.patches,
                });
              }
              buffered = [];
              display();
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
    const status = await readJson<Status>(await fetch(projectApi("status")));
    if (epoch === connection) store.setState({ status });
  };
  function waitForRevision(revision: number) {
    if (!live || live.revision >= revision || !store.getState().connected)
      return Promise.resolve();
    return new Promise<void>((resolve) => {
      const off = store.subscribe((state) => {
        if (!state.connected || (live && live.revision >= revision)) {
          off();
          resolve();
        }
      });
    });
  }
  let commandTail: Promise<unknown> = Promise.resolve();
  const command = async (value: Command) => {
    setError(null);
    const id = crypto.randomUUID();
    const optimistic = live && isNavigation(value);
    if (optimistic) {
      pending.set(id, { command: value });
      display();
    }
    const send = async () =>
      readJson<CommandResult>(
        await fetch(projectApi("commands"), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-Image-To-World-Client": "web",
            "X-Image-To-World-Context": JSON.stringify({
              actorId: "You",
              requestId: id,
            }),
          },
          body: JSON.stringify(value),
        }),
      );
    try {
      const response = commandTail.then(send);
      commandTail = response.catch(() => {});
      const result = await response;
      if (pending.has(id)) {
        pending.get(id)!.revision = result.revision;
        display();
      }
      if (value.type === "environment.configure") await refreshStatus();
      else if (!live) await refresh();
      else if (!optimistic) await waitForRevision(result.revision);
      return result;
    } catch (error) {
      pending.delete(id);
      display();
      throw error;
    }
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
    const response = await fetch(projectApi("assets"), {
      method: "POST",
      headers: { "X-Image-To-World-Client": "web" },
      body: data,
    });
    const assets = await readJson<Asset[]>(response);
    await waitForRevision(Number(response.headers.get("X-Workspace-Revision")));
    return assets;
  };
  const connect = () => {
    const epoch = ++connection;
    try {
      projectApi("status");
    } catch (error) {
      store.setState({ loading: false, error: String(error) });
      return () => {};
    }
    refreshing = undefined;
    void refresh();
    void fetch(projectApi("status"))
      .then(readJson<Status>)
      .then((status) => {
        if (epoch === connection) store.setState({ status });
      })
      .catch(() => undefined);
    const events = new EventSource(projectApi("events"));
    events.addEventListener("open", () => {
      if (epoch !== connection) return;
      store.setState({ connected: true });
      if (store.getState().error === "Live updates disconnected")
        setError(null);
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
          ...(state.showViewportFeed !== false &&
          activity.phase !== "started" &&
          (activity.detail === "summary" ||
            activity.severity !== "info" ||
            activity.sceneChange)
            ? {
                toasts: latestActivities([
                  ...(state.toasts ?? []),
                  activity,
                ]).slice(-3),
              }
            : {}),
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
      if (epoch !== connection) return;
      try {
        const delta = JSON.parse((event as MessageEvent).data);
        if (!live || refreshing) {
          buffered.push(delta);
          if (!refreshing) void refresh();
          return;
        }
        if (stream === delta.stream && delta.revision <= live.revision) return;
        if (
          stream !== delta.stream ||
          !delta.patches ||
          delta.base !== live.revision
        ) {
          void refresh();
          return;
        }
        live = applyDelta(live, delta);
        display();
      } catch {
        void refresh();
      }
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
      buffered = [];
      pending.clear();
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
    setViewportFeed(enabled: boolean) {
      store.setState({ showViewportFeed: enabled, toasts: [] });
      try {
        globalThis.localStorage?.setItem(
          feedPreference,
          enabled ? "on" : "off",
        );
      } catch {}
    },
    refresh,
    command,
    safeCommand,
    upload,
    connect,
  };
}
