import { expect, test } from "bun:test";
import { Theme } from "@radix-ui/themes";
import { Window } from "happy-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { applyCommand } from "../../../core/commands";
import { createCapture } from "../../../core/captures";
import { assetSchema, emptyWorkspace, identity } from "../../../core/schema";
import { ViewportPathActions } from "../components/ViewportPathActions";

test("path generation requires usable included context while path preview remains available", () => {
  const workspace = emptyWorkspace();
  const camera = workspace.settings.viewportCamera;
  const image = assetSchema.parse({
    id: "image",
    name: "Image",
    path: "image.png",
    kind: "image",
    mimeType: "image/png",
    size: 1,
    modifiedAt: 0,
    camera,
    depthAssetId: "depth",
  });
  workspace.assets.image = image;
  workspace.assets.depth = {
    ...image,
    id: "depth",
    kind: "depth",
    path: "depth.exr",
  };
  applyCommand(workspace, {
    type: "nodes.put",
    nodes: [
      {
        id: "path",
        name: "Path",
        kind: "path",
        parentId: null,
        visible: true,
        transform: identity(),
        targetFrameCount: 5,
        keyframes: [
          { id: "start", camera },
          {
            id: "end",
            camera: {
              ...camera,
              extrinsics: { ...camera.extrinsics, position: [2, 0, 0] },
            },
          },
        ],
      },
    ],
  });
  applyCommand(workspace, { type: "selection.set", ids: ["path"] });
  const window = new Window();
  const buttons = () => {
    window.document.body.innerHTML = renderToStaticMarkup(
      <Theme>
        <ViewportPathActions
          workspace={workspace}
          command={async () => {
            throw new Error("Rendering must not submit a command");
          }}
          onError={() => {}}
          onPreviewCamera={() => {}}
        />
      </Theme>,
    );
    return Object.fromEntries(
      [...window.document.querySelectorAll("button")].map((button) => [
        button.textContent?.trim(),
        button.disabled,
      ]),
    );
  };
  try {
    expect(buttons()).toMatchObject({
      "Preview path": false,
      "Generate keyframes": true,
      "Render video": true,
    });
    applyCommand(workspace, {
      type: "nodes.put",
      nodes: [
        ...createCapture(image, "healthy"),
        ...createCapture(image, "broken"),
      ],
    });
    expect(buttons()).toMatchObject({
      "Generate keyframes": false,
      "Render video": false,
    });
    applyCommand(workspace, { type: "nodes.remove", ids: ["broken_points"] });
    expect(buttons()).toMatchObject({
      "Preview path": false,
      "Generate keyframes": true,
      "Render video": true,
    });
    workspace.settings.atlas.excludedIds = ["broken"];
    expect(buttons()).toMatchObject({
      "Generate keyframes": false,
      "Render video": false,
    });
    workspace.settings.atlasPanel.selectedOnly = true;
    expect(buttons()).toMatchObject({
      "Generate keyframes": true,
      "Render video": true,
    });
    applyCommand(workspace, {
      type: "selection.set",
      ids: ["healthy", "path"],
    });
    expect(buttons()).toMatchObject({
      "Generate keyframes": false,
      "Render video": false,
    });
  } finally {
    window.close();
  }
});
