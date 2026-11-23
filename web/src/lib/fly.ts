import { Euler, PerspectiveCamera, Vector3 } from "three";

const movementKeys = new Set([
  "w",
  "a",
  "s",
  "d",
  "q",
  "e",
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
]);

export function moveFlyCamera(
  camera: PerspectiveCamera,
  keys: Set<string>,
  seconds: number,
  speed: number,
) {
  const forward = camera.getWorldDirection(new Vector3());
  forward.y = 0;
  forward.normalize();
  const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  right.y = 0;
  right.normalize();
  const delta = new Vector3();
  if (keys.has("w") || keys.has("arrowup")) delta.add(forward);
  if (keys.has("s") || keys.has("arrowdown")) delta.sub(forward);
  if (keys.has("d") || keys.has("arrowright")) delta.add(right);
  if (keys.has("a") || keys.has("arrowleft")) delta.sub(right);
  if (keys.has("e")) delta.y += 1;
  if (keys.has("q")) delta.y -= 1;
  if (!delta.lengthSq()) return false;
  camera.position.add(
    delta.normalize().multiplyScalar(Math.min(seconds, 0.05) * speed),
  );
  camera.updateMatrixWorld();
  return true;
}

export function lookFlyCamera(
  camera: PerspectiveCamera,
  dx: number,
  dy: number,
) {
  const rotation = new Euler().setFromQuaternion(camera.quaternion, "YXZ");
  rotation.y += dx * 0.003;
  rotation.x = Math.max(
    -Math.PI / 2 + 0.01,
    Math.min(Math.PI / 2 - 0.01, rotation.x + dy * 0.003),
  );
  camera.quaternion.setFromEuler(rotation);
  camera.updateMatrixWorld();
}

export function zoomFlyCamera(camera: PerspectiveCamera, delta: number) {
  const previous = Math.tan((camera.fov * Math.PI) / 360);
  camera.fov = Math.max(10, Math.min(120, camera.fov * Math.exp(delta * 0.01)));
  // Keep the calibrated principal point, pixel aspect, and viewfinder framing.
  const scale = previous / Math.tan((camera.fov * Math.PI) / 360);
  camera.projectionMatrix.elements[0] *= scale;
  camera.projectionMatrix.elements[5] *= scale;
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}

export class FlyControls {
  private keys = new Set<string>();
  private shift = false;
  private pointer: number | null = null;
  private previous = { x: 0, y: 0 };
  private wheelTimer: ReturnType<typeof setTimeout> | undefined;
  private dirty = false;
  private listeners = new AbortController();
  speed = 5;

  constructor(
    private camera: PerspectiveCamera,
    private element: HTMLCanvasElement,
    private enabled: () => boolean,
    private commit: () => void,
    private begin: () => void = () => {},
    private surface: HTMLElement = element,
  ) {
    const signal = this.listeners.signal;
    element.addEventListener("pointerdown", this.pointerDown, { signal });
    element.addEventListener("pointermove", this.pointerMove, { signal });
    element.addEventListener("pointerup", this.pointerUp, { signal });
    element.addEventListener("pointercancel", this.stop, { signal });
    element.addEventListener("lostpointercapture", this.stop, { signal });
    surface.addEventListener("pointerleave", this.leave, { signal });
    element.addEventListener("contextmenu", (event) => event.preventDefault(), {
      signal,
    });
    surface.addEventListener("wheel", this.wheel, { signal, passive: false });
    window.addEventListener("keyup", this.keyUp, { signal });
    window.addEventListener("blur", this.stop, { signal });
    document.addEventListener("visibilitychange", this.stop, { signal });
    document.addEventListener("focusin", this.focus, { signal });
  }

  get active() {
    return this.dirty || this.keys.size > 0 || this.pointer !== null;
  }

  get moving() {
    return this.dirty || this.keys.size > 0;
  }

  markChanged() {
    this.dirty = true;
  }

  keyDown(event: KeyboardEvent) {
    if (
      !this.enabled() ||
      (!this.surface.matches(":hover") && this.pointer === null)
    )
      return false;
    const key = event.key.toLowerCase();
    this.shift = event.shiftKey;
    if (!movementKeys.has(key)) return false;
    event.preventDefault();
    this.begin();
    this.keys.add(key);
    return true;
  }

  update(seconds: number) {
    if (!this.enabled()) {
      this.stop();
      return;
    }
    if (
      moveFlyCamera(
        this.camera,
        this.keys,
        seconds,
        this.speed * (this.shift ? 3 : 1),
      )
    )
      this.dirty = true;
  }

  private flush() {
    if (
      !this.dirty ||
      this.keys.size ||
      this.pointer !== null ||
      this.wheelTimer
    )
      return;
    this.dirty = false;
    this.commit();
  }

  private keyUp = (event: KeyboardEvent) => {
    this.shift = event.shiftKey;
    // A quick tap can finish between animation frames.
    if (this.keys.has(event.key.toLowerCase()) && !this.dirty)
      this.dirty = moveFlyCamera(
        this.camera,
        this.keys,
        1 / 60,
        this.speed * (this.shift ? 3 : 1),
      );
    this.keys.delete(event.key.toLowerCase());
    this.flush();
  };
  private pointerDown = (event: PointerEvent) => {
    if (event.button !== 2 || !this.enabled()) return;
    event.preventDefault();
    this.pointer = event.pointerId;
    this.previous = { x: event.clientX, y: event.clientY };
    this.element.setPointerCapture(event.pointerId);
  };
  private pointerMove = (event: PointerEvent) => {
    if (this.pointer !== event.pointerId || !this.enabled()) return;
    if (this.previous.x === event.clientX && this.previous.y === event.clientY)
      return;
    this.begin();
    lookFlyCamera(
      this.camera,
      this.previous.x - event.clientX,
      this.previous.y - event.clientY,
    );
    this.previous = { x: event.clientX, y: event.clientY };
    this.dirty = true;
  };
  private pointerUp = (event: PointerEvent) => {
    if (this.pointer !== event.pointerId) return;
    this.pointer = null;
    this.flush();
  };
  private wheel = (event: WheelEvent) => {
    if (!this.enabled() || (!event.deltaX && !event.deltaY)) return;
    event.preventDefault();
    this.begin();
    const units =
      event.deltaMode === 1
        ? 16
        : event.deltaMode === 2
          ? this.surface.clientHeight
          : 1;
    if (event.ctrlKey) zoomFlyCamera(this.camera, event.deltaY * units);
    else lookFlyCamera(this.camera, event.deltaX * units, event.deltaY * units);
    this.dirty = true;
    clearTimeout(this.wheelTimer);
    this.wheelTimer = setTimeout(() => {
      this.wheelTimer = undefined;
      this.flush();
    }, 180);
  };
  private leave = () => {
    if (this.pointer === null) this.stop();
  };
  private focus = (event: FocusEvent) => {
    if (event.target !== this.element) this.stop();
  };
  stop = () => {
    this.keys.clear();
    const pointer = this.pointer;
    this.pointer = null;
    if (pointer !== null && this.element.hasPointerCapture(pointer))
      this.element.releasePointerCapture(pointer);
    clearTimeout(this.wheelTimer);
    this.wheelTimer = undefined;
    this.flush();
  };
  dispose() {
    this.stop();
    this.listeners.abort();
  }
}
