import { useWorldbashClient, useWorkspaceData } from "../lib/client";
import { Button } from "@radix-ui/themes";
import { Cpu, Image as ImageIcon, SpinnerGap } from "@phosphor-icons/react";
import { useState } from "react";
import type { Asset, Workspace } from "../../../core/schema";
import { Field } from "./panelShared";
import { Hint } from "./ui";

export function GeneratePanel({
  status,
}: {
  status: {
    worldLabsConfigured: boolean;
    falConfigured: boolean;
    ffmpegAvailable: boolean;
  } | null;
}) {
  const { command, safeCommand, setError: onError } = useWorldbashClient();
  const workspace = useWorkspaceData(
    ["assets", "selection"],
    ["falModel", "falInput"],
  );
  const selectedAssets = workspace.selection
    .map((id) => workspace.assets[id])
    .filter((asset): asset is Asset => !!asset);
  const imageAssets = selectedAssets.filter((asset) => asset.kind === "image");
  const [busy, setBusy] = useState<string | null>(null);
  const updateSettings = (settings: Partial<Workspace["settings"]>) =>
    safeCommand({ type: "workspace.update", settings });
  const submit = async (
    label: string,
    input: Parameters<typeof command>[0],
  ) => {
    setBusy(label);
    try {
      await command(input);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };
  const doFal = () => {
    try {
      void submit("fal", {
        type: "jobs.submit",
        input: {
          kind: "fal",
          model: workspace.settings.falModel,
          input: JSON.parse(workspace.settings.falInput) as Record<
            string,
            unknown
          >,
        },
      });
    } catch (cause) {
      onError(
        `FAL input is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  };
  return (
    <div className="panel-body generate-panel">
      <section className="recipe-card">
        <div className="recipe-title">
          <ImageIcon />
          <div>
            <strong>Pose images</strong>
            <span>Recover camera and depth</span>
          </div>
        </div>
        <Hint label="Recover camera and depth for the selected images">
          <Button
            size="1"
            variant="surface"
            color="gray"
            className="button primary"
            disabled={
              !imageAssets.length ||
              busy !== null ||
              !status?.worldLabsConfigured
            }
            onClick={() =>
              void submit("pose", {
                type: "generation.submit",
                request: {
                  kind: "pose",
                  assetIds: imageAssets.map((a) => a.id),
                },
              })
            }
          >
            {busy === "pose" && <SpinnerGap className="spin" />}
            Pose {imageAssets.length || ""}
          </Button>
        </Hint>
        <small>
          {status?.worldLabsConfigured === false
            ? "World Labs credentials required"
            : "Select one or more image assets"}
        </small>
      </section>
      <section className="recipe-card">
        <div className="recipe-title">
          <Cpu />
          <div>
            <strong>FAL model</strong>
            <span>
              Reference assets as <code>$asset:id</code>
            </span>
          </div>
        </div>
        <Field label="Model ID">
          <input
            value={workspace.settings.falModel}
            onChange={(e) => void updateSettings({ falModel: e.target.value })}
          />
        </Field>
        <Field label="Input (JSON)">
          <textarea
            className="code-input"
            rows={7}
            value={workspace.settings.falInput}
            onChange={(e) => void updateSettings({ falInput: e.target.value })}
          />
        </Field>
        <Hint label="Run the configured FAL model">
          <Button
            size="1"
            variant="surface"
            color="gray"
            className="button"
            disabled={!status?.falConfigured || busy !== null}
            onClick={doFal}
          >
            Run model
          </Button>
        </Hint>
      </section>
    </div>
  );
}
