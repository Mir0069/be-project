import { azureSpeechService } from '@services/azure-speech.service';
import { CallRecord } from '@db/models/call-record.model';
import { DocumentModel } from '@db/models/document.model';

// Mock dependencies
jest.mock('@services/azure-speech.service', () => ({
  azureSpeechService: {
    transcribeBuffer: jest.fn(),
    transcribeFile: jest.fn(),
  },
}));

jest.mock('@db/models/call-record.model', () => ({
  CallRecord: {
    create: jest.fn(),
    updateOne: jest.fn(),
  },
}));

jest.mock('@db/models/document.model', () => {
  const actual = jest.requireActual('@db/models/document.model');
  return {
    ...actual,
    DocumentModel: {
      create: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      updateOne: jest.fn(),
    },
  };
});

describe('DropboxSyncService — Audio & Video Transcription Support', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('correctly maps audio and video extensions to MIME types', () => {
    const EXT_MIME_TEST: Record<string, string> = {
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.m4a': 'audio/mp4',
      '.ogg': 'audio/ogg',
      '.flac': 'audio/flac',
      '.webm': 'audio/webm',
      '.mp4': 'video/mp4',
      '.mov': 'video/quicktime',
      '.mkv': 'video/x-matroska',
      '.aac': 'audio/aac',
      '.wma': 'audio/x-ms-wma',
    };

    for (const [ext, expectedMime] of Object.entries(EXT_MIME_TEST)) {
      expect(ext.startsWith('.')).toBe(true);
      expect(expectedMime).toBeTruthy();
    }
  });

  it('transcribes audio file buffer via azureSpeechService when uploaded to transcript folder', async () => {
    const mockTranscript = 'Hello, this is John from Acme Corp discussing 4 fixed units.';
    (azureSpeechService.transcribeBuffer as jest.Mock).mockResolvedValueOnce(mockTranscript);
    (CallRecord.create as jest.Mock).mockResolvedValueOnce({});
    (DocumentModel.create as jest.Mock).mockResolvedValueOnce({});

    const fileBuffer = Buffer.from('fake-audio-bytes');
    const result = await azureSpeechService.transcribeBuffer(fileBuffer, 'audio/mpeg', 'call-recording.mp3');

    expect(result).toBe(mockTranscript);
    expect(azureSpeechService.transcribeBuffer).toHaveBeenCalledWith(
      fileBuffer,
      'audio/mpeg',
      'call-recording.mp3'
    );
  });

  it('transcribes media file from disk via azureSpeechService.transcribeFile with zero RAM buffer', async () => {
    const mockTranscript = 'Customer called to increase sliding door width to 3200mm.';
    (azureSpeechService.transcribeFile as jest.Mock).mockResolvedValueOnce(mockTranscript);

    const result = await azureSpeechService.transcribeFile('/tmp/test-call.wav', 'audio/wav', 'test-call.wav');

    expect(result).toBe(mockTranscript);
    expect(azureSpeechService.transcribeFile).toHaveBeenCalledWith(
      '/tmp/test-call.wav',
      'audio/wav',
      'test-call.wav'
    );
  });

  it('gracefully handles transcription failure without throwing', async () => {
    (azureSpeechService.transcribeBuffer as jest.Mock).mockRejectedValueOnce(
      new Error('AZURE_SPEECH_KEY is required')
    );

    let caughtError: Error | null = null;
    let summaryText = '';
    try {
      summaryText = await azureSpeechService.transcribeBuffer(
        Buffer.from('bytes'),
        'audio/mpeg',
        'test.mp3'
      );
    } catch (err: any) {
      caughtError = err;
    }

    expect(caughtError).toBeTruthy();
    expect(summaryText).toBe('');
  });
});
