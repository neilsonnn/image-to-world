import { z } from "zod";
import type { Workspace } from "./schema";

export const commandContextSchema = z
  .object({
    requestId: z.string().min(1).max(200).optional(),
    actorId: z.string().min(1).max(120).default("CLI session"),
    interactive: z.boolean().default(false),
    preconditions: z
      .array(
        z
          .object({
            collection: z.enum(["nodes", "assets"]),
            id: z.string(),
            field: z.string().optional(),
            expected: z.unknown(),
          })
          .strict(),
      )
      .max(1000)
      .default([]),
  })
  .strict();
export type CommandContext = z.input<typeof commandContextSchema>;

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export class CommandConflict extends Error {
  constructor(public readonly conflicts: string[]) {
    super(`Command conflict: ${conflicts.join(", ")}`);
  }
}

export function checkPreconditions(state: Workspace, context: CommandContext) {
  const conflicts: string[] = [];
  for (const guard of context.preconditions ?? []) {
    const record = state[guard.collection][guard.id];
    const actual = guard.field
      ? (record as unknown as Record<string, unknown> | undefined)?.[
          guard.field
        ]
      : record;
    if (canonical(actual) !== canonical(guard.expected))
      conflicts.push(
        `${guard.collection}.${guard.id}${guard.field ? `.${guard.field}` : ""}`,
      );
  }
  if (conflicts.length) throw new CommandConflict(conflicts);
}
