import { isEmailBodyDocument } from '@features/document-ingestion/document-ingestion.types';

describe('isEmailBodyDocument', () => {
  it('recognises the explicit email-body marker', () => {
    expect(isEmailBodyDocument({
      originalName: 'message.txt',
      mimeType: 'text/plain',
      metadata: { kind: 'email-body' },
    })).toBe(true);
  });

  it('recognises legacy staged email body records', () => {
    expect(isEmailBodyDocument({
      originalName: 'email-AAMkAD123.txt',
      mimeType: 'text/plain',
      metadata: { source: 'outlook', messageId: 'AAMkAD123' },
    })).toBe(true);
  });

  it('keeps real attachments and manual text files visible', () => {
    expect(isEmailBodyDocument({
      originalName: 'lead-sheet.pdf',
      mimeType: 'application/pdf',
      metadata: { source: 'outlook', messageId: 'AAMkAD123' },
    })).toBe(false);

    expect(isEmailBodyDocument({
      originalName: 'email-notes.txt',
      mimeType: 'text/plain',
      metadata: { source: 'manual-upload' },
    })).toBe(false);
  });
});
