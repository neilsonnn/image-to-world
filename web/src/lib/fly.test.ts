import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { Euler, PerspectiveCamera } from "three";
import { FlyControls } from "./fly";

test("right-drag looks with the pointer while two-finger scroll keeps its direction and pinch only zooms", () => {
  const window = new Window();
  const previous = Object.fromEntries(
    ["window", "document"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: window,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: window.document,
  });
  const canvas = window.document.createElement("canvas");
  Object.assign(canvas, {
    setPointerCapture() {},
    hasPointerCapture() {
      return false;
    },
  });
  const camera = new PerspectiveCamera(50);
  let restore: (() => void) | undefined;
  const controls = new FlyControls(
    camera,
    canvas as unknown as HTMLCanvasElement,
    () => true,
    () => {},
    () => {
      const callback = restore;
      restore = undefined;
      callback?.();
    },
  );
  try {
    canvas.dispatchEvent(
      new window.PointerEvent("pointerdown", {
        button: 2,
        pointerId: 1,
        clientX: 100,
        clientY: 100,
      }),
    );
    canvas.dispatchEvent(
      new window.PointerEvent("pointermove", {
        pointerId: 1,
        clientX: 120,
        clientY: 110,
      }),
    );
    const drag = new Euler().setFromQuaternion(camera.quaternion, "YXZ");
    expect(drag.y).toBeCloseTo(-0.06);
    expect(drag.x).toBeCloseTo(-0.03);
    canvas.dispatchEvent(
      new window.PointerEvent("pointerup", { button: 2, pointerId: 1 }),
    );
    camera.quaternion.identity();
    canvas.dispatchEvent(
      new window.WheelEvent("wheel", { deltaX: 20, deltaY: 10 }),
    );
    const scroll = new Euler().setFromQuaternion(camera.quaternion, "YXZ");
    expect(scroll.y).toBeCloseTo(0.06);
    expect(scroll.x).toBeCloseTo(0.03);
    const rotation = camera.quaternion.clone();
    const pinch = new window.WheelEvent("wheel", { deltaY: -20 });
    Object.defineProperty(pinch, "ctrlKey", { value: true });
    canvas.dispatchEvent(pinch);
    expect(camera.fov).toBeLessThan(50);
    expect(camera.quaternion.equals(rotation)).toBe(true);
    controls.stop();
    // A temporary viewed camera must be restored before navigation changes it.
    camera.position.set(99, 99, 99);
    camera.fov = 90;
    restore = () => {
      camera.position.set(1, 2, 3);
      camera.fov = 45;
    };
    canvas.dispatchEvent(pinch);
    expect(camera.position.toArray()).toEqual([1, 2, 3]);
    expect(camera.fov).toBeCloseTo(45 * Math.exp(-0.2));
    controls.stop();
    Object.assign(canvas, { matches: () => true });
    restore = () => camera.position.set(4, 5, 6);
    controls.keyDown(
      new window.KeyboardEvent("keydown", {
        key: "w",
      }) as unknown as KeyboardEvent,
    );
    expect(camera.position.toArray()).toEqual([4, 5, 6]);
    controls.update(1 / 60);
    expect(camera.position.toArray()).not.toEqual([4, 5, 6]);
    controls.stop();
  } finally {
    controls.dispose();
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as any)[key];
    }
    window.close();
  }
});
