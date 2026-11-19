import { expect, test } from "bun:test";
import { applyCommand } from "./commands";
import { emptyWorkspace, nodeSchema, commandSchema } from "./schema";
import { frameTasks } from "./frame-work";

test("Frame slugs survive renaming and duplication and concurrent workers finish independently", () => {
  const state = emptyWorkspace();
  applyCommand(state, {
    type: "nodes.put",
    nodes: ["a", "b"].map((id) =>
      nodeSchema.parse({ id, kind: "capture", name: "Desk Painter.png" }),
    ),
  });
  expect(state.nodes.a.frameSlug).toBe("desk-painter");
  expect(state.nodes.b.frameSlug).not.toBe(state.nodes.a.frameSlug);
  applyCommand(state, {
    type: "nodes.patch",
    id: "a",
    patch: { name: "Renamed" },
  });
  expect(state.nodes.a.frameSlug).toBe("desk-painter");
  expect(() =>
    applyCommand(state, {
      type: "nodes.patch",
      id: "b",
      patch: { frameSlug: "desk-painter" },
    }),
  ).toThrow();
  const work = (actor: string, description: string | null) =>
    applyCommand(state, { type: "frame.work", id: "a", actor, description });
  const edits = state.undo.length;
  work("lamp", "Making brass hinges");
  work("wood", "Painting the desk");
  work("lamp", "Fitting the shade");
  expect(frameTasks(state.nodes.a, {})).toEqual([
    "Painting the desk",
    "Fitting the shade",
  ]);
  work("wood", null);
  expect(frameTasks(state.nodes.a, {})).toEqual(["Fitting the shade"]);
  expect(state.undo.length).toBe(edits);
  applyCommand(state, { type: "nodes.duplicate", ids: ["a"] });
  const copy = Object.values(state.nodes).find(
    (n) => n.id !== "a" && n.id !== "b",
  )!;
  expect(copy.frameSlug).not.toBe("desk-painter");
  expect(frameTasks(copy, {})).toEqual([]);
  expect(
    commandSchema.safeParse({
      type: "frame.work",
      id: "a",
      actor: "lamp",
      description: "busy",
    }).success,
  ).toBe(false);
});
