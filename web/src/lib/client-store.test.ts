import { expect, spyOn, test } from "bun:test";
import { emptyWorkspace, identity } from "../../../core/schema";
import { createWorldbashClient } from "./client-store";

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
  const client = createWorldbashClient();
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
  const client = createWorldbashClient();
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
  const client = createWorldbashClient();
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
  const first = createWorldbashClient();
  const second = createWorldbashClient();
  first.acceptWorkspace(project());
  first.setError("Disconnected");
  expect(second.store.getState()).toEqual({
    workspace: null,
    status: null,
    loading: true,
    connected: false,
    hoveredNodeId: null,
    lastOperation: null,
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
    const client = createWorldbashClient();
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
  const client = createWorldbashClient();
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
