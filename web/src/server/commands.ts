import { createHash } from "node:crypto";
import {
  canonical,
  checkPreconditions,
  commandContextSchema,
  type CommandContext,
} from "../../../core/command-context";
import { operationName, activityTargets } from "../../../core/activity";
import { moveAssetsToTrash, revealAsset } from "./asset-files";
import { applyCommand } from "../../../core/commands";
import { generationInput } from "../../../core/generation";
import { frameAssets, frameAt } from "../../../core/frames";
import {
  commandSchema,
  type Command,
  type CommandResult,
} from "../../../core/schema";
import type { JobRunner } from "./jobs";
import type { WorkspaceStore } from "./store";
import { integrateAssets } from "./integration";
import { saveEnvironment } from "./environment";

export class CommandService {
  constructor(
    private store: WorkspaceStore,
    private jobs: JobRunner,
  ) {}
  private tail: Promise<unknown> = Promise.resolve();
  execute(
    input: Command,
    metadata: CommandContext = {},
  ): Promise<CommandResult> {
    const task = this.tail.then(() => this.executeOnce(input, metadata));
    this.tail = task.catch(() => {});
    return task;
  }
  private async executeOnce(
    input: Command,
    metadata: CommandContext,
  ): Promise<CommandResult> {
    const command = commandSchema.parse(input);
    const context = commandContextSchema.parse(metadata);
    context.requestId ??= crypto.randomUUID();
    const body = createHash("sha256")
      .update(
        canonical({
          command,
          actorId: context.actorId,
          preconditions: context.preconditions,
        }),
      )
      .digest("hex");
    const previous = this.store.snapshot().receipts[context.requestId];
    if (previous) {
      if (previous.body !== body)
        throw new Error("Request ID was already used for another command");
      if (!previous.result) {
        const jobId = `job_${context.requestId}`;
        if (
          ["generation.submit", "jobs.submit"].includes(command.type) &&
          this.store.snapshot().jobs[jobId]
        ) {
          return this.store.update((state) => {
            const result = { revision: state.revision + 1, jobId };
            state.receipts[context.requestId!] = { body, result };
            return result;
          });
        }
        throw new Error(
          "This request was interrupted; inspect its effects before submitting a new request",
        );
      }
      return previous.result;
    }
    const activity = {
      actorId: context.actorId,
      requestId: context.requestId,
      operation: command.type,
      name: operationName(command),
      ...activityTargets(command),
      detail: ([
        "generation.submit",
        "jobs.submit",
        "workspace.update",
        "selection.set",
        "selection.visibility",
      ].includes(command.type)
        ? "actions"
        : "summary") as "actions" | "summary",
      severity: "info" as const,
    };
    this.store.reportOperation(operationName(command));
    this.store.recordActivity({ ...activity, phase: "started" });
    const before = this.store.snapshot();
    try {
      if (command.type === "environment.configure") {
        const result = await this.perform(command, context);
        this.store.recordActivity({ ...activity, phase: "succeeded" });
        return result;
      }
      const external = [
        "caption.clear",
        "generation.submit",
        "jobs.submit",
        "jobs.cancel",
        "jobs.retry",
        "assets.place",
        "frames.integrate",
        "assets.trash",
        "assets.restore",
        "assets.reveal",
      ].includes(command.type);
      if (!external) {
        const result = await this.store.update((state) => {
          checkPreconditions(state, context);
          const nodes = new Set(Object.keys(state.nodes));
          const lastEdit = state.undo.at(-1)?.id;
          applyCommand(state, command, {
            preserveSelection: !context.interactive,
          });
          const edit = state.undo.at(-1);
          const editId = edit?.id !== lastEdit ? edit?.id : undefined;
          if (editId)
            Object.assign(edit!, {
              actorId: context.actorId,
              requestId: context.requestId,
            });
          const result: CommandResult = {
            revision: state.revision + 1,
            nodeIds: Object.keys(state.nodes).filter((id) => !nodes.has(id)),
            editId,
          };
          state.receipts[context.requestId!] = { body, result };
          return result;
        });
        this.store.recordActivity({
          ...activity,
          nodeIds: [
            ...new Set([...activity.nodeIds, ...(result.nodeIds ?? [])]),
          ],
          phase: "succeeded",
        });
        return result;
      }
      await this.store.update((state) => {
        checkPreconditions(state, context);
        state.receipts[context.requestId!] = { body, result: null };
      });
      const result = await this.perform(command, context);
      const after = this.store.snapshot();
      if (
        result.jobId &&
        ["generation.submit", "jobs.submit"].includes(command.type)
      ) {
        const input = after.jobs[result.jobId]?.input;
        result.nodeIds =
          input && (input.kind === "image" || input.kind === "pose")
            ? input.nodeIds
            : [];
      } else
        result.nodeIds = Object.keys(after.nodes).filter(
          (id) => !before.nodes[id],
        );
      const edit = after.undo.at(-1);
      if (edit && edit.id !== before.undo.at(-1)?.id) result.editId = edit.id;
      await this.store.update((state) => {
        result.revision = state.revision + 1;
        state.receipts[context.requestId!] = { body, result };
        if (result.editId) {
          const entry = state.undo.find((e) => e.id === result.editId);
          if (entry)
            Object.assign(entry, {
              actorId: context.actorId,
              requestId: context.requestId,
            });
        }
      });
      this.store.recordActivity({
        ...activity,
        nodeIds: [...new Set([...activity.nodeIds, ...(result.nodeIds ?? [])])],
        jobId: result.jobId,
        phase: result.jobId
          ? this.store.snapshot().jobs[result.jobId].status
          : "succeeded",
      });
      return result;
    } catch (error) {
      this.store.recordActivity({
        ...activity,
        phase: "failed",
        severity: "error",
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
  private async perform(
    command: ReturnType<typeof commandSchema.parse>,
    context: CommandContext,
  ): Promise<CommandResult> {
    this.store.reportOperation(operationName(command));
    let jobId: string | undefined, jobIds: string[] | undefined;
    switch (command.type) {
      case "caption.clear":
        await this.store.update((state) => {
          state.settings.enhancedCaption = null;
          state.settings.captionEpoch = (state.settings.captionEpoch ?? 0) + 1;
        });
        break;
      case "environment.configure":
        await saveEnvironment(command.values);
        break;
      case "assets.trash":
        await moveAssetsToTrash(this.store, command.ids);
        break;
      case "assets.restore":
        await moveAssetsToTrash(this.store, command.ids, true);
        break;
      case "assets.reveal":
        await revealAsset(this.store, command.id);
        break;
      case "generation.submit": {
        const { request } = command;
        jobId = await this.jobs.submit(
          generationInput(this.store.snapshot(), request),
          `job_${context.requestId}`,
          undefined,
          context,
        );
        if (
          request.kind === "view" &&
          request.seed === undefined &&
          this.store.snapshot().settings.seedMode === "auto"
        )
          await this.store.update((state) => {
            state.settings.seed += 1;
          });
        break;
      }
      case "jobs.submit":
        jobId = await this.jobs.submit(
          command.input,
          `job_${context.requestId}`,
          undefined,
          context,
        );
        break;
      case "jobs.cancel":
        await this.jobs.cancel(command.id);
        break;
      case "jobs.retry":
        jobId = await this.jobs.retry(command.id);
        break;
      case "assets.place":
        jobIds = await this.jobs.place(
          command.assetIds,
          command.camera,
          command,
          command.mode,
          context,
        );
        break;
      case "frames.integrate": {
        const snapshot = this.store.snapshot(),
          job = snapshot.jobs[command.jobId];
        if (!job || job.status !== "succeeded")
          throw new Error("Choose a completed generation");
        const frames = frameAssets(snapshot, job);
        const selected =
          command.indices?.map((index) => frameAt(snapshot, job, index)) ??
          frames;
        if (!selected.length || selected.some((asset) => !asset))
          throw new Error("Choose valid frame indices");
        await integrateAssets(
          this.store,
          selected.map((asset) => asset!.id),
        );
        break;
      }
      default:
        await this.store.update((state) => {
          checkPreconditions(state, context);
          applyCommand(state, command, {
            preserveSelection: !context.interactive,
          });
        });
    }
    return {
      revision: this.store.snapshot().revision,
      ...(jobId ? { jobId } : {}),
      ...(jobIds ? { jobIds } : {}),
    };
  }
}
