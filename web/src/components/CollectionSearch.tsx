import { useRef, useState } from "react";
import { MagnifyingGlass, X } from "@phosphor-icons/react";
import { Hint } from "./ui";

export function CollectionSearch({
  label,
  value,
  onChange,
  autoFocus,
  onEscape,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  /** Escape in the field calls this, for searches that close. */
  onEscape?: () => void;
}) {
  return (
    <label className="collection-search">
      <MagnifyingGlass aria-hidden="true" />
      <input
        type="search"
        aria-label={label}
        placeholder="Search"
        value={value}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !onEscape) return;
          event.preventDefault();
          event.stopPropagation();
          onEscape();
        }}
      />
      {value && (
        <Hint label="Clear search">
          <button
            type="button"
            className="collection-search-clear"
            aria-label="Clear search"
            onClick={() => onChange("")}
          >
            <X />
          </button>
        </Hint>
      )}
    </label>
  );
}

// Keep typing responsive while writes run in order and server snapshots catch up.
export function useCollectionSearch(
  value: string,
  persist: (value: string) => Promise<unknown>,
) {
  const [local, setLocal] = useState<string | null>(null);
  const tail = useRef(Promise.resolve());
  const revision = useRef(0);
  const change = (next: string) => {
    setLocal(next);
    const current = ++revision.current;
    tail.current = tail.current.then(async () => {
      if (current !== revision.current) return;
      await persist(next);
      if (current === revision.current) setLocal(null);
    });
  };
  return [local ?? value, change] as const;
}
