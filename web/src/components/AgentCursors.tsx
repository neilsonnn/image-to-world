import { Cursor } from "@phosphor-icons/react";
import { Tooltip } from "@radix-ui/themes";
import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import {
  activeAgents,
  actorColor,
  type Activity,
} from "../../../core/activity";
import { useClientState } from "../lib/client";

const empty: Activity[] = [];
export function useActiveAgents() {
  const events = useClientState((s) => s.activity ?? empty);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 4000);
    return () => window.clearInterval(timer);
  }, []);
  return useMemo(() => activeAgents(events, now), [events, now]);
}
export function AgentCursors({
  layer,
  anchors,
}: {
  layer: RefObject<HTMLDivElement | null>;
  anchors: RefObject<Map<string, Activity>>;
}) {
  const agents = useActiveAgents();
  const enabled = useClientState((s) => s.showPresence !== false);
  useEffect(() => {
    anchors.current = new Map(
      [...agents].flatMap(([actor, entry]) =>
        entry.anchor ? [[actor, entry.anchor]] : [],
      ),
    );
    return () => {
      anchors.current.clear();
    };
  }, [agents, anchors]);
  return (
    <div ref={layer} className="agent-cursor-layer" aria-label="Agent cursors">
      {enabled &&
        [...agents].map(
          ([actor, { latest, anchor }]) =>
            anchor && (
              <Tooltip
                key={actor}
                delayDuration={0}
                className="scene-label-tooltip"
                content={latest.name + " · " + latest.phase}
              >
                <span
                  className="agent-cursor"
                  data-actor={actor}
                  hidden
                  tabIndex={0}
                  aria-label={actor + " · " + latest.name}
                  style={
                    { "--agent-color": actorColor(actor) } as CSSProperties
                  }
                >
                  <Cursor weight="fill" aria-hidden="true" />
                  <span>{actor}</span>
                </span>
              </Tooltip>
            ),
        )}
    </div>
  );
}
