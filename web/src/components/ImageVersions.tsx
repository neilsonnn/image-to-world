import { CaretUp, CaretDown } from "@phosphor-icons/react";
import { Popover } from "@radix-ui/themes";
import { useMemo, type ReactNode } from "react";
import { imageVersionsFor } from "../../../core/images";
import { useWorkspaceData } from "../lib/client";
import { Hint, useHoverDisclosure } from "./ui";

export function ImageVersions({
  assetId,
  onSelect,
  children,
}: {
  assetId: string | null;
  onSelect: (id: string) => void;
  children: ReactNode;
}) {
  const workspace = useWorkspaceData(["assets", "nodes"], []);
  const hover = useHoverDisclosure();
  const versions = useMemo(
    () => imageVersionsFor(workspace, assetId),
    [workspace.assets, workspace.nodes, assetId],
  );
  const index = versions.findIndex((asset) => asset.id === assetId);
  return (
    <Popover.Root open={hover.open} onOpenChange={hover.setOpen}>
      <Popover.Anchor asChild>
        <div
          className="ie-version-navigation"
          role="group"
          aria-label="Image versions"
          onPointerEnter={(e) => {
            if (e.pointerType !== "touch" && assetId) hover.show();
          }}
          onPointerLeave={hover.scheduleClose}
        >
          {[
            {
              label: "Previous image version",
              icon: <CaretUp />,
              target: versions[index - 1],
            },
            {
              label: "Next image version",
              icon: <CaretDown />,
              target: versions[index + 1],
            },
          ].map(({ label, icon, target }) => (
            <Hint key={label} label={label}>
              <button
                className="icon-button"
                aria-label={label}
                disabled={!target}
                onClick={() => {
                  if (target) onSelect(target.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowRight") hover.show();
                  if (event.key === "Escape") hover.setOpen(false);
                }}
              >
                {icon}
              </button>
            </Hint>
          ))}
        </div>
      </Popover.Anchor>
      <Popover.Content
        size="1"
        side="top"
        align="start"
        width="250px"
        className="ie-version-list"
        aria-label="Versions of this image"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onPointerEnter={hover.cancelClose}
        onPointerLeave={hover.scheduleClose}
      >
        {children}
      </Popover.Content>
    </Popover.Root>
  );
}
