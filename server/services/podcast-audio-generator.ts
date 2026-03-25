import { textToSpeech } from "../replit_integrations/audio/client";
import { objectStorageClient } from "../replit_integrations/object_storage/objectStorage";
import { storage } from "../storage";
import { generatePodcastScript, type PodcastLine } from "./podcast-script-generator";
import type { BriefingData } from "./intelligence-briefing-service";
import { spawn } from "child_process";
import { Buffer } from "node:buffer";

const VOICE_A: "echo" = "echo";
const VOICE_B: "nova" = "nova";
const SILENCE_GAP_MS = 400;

function generateSilenceMp3(durationMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const durationSec = durationMs / 1000;
    const ffmpeg = spawn("ffmpeg", [
      "-f", "lavfi",
      "-i", `anullsrc=r=24000:cl=mono`,
      "-t", String(durationSec),
      "-c:a", "libmp3lame",
      "-b:a", "64k",
      "-f", "mp3",
      "pipe:1",
    ]);

    const chunks: Buffer[] = [];
    ffmpeg.stdout.on("data", (chunk) => chunks.push(chunk));
    ffmpeg.stderr.on("data", () => {});
    ffmpeg.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg silence gen exited with code ${code}`));
    });
    ffmpeg.on("error", reject);
  });
}

function simpleConcatenate(buffers: Buffer[]): Buffer {
  return Buffer.concat(buffers);
}

async function renderLine(line: PodcastLine): Promise<Buffer> {
  const voice = line.speaker === "A" ? VOICE_A : VOICE_B;
  return textToSpeech(line.text, voice, "mp3");
}

export async function generatePodcastAudio(
  briefingId: string,
  briefingData: BriefingData,
): Promise<string> {
  await storage.updateIntelligenceBriefing(briefingId, {
    podcastStatus: "generating",
  });

  try {
    const script = generatePodcastScript(briefingData);
    console.log(`[Podcast] Generating audio for briefing ${briefingId}: ${script.lines.length} lines, ~${script.estimatedDurationMinutes} min`);

    let silenceBuffer: Buffer;
    try {
      silenceBuffer = await generateSilenceMp3(SILENCE_GAP_MS);
    } catch {
      silenceBuffer = Buffer.alloc(0);
    }

    const audioSegments: Buffer[] = [];
    const BATCH_SIZE = 3;
    for (let i = 0; i < script.lines.length; i += BATCH_SIZE) {
      const batch = script.lines.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(batch.map(renderLine));
      for (const segment of batchResults) {
        audioSegments.push(segment);
        if (silenceBuffer.length > 0) {
          audioSegments.push(silenceBuffer);
        }
      }
    }

    const finalMp3 = simpleConcatenate(audioSegments);
    console.log(`[Podcast] Generated ${(finalMp3.length / 1024 / 1024).toFixed(2)} MB of audio`);

    const privateDir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!privateDir) {
      throw new Error("PRIVATE_OBJECT_DIR not configured for object storage");
    }

    const objectPath = `${privateDir}/podcasts/${briefingId}.mp3`;
    const parts = objectPath.startsWith("/") ? objectPath.slice(1).split("/") : objectPath.split("/");
    const bucketName = parts[0];
    const objectName = parts.slice(1).join("/");

    const bucket = objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectName);
    await file.save(finalMp3, {
      metadata: {
        contentType: "audio/mpeg",
        metadata: {
          briefingId,
          generatedAt: new Date().toISOString(),
        },
      },
    });

    const audioUrl = `/api/intelligence-briefings/${briefingId}/podcast-audio`;

    await storage.updateIntelligenceBriefing(briefingId, {
      podcastStatus: "ready",
      podcastAudioUrl: audioUrl,
    });

    console.log(`[Podcast] Audio ready for briefing ${briefingId}`);
    return audioUrl;
  } catch (error: any) {
    console.error(`[Podcast] Audio generation failed for briefing ${briefingId}:`, error);
    await storage.updateIntelligenceBriefing(briefingId, {
      podcastStatus: "failed",
    });
    throw error;
  }
}

export async function getPodcastAudioBuffer(briefingId: string): Promise<Buffer | null> {
  const privateDir = process.env.PRIVATE_OBJECT_DIR || "";
  if (!privateDir) return null;

  const objectPath = `${privateDir}/podcasts/${briefingId}.mp3`;
  const parts = objectPath.startsWith("/") ? objectPath.slice(1).split("/") : objectPath.split("/");
  const bucketName = parts[0];
  const objectName = parts.slice(1).join("/");

  try {
    const bucket = objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectName);
    const [exists] = await file.exists();
    if (!exists) return null;
    const [buffer] = await file.download();
    return buffer;
  } catch {
    return null;
  }
}
