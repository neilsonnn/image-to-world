import { expect, test } from "bun:test";
import { activitySchema, latestActivities, recentActivities } from "./activity";
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
