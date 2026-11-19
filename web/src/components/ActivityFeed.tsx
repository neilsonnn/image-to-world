import { useActiveAgents } from "./AgentCursors";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  latestActivities,
  recentActivities,
  activityDetails,
  actorColor,
  type Activity,
} from "../../../core/activity";
import { useClientState, useImageToWorldClient } from "../lib/client";
import {
  Button,
  Checkbox,
  Flex,
  Select,
  Text,
  TextField,
} from "@radix-ui/themes";
import { ArrowDown, X } from "@phosphor-icons/react";
import { Hint, PanelHeader, ToolbarIconButton } from "./ui";

const empty: Activity[] = [];
export function ActivityFeed({ fallback }: { fallback: string }) {
  const events = useClientState((s) => s.activity ?? empty);
  const showPresence = useClientState((s) => s.showPresence !== false);
  const client = useImageToWorldClient();
  const [open, setOpen] = useState(false),
    [detail, setDetail] = useState("summary");
  const [actor, setActor] = useState(""),
    [severity, setSeverity] = useState(""),
    [search, setSearch] = useState("");
  const list = useRef<HTMLDivElement>(null),
    following = useRef(true);
  const actors = [...new Set(events.map((e) => e.actorId))];
  const active = useActiveAgents();
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
          {active.size > 0 && (
            <span className="activity-count">{active.size} active</span>
          )}
        </button>
      </Hint>
      {open && (
        <section className="activity-drawer" aria-label="Activity history">
          <PanelHeader title="Activity">
            <Text as="label" size="1" weight="regular" color="gray">
              <Flex align="center" gap="2" mr="2">
                <Checkbox
                  size="1"
                  color="gray"
                  checked={showPresence}
                  onCheckedChange={(checked) =>
                    client.store.setState({ showPresence: checked === true })
                  }
                />
                Agent presence
              </Flex>
            </Text>
            <ToolbarIconButton
              label="Close activity"
              onClick={() => setOpen(false)}
            >
              <X size={14} />
            </ToolbarIconButton>
          </PanelHeader>
          {active.size > 0 && (
            <div className="activity-agents" aria-label="Active agents">
              {[...active].map(([actor, { latest }]) => (
                <Hint key={actor} label={latest.name + " · " + latest.phase}>
                  <span tabIndex={0} style={{ color: actorColor(actor) }}>
                    {actor}
                  </span>
                </Hint>
              ))}
            </div>
          )}
          <div className="activity-filters">
            {[
              {
                label: "Activity detail",
                value: detail,
                onChange: setDetail,
                options: Object.entries(activityDetails),
              },
              {
                label: "Activity actor",
                value: actor,
                onChange: setActor,
                options: [["", "All actors"], ...actors.map((a) => [a, a])],
              },
              {
                label: "Activity severity",
                value: severity,
                onChange: setSeverity,
                options: [
                  ["", "All levels"],
                  ["info", "Info"],
                  ["warning", "Warnings"],
                  ["error", "Errors"],
                ],
              },
            ].map((filter) => (
              <Select.Root
                key={filter.label}
                size="1"
                value={`option:${filter.value}`}
                onValueChange={(value) => filter.onChange(value.slice(7))}
              >
                <Select.Trigger
                  aria-label={filter.label}
                  variant="surface"
                  color="gray"
                />
                <Select.Content position="popper" color="gray" variant="soft">
                  {filter.options.map(([value, label]) => (
                    <Select.Item key={value} value={`option:${value}`}>
                      {label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            ))}
            <TextField.Root
              size="1"
              className="activity-search"
              aria-label="Search activity"
              placeholder="Search actions, assets, models…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Button
              size="1"
              variant="surface"
              color="gray"
              onClick={() => {
                following.current = true;
                if (list.current)
                  list.current.scrollTop = list.current.scrollHeight;
              }}
            >
              Live <ArrowDown size={12} />
            </Button>
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
