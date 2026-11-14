import { X } from "@phosphor-icons/react";
import { Button, Dialog, Flex, IconButton, Text } from "@radix-ui/themes";
import { useEffect, useRef, useState, type ReactNode } from "react";

/** An explicit confirmation after a delay; reaching zero never runs the action. */
export function ConfirmActionDialog({
  open,
  title,
  description,
  delaySeconds = 0,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  delaySeconds?: number;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<unknown>;
}) {
  const [remaining, setRemaining] = useState(delaySeconds);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const deadline = useRef(Infinity);
  const inFlight = useRef(false);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    deadline.current = performance.now() + delaySeconds * 1000;
    inFlight.current = false;
    setRemaining(delaySeconds);
    setSubmitting(false);
    setError(undefined);
    const tick = () =>
      setRemaining(
        Math.max(0, Math.ceil((deadline.current - performance.now()) / 1000)),
      );
    const timer = window.setInterval(tick, 100);
    return () => window.clearInterval(timer);
  }, [open, delaySeconds]);
  const confirm = async () => {
    if (inFlight.current || performance.now() < deadline.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(undefined);
    try {
      await onConfirm();
      inFlight.current = false;
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      inFlight.current = false;
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!inFlight.current) onOpenChange(next);
      }}
    >
      <Dialog.Content
        size="2"
        maxWidth="360px"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancel.current?.focus();
        }}
      >
        <Flex justify="between" align="center" gap="3">
          <Dialog.Title size="3" mb="0">
            {title}
          </Dialog.Title>
          <Dialog.Close>
            <IconButton
              ref={cancel}
              size="1"
              variant="surface"
              color="gray"
              aria-label="Cancel"
              disabled={submitting}
            >
              <X />
            </IconButton>
          </Dialog.Close>
        </Flex>
        <Dialog.Description size="2" mt="3" mb="3">
          {description}
        </Dialog.Description>
        {error && (
          <Text as="p" size="1" color="red" mb="3" role="alert">
            {error}
          </Text>
        )}
        <Flex justify="end">
          <Button
            size="1"
            variant="surface"
            color="gray"
            disabled={remaining > 0 || submitting}
            onClick={() => void confirm()}
          >
            {submitting
              ? "Submitting…"
              : remaining > 0
                ? `Yes (${remaining})`
                : "Yes"}
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
