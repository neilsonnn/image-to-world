import { Tooltip } from "@radix-ui/themes";
import type { ReactNode } from "react";
import type {
  Asset,
  Command,
  CommandResult,
  Workspace,
} from "../../../core/schema";
import type { RequestPlacement } from "./ImageImport";

export type SharedProps = {
  workspace: Workspace;
  command: (command: Command) => Promise<CommandResult>;
  safeCommand: (command: Command) => Promise<CommandResult | undefined>;
  upload: (files: File[]) => Promise<Asset[]>;
  requestPlacement: RequestPlacement;
  onError: (message: string) => void;
};

export const uid = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

export function openImage(
  workspace: Pick<Workspace, "assets"> & {
    settings: Pick<Workspace["settings"], "editor2d">;
  },
  safeCommand: SharedProps["safeCommand"],
  assetId: string,
) {
  if (workspace.assets[assetId]?.kind !== "image") return;
  return safeCommand({
    type: "workspace.update",
    settings: {
      editor2d: { ...workspace.settings.editor2d, activeAssetId: assetId },
    },
  });
}

export function selected(
  workspace: Workspace,
  id: string,
  event: React.MouseEvent,
) {
  return event.metaKey || event.ctrlKey || event.shiftKey
    ? workspace.selection.includes(id)
      ? workspace.selection.filter((item) => item !== id)
      : [...workspace.selection, id]
    : [id];
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Tooltip delayDuration={0} content={label}>
      <label className="field">
        <span>{label}</span>
        {children}
      </label>
    </Tooltip>
  );
}

export function VectorField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number[];
  onCommit: (value: number[]) => void;
}) {
  return (
    <div className="vector-field">
      <span>{label}</span>
      <div>
        {value.map((number, index) => (
          <input
            key={index}
            type="number"
            step="0.05"
            value={Number(number.toFixed(4))}
            onChange={(event) => {
              const next = [...value];
              next[index] = Number(event.target.value);
              onCommit(next);
            }}
          />
        ))}
      </div>
    </div>
  );
}
