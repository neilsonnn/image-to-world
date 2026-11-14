import { useEffect, useMemo, useRef, useState } from "react";
import {
  latestActivities,
  recentActivities,
  activityDetails,
  actorColor,
  type Activity,
} from "../../../core/activity";
import { useClientState, useWorldbashClient } from "../lib/client";
import { Hint, PanelHeader } from "./ui";

const empty: Activity[] = [];
export function ActivityFeed({ fallback }: { fallback: string }) {
  const events = useClientState((s) => s.activity ?? empty);
  const showPresence = useClientState((s) => s.showPresence !== false);
  const client = useWorldbashClient();
  const [open, setOpen] = useState(false),
    [detail, setDetail] = useState("summary");
  const [actor, setActor] = useState(""),
    [severity, setSeverity] = useState(""),
    [search, setSearch] = useState("");
  const [now, setNow] = useState(Date.now());
  const list = useRef<HTMLDivElement>(null),
    following = useRef(true);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  const actors = [...new Set(events.map((e) => e.actorId))];
  const active = [
    ...new Set(
      recentActivities(events, now)
        .filter((e) => !["You", "System"].includes(e.actorId))
        .map((e) => e.actorId),
    ),
  ];
  const visible = useMemo(() => {
    const ranks = { summary: 0, actions: 1, trace: 2 };
    const filtered = (
      detail === "summary"
        ? latestActivities(
            events.filter(
              (e) => e.detail === "summary" || e.severity === "error",
            ),
          )
        : events
    ).filter(
      (e) =>
        (!actor || e.actorId === actor) &&
        (!severity || e.severity === severity) &&
        (e.severity === "error" ||
          ranks[e.detail] <= ranks[detail as keyof typeof ranks]) &&
        (!search ||
          `${e.name} ${e.message ?? ""} ${e.model ?? ""} ${e.nodeIds.join(" ")} ${e.assetIds.join(" ")}`
            .toLowerCase()
            .includes(search.toLowerCase())),
    );
    // Each request/job occupies one row at Summary; Actions and Trace retain its stages.
    if (detail !== "summary") return filtered;
    const latest = new Map<string, Activity>();
    for (const e of filtered) latest.set(e.jobId ?? e.requestId ?? e.id, e);
    return [...latest.values()].sort((a, b) => a.sequence - b.sequence);
  }, [events, actor, severity, detail, search]);
  useEffect(() => {
    if (following.current && list.current)
      list.current.scrollTop = list.current.scrollHeight;
  }, [visible, open]);
  const last = events.at(-1);
  return (
    <div className="activity-container">
      <Hint label="Open activity history">
        <button
          className="footer-operation"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <span>
            {last ? `${last.actorId} · ${last.name} · ${last.phase}` : fallback}
          </span>
          {active.length > 0 && (
            <span className="activity-count">{active.length} active</span>
          )}
        </button>
      </Hint>
      {open && (
        <section className="activity-drawer" aria-label="Activity history">
          <PanelHeader title="Activity">
            <label>
              <input
                type="checkbox"
                checked={showPresence}
                onChange={(e) =>
                  client.store.setState({ showPresence: e.target.checked })
                }
              />{" "}
              Agent presence
            </label>
            <button onClick={() => setOpen(false)} aria-label="Close activity">
              ×
            </button>
          </PanelHeader>
          <div className="activity-filters">
            <select
              aria-label="Activity detail"
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
            >
              {Object.entries(activityDetails).map(([v, label]) => (
                <option value={v} key={v}>
                  {label}
                </option>
              ))}
            </select>
            <select
              aria-label="Activity actor"
              value={actor}
              onChange={(e) => setActor(e.target.value)}
            >
              <option value="">All actors</option>
              {actors.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
            <select
              aria-label="Activity severity"
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
            >
              <option value="">All levels</option>
              <option value="info">Info</option>
              <option value="warning">Warnings</option>
              <option value="error">Errors</option>
            </select>
            <input
              aria-label="Search activity"
              placeholder="Search actions, assets, models…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button
              onClick={() => {
                following.current = true;
                if (list.current)
                  list.current.scrollTop = list.current.scrollHeight;
              }}
            >
              Live ↓
            </button>
          </div>
          <div
            className="activity-list"
            ref={list}
            onScroll={() => {
              const el = list.current!;
              following.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 30;
            }}
          >
            {!visible.length && <p>No matching activity.</p>}
            {visible.map((e) => (
              <details className={`activity-entry ${e.severity}`} key={e.id}>
                <summary>
                  <time>{new Date(e.at).toLocaleTimeString()}</time>
                  <span style={{ color: actorColor(e.actorId) }}>
                    {e.actorId}
                  </span>
                  <strong>{e.name}</strong>
                  <span>{e.phase}</span>
                </summary>
                <div className="activity-details">
                  {e.message && <p>{e.message}</p>}
                  {e.model && <p>Model: {e.model}</p>}
                  <code>{e.operation}</code>
                  {!!e.nodeIds.length && (
                    <p>
                      Nodes:{" "}
                      {e.nodeIds.map((id) => (
                        <button
                          key={id}
                          onClick={() =>
                            void client.safeCommand({
                              type: "selection.set",
                              ids: [id],
                            })
                          }
                        >
                          {client.getWorkspace().nodes[id]?.name ?? id}
                        </button>
                      ))}
                    </p>
                  )}
                  {!!e.assetIds.length && (
                    <p>
                      Assets:{" "}
                      {e.assetIds.map((id) => (
                        <a
                          key={id}
                          href={`/api/assets/${encodeURIComponent(id)}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {client.getWorkspace().assets[id]?.name ?? id}{" "}
                        </a>
                      ))}
                    </p>
                  )}
                  {e.jobId && (
                    <p>
                      Job: <code>{e.jobId}</code>
                    </p>
                  )}
                </div>
              </details>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export function ActivityBadge({ id }: { id: string }) {
  const events = useClientState((s) => s.activity ?? empty);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  const recent = [
    ...new Map(
      recentActivities(events, now, 30000)
        .filter(
          (e) =>
            (e.nodeIds.includes(id) || e.assetIds.includes(id)) &&
            e.actorId !== "You",
        )
        .map((e) => [e.actorId, e]),
    ).values(),
  ];
  return (
    <span className="activity-badges">
      {recent.map((e) => (
        <Hint key={e.actorId} label={`${e.actorId}: ${e.name} · ${e.phase}`}>
          <span style={{ color: actorColor(e.actorId) }}>●</span>
        </Hint>
      ))}
    </span>
  );
}
