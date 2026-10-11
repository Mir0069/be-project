import path from 'path';

import unzipper from 'unzipper';

/**
 * Streams a ZIP archive and invokes `onFile` for every non-directory entry,
 * recursing into nested `.zip` entries. Constant memory: one entry is processed
 * at a time and never buffered whole. A per-file failure is isolated so one bad
 * entry cannot abort the rest of the archive.
 */
export async function processZipStream(
  inputStream: NodeJS.ReadableStream,
  onFile: (fileName: string, fileStream: NodeJS.ReadableStream) => Promise<void>,
): Promise<void> {
  const zipParser = inputStream.pipe(unzipper.Parse({ forceStream: true }));

  const extractEntry = async (entry: any): Promise<void> => {
    const fileName = path.basename(entry.path);

    if (entry.type === 'Directory') {
      entry.autodrain();
      return;
    }

    if (fileName.toLowerCase().endsWith('.zip')) {
      const nestedParser = entry.pipe(unzipper.Parse({ forceStream: true }));
      for await (const nestedEntry of nestedParser) {
        await extractEntry(nestedEntry);
      }
      return;
    }

    try {
      await onFile(fileName, entry);
    } catch (err) {
      entry.autodrain();
      console.error(`[processZipStream] failed on ${fileName}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  for await (const entry of zipParser) {
    await extractEntry(entry);
  }
}
