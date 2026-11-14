import { Button, Dialog, Flex, Grid, Text, TextField } from "@radix-ui/themes";
import { Plus, X } from "@phosphor-icons/react";
import { useState } from "react";
import type { EnvironmentStatus } from "../../../core/environment";
import { useClientState, useWorldbashClient } from "../lib/client";
import { PanelHeader, ToolbarIconButton } from "./ui";

type Row = {
  id: string;
  original: string | null;
  name: string;
  value: string;
  source: string;
};
const rowsFor = (environment: EnvironmentStatus): Row[] =>
  Object.entries(environment).map(([name, entry]) => ({
    id: crypto.randomUUID(),
    original: name,
    name,
    value: "",
    source: entry.source,
  }));

export function EnvironmentEditor({ onClose }: { onClose: () => void }) {
  const client = useWorldbashClient();
  const environment = useClientState((state) => state.status?.environment);
  const [rows, setRows] = useState(() => rowsFor(environment ?? {}));
  const [removed, setRemoved] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const update = (id: string, patch: Partial<Row>) => {
    setRows(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
    setSaved(false);
  };
  const dirty =
    removed.length > 0 ||
    rows.some((row) => row.value !== "" || row.name !== (row.original ?? ""));
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <Dialog.Content maxWidth="640px">
        <PanelHeader
          title={
            <Dialog.Title size="3" mb="0">
              Environment variables
            </Dialog.Title>
          }
        />
        <Dialog.Description size="2" mb="3">
          Shared local .env configuration. Add or update any variable by name.
        </Dialog.Description>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setError("");
            setSaved(false);
            const values: Record<string, string | null> = Object.create(null);
            for (const name of removed) values[name] = null;
            for (const row of rows)
              if (row.original && row.original !== row.name.trim())
                values[row.original] = null;
            const names = new Set<string>();
            for (const row of rows) {
              const name = row.name.trim();
              if (!name && !row.value && !row.original) continue;
              if (!name || names.has(name)) {
                setError("Each row needs a unique variable name.");
                return;
              }
              names.add(name);
              if (row.original && row.original !== name) {
                if (!row.value && row.source !== "unset") {
                  setError(
                    "Enter a new value when renaming a saved or inherited variable.",
                  );
                  return;
                }
              }
              if (row.value !== "" || row.original !== name)
                values[name] = row.value;
            }
            setSaving(true);
            try {
              await client.command({ type: "environment.configure", values });
              setRows(rowsFor(client.store.getState().status!.environment));
              setRemoved([]);
              setSaved(true);
            } catch (cause) {
              setError(
                cause instanceof Error
                  ? cause.message
                  : "Could not save variables",
              );
            } finally {
              setSaving(false);
            }
          }}
        >
          <Flex direction="column" gap="2">
            <Grid columns="minmax(0, 1fr) minmax(0, 1fr) 28px" gap="2">
              <Text size="1" color="gray">
                Variable
              </Text>
              <Text size="1" color="gray">
                Value
              </Text>
            </Grid>
            {rows.map((row, index) => (
              <Grid
                key={row.id}
                columns="minmax(0, 1fr) minmax(0, 1fr) 28px"
                gap="2"
                align="start"
              >
                <div>
                  <TextField.Root
                    aria-label={`Variable ${index + 1}`}
                    size="2"
                    value={row.name}
                    disabled={saving}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="VARIABLE_NAME"
                    onChange={(event) =>
                      update(row.id, { name: event.target.value })
                    }
                  />
                  <Text as="p" size="1" color="gray" mt="1">
                    {row.source}
                  </Text>
                </div>
                <TextField.Root
                  aria-label={`Value for ${row.name || `variable ${index + 1}`}`}
                  size="2"
                  type="password"
                  value={row.value}
                  disabled={saving}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder={
                    row.source === "unset" || row.source === "new"
                      ? "Enter value"
                      : "Unchanged · enter replacement"
                  }
                  onChange={(event) =>
                    update(row.id, { value: event.target.value })
                  }
                />
                <ToolbarIconButton
                  label={`Remove ${row.name || "variable"}`}
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    if (row.original) setRemoved([...removed, row.original]);
                    setRows(rows.filter((item) => item.id !== row.id));
                    setSaved(false);
                  }}
                >
                  <X />
                </ToolbarIconButton>
              </Grid>
            ))}
            <Flex>
              <Button
                type="button"
                size="1"
                variant="surface"
                color="gray"
                disabled={saving}
                onClick={() => {
                  setRows([
                    ...rows,
                    {
                      id: crypto.randomUUID(),
                      original: null,
                      name: "",
                      value: "",
                      source: "new",
                    },
                  ]);
                  setSaved(false);
                }}
              >
                <Plus />
                Add variable
              </Button>
            </Flex>
            <Text size="1" color="gray">
              Saved values stay on the server. Leave a value blank to keep it.
              Removing an override restores any process value. Runtime settings
              update immediately; startup settings apply next launch.
            </Text>
            {error && (
              <Text role="alert" size="2" color="red">
                {error}
              </Text>
            )}
            {saved && (
              <Text role="status" size="2">
                Environment saved.
              </Text>
            )}
            <Flex justify="end" gap="2" mt="2">
              <Button
                type="button"
                variant="surface"
                color="gray"
                disabled={saving}
                onClick={onClose}
              >
                {saved ? "Done" : "Close"}
              </Button>
              <Button
                type="submit"
                className="submit-action"
                data-ready={dirty && !saving}
                variant="surface"
                color="gray"
                disabled={saving || !dirty}
              >
                {saving ? "Saving…" : "Save"}
              </Button>
            </Flex>
          </Flex>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
}
