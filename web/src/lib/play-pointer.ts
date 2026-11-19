import { PerspectiveCamera, Raycaster, Vector2, type Ray } from "three";
import { lookFlyCamera } from "./fly";

type GrabSession = {
  grab(ray: Ray): boolean;
  moveGrab(ray: Ray): void;
  release(): void;
};

/** One captured pointer owns a grab, including when it leaves the canvas. */
export class PlayPointer {
  private readonly events = new AbortController();
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly previous = new Vector2();
  private pointer: number | null = null;
  private grabbing = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private camera: PerspectiveCamera,
    private session: GrabSession,
  ) {
    const options = { signal: this.events.signal };
    canvas.addEventListener("pointerdown", this.down, options);
    canvas.addEventListener("pointermove", this.move, options);
    canvas.addEventListener("pointerup", this.end, options);
    canvas.addEventListener("pointercancel", this.end, options);
    canvas.addEventListener("lostpointercapture", this.end, options);
    window.addEventListener("blur", this.release, options);
    document.addEventListener("visibilitychange", this.release, options);
  }

  private point(event: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      1 - ((event.clientY - rect.top) / rect.height) * 2,
    );
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.ndc, this.camera);
  }

  private down = (event: PointerEvent) => {
    if (event.button !== 0 || this.pointer !== null) return;
    this.point(event);
    this.grabbing = this.session.grab(this.raycaster.ray);
    if (!this.grabbing && event.pointerType !== "touch") return;
    this.pointer = event.pointerId;
    this.previous.set(event.clientX, event.clientY);
    this.canvas.setPointerCapture(event.pointerId);
    if (this.grabbing) this.canvas.dataset.grabbing = "true";
    event.preventDefault();
  };

  private move = (event: PointerEvent) => {
    if (event.pointerId !== this.pointer) return;
    if (this.grabbing) {
      this.point(event);
      this.session.moveGrab(this.raycaster.ray);
    } else {
      lookFlyCamera(
        this.camera,
        this.previous.x - event.clientX,
        this.previous.y - event.clientY,
      );
    }
    this.previous.set(event.clientX, event.clientY);
  };

  update() {
    if (!this.grabbing) return;
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.ndc, this.camera);
    this.session.moveGrab(this.raycaster.ray);
  }

  private end = (event: PointerEvent) => {
    if (event.pointerId === this.pointer) this.release();
  };

  private release = () => {
    const pointer = this.pointer;
    this.pointer = null;
    if (this.grabbing) this.session.release();
    this.grabbing = false;
    delete this.canvas.dataset.grabbing;
    if (pointer !== null && this.canvas.hasPointerCapture(pointer))
      this.canvas.releasePointerCapture(pointer);
  };

  dispose() {
    this.events.abort();
    this.release();
  }
}
