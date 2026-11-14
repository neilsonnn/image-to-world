import {
  Button,
  Checkbox,
  Flex,
  Select,
  TextField,
  Text,
} from "@radix-ui/themes";
import { useImageToWorldClient, useWorkspace } from "../lib/client";
import {
  artFields,
  artPresets,
  materialFields,
  lightFields,
  imageSurfaceSchema,
  animationSchema,
  primitiveShapes,
  surfaceSchema,
  type ParameterField,
} from "../../../core/creation";
import type { SceneNode } from "../../../core/schema";
import { assetUrl } from "../../../core/schema";
import { currentCamera } from "../../../core/generation";
import { NumericInput } from "./NumericInput";

type SimpleField = {
  label?: string;
  type: string;
  min?: number;
  max?: number;
  step?: number;
  options?: readonly string[];
  default?: string | number | boolean;
};
export function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Record<string, string>;
  onChange: (value: string) => void;
}) {
  return (
    <Select.Root
      size="1"
      value={`value:${value}`}
      onValueChange={(value) => onChange(value.slice(6))}
    >
      <Select.Trigger variant="surface" color="gray" aria-label={label} />
      <Select.Content color="gray" variant="soft" position="popper">
        {Object.entries(options).map(([key, text]) => (
          <Select.Item value={`value:${key}`} key={key}>
            {text}
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
}
export function SimpleFields({
  fields,
  values,
  onChange,
}: {
  fields: Record<string, SimpleField>;
  values: Record<string, unknown>;
  onChange: (key: string, value: string | number | boolean) => void;
}) {
  return (
    <div className="creation-fields">
      {Object.entries(fields).map(([key, field]) => {
        const value = values[key] ?? field.default,
          label = field.label ?? key;
        return (
          <label key={key} className="creation-field">
            <span>{label}</span>
            {field.type === "number" ? (
              <NumericInput
                inlineLabel={false}
                label={label}
                value={typeof value === "number" ? value : 0}
                min={field.min}
                max={field.max}
                step={field.step}
                onCommit={(value) => onChange(key, value)}
              />
            ) : field.type === "boolean" ? (
              <Checkbox
                size="1"
                color="gray"
                aria-label={label}
                checked={value === true}
                onCheckedChange={(checked) => onChange(key, checked === true)}
              />
            ) : field.type === "select" ? (
              <SelectField
                label={label}
                value={String(value ?? "")}
                options={Object.fromEntries(
                  (field.options ?? []).map((v) => [v, v]),
                )}
                onChange={(value) => onChange(key, value)}
              />
            ) : field.type === "color" ? (
              <input
                type="color"
                aria-label={label}
                value={String(value ?? "#ffffff")}
                onChange={(event) => onChange(key, event.target.value)}
              />
            ) : (
              <TextField.Root
                key={String(value)}
                aria-label={label}
                size="1"
                defaultValue={String(value ?? "")}
                onBlur={(event) => {
                  if (event.target.value !== value)
                    onChange(key, event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />
            )}
          </label>
        );
      })}
    </div>
  );
}
export function ArtControls() {
  const art = useWorkspace((state) => state.settings.art),
    assets = useWorkspace((state) => state.assets);
  const client = useImageToWorldClient();
  const update = (key: string, value: string | number | boolean) =>
    void client.safeCommand({
      type: "workspace.update",
      settings: {
        art: {
          ...client.getWorkspace().settings.art,
          preset: "custom",
          [key]: value,
        },
      },
    });
  return (
    <div className="creation-controls">
      <SelectField
        label="Art direction preset"
        value={art.preset}
        options={{
          ...Object.fromEntries(
            Object.entries(artPresets).map(([key, preset]) => [
              key,
              preset.label,
            ]),
          ),
          custom: "Custom",
        }}
        onChange={(key) => {
          if (key in artPresets)
            void client.safeCommand({
              type: "workspace.update",
              settings: {
                art: artPresets[key as keyof typeof artPresets].settings,
              },
            });
        }}
      />
      <label className="creation-field">
        <span>Environment</span>
        <SelectField
          label="Environment source"
          value={art.environment}
          options={{
            studio: "Studio lighting",
            none: "Solid color",
            asset: "Environment map",
          }}
          onChange={(value) => update("environment", value)}
        />
      </label>
      {art.environment === "asset" && (
        <SelectField
          label="Environment map"
          value={art.environmentAssetId ?? ""}
          options={{
            "": "Choose image or HDR…",
            ...Object.fromEntries(
              Object.values(assets)
                .filter(
                  (a) =>
                    !a.missing &&
                    !a.trashedAt &&
                    (a.kind === "image" || /\.hdr$/i.test(a.name)),
                )
                .map((a) => [a.id, a.name]),
            ),
          }}
          onChange={(value) => update("environmentAssetId", value)}
        />
      )}
      <SimpleFields fields={artFields} values={art} onChange={update} />
      <Text size="1" color="gray">
        Art direction is saved with the scene. Measurement passes keep the
        calibrated camera and linear depth.
      </Text>
    </div>
  );
}
export function CreationProperties({ node }: { node: SceneNode }) {
  const client = useImageToWorldClient();
  const patch = (patch: Partial<SceneNode>) =>
    void client.safeCommand({ type: "nodes.patch", id: node.id, patch });
  const source =
    node.procedural &&
    client.getWorkspace().assets[node.procedural.sourceAssetId];
  return (
    <>
      {node.primitive && (
        <section className="property-section">
          <h3>Geometry</h3>
          <SelectField
            label="Primitive shape"
            value={node.primitive.shape}
            options={primitiveShapes}
            onChange={(shape) =>
              patch({
                primitive: {
                  ...node.primitive!,
                  shape: shape as NonNullable<SceneNode["primitive"]>["shape"],
                },
              })
            }
          />
          <div className="creation-fields">
            {["Width", "Height", "Depth"].map((label, index) => (
              <label className="creation-field" key={label}>
                <span>{label}</span>
                <NumericInput
                  inlineLabel={false}
                  label={label}
                  value={node.primitive!.size[index]}
                  min={0.001}
                  step={0.1}
                  onCommit={(value) => {
                    const size = [...node.primitive!.size] as [
                      number,
                      number,
                      number,
                    ];
                    size[index] = value;
                    patch({ primitive: { ...node.primitive!, size } });
                  }}
                />
              </label>
            ))}
          </div>
        </section>
      )}
      {(node.kind === "primitive" || node.kind === "mesh") && (
        <section className="property-section">
          <h3>Material</h3>
          <SimpleFields
            fields={materialFields}
            values={surfaceSchema.parse(node.surface ?? {})}
            onChange={(key, value) =>
              patch({
                surface: surfaceSchema.parse({
                  ...surfaceSchema.parse(node.surface ?? {}),
                  [key]: value,
                }),
              })
            }
          />
        </section>
      )}
      {node.light && (
        <section className="property-section">
          <h3>Light</h3>
          <SimpleFields
            fields={lightFields}
            values={node.light}
            onChange={(key, value) =>
              patch({ light: { ...node.light!, [key]: value } })
            }
          />
        </section>
      )}
      {node.kind === "image" && (
        <section className="property-section">
          <h3>Image surface</h3>
          <SimpleFields
            fields={{
              mode: {
                type: "select",
                options: ["reference", "surface", "sprite"],
              },
              width: { type: "number", min: 0.001, step: 0.1 },
              nearest: { type: "boolean", label: "Pixel edges" },
              alphaTest: { type: "number", min: 0, max: 1, step: 0.05 },
            }}
            values={imageSurfaceSchema.parse(node.imageSurface ?? {})}
            onChange={(key, value) =>
              patch({
                imageSurface: imageSurfaceSchema.parse({
                  ...imageSurfaceSchema.parse(node.imageSurface ?? {}),
                  [key]: value,
                }),
              })
            }
          />
        </section>
      )}
      {node.kind === "mesh" && (
        <section className="property-section">
          <h3>Animation</h3>
          <Text size="1" color="gray">
            Use a clip name from a rendered scene inspection.
          </Text>
          <SimpleFields
            fields={{
              clip: { type: "string" },
              speed: { type: "number", step: 0.1 },
              offset: { type: "number", step: 0.1 },
              loop: { type: "boolean" },
            }}
            values={animationSchema.parse(node.animation ?? { clip: "" })}
            onChange={(key, value) =>
              patch({
                animation: animationSchema.parse({
                  ...animationSchema.parse(node.animation ?? { clip: "" }),
                  [key]: value,
                }),
              })
            }
          />
        </section>
      )}
      {node.procedural && (
        <section className="property-section">
          <h3>Procedural source</h3>
          {source && (
            <a href={assetUrl(source)} download>
              {source.name}
            </a>
          )}
          <SimpleFields
            fields={{
              enabled: { type: "boolean", label: "Run module" },
              seed: { type: "number", label: "Seed", step: 1 },
            }}
            values={node.procedural}
            onChange={(key, value) =>
              patch({ procedural: { ...node.procedural!, [key]: value } })
            }
          />
          <SimpleFields
            fields={node.procedural.fields as Record<string, ParameterField>}
            values={node.procedural.parameters}
            onChange={(key, value) =>
              patch({
                procedural: {
                  ...node.procedural!,
                  parameters: { ...node.procedural!.parameters, [key]: value },
                },
              })
            }
          />
          <Button
            size="1"
            variant="surface"
            color="gray"
            onClick={() =>
              void client.safeCommand({
                type: "generation.submit",
                request: {
                  kind: "render",
                  camera: currentCamera(client.getWorkspace()),
                  nodeIds: [node.id],
                  bake: true,
                  time: client.getWorkspace().settings.art.time,
                },
              })
            }
          >
            Bake portable assets
          </Button>
          <Text as="p" size="1" color="gray">
            Rebuild with module update {node.id} source.ts. Failed builds retain
            the last working version.
          </Text>
        </section>
      )}
    </>
  );
}
