import * as fs from 'node:fs/promises';
import { openAsBlob } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { StatusCodes } from 'http-status-codes';
import { AppError } from '@shared/errors/app.error';
import { env } from '@config/env';

const execFileAsync = promisify(execFile);

// Formats the Fast Transcription API accepts directly — no conversion needed
const FAST_TRANSCRIPTION_SUPPORTED_MIME_TYPES = new Set([
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/mp4',
  'audio/x-m4a',
  'audio/m4a',
  'audio/flac',
  'audio/ogg',
  'audio/webm',
]);

// Formats that are already WAV — skip ffmpeg conversion
const WAV_MIME_TYPES = new Set(['audio/wav', 'audio/x-wav', 'audio/wave']);

const FAST_TRANSCRIPTION_API_VERSION = '2025-10-15';
const DEFAULT_TIMEOUT_MS = 120_000; // 2 minutes

interface IFastTranscriptionResponse {
  combinedPhrases?: Array<{ text?: string }>;
  phrases?: Array<{
    text?: string;
    offsetMilliseconds?: number;
    durationMilliseconds?: number;
  }>;
}

export interface IAudioTranscriptionResult {
  transcript: string;
  segments: Array<{ text: string; startMs: number; endMs: number }>;
}

export class AzureSpeechService {
  public async transcribeBuffer(
    audioBuffer: Buffer,
    mimeType: string,
    fileName = 'audio',
  ): Promise<string> {
    const result = await this.transcribe(audioBuffer, mimeType, fileName);
    return result.transcript;
  }

  /**
   * Transcribes an audio or video file directly from disk using streaming (openAsBlob).
   * Holds zero audio/video buffers in Node.js RAM, keeping memory usage constant (~0 MB)
   * even for massive files (e.g. 500MB+ video or multi-hour WAV).
   */
  public async transcribeFile(
    filePath: string,
    mimeType: string,
    fileName = 'audio',
  ): Promise<string> {
    const { key, region, endpoint } = env.speech;
    if (!key) {
      throw new AppError(
        'AZURE_SPEECH_KEY is required for transcription.',
        StatusCodes.INTERNAL_SERVER_ERROR,
      );
    }

    let targetFilePath = filePath;
    let targetMimeType = mimeType;
    let tempDir: string | null = null;

    if (!FAST_TRANSCRIPTION_SUPPORTED_MIME_TYPES.has(mimeType) && !WAV_MIME_TYPES.has(mimeType)) {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gfs-audio-'));
      const tempWavPath = path.join(tempDir, 'output.wav');
      try {
        await execFileAsync('ffmpeg', [
          '-y', '-i', filePath,
          '-vn',
          '-ac', '1',
          '-ar', '16000',
          '-f', 'wav',
          tempWavPath,
        ]);
        targetFilePath = tempWavPath;
        targetMimeType = 'audio/wav';
      } catch (error) {
        if (tempDir) await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
        const msg = error instanceof Error ? error.message : 'Audio conversion failed';
        throw new AppError(msg, StatusCodes.UNPROCESSABLE_ENTITY);
      }
    }

    try {
      const audioBlob = await openAsBlob(targetFilePath, { type: targetMimeType });
      const response = await this.submitFastTranscriptionBlob(
        audioBlob,
        fileName,
        key,
        region,
        endpoint,
      );
      return this.extractTranscript(response);
    } finally {
      if (tempDir) {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  public async transcribe(
    audioBuffer: Buffer,
    mimeType: string,
    fileName = 'audio',
  ): Promise<IAudioTranscriptionResult> {
    const { key, region, endpoint } = env.speech;
    if (!key) {
      throw new AppError(
        'AZURE_SPEECH_KEY is required for transcription.',
        StatusCodes.INTERNAL_SERVER_ERROR,
      );
    }

    const preparedAudio = await this.prepareAudio(audioBuffer, mimeType, fileName);
    const response = await this.submitFastTranscription(preparedAudio, key, region, endpoint);

    const transcript = this.extractTranscript(response);
    return {
      transcript,
      segments: this.extractSegments(response, transcript),
    };
  }

  // Converts unsupported formats to WAV via ffmpeg (only triggered for unsupported types)
  private async prepareAudio(
    buffer: Buffer,
    mimeType: string,
    fileName: string,
  ): Promise<{ buffer: Buffer; mimeType: string; fileName: string }> {
    if (FAST_TRANSCRIPTION_SUPPORTED_MIME_TYPES.has(mimeType)) {
      return { buffer, mimeType, fileName };
    }

    if (WAV_MIME_TYPES.has(mimeType)) {
      return { buffer, mimeType: 'audio/wav', fileName };
    }

    // Fallback: convert to WAV via ffmpeg (must be installed on system or via ffmpeg-static)
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gfs-audio-'));
    const ext = path.extname(fileName) || '.audio';
    const inputPath = path.join(tempDir, `input${ext}`);
    const outputPath = path.join(tempDir, 'output.wav');

    try {
      await fs.writeFile(inputPath, buffer);
      await execFileAsync('ffmpeg', [
        '-y', '-i', inputPath,
        '-ac', '1',
        '-ar', '16000',
        '-f', 'wav',
        outputPath,
      ]);
      const converted = await fs.readFile(outputPath);
      return { buffer: converted, mimeType: 'audio/wav', fileName: 'output.wav' };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Audio conversion failed';
      throw new AppError(msg, StatusCodes.UNPROCESSABLE_ENTITY);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  private async submitFastTranscriptionBlob(
    audioBlob: Blob,
    fileName: string,
    key: string,
    region: string,
    endpoint: string,
  ): Promise<IFastTranscriptionResponse> {
    const apiEndpoint = this.resolveEndpoint(region, endpoint);

    const form = new FormData();
    form.set('audio', audioBlob, fileName);
    form.set('definition', JSON.stringify({ locales: ['en-US'] }));

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Ocp-Apim-Subscription-Key': key },
        body: form,
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new AppError(
          `Azure Speech transcription failed (${response.status}): ${errorText}`,
          response.status >= 500 ? StatusCodes.BAD_GATEWAY : StatusCodes.BAD_REQUEST,
        );
      }

      return await response.json() as IFastTranscriptionResponse;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new AppError(
          `Azure Speech transcription timed out after ${DEFAULT_TIMEOUT_MS}ms.`,
          StatusCodes.GATEWAY_TIMEOUT,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async submitFastTranscription(
    audio: { buffer: Buffer; mimeType: string; fileName: string },
    key: string,
    region: string,
    endpoint: string,
  ): Promise<IFastTranscriptionResponse> {
    const blob = new Blob([new Uint8Array(audio.buffer)], { type: audio.mimeType });
    return this.submitFastTranscriptionBlob(blob, audio.fileName, key, region, endpoint);
  }

  private resolveEndpoint(region: string, endpoint: string): string {
    if (endpoint) {
      const url = new URL(endpoint);
      url.protocol = 'https:';
      url.pathname = '/speechtotext/transcriptions:transcribe';
      url.search = `api-version=${FAST_TRANSCRIPTION_API_VERSION}`;
      return url.toString();
    }

    if (!region) {
      throw new AppError(
        'Either AZURE_SPEECH_ENDPOINT or AZURE_SPEECH_REGION must be set.',
        StatusCodes.INTERNAL_SERVER_ERROR,
      );
    }

    return `https://${region}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=${FAST_TRANSCRIPTION_API_VERSION}`;
  }

  private extractTranscript(response: IFastTranscriptionResponse): string {
    const combined = response.combinedPhrases
      ?.map((p) => p.text?.trim() ?? '')
      .filter((t) => t.length > 0)
      .join(' ')
      .trim();

    if (combined && combined.length > 0) return combined;

    return (
      response.phrases
        ?.map((p) => p.text?.trim() ?? '')
        .filter((t) => t.length > 0)
        .join(' ')
        .trim() ?? ''
    );
  }

  private extractSegments(
    response: IFastTranscriptionResponse,
    transcript: string,
  ): IAudioTranscriptionResult['segments'] {
    const segments = response.phrases
      ?.map((p) => {
        const text = p.text?.trim() ?? '';
        if (!text) return null;
        const startMs = p.offsetMilliseconds ?? 0;
        const durationMs = p.durationMilliseconds ?? 0;
        return { text, startMs, endMs: startMs + durationMs };
      })
      .filter((s): s is NonNullable<typeof s> => Boolean(s));

    if (segments && segments.length > 0) return segments;
    return transcript.length > 0 ? [{ text: transcript, startMs: 0, endMs: 0 }] : [];
  }
}

export const azureSpeechService = new AzureSpeechService();
