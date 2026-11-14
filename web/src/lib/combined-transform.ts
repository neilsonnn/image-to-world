import {
  EventDispatcher,
  Group,
  type Camera,
  type ColorRepresentation,
  type Object3D,
} from "three";
import {
  TransformControls,
  type TransformControlsEventMap,
  type TransformControlsMode,
} from "three/examples/jsm/controls/TransformControls.js";
import type { TransformCapabilities } from "../../../core/node-capabilities";

type Events = Pick<
  TransformControlsEventMap,
  "mouseDown" | "mouseUp" | "objectChange" | "dragging-changed"
> & { cancel: {} };

/** Three public TransformControls sharing one pivot and one pointer owner. */
export class CombinedTransformControls extends EventDispatcher<Events> {
  readonly controls: Record<TransformControlsMode, TransformControls>;
  private helper = new Group();
  private active?: TransformControls;
  private pointerId?: number;
  private object?: Object3D;
  private supported: TransformCapabilities = {
    translate: true,
    rotate: true,
    scale: true,
  };
  private listeners = new AbortController();
  // Small inner scale handles, translation arrows, then outer rotation rings.
  private order = ["scale", "translate", "rotate"] as const;

  constructor(
    camera: Camera,
    private element: HTMLElement,
  ) {
    super();
    this.controls = Object.fromEntries(
      this.order.map((mode) => {
        const control = new TransformControls(camera, element);
        control.disconnect();
        control.setMode(mode);
        control.setSize({ scale: 0.55, translate: 0.9, rotate: 1.15 }[mode]);
        this.helper.add(control.getHelper());
        control.addEventListener("mouseDown", (e) =>
          this.dispatchEvent({ type: "mouseDown", mode: e.mode }),
        );
        control.addEventListener("mouseUp", (e) =>
          this.dispatchEvent({ type: "mouseUp", mode: e.mode }),
        );
        control.addEventListener("objectChange", () =>
          this.dispatchEvent({ type: "objectChange" }),
        );
        control.addEventListener("dragging-changed", (e) =>
          this.dispatchEvent({ type: "dragging-changed", value: e.value }),
        );
        return [mode, control];
      }),
    ) as Record<TransformControlsMode, TransformControls>;
    element.style.touchAction = "none";
    const signal = this.listeners.signal;
    element.addEventListener("pointermove", this.move, { signal });
    element.addEventListener("pointerdown", this.down, { signal });
    element.addEventListener("pointerup", this.up, { signal });
    element.addEventListener("pointercancel", this.cancel, { signal });
    element.addEventListener("lostpointercapture", this.cancel, { signal });
    element.addEventListener(
      "pointerleave",
      () => {
        if (!this.active) this.clearHover();
      },
      { signal },
    );
    window.addEventListener("blur", this.cancel, { signal });
  }
  get dragging() {
    return !!this.active?.dragging;
  }
  getHelper() {
    return this.helper;
  }
  setColors(
    ...colors: [
      ColorRepresentation,
      ColorRepresentation,
      ColorRepresentation,
      ColorRepresentation,
    ]
  ) {
    for (const control of Object.values(this.controls))
      control.setColors(...colors);
  }
  setSpace(space: "world" | "local") {
    for (const control of Object.values(this.controls)) control.setSpace(space);
  }
  setCapabilities(value: TransformCapabilities) {
    this.supported = value;
    for (const mode of this.order) {
      const control = this.controls[mode];
      control.enabled = value[mode];
      if (this.object && value[mode]) control.attach(this.object);
      else control.detach();
    }
  }
  attach(object: Object3D) {
    this.object = object;
    this.setCapabilities(this.supported);
  }
  detach() {
    this.object = undefined;
    for (const control of Object.values(this.controls)) control.detach();
  }
  reset() {
    this.cancel();
  }
  dispose() {
    this.cancel();
    this.listeners.abort();
    for (const control of Object.values(this.controls)) control.dispose();
    this.helper.removeFromParent();
  }
  private pointer(event: PointerEvent) {
    const rect = this.element.getBoundingClientRect();
    // TransformControls expects normalized x/y despite its PointerEvent type declaration.
    return {
      x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
      y: (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      button: event.button,
    } as PointerEvent;
  }
  private clearHover() {
    for (const control of Object.values(this.controls)) control.axis = null;
  }
  private hover(event: PointerEvent) {
    this.clearHover();
    this.helper.updateMatrixWorld(true);
    for (const mode of this.order) {
      const control = this.controls[mode];
      if (!control.enabled) continue;
      control.pointerHover(this.pointer(event));
      if (control.axis) return control;
    }
  }
  private move = (event: PointerEvent) => {
    if (this.active) {
      if (this.pointerId === event.pointerId)
        this.active.pointerMove(this.pointer(event));
    } else if (!event.buttons) this.hover(event);
  };
  private down = (event: PointerEvent) => {
    if (event.button !== 0 || this.active || event.altKey) return;
    const control = this.hover(event);
    if (!control) return;
    this.active = control;
    this.pointerId = event.pointerId;
    control.pointerDown(this.pointer(event));
    if (control.dragging) this.element.setPointerCapture(event.pointerId);
    else {
      this.active = undefined;
      this.pointerId = undefined;
    }
  };
  private up = (event: PointerEvent) => {
    if (
      !this.active ||
      this.pointerId !== event.pointerId ||
      event.button !== 0
    )
      return;
    this.active.pointerUp(this.pointer(event));
    this.active = undefined;
    this.pointerId = undefined;
    if (this.element.hasPointerCapture(event.pointerId))
      this.element.releasePointerCapture(event.pointerId);
  };
  private cancel = () => {
    if (!this.active) return;
    this.active.reset();
    this.active.dragging = false;
    this.active.axis = null;
    this.active = undefined;
    const id = this.pointerId;
    this.pointerId = undefined;
    if (id !== undefined && this.element.hasPointerCapture(id))
      this.element.releasePointerCapture(id);
    this.dispatchEvent({ type: "cancel" });
  };
}
