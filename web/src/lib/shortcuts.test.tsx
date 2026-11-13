import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { useGlobalShortcuts, usePaneShortcuts } from "./shortcuts";

test("global selection shortcuts work across panes while text fields and dialogs keep their keys", async () => {
  const window = new Window();
  const globals = {
    window,
    document: window.document,
    navigator: window.navigator,
    Element: window.Element,
    Node: window.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = Object.fromEntries(
    Object.keys(globals).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, value });
  const { createRoot } = await import("react-dom/client");
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const events: string[] = [];
  function Harness() {
    const pane = usePaneShortcuts(
      "shortcut-test",
      (event) => {
        if (event.key === "Escape") {
          events.push("cancel gesture");
          event.preventDefault();
        }
      },
      true,
    );
    useGlobalShortcuts((event) => events.push(event.key));
    return (
      <div {...pane}>
        <button>Viewport</button>
        <input />
      </div>
    );
  }
  const key = (
    target: InstanceType<typeof window.HTMLElement>,
    value: string,
  ) =>
    target.dispatchEvent(
      new window.KeyboardEvent("keydown", {
        key: value,
        bubbles: true,
        cancelable: true,
      }),
    );
  try {
    await act(async () => root.render(<Harness />));
    const button = host.querySelector("button")!;
    button.dispatchEvent(
      new window.PointerEvent("pointerdown", { bubbles: true }),
    );
    key(button, "Escape");
    expect(events).toEqual(["cancel gesture", "Escape"]);
    events.length = 0;
    key(button, "h");
    expect(events).toEqual(["h"]);
    events.length = 0;
    key(host.querySelector("input")!, "h");
    key(host.querySelector("input")!, "Escape");
    const dialog = window.document.createElement("div");
    dialog.setAttribute("role", "dialog");
    host.append(dialog);
    key(button, "Escape");
    expect(events).toEqual([]);
  } finally {
    await act(async () => root.unmount());
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as any)[key];
    }
    window.close();
  }
});
