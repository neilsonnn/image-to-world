import { Button, Flex, Text } from "@radix-ui/themes";
import { Cube, Code, ImageSquare, Plus } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { assetUrl, identity, nodeSchema } from "../../../core/schema";
import {
  primitiveSchema,
  surfaceSchema,
  primitiveShapes,
  lightSchema,
} from "../../../core/creation";
import { useImageToWorldClient, useWorkspace } from "../lib/client";
import { PanelHeader, ToolbarIconButton } from "./ui";
import { AtlasDock } from "./AtlasDock";
import { ArtControls } from "./CreationControls";
import type { RequestPlacement } from "./ImageImport";

export function CreationDock({
  requestPlacement,
}: {
  requestPlacement: RequestPlacement;
}) {
  const workflow = useWorkspace((state) => state.settings.workflow),
    assets = useWorkspace((state) => state.assets),
    client = useImageToWorldClient();
  const input = useRef<HTMLInputElement>(null),
    [copied, setCopied] = useState(false);
  const images = Object.values(assets).filter(
    (a) =>
      a.kind === "image" &&
      a.role !== "render" &&
      a.role !== "mask" &&
      !a.missing &&
      !a.trashedAt,
  );
  const create = (shape: keyof typeof primitiveShapes) => {
    const pixel = client.getWorkspace().settings.art.preset === "pixel";
    void client.safeCommand({
      type: "nodes.put",
      nodes: [
        nodeSchema.parse({
          id: `node_${crypto.randomUUID()}`,
          name: primitiveShapes[shape],
          kind: "primitive",
          transform: identity(),
          primitive: primitiveSchema.parse({ shape }),
          surface: surfaceSchema.parse({
            shading: pixel ? "toon" : "standard",
          }),
        }),
      ],
    });
  };
  return (
    <div className="creation-dock">
      <div
        className="workflow-tabs"
        role="tablist"
        aria-label="Creation workflows"
      >
        {Object.entries({
          references: "References",
          build: "Build",
          atlas: "Atlas",
        }).map(([key, label]) => (
          <button
            role="tab"
            aria-selected={workflow === key}
            key={key}
            onClick={() =>
              void client.safeCommand({
                type: "workspace.update",
                settings: { workflow: key as typeof workflow },
              })
            }
          >
            {label}
          </button>
        ))}
      </div>
      {workflow === "atlas" ? (
        <AtlasDock requestPlacement={requestPlacement} />
      ) : workflow === "references" ? (
        <>
          <PanelHeader title="Images & inspiration">
            <ToolbarIconButton
              label="Import references"
              onClick={() => input.current?.click()}
            >
              <Plus />
            </ToolbarIconButton>
          </PanelHeader>
          <input
            ref={input}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => {
              const files = [...(event.target.files ?? [])];
              event.target.value = "";
              void client
                .upload(files)
                .catch((error) => client.setError(String(error)));
            }}
          />
          <div className="creation-dock-body">
            <Text as="p" size="1" color="gray">
              Start from an image. Build with code, objects, or models, then
              refine the result.
            </Text>
            {!images.length && (
              <Button
                size="1"
                variant="surface"
                color="gray"
                onClick={() => input.current?.click()}
              >
                <ImageSquare /> Add references
              </Button>
            )}
            {images.map((asset) => (
              <article className="reference-card" key={asset.id}>
                <button
                  className="reference-image"
                  onClick={() =>
                    void client.safeCommand({
                      type: "workspace.update",
                      settings: {
                        editor2d: {
                          ...client.getWorkspace().settings.editor2d,
                          activeAssetId: asset.id,
                        },
                      },
                    })
                  }
                >
                  <img src={assetUrl(asset)} alt={asset.name} loading="lazy" />
                </button>
                <Text size="1" className="reference-name">
                  {asset.name}
                </Text>
                <Flex gap="1" wrap="wrap">
                  <Button
                    size="1"
                    variant="surface"
                    color="gray"
                    onClick={() => requestPlacement([asset])}
                  >
                    Place reference
                  </Button>
                  <Button
                    size="1"
                    variant="surface"
                    color="gray"
                    onClick={() =>
                      void client.safeCommand({
                        type: "generation.submit",
                        request: { kind: "pose", assetIds: [asset.id] },
                      })
                    }
                  >
                    Pose depth
                  </Button>
                </Flex>
              </article>
            ))}
          </div>
        </>
      ) : (
        <>
          <PanelHeader title="Make something" />
          <div className="creation-dock-body">
            <Text as="p" size="1" color="gray">
              Create assets, compose a scene, and make it look great.
            </Text>
            <h3>Geometry</h3>
            <Flex gap="1" wrap="wrap">
              {Object.entries(primitiveShapes).map(([shape, label]) => (
                <Button
                  key={shape}
                  size="1"
                  variant="surface"
                  color="gray"
                  onClick={() => create(shape as keyof typeof primitiveShapes)}
                >
                  <Cube size={12} />
                  {label}
                </Button>
              ))}
            </Flex>
            <Button
              size="1"
              variant="surface"
              color="gray"
              mt="2"
              onClick={() =>
                void client.safeCommand({
                  type: "nodes.put",
                  nodes: [
                    nodeSchema.parse({
                      id: `node_${crypto.randomUUID()}`,
                      name: "Point light",
                      kind: "light",
                      transform: { ...identity(), position: [0, 3, 2] },
                      light: lightSchema.parse({
                        type: "point",
                        intensity: 30,
                      }),
                    }),
                  ],
                })
              }
            >
              Add light
            </Button>
            <h3>Build with your agent</h3>
            <Text as="p" size="1" color="gray">
              Procedural architecture, splat characters, particles, and
              animation can all be authored as live scene nodes.
            </Text>
            <Button
              size="1"
              variant="surface"
              color="gray"
              onClick={() =>
                void navigator.clipboard
                  .writeText(
                    `Use my image-to-world project at ${window.location.origin}. Read skills/image-to-world-code/SKILL.md. Create a beautiful procedural asset suited to my scene and register it with module add. Use context.THREE and context.spark, expose useful parameters, inspect independent renders, and refine the visual result.`,
                  )
                  .then(
                    () => setCopied(true),
                    (error) => client.setError(String(error)),
                  )
              }
            >
              <Code />
              {copied ? "Copied" : "Copy agent prompt"}
            </Button>
            <h3>Art direction</h3>
            <ArtControls />
          </div>
        </>
      )}
    </div>
  );
}
