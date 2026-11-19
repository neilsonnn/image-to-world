import { PerspectiveCamera, Scene } from "three";
import type { PlayerScene } from "../../../core/player-scene";
import { FlyControls } from "../lib/fly";
import { PlayPointer } from "../lib/play-pointer";
import { SceneGraph } from "../lib/scene";
import { SceneRenderer } from "../lib/scene-renderer";
import { startScenePlay } from "../lib/scene-play";
import { applyCamera, viewportProjection } from "../lib/viewport-projection";

export * as THREE from "three";

const styles = `
:host{display:block;position:relative;width:100%;height:100%;overflow:hidden;background:#17191e;color:#fff;color-scheme:dark;font:14px system-ui,sans-serif}
canvas{display:block;width:100%;height:100%;outline:none;touch-action:none}canvas[data-grabbing]{cursor:grabbing}
nav{position:absolute;bottom:max(16px,env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);display:flex;gap:4px;padding:4px;border:1px solid #ffffff35;border-radius:9px;background:#212329e8}
button{font:inherit;font-weight:550;color:inherit;background:transparent;border:0;border-radius:5px;padding:7px 13px;cursor:pointer}button:hover,button:focus-visible{background:#ffffff24}button:disabled{opacity:.54;cursor:progress}
output{position:absolute;top:14px;left:50%;transform:translateX(-50%);padding:7px 12px;border-radius:5px;background:#101115df;max-width:90%;overflow-wrap:anywhere}output:empty{display:none}
`;

function playerView(container: HTMLElement) {
  const element = document.createElement("div");
  container.append(element);
  const root = element.attachShadow({ mode: "open" });
  root.innerHTML = `<style>${styles}</style><output role="status">Loading scene…</output><nav aria-label="Scene controls"><button type="button" class="play" disabled>Play</button><button type="button" class="fullscreen">Fullscreen</button></nav>`;
  return {
    element,
    root,
    play: root.querySelector<HTMLButtonElement>(".play")!,
    fullscreen: root.querySelector<HTMLButtonElement>(".fullscreen")!,
    status: root.querySelector("output")!,
  };
}

export async function mountScene(
  container: HTMLElement,
  sceneUrl: string | URL,
) {
  const view = playerView(container);
  const life = new AbortController();
  const { signal } = life;
  const report = (message: string) => {
    view.status.textContent = message;
  };
  const reportCause = (error: unknown) =>
    report(error instanceof Error ? error.message : String(error));
  const scene = new Scene();
  let surface: SceneRenderer | undefined;
  let graph: SceneGraph | undefined;
  let fly: FlyControls | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let frame = 0;
  let clock = 0;
  let starting:
    { controller: AbortController; task: Promise<void> } | undefined;
  let simulation: Awaited<ReturnType<typeof startScenePlay>> | undefined;
  let pointer: PlayPointer | undefined;
  function stop() {
    starting?.controller.abort();
    starting = undefined;
    pointer?.dispose();
    pointer = undefined;
    simulation?.dispose();
    simulation = undefined;
    clock = 0;
    view.play.textContent = "Play";
    view.play.disabled = false;
  }
  async function dispose() {
    if (signal.aborted) return;
    life.abort();
    stop();
    cancelAnimationFrame(frame);
    resizeObserver?.disconnect();
    fly?.dispose();
    view.element.remove();
    await surface?.dispose(() => graph?.dispose());
  }
  try {
    const url = new URL(sceneUrl, document.baseURI);
    const response = await fetch(url, { signal });
    if (!response.ok)
      throw new Error(`Scene could not be loaded (HTTP ${response.status}).`);
    const manifest: PlayerScene = await response.json();
    if (manifest.version !== 1)
      throw new Error("Unsupported player scene format.");
    const rendererSurface = (surface = new SceneRenderer(false, report));
    await rendererSurface.init();
    const { renderer } = rendererSurface;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x17191e, 1);
    const canvas = renderer.domElement;
    canvas.tabIndex = 0;
    canvas.setAttribute("aria-label", "Interactive 3D scene");
    view.root.prepend(canvas);
    let initializing = true;
    const loadErrors: string[] = [];
    const sceneError = (message: string) => {
      if (initializing) loadErrors.push(message);
      report(message);
    };
    const sceneGraph = (graph = new SceneGraph(
      scene,
      sceneError,
      "#657080",
      "#c4e6ff",
      () => renderer,
      (asset) => new URL(asset.path, response.url || url).href,
    ));
    sceneGraph.sync({
      ...manifest,
      jobs: {},
      selection: [],
      primaryId: null,
      settings: {
        ...manifest.settings,
        atlas: { order: [], excludedIds: [], soloIds: [] },
      },
    });
    const { near, far } = manifest.settings.viewportOptions;
    const camera = new PerspectiveCamera(50, 1, near, far);
    camera.coordinateSystem = renderer.coordinateSystem;
    applyCamera(camera, manifest.camera);
    const controls = (fly = new FlyControls(
      camera,
      canvas,
      () => true,
      () => {},
    ));
    // Listen at window level for hover navigation, while leaving other embedded inputs alone.
    window.addEventListener(
      "keydown",
      (event) => {
        if (
          event.defaultPrevented ||
          event.metaKey ||
          event.ctrlKey ||
          event.altKey
        )
          return;
        const target = event.composedPath()[0];
        if (
          target instanceof HTMLElement &&
          (target.isContentEditable ||
            target.matches("input, textarea, select"))
        )
          return;
        controls.keyDown(event);
      },
      { signal },
    );
    const resize = () => {
      const width = Math.max(1, view.element.clientWidth);
      const height = Math.max(1, view.element.clientHeight);
      renderer.setSize(width, height, false);
      viewportProjection(camera, width, height, manifest.camera);
    };
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(view.element);
    resize();
    view.fullscreen.hidden = !document.fullscreenEnabled;
    view.fullscreen.addEventListener(
      "click",
      () => {
        const transition =
          document.fullscreenElement === view.element
            ? document.exitFullscreen()
            : view.element.requestFullscreen();
        void transition.catch(reportCause);
      },
      { signal },
    );
    document.addEventListener(
      "fullscreenchange",
      () => {
        view.fullscreen.textContent =
          document.fullscreenElement === view.element
            ? "Exit fullscreen"
            : "Fullscreen";
      },
      { signal },
    );
    await sceneGraph.ready(signal);
    initializing = false;
    if (loadErrors.length) throw new Error(loadErrors.join("\n"));
    view.status.textContent = "";
    sceneGraph.hideCaptureHelpers();
    renderer.shadowMap.enabled = sceneGraph.keyShadows;
    rendererSurface.maxPixelRadius = manifest.settings.pointSize;
    rendererSurface.falloff =
      manifest.settings.display.pointStyle === "gaussian" ? 1 : 0;

    async function play() {
      signal.throwIfAborted();
      if (starting) return starting.task;
      if (simulation) return;
      const controller = new AbortController();
      view.play.disabled = true;
      const task = startScenePlay(sceneGraph, controller.signal)
        .then((session) => {
          if (controller.signal.aborted) {
            session.dispose();
            return;
          }
          simulation = session;
          pointer = new PlayPointer(canvas, camera, session);
          view.play.textContent = "Stop";
        })
        .catch((error) => {
          if (!controller.signal.aborted) throw error;
        })
        .finally(() => {
          if (starting?.controller === controller) {
            starting = undefined;
            view.play.disabled = false;
          }
        });
      starting = { controller, task };
      return task;
    }
    view.play.title =
      "Start or stop physics. Drag a movable object to grab it.";
    view.play.disabled = false;
    view.play.addEventListener(
      "click",
      () => {
        if (simulation) stop();
        else void play().catch(reportCause);
      },
      { signal },
    );
    let last = performance.now();
    function draw(now: number) {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      try {
        controls.update(dt);
        if (simulation) clock += dt;
        sceneGraph.sample(clock, camera);
        pointer?.update();
        simulation?.step(dt);
        sceneGraph.update();
        rendererSurface.render(scene, camera);
        frame = requestAnimationFrame(draw);
      } catch (error) {
        stop();
        reportCause(error);
      }
    }
    draw(last);
    return { name: manifest.name, scene, camera, play, stop, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}
