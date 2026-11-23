import {
  Button,
  DropdownMenu,
  Flex,
  IconButton as RadixIconButton,
  Popover,
  Text,
  TextArea,
  Tooltip,
} from "@radix-ui/themes";
import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";

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
        type="button"
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
  side,
}: {
  label: string;
  icon: ReactNode;
  children: ReactNode;
  width: number;
  side?: "top" | "bottom";
}) {
  return (
    <Popover.Root>
      <Tooltip content={label} delayDuration={0}>
        <Popover.Trigger>
          <RadixIconButton
            aria-label={label}
            type="button"
            size="1"
            variant="surface"
            color="gray"
          >
            {icon}
          </RadixIconButton>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Content
        className="toolbar-popover"
        width={`${width}px`}
        side={side}
      >
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
  indicator,
  children,
}: {
  label: string;
  hint: string;
  placeholder: string;
  note?: string;
  value: string;
  onChange: (value: string) => void;
  indicator?: ReactNode;
  children?: ReactNode;
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
            <span>{label}</span>
            {indicator}
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
          {children}
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

/** Toolbar menus leave neighboring controls interactive; Radix handles outside dismissal and focus. */
export function ToolbarMenu(
  props: Omit<ComponentProps<typeof DropdownMenu.Root>, "modal">,
) {
  return <DropdownMenu.Root {...props} modal={false} />;
}

export type ToolbarSelectOption = {
  label: string;
  icon: ReactNode;
  hint: string;
};

/** Keep hover-triggered surfaces open while crossing the trigger/content gap. */
export function useHoverDisclosure() {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const cancelClose = () => clearTimeout(closeTimer.current);
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  };
  const show = () => {
    cancelClose();
    setOpen(true);
  };
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  return { open, setOpen, cancelClose, scheduleClose, show };
}

/** Shared compact icon/label selector, with no caret and standard menu keyboard behavior. */
export function ToolbarSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Record<T, ToolbarSelectOption>;
  onChange: (value: T) => void;
}) {
  const { open, setOpen, cancelClose, scheduleClose } = useHoverDisclosure();
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const current = options[value];
  return (
    <ToolbarMenu open={open} onOpenChange={setOpen}>
      <Tooltip
        delayDuration={0}
        content={current.hint}
        open={!open && tooltipOpen}
        onOpenChange={setTooltipOpen}
      >
        <DropdownMenu.Trigger>
          <Button
            size="1"
            variant="surface"
            color="gray"
            className="toolbar-select"
            aria-label={`${label}: ${current.label}`}
            onPointerEnter={(event) => {
              cancelClose();
              if (event.pointerType !== "touch") setOpen(true);
            }}
            onPointerLeave={scheduleClose}
          >
            {current.icon}
            <span className="toolbar-label">{current.label}</span>
          </Button>
        </DropdownMenu.Trigger>
      </Tooltip>
      <DropdownMenu.Content
        size="1"
        color="gray"
        aria-label={label}
        className="toolbar-select-menu"
        onPointerEnter={cancelClose}
        onPointerLeave={scheduleClose}
      >
        <DropdownMenu.RadioGroup
          value={value}
          onValueChange={(value) => onChange(value as T)}
        >
          {(Object.keys(options) as T[]).map((key) => {
            const option = options[key];
            return (
              <Tooltip key={key} delayDuration={0} content={option.hint}>
                <DropdownMenu.RadioItem value={key}>
                  {option.icon}
                  {option.label}
                </DropdownMenu.RadioItem>
              </Tooltip>
            );
          })}
        </DropdownMenu.RadioGroup>
      </DropdownMenu.Content>
    </ToolbarMenu>
  );
}
