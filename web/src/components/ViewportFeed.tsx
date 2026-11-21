import { ArrowUpRight } from "@phosphor-icons/react";
import { actorColor, type Activity } from "../../../core/activity";
import {
  useClientState,
  useImageToWorldClient,
  useWorkspace,
} from "../lib/client";

function ActionLabel({ event }: { event: Activity }) {
  const subject = useWorkspace(
    (w) =>
      w.nodes[event.sceneChange?.nodeIds[0] ?? event.nodeIds[0]]?.name ??
      w.assets[event.assetIds[0]]?.name,
  );
  const label = subject ? event.name + " · " + subject : event.name;
  return (
    <span className="toast-action" title={event.message || label}>
      {label}
    </span>
  );
}

export function ViewportFeed({ go }: { go: (activity: Activity) => boolean }) {
  const events = useClientState((s) => s.toasts);
  const { store } = useImageToWorldClient();
  return (
    <div
      className="viewport-feed"
      aria-label="Recent activity"
      role="log"
      aria-live="polite"
    >
      {events?.map((e) => (
        <div
          className="viewport-toast"
          key={e.id}
          onAnimationEnd={() =>
            store.setState((s) => ({
              toasts: s.toasts?.filter((item) => item.id !== e.id),
            }))
          }
        >
          <span
            className="toast-actor"
            style={{ color: actorColor(e.actorId) }}
          >
            {e.actorId}
          </span>
          <ActionLabel event={e} />
          <small>{e.phase}</small>
          <button
            aria-label={"Go to " + e.name}
            onClick={() => {
              if (!go(e)) store.setState({ inspectActivity: e.id });
            }}
          >
            Go <ArrowUpRight />
          </button>
        </div>
      ))}
    </div>
  );
}
