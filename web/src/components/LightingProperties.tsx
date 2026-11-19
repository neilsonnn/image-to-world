import {
  defaultLighting,
  frameRig,
  lightColors,
  lightNumbers,
  type LightRig,
  type ProjectLighting,
} from "../../../core/lighting";
import { useImageToWorldClient, useWorkspaceData } from "../lib/client";
import { NumericInput } from "./NumericInput";
import { Field } from "./panelShared";

export function LightingProperties({ frameId }: { frameId?: string }) {
  const client = useImageToWorldClient();
  const workspace = useWorkspaceData(["nodes", "assets"], ["lighting"]);
  const project = workspace.settings.lighting ?? defaultLighting;
  const custom = frameId ? workspace.nodes[frameId]?.lighting : null;
  const shown = custom ?? project;
  const setFrame = (lighting: LightRig | null) =>
    client.safeCommand({
      type: "nodes.patch",
      id: frameId!,
      patch: { lighting },
    });
  const change = (partial: Partial<ProjectLighting>) => {
    const state = client.getWorkspace();
    const scene = state.settings.lighting ?? defaultLighting;
    if (frameId) {
      const frame = state.nodes[frameId];
      if (frame)
        void setFrame({ ...(frame.lighting ?? frameRig(scene)), ...partial });
    } else
      void client.safeCommand({
        type: "workspace.update",
        settings: { lighting: { ...scene, ...partial } },
      });
  };
  return (
    <section className="property-section">
      <h3>{frameId ? "View lighting" : "Scene lighting"}</h3>
      {frameId && (
        <Field label="Light rig">
          <select
            value={custom ? "custom" : "scene"}
            onChange={(e) =>
              void setFrame(
                e.target.value === "custom" ? frameRig(project) : null,
              )
            }
          >
            <option value="scene">Use scene lighting</option>
            <option value="custom">Match this view</option>
          </select>
        </Field>
      )}
      {(!frameId || custom) && (
        <>
          {Object.entries(lightColors).map(([key, label]) => (
            <Field key={key} label={label}>
              <input
                type="color"
                value={shown[key as keyof typeof lightColors]}
                onChange={(e) => change({ [key]: e.target.value })}
              />
            </Field>
          ))}
          {Object.entries(lightNumbers).map(([key, field]) => (
            <Field key={key} label={field.label}>
              <NumericInput
                value={shown[key as keyof typeof lightNumbers]}
                min={field.min}
                max={field.max}
                step={field.step}
                onCommit={(v) => change({ [key]: v })}
              />
            </Field>
          ))}
          <Field label="Key shadows">
            <select
              value={shown.keyShadows ? "on" : "off"}
              onChange={(event) =>
                change({ keyShadows: event.target.value === "on" })
              }
            >
              <option value="off">Off</option>
              <option value="on">On</option>
            </select>
          </Field>
          <Field label="Background">
            <select
              value={shown.background ? "color" : "editor"}
              onChange={(e) =>
                change({
                  background: e.target.value === "color" ? "#17191e" : null,
                })
              }
            >
              <option value="editor">Editor background</option>
              <option value="color">Solid color</option>
            </select>
          </Field>
          {shown.background && (
            <Field label="Background color">
              <input
                type="color"
                value={shown.background}
                onChange={(e) => change({ background: e.target.value })}
              />
            </Field>
          )}
        </>
      )}
      {!frameId && (
        <>
          <Field label="Environment map">
            <select
              value={project.environmentAssetId ?? ""}
              onChange={(e) =>
                change({ environmentAssetId: e.target.value || null })
              }
            >
              <option value="">None</option>
              {Object.values(workspace.assets)
                .filter(
                  (asset) =>
                    asset.kind === "image" &&
                    !asset.missing &&
                    !asset.trashedAt,
                )
                .map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.name}
                  </option>
                ))}
            </select>
          </Field>
          {project.environmentAssetId && (
            <>
              <Field label="Environment intensity">
                <NumericInput
                  value={project.environmentIntensity}
                  min={0}
                  max={20}
                  step={0.1}
                  onCommit={(v) => change({ environmentIntensity: v })}
                />
              </Field>
              <Field label="Environment yaw (°)">
                <NumericInput
                  value={project.environmentYaw}
                  min={-180}
                  max={180}
                  step={1}
                  onCommit={(v) => change({ environmentYaw: v })}
                />
              </Field>
            </>
          )}
        </>
      )}
    </section>
  );
}
