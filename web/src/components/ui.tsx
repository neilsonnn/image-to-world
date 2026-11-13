import {
  Button,
  Flex,
  IconButton as RadixIconButton,
  Popover,
  Text,
  TextArea,
  Tooltip,
} from "@radix-ui/themes";
import type { ComponentProps, ReactNode } from "react";

export function Hint({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <Tooltip content={label} delayDuration={0}>
      <span className="hint-trigger">{children}</span>
    </Tooltip>
  );
}

export function PanelHeader({
  title,
  children,
  className,
}: {
  title: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={["panel-header", className].filter(Boolean).join(" ")}>
      <span className="panel-header-title">{title}</span>
      {children && <div className="panel-header-actions">{children}</div>}
    </header>
  );
}

type ToolbarIconButtonProps = ComponentProps<typeof RadixIconButton> & {
  label: string;
};

export function ToolbarIconButton({
  label,
  children,
  ...props
}: ToolbarIconButtonProps) {
  return (
    <Hint label={label}>
      <RadixIconButton
        aria-label={label}
        size="1"
        variant="surface"
        color="gray"
        {...props}
      >
        {children}
      </RadixIconButton>
    </Hint>
  );
}

export function ToolbarPopover({
  label,
  icon,
  children,
  width,
}: {
  label: string;
  icon: ReactNode;
  children: ReactNode;
  width: number;
}) {
  return (
    <Popover.Root>
      <Tooltip content={label} delayDuration={0}>
        <Popover.Trigger>
          <RadixIconButton
            aria-label={label}
            size="1"
            variant="surface"
            color="gray"
          >
            {icon}
          </RadixIconButton>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Content className="toolbar-popover" width={`${width}px`}>
        {children}
      </Popover.Content>
    </Popover.Root>
  );
}

/**
 * A compact button showing a prompt's text; it opens a popover to edit it.
 * Keeps prompts at the app's size-1 control height wherever they sit.
 */
export function PromptButton({
  label,
  hint,
  placeholder,
  note,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  placeholder: string;
  note?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Popover.Root>
      <Hint label={hint}>
        <Popover.Trigger>
          <Button
            size="1"
            variant="surface"
            color="gray"
            className={`prompt-button${value ? "" : " is-empty"}`}
          >
            <span>{value || label}</span>
          </Button>
        </Popover.Trigger>
      </Hint>
      <Popover.Content size="1" width="300px" side="top" align="end">
        <Flex direction="column" gap="2">
          <Text size="1" weight="medium">
            {label}
          </Text>
          <TextArea
            size="1"
            rows={4}
            autoFocus
            placeholder={placeholder}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !event.nativeEvent.isComposing)
                event.currentTarget.blur();
            }}
          />
          {note && (
            <Text size="1" color="gray">
              {note}
            </Text>
          )}
        </Flex>
      </Popover.Content>
    </Popover.Root>
  );
}
