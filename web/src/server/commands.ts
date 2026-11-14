import { operationName } from "../../../core/activity";
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
  async execute(input: Command): Promise<CommandResult> {
    const command = commandSchema.parse(input);
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
        jobId = await this.jobs.submit(command.input);
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
        await this.store.update((state) => applyCommand(state, command));
    }
    return {
      revision: this.store.snapshot().revision,
      ...(jobId ? { jobId } : {}),
      ...(jobIds ? { jobIds } : {}),
    };
  }
}
