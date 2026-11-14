import { expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act, memo } from "react";
import { emptyWorkspace, identity } from "../../../core/schema";
import {
  WorldbashProvider,
  useWorldbashClient,
  useClientState,
  useWorkspace,
  useWorkspaceData,
} from "./client";

test("React subscribers skip unrelated snapshots and reconnects discard old responses", async () => {
  const window = new Window();
  class Events extends EventTarget {
    static instances: Events[] = [];
    closed = false;
    constructor(_url: string) {
      super();
      Events.instances.push(this);
    }
    close() {
      this.closed = true;
    }
  }
  const globals = {
    window,
    document: window.document,
    navigator: window.navigator,
    EventSource: Events,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = Object.fromEntries(
    Object.keys(globals).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  const workspace = emptyWorkspace();
  workspace.nodes.camera = {
    id: "camera",
    name: "Camera",
    kind: "camera",
    parentId: null,
    visible: true,
    locked: false,
    transform: identity(),
  };
  let snapshot = workspace;
  let held: ((response: Response) => void) | undefined;
  let holdNext = false;
  const network = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: RequestInfo | URL) => {
        if (input === "/api/status")
          return Response.json({
            worldLabsConfigured: false,
            falConfigured: false,
            ffmpegAvailable: false,
            environment: {},
            workspacePath: "/test",
          });
        if (holdNext) {
          holdNext = false;
          return new Promise<Response>((resolve) => {
            held = resolve;
          });
        }
        return Response.json(snapshot);
      },
      { preconnect: fetch.preconnect },
    ),
  );
  const renders = { camera: 0, assets: 0, collections: 0 };
  let client!: ReturnType<typeof useWorldbashClient>;
  const Camera = memo(function Camera() {
    const camera = useWorkspace((workspace) => workspace.nodes.camera);
    renders.camera++;
    return <span>{camera.name}</span>;
  });
  const Assets = memo(function Assets() {
    const { assets } = useWorkspaceData(["assets"], []);
    renders.assets++;
    return <span>{Object.keys(assets).length} assets</span>;
  });
  const Collections = memo(function Collections() {
    const { settings } = useWorkspaceData([], ["collections"]);
    renders.collections++;
    return <span>{settings.collections.assetSearch}</span>;
  });
  function Panels() {
    client = useWorldbashClient();
    const ready = useClientState((state) => state.workspace !== null);
    return ready ? (
      <>
        <Camera />
        <Assets />
        <Collections />
      </>
    ) : null;
  }
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let disconnect: (() => void) | undefined;
  try {
    await act(async () => {
      root.render(
        <WorldbashProvider>
          <Panels />
        </WorldbashProvider>,
      );
    });
    expect(renders).toEqual({ camera: 1, assets: 1, collections: 1 });
    snapshot = structuredClone(snapshot);
    snapshot.revision++;
    snapshot.nodes.camera.name = "Renamed camera";
    await act(async () => {
      Events.instances[0].dispatchEvent(new Event("change"));
      await client.refresh();
    });
    expect(renders).toEqual({ camera: 2, assets: 1, collections: 1 });
    expect(container.textContent).toContain("Renamed camera");
    snapshot = structuredClone(snapshot);
    snapshot.revision++;
    snapshot.settings.collections.assetSearch = "courtyard";
    await act(async () => {
      await client.refresh();
    });
    expect(renders).toEqual({ camera: 2, assets: 1, collections: 2 });
    expect(container.textContent).toContain("courtyard");

    holdNext = true;
    const oldRequest = client.refresh();
    await Promise.resolve();
    await act(async () => {
      root.unmount();
    });
    expect(Events.instances[0].closed).toBe(true);
    snapshot = structuredClone(snapshot);
    snapshot.revision++;
    snapshot.name = "Reconnected";
    disconnect = client.connect();
    await client.refresh();
    const oldSnapshot = structuredClone(snapshot);
    oldSnapshot.revision += 100;
    oldSnapshot.name = "Late response from closed connection";
    held!(Response.json(oldSnapshot));
    await oldRequest;
    expect(client.getWorkspace().name).toBe("Reconnected");
  } finally {
    await act(async () => {
      root.unmount();
    });
    disconnect?.();
    network.mockRestore();
    await window.happyDOM.close();
    for (const key of Object.keys(globals)) {
      const descriptor = previous[key];
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
