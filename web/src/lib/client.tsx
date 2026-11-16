import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { Workspace } from "../../../core/schema";
import { createImageToWorldClient, type ClientState } from "./client-store";

const ClientContext = createContext<ReturnType<
  typeof createImageToWorldClient
> | null>(null);

export function ImageToWorldProvider({ children }: { children: ReactNode }) {
  const [client] = useState(createImageToWorldClient);
  useEffect(() => client.connect(), [client]);
  return (
    <ClientContext.Provider value={client}>{children}</ClientContext.Provider>
  );
}

export function useImageToWorldClient() {
  const client = useContext(ClientContext);
  if (!client) throw new Error("ImageToWorldProvider is required");
  return client;
}

export function useClientState<T>(selector: (state: ClientState) => T) {
  return useStore(useImageToWorldClient().store, selector);
}

export function useWorkspace<T>(selector: (workspace: Workspace) => T) {
  return useClientState((state) => {
    if (!state.workspace) throw new Error("Workspace is not loaded");
    return selector(state.workspace);
  });
}

function pick<T, K extends keyof T>(value: T, keys: readonly K[]): Pick<T, K> {
  return Object.fromEntries(keys.map((key) => [key, value[key]])) as Pick<T, K>;
}

export function useWorkspaceData<
  K extends Exclude<keyof Workspace, "settings">,
  S extends keyof Workspace["settings"],
>(keys: readonly K[], settingKeys: readonly S[]) {
  const data = useWorkspace(useShallow((workspace) => pick(workspace, keys)));
  const settings = useWorkspace(
    useShallow((workspace) => pick(workspace.settings, settingKeys)),
  );
  return useMemo(() => ({ ...data, settings }), [data, settings]);
}
