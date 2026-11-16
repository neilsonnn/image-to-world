import { useEffect, useState } from "react";
import { TextArea } from "@radix-ui/themes";
import { moduleParameters } from "../../../core/procedural";
import { assetUrl, type SceneNode } from "../../../core/schema";
import { useImageToWorldClient, useWorkspaceData } from "../lib/client";
import { Field } from "./panelShared";
import { NumericInput } from "./NumericInput";

export function ProceduralProperties({ node }: { node: SceneNode }) {
  const workspace = useWorkspaceData(["assets"], []);
  const client = useImageToWorldClient();
  const p = node.procedural!;
  const value = JSON.stringify(p.parameters, null, 2);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState("");
  useEffect(() => {
    setDraft(value);
    setError("");
  }, [value, node.id]);
  const patch = (changes: Partial<typeof p>) => {
    const current = client.getWorkspace().nodes[node.id]?.procedural;
    if (current)
      void client.safeCommand({
        type: "nodes.patch",
        id: node.id,
        patch: { procedural: { ...current, ...changes } },
      });
  };
  const source = workspace.assets[p.sourceAssetId];
  return (
    <section className="property-section">
      <h3>Procedural code</h3>
      {source && (
        <a href={assetUrl(source)} download={source.name}>
          {source.name}
        </a>
      )}
      <Field label="Enabled">
        <button
          className={`toggle ${p.enabled ? "on" : ""}`}
          aria-label="Enable module"
          aria-pressed={p.enabled}
          onClick={() => patch({ enabled: !p.enabled })}
        >
          <span />
        </button>
      </Field>
      <Field label="Seed">
        <NumericInput
          value={p.seed}
          step={1}
          onCommit={(seed) => patch({ seed: Math.round(seed) })}
        />
      </Field>
      <Field label="Parameters (JSON)">
        <TextArea
          aria-label="Module parameters"
          size="1"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            try {
              const parameters = moduleParameters.parse(JSON.parse(draft));
              setError("");
              if (JSON.stringify(parameters) !== JSON.stringify(p.parameters))
                patch({ parameters });
            } catch (error) {
              setError(String(error));
            }
          }}
        />
      </Field>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
