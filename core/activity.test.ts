import { expect, test } from "bun:test";
import {
  activeAgents,
  activitySchema,
  latestActivities,
  recentActivities,
} from "./activity";
const event = (id: string, phase: string, at: number, extra = {}) =>
  activitySchema.parse({
    id,
    sequence: Number(id),
    at,
    actorId: "Chair",
    operation: "generation.submit",
    name: "Generate mesh",
    phase,
    severity: "info",
    detail: "summary",
    requestId: "r",
    ...extra,
  });
test("summary links request start to job and expires completed actors without resurrecting running stages", () => {
  const events = [
    event("1", "started", 0),
    event("2", "running", 1, { jobId: "j" }),
    event("3", "succeeded", 2, { jobId: "j" }),
  ];
  expect(latestActivities(events).map((e) => e.id)).toEqual(["3"]);
  expect(recentActivities(events, 90000)).toEqual([]);
  expect(recentActivities(events.slice(0, 2), 90000).map((e) => e.id)).toEqual([
    "2",
  ]);
});

test("presence keeps each actor's last spatial edit and shows the newest feed action", () => {
  const anchor = { nodeIds: ["desk"], position: [0, 1, 2], major: true };
  const events = [
    event("1", "succeeded", 100, { sceneChange: anchor }),
    event("2", "succeeded", 101, {
      requestId: "settings",
      name: "Adjust lighting",
    }),
    event("3", "running", 102, { actorId: "Lamp", jobId: "job" }),
    event("4", "succeeded", 103, {
      actorId: "You",
      requestId: "manual",
      sceneChange: anchor,
    }),
  ];
  const actors = activeAgents(events, 105);
  expect([...actors.keys()]).toEqual(["Chair", "Lamp"]);
  expect(actors.get("Chair")?.latest.name).toBe("Adjust lighting");
  expect(actors.get("Chair")?.anchor?.id).toBe("1");
  expect(actors.get("Lamp")?.anchor).toBeUndefined();
  expect([...activeAgents(events, 70000).keys()]).toEqual(["Lamp"]);
});
