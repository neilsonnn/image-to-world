import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import type { Asset } from "../../../core/schema";
import type { WorkspaceStore } from "./store";
import { environmentValue } from "./environment";
export const ffmpegPath = () =>
  Bun.which(environmentValue("FFMPEG_PATH") || "ffmpeg");
export async function encodeVideo(
  store: WorkspaceStore,
  frames: Asset[],
  fps: number,
  jobId: string,
  signal: AbortSignal,
) {
  const executable = ffmpegPath();
  if (!executable)
    throw new Error("Install FFmpeg or set FFMPEG_PATH to encode videos");
  const temporaryRoot = path.join(store.root, ".render");
  await mkdir(temporaryRoot, { recursive: true });
  const temporary = await mkdtemp(path.join(temporaryRoot, "video-"));
  try {
    for (let i = 0; i < frames.length; i++) {
      signal.throwIfAborted();
      const { file } = await store.assetFile(frames[i].id);
      await Bun.write(
        path.join(temporary, `frame-${String(i).padStart(6, "0")}.png`),
        Bun.file(file),
      );
    }
    const output = path.join(temporary, "video.mp4");
    const process = Bun.spawn(
      [
        executable,
        "-hide_banner",
        "-loglevel",
        "error",
        "-framerate",
        String(fps),
        "-i",
        path.join(temporary, "frame-%06d.png"),
        "-vf",
        "pad=ceil(iw/2)*2:ceil(ih/2)*2",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        output,
      ],
      { stdout: "ignore", stderr: "pipe" },
    );
    const abort = () => process.kill();
    signal.addEventListener("abort", abort, { once: true });
    try {
      const [status, error] = await Promise.all([
        process.exited,
        new Response(process.stderr).text(),
      ]);
      signal.throwIfAborted();
      if (status !== 0) throw new Error(`FFmpeg failed: ${error.slice(-2000)}`);
      return await store.importFile(Bun.file(output), `${jobId}.mp4`, {
        jobId,
      });
    } finally {
      signal.removeEventListener("abort", abort);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function extractVideoFrames(
  store: WorkspaceStore,
  videoAssetId: string,
  fps: number,
  maxFrames: number,
  jobId: string,
  signal: AbortSignal,
) {
  const { asset, file } = await store.assetFile(videoAssetId);
  if (asset.kind !== "video") throw new Error("Choose a video asset");
  const ffmpeg = ffmpegPath();
  const ffprobe = Bun.which(environmentValue("FFPROBE_PATH") || "ffprobe");
  if (!ffmpeg || !ffprobe)
    throw new Error("Install FFmpeg and ffprobe to reconstruct video");
  const run = async (args: string[]) => {
    signal.throwIfAborted();
    const child = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
    const abort = () => child.kill();
    signal.addEventListener("abort", abort, { once: true });
    try {
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      signal.throwIfAborted();
      if (code)
        throw new Error(`Video decoding failed: ${stderr.slice(-2000)}`);
      return stdout;
    } finally {
      signal.removeEventListener("abort", abort);
    }
  };
  const info = JSON.parse(
    await run([
      ffprobe,
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "json",
      file,
    ]),
  );
  const duration = Number(info.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0)
    throw new Error("Video duration is unavailable");
  const sampleFps = Math.min(fps, maxFrames / duration);
  const temporaryRoot = path.join(store.root, ".render");
  await mkdir(temporaryRoot, { recursive: true });
  const temporary = await mkdtemp(path.join(temporaryRoot, "frames-"));
  try {
    await run([
      ffmpeg,
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      file,
      "-vf",
      `fps=${sampleFps}`,
      "-frames:v",
      String(maxFrames),
      path.join(temporary, "%06d.png"),
    ]);
    const { readdir } = await import("node:fs/promises");
    const files = (await readdir(temporary))
      .filter((name) => name.endsWith(".png"))
      .sort();
    if (!files.length) throw new Error("Video contains no decodable frames");
    const assets: Asset[] = [];
    for (let i = 0; i < files.length; i++) {
      signal.throwIfAborted();
      const existing = Object.values(store.snapshot().assets).find(
        (a) =>
          a.jobId === jobId &&
          a.sourceVideoId === videoAssetId &&
          a.frameIndex === i,
      );
      assets.push(
        existing ??
          (await store.importFile(
            Bun.file(path.join(temporary, files[i])),
            `${jobId}-input-${i}.png`,
            {
              jobId,
              sourceVideoId: videoAssetId,
              frameIndex: i,
              frameTime: i / sampleFps,
              name: `${asset.name} · ${(i / sampleFps).toFixed(2)}s`,
            },
          )),
      );
    }
    return assets;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
