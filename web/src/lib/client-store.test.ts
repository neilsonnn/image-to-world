import { expect, spyOn, test } from "bun:test";
import { emptyWorkspace, identity } from "../../../core/schema";
import { createImageToWorldClient } from "./client-store";

function project() {
  const workspace = emptyWorkspace();
  workspace.nodes.camera = {
    id: "camera",
    kind: "camera",
    name: "Camera",
    parentId: null,
    visible: true,
    locked: false,
    transform: identity(),
  };
  workspace.nodes.group = {
    id: "group",
    kind: "group",
    name: "Group",
    parentId: null,
    visible: true,
    locked: false,
    transform: identity(),
  };
  return workspace;
}

test("saving provider keys refreshes readiness without putting secrets in client state", async () => {
  const client = createImageToWorldClient();
  const original = project();
  client.acceptWorkspace(original);
  const requests: string[] = [];
  const network = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: RequestInfo | URL) => {
        requests.push(String(input));
        return Response.json(
          input === "/api/commands"
            ? { revision: original.revision }
            : {
                workspacePath: "/temporary-project",
                worldLabsConfigured: true,
                falConfigured: false,
                ffmpegAvailable: true,
                environment: {
                  WLT_API_KEY: { configured: true, source: "saved" },
                },
              },
        );
      },
      { preconnect: fetch.preconnect },
    ),
  );
  try {
    await client.command({
      type: "environment.configure",
      values: { WLT_API_KEY: "private-test-key" },
    });
    expect(requests).toEqual(["/api/commands", "/api/status"]);
    expect(client.store.getState().status?.worldLabsConfigured).toBe(true);
    expect(client.getWorkspace()).toBe(original);
    expect(JSON.stringify(client.store.getState())).not.toContain(
      "private-test-key",
    );
  } finally {
    network.mockRestore();
  }
});

test("a refreshed snapshot changes only edited branches, including removal and array order", () => {
  const client = createImageToWorldClient();
  const original = project();
  original.selection = ["camera", "group"];
  client.acceptWorkspace(original);
  const next = structuredClone(original);
  next.revision++;
  next.nodes.camera.name = "Renamed";
  next.selection.reverse();
  client.acceptWorkspace(next);
  const current = client.getWorkspace();
  expect(current.nodes.camera).not.toBe(original.nodes.camera);
  expect(current.nodes.camera.transform).toBe(original.nodes.camera.transform);
  expect(current.nodes.group).toBe(original.nodes.group);
  expect(current.assets).toBe(original.assets);
  expect(current.settings).toBe(original.settings);
  expect(current.selection).toEqual(["group", "camera"]);
  const removed = structuredClone(current);
  removed.revision++;
  delete removed.nodes.group;
  removed.selection = ["camera"];
  client.acceptWorkspace(removed);
  expect(client.getWorkspace().nodes.group).toBeUndefined();
  expect(client.getWorkspace().selection).toEqual(["camera"]);
});

test("duplicate and older snapshots do not replace the accepted project", () => {
  const client = createImageToWorldClient();
  const current = project();
  current.revision = 9;
  client.acceptWorkspace(current);
  client.acceptWorkspace(structuredClone(current));
  expect(client.getWorkspace()).toBe(current);
  const old = structuredClone(current);
  old.revision = 8;
  old.nodes.camera.name = "Old name";
  client.acceptWorkspace(old);
  expect(client.getWorkspace()).toBe(current);
});

test("editor instances do not share their workspace or errors", () => {
  const first = createImageToWorldClient();
  const second = createImageToWorldClient();
  first.acceptWorkspace(project());
  first.setError("Disconnected");
  expect(second.store.getState()).toEqual({
    workspace: null,
    status: null,
    loading: true,
    connected: false,
    hoveredNodeId: null,
    lastOperation: null,
    activity: [],
    showPresence: true,
    error: null,
  });
});

test("a command during a refresh waits for a subsequent snapshot without parallel fetches", async () => {
  const replies: Array<(response: Response) => void> = [];
  let workspaceReads = 0;
  const network = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: RequestInfo | URL) => {
        if (input === "/api/commands") return Response.json({ revision: 2 });
        workspaceReads++;
        return new Promise<Response>((resolve) => replies.push(resolve));
      },
      { preconnect: fetch.preconnect },
    ),
  );
  try {
    const client = createImageToWorldClient();
    const pending = client.refresh();
    await Promise.resolve();
    const command = client.command({ type: "selection.set", ids: [] });
    // Drain the command response while the first workspace response is held.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(workspaceReads).toBe(1);
    const first = project();
    first.revision = 1;
    replies.shift()!(Response.json(first));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(workspaceReads).toBe(2);
    const second = structuredClone(first);
    second.revision = 2;
    replies.shift()!(Response.json(second));
    await Promise.all([pending, command]);
    expect(client.getWorkspace().revision).toBe(2);
  } finally {
    network.mockRestore();
  }
});

test("a failed refresh retains the project and recovers on the next request", async () => {
  const client = createImageToWorldClient();
  const original = project();
  client.acceptWorkspace(original);
  const network = spyOn(globalThis, "fetch").mockRejectedValueOnce(
    new Error("Network unavailable"),
  );
  try {
    await client.refresh();
    expect(client.getWorkspace()).toBe(original);
    expect(client.store.getState().error).toBe("Network unavailable");
    const next = structuredClone(original);
    next.revision++;
    network.mockResolvedValue(Response.json(next));
    await client.refresh();
    expect(client.getWorkspace().revision).toBe(next.revision);
  } finally {
    network.mockRestore();
  }
});

test("camera selection is local before the network responds, and only a gap refetches the scene", async () => {
  let stream: EventTarget;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "EventSource");
  class Events extends EventTarget {
    constructor() {
      super();
      stream = this;
    }
    close() {}
  }
  Object.defineProperty(globalThis, "EventSource", {
    value: Events,
    configurable: true,
  });
  const scene = project();
  scene.nodes.camera.projection = scene.settings.viewportCamera.intrinsics;
  scene.nodes.camera.transform.position = [6, 2, 1];
  let reads = 0,
    reply!: (r: Response) => void;
  const network = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (url: RequestInfo | URL) => {
        if (url === "/api/commands")
          return new Promise<Response>((resolve) => (reply = resolve));
        if (url === "/api/workspace") {
          reads++;
          return Response.json(scene, {
            headers: { "X-Workspace-Stream": "test" },
          });
        }
        return Response.json({});
      },
      { preconnect: fetch.preconnect },
    ),
  );
  const client = createImageToWorldClient();
  const disconnect = client.connect();
  const change = (payload: object) =>
    stream.dispatchEvent(
      new MessageEvent("change", {
        data: JSON.stringify({ stream: "test", ...payload }),
      }),
    );
  try {
    await Bun.sleep(0);
    stream!.dispatchEvent(new Event("open"));
    const start = client.getWorkspace();
    const command = client.command({ type: "camera.view", nodeId: "camera" });
    expect(client.getWorkspace().settings.viewingCameraId).toBe("camera");
    expect(
      client.getWorkspace().settings.viewportCamera.extrinsics.position,
    ).toEqual([6, 2, 1]);
    expect(client.getWorkspace().jobs).toBe(start.jobs);
    await Bun.sleep(0);
    change({
      base: scene.revision,
      revision: scene.revision + 1,
      patches: [
        { field: "settings", key: "viewingCameraId", value: "camera" },
        {
          field: "settings",
          key: "viewportCamera",
          value: client.getWorkspace().settings.viewportCamera,
        },
      ],
    });
    scene.revision++;
    reply(Response.json({ revision: scene.revision }));
    await command;
    change({ revision: scene.revision });
    expect(reads).toBe(1);
    scene.revision += 2;
    scene.name = "Recovered";
    change({ base: scene.revision - 1, revision: scene.revision, patches: [] });
    await Bun.sleep(0);
    expect(reads).toBe(2);
    expect(client.getWorkspace().name).toBe("Recovered");
  } finally {
    disconnect();
    network.mockRestore();
    if (descriptor)
      Object.defineProperty(globalThis, "EventSource", descriptor);
    else Reflect.deleteProperty(globalThis, "EventSource");
  }
});
