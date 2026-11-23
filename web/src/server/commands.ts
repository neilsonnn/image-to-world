import { randomInt } from "node:crypto";
import { atlasReview } from "../../../core/atlas-review";
import { sceneChange, editSceneChange } from "./activity-scene";
import type { Activity } from "../../../core/activity";
import { createHash } from "node:crypto";
import {
  canonical,
  checkPreconditions,
  commandContextSchema,
  CommandConflict,
  type CommandContext,
} from "../../../core/command-context";
import { operationName, activityTargets } from "../../../core/activity";
import { moveAssetsToTrash, revealAsset } from "./asset-files";
import { applyCommand, isNavigation } from "../../../core/commands";
import { atlasPairCaption, generationInput } from "../../../core/generation";
import { frameAssets, frameAt } from "../../../core/frames";
import {
  commandSchema,
  type Command,
  type CommandResult,
} from "../../../core/schema";
import type { JobRunner } from "./jobs";
import type { WorkspaceStore } from "./store";
import { captureFrame } from "../../../core/captures";
import { integrateAssets, integrateFrames } from "./integration";
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
  private async submissionId(command: Command, requestId: string) {
    const request =
      command.type === "generation.submit"
        ? command.request
        : command.type === "jobs.submit"
          ? command.input
          : undefined;
    if (
      !request ||
      !(request.kind === "model" || request.kind === "fal") ||
      !request.buildKey
    )
      return `job_${/^[a-zA-Z0-9_-]+$/.test(requestId) ? requestId : createHash("sha256").update(requestId).digest("hex")}`;
    // One reservation across actors and receipt IDs, durable in the job table.
    const id = `build_${createHash("sha256").update(request.buildKey).digest("hex")}`;
    const existing =
      this.store.current.jobs[id] && (await this.store.loadJob(id)).input;
    if (
      existing &&
      canonical(existing) !== canonical({ ...request, kind: "fal" })
    )
      throw new CommandConflict([
        `Build "${request.buildKey}" already has different inputs; choose a new key for a variant`,
      ]);
    return id;
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
    if (isNavigation(command))
      return this.store.navigate(command, context, body);
    const jobCommand =
      command.type === "generation.submit" || command.type.startsWith("jobs.");
    const previous = await this.store.commandReceipt(context.requestId);
    if (previous) {
      if (previous.body !== body)
        throw new Error("Request ID was already used for another command");
      if (!previous.result) {
        const jobId = await this.submissionId(command, context.requestId);
        if (
          ["generation.submit", "jobs.submit"].includes(command.type) &&
          this.store.current.jobs[jobId]
        ) {
          const result = {
            revision: this.store.revision,
            jobId,
            ...(command.type === "generation.submit" &&
            command.request.kind === "view.pair"
              ? { jobIds: [jobId, `atlas_choice_${jobId}`] }
              : {}),
          };
          await this.store.saveJobReceipt(context.requestId, { body, result });
          return result;
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
    const before = this.store.current;
    try {
      if (command.type === "environment.configure") {
        const result = await this.perform(command, context);
        this.store.recordActivity({ ...activity, phase: "succeeded" });
        return result;
      }
      if (command.type === "atlas.review") {
        const result = await this.reviewRound(command, context, body);
        this.store.recordActivity({
          ...activity,
          phase: "succeeded",
          nodeIds: result.nodeIds,
          sceneChange: sceneChange(
            result.nodeIds ?? [],
            this.store.current.nodes,
          ),
        });
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
        let change: Activity["sceneChange"];
        const result = await this.store.updateScene((state) => {
          checkPreconditions(state, context);
          const nodes = new Set(Object.keys(state.nodes));
          const beforeNodes = state.nodes;
          const historyEdit =
            command.type === "history.undo" || command.type === "history.redo"
              ? state[
                  command.type === "history.undo" ? "undo" : "redo"
                ].findLast((edit) => edit.scope === command.assetId)
              : undefined;
          const lastEdit = state.undo.at(-1)?.id;
          applyCommand(state, command, {
            preserveSelection: !context.interactive,
          });
          const edit = state.undo.at(-1);
          const editId =
            !historyEdit && edit?.id !== lastEdit ? edit?.id : undefined;
          change = editSceneChange(
            historyEdit ?? (editId ? edit : undefined),
            state.nodes,
            beforeNodes,
          );
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
            ...new Set([
              ...activity.nodeIds,
              ...(result.nodeIds ?? []),
              ...(change?.nodeIds ?? []),
            ]),
          ],
          sceneChange: change,
          phase: "succeeded",
        });
        return result;
      }
      if (jobCommand) {
        checkPreconditions(this.store.current, context);
        await this.store.saveJobReceipt(context.requestId, {
          body,
          result: null,
        });
      } else
        await this.store.updateScene((state) => {
          checkPreconditions(state, context);
          state.receipts[context.requestId!] = { body, result: null };
        });
      const result = await this.perform(command, context);
      const after = this.store.current;
      if (
        result.jobId &&
        ["generation.submit", "jobs.submit"].includes(command.type)
      ) {
        const input = after.jobs[result.jobId]?.input;
        result.nodeIds =
          input && (input.kind === "image" || input.kind === "pose")
            ? input.nodeIds
            : [];
      } else if (!result.nodeIds)
        result.nodeIds = Object.keys(after.nodes).filter(
          (id) => !before.nodes[id],
        );
      const edit = after.undo.at(-1);
      if (
        command.type !== "assets.place" &&
        edit &&
        edit.id !== before.undo.at(-1)?.id
      )
        result.editId = edit.id;
      if (!jobCommand || result.editId)
        await this.store.updateScene((state) => {
          result.revision = state.revision + 1;
          if (!jobCommand)
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
      if (jobCommand)
        await this.store.saveJobReceipt(context.requestId, { body, result });
      this.store.recordActivity({
        ...activity,
        nodeIds: [...new Set([...activity.nodeIds, ...(result.nodeIds ?? [])])],
        sceneChange:
          command.type === "assets.place" || command.type === "frames.integrate"
            ? sceneChange(result.nodeIds ?? [], after.nodes)
            : undefined,
        jobId: result.jobId,
        phase: result.jobId
          ? this.store.current.jobs[result.jobId].status
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
  private reviewRound(
    command: Extract<Command, { type: "atlas.review" }>,
    context: CommandContext,
    body: string,
  ) {
    if (!context.interactive)
      throw new Error("Choose or discard the comparison in the editor");
    return this.store.updateScene((state) => {
      checkPreconditions(state, context);
      const review = atlasReview(state);
      if (!review || review.id !== command.id || review.decision)
        throw new Error("This Atlas comparison is no longer open");
      const round = state.atlasRound!;
      const result: CommandResult = {
        revision: state.revision + 1,
        nodeIds: [],
      };
      if (command.decision.kind === "discard")
        round.decision = { kind: "discard" };
      else {
        const jobId = command.decision.jobId;
        const candidate = review.candidates.find((c) => c.id === jobId);
        if (review.phase !== "review" || !candidate?.assetId)
          throw new Error(
            "Wait for two posed results and choose a view from this comparison",
          );
        const nodeIds = integrateFrames(
          state,
          [candidate.assetId],
          undefined,
          jobId,
          review.caption.slice(0, 80),
        );
        const frameId = nodeIds[0];
        if (!frameId) throw new Error("The chosen Atlas view cannot be placed");
        captureFrame(state, frameId);
        state.atlasRound!.decision = { kind: "keep", jobId, frameId };
        const settings = state.settings;
        if (round.updateCaption) {
          if (settings.prompt !== round.caption) {
            settings.prompt = round.caption;
            settings.enhancedCaption = null;
            settings.captionEpoch = (settings.captionEpoch ?? 0) + 1;
          }
          const enhanced = state.jobs[jobId].enhancedViewCaption;
          if (enhanced)
            settings.enhancedCaption = {
              prompt: round.caption,
              text: enhanced,
            };
        }
        const edit = state.undo.at(-1)!;
        Object.assign(edit, {
          actorId: context.actorId,
          requestId: context.requestId,
        });
        Object.assign(result, { nodeIds, editId: edit.id });
      }
      state.receipts[context.requestId!] = { body, result };
      return result;
    });
  }

  private async perform(
    command: ReturnType<typeof commandSchema.parse>,
    context: CommandContext,
  ): Promise<CommandResult> {
    this.store.reportOperation(operationName(command));
    let jobId: string | undefined;
    switch (command.type) {
      case "caption.clear":
        await this.store.updateScene((state) => {
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
        const id = await this.submissionId(command, context.requestId!);
        if (request.kind === "view.pair") {
          const alternative = `atlas_choice_${id}`;
          const workspace = this.store.current;
          await this.jobs.submit(
            generationInput(workspace, {
              ...request,
              seed: request.seed ?? randomInt(2147483647),
            }),
            id,
            undefined,
            context,
            {
              jobId: alternative,
              caption: atlasPairCaption(workspace, request.prompt),
              updateCaption: request.prompt !== undefined,
            },
          );
          return {
            revision: this.store.revision,
            jobId: id,
            jobIds: [id, alternative],
          };
        }
        jobId = await this.jobs.submit(
          generationInput(this.store.current, request),
          id,
          undefined,
          context,
        );
        if (
          request.kind === "view" &&
          request.seed === undefined &&
          this.store.current.settings.seedMode === "auto"
        )
          await this.store.updateScene((state) => {
            state.settings.seed += 1;
          });
        break;
      }
      case "jobs.submit":
        jobId = await this.jobs.submit(
          command.input,
          await this.submissionId(command, context.requestId!),
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
      case "assets.place": {
        const placement = await this.jobs.place(
          command.assetIds,
          command.camera,
          command,
          command.mode,
          context,
        );
        return { revision: this.store.current.revision, ...placement };
      }
      case "frames.integrate": {
        const snapshot = this.store.current,
          job = snapshot.jobs[command.jobId];
        if (!job || job.status !== "succeeded")
          throw new Error("Choose a completed generation");
        if (job.choiceRoundId)
          throw new Error(
            "Keep this Atlas view from its comparison in the editor",
          );
        const frames = frameAssets(snapshot, job);
        const selected =
          command.indices?.map((index) => frameAt(snapshot, job, index)) ??
          frames;
        if (!selected.length || selected.some((asset) => !asset))
          throw new Error("Choose valid frame indices");
        const nodeIds = await integrateAssets(
          this.store,
          selected.map((asset) => asset!.id),
        );
        return { revision: this.store.current.revision, nodeIds };
      }
      default:
        await this.store.updateScene((state) => {
          checkPreconditions(state, context);
          applyCommand(state, command, {
            preserveSelection: !context.interactive,
          });
        });
    }
    return {
      revision: this.store.current.revision,
      ...(jobId ? { jobId } : {}),
    };
  }
}
