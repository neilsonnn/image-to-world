import { ScenePlayer } from "../lib/scene-player";
import { setAssetLocation, workspaceSchema } from "../../../core/schema";
setAssetLocation(
  (asset) =>
    `./assets/${encodeURIComponent(asset.id)}/${encodeURIComponent(asset.name)}`,
);
const error = (message: string) => {
  const output = document.querySelector<HTMLElement>("#status");
  if (output) {
    output.textContent = message;
    output.hidden = false;
  }
};
try {
  const response = await fetch("./workspace.json");
  if (!response.ok)
    throw new Error(
      "Could not load scene. Serve this directory with a local HTTP server.",
    );
  const workspace = workspaceSchema.parse(await response.json());
  document.title = workspace.name;
  const player = new ScenePlayer(
    document.querySelector<HTMLElement>("#scene")!,
    workspace,
    error,
  );
  player.playing = true;
  document.querySelector("#play")?.addEventListener("click", (event) => {
    player.playing = !player.playing;
    (event.currentTarget as HTMLElement).textContent = player.playing
      ? "Pause"
      : "Play";
  });
} catch (cause) {
  error(String(cause));
}
