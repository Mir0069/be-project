# Developer Guide: Reuse of Streaming Zip Ingestion as a Shared Utility

This document outlines how other engineering teams can reuse the streaming folder download and recursive ZIP extraction utilities in the GFS-backend codebase.

---

## 1. Streaming ZIP Extraction Utility

If you have a live network stream of a ZIP archive and want to extract files on-the-fly with a **constant memory footprint (15-20MB RAM, 0MB disk)**, you can reuse the streaming parser pattern.

### Quick Integration Example

```typescript
import path from 'path';
import unzipper from 'unzipper';

/**
 * Extracts and processes files from a zip stream.
 * Handles nested .zip archives recursively.
 */
export async function processZipStream(
  inputStream: NodeJS.ReadableStream,
  onFile: (fileName: string, fileStream: NodeJS.ReadableStream) => Promise<void>
): Promise<void> {
  const zipParser = inputStream.pipe(unzipper.Parse({ forceStream: true }));

  const extractEntry = async (entry: any) => {
    const fileName = path.basename(entry.path);

    // Skip directories
    if (entry.type === 'Directory') {
      entry.autodrain();
      return;
    }

    // Recursive unzipping for nested zip files
    if (fileName.toLowerCase().endsWith('.zip')) {
      try {
        const nestedParser = entry.pipe(unzipper.Parse({ forceStream: true }));
        for await (const nestedEntry of nestedParser) {
          await extractEntry(nestedEntry);
        }
      } catch (err: any) {
        console.error(`Failed to extract nested zip ${fileName}:`, err.message);
      }
      return;
    }

    // Process the file entry stream
    try {
      await onFile(fileName, entry);
    } catch (err: any) {
      entry.autodrain(); // Ensure the stream doesn't hang on error
      console.error(`Error processing file ${fileName}:`, err.message);
    }
  };

  for await (const entry of zipParser) {
    await extractEntry(entry);
  }
}
```

---

## 2. Cloud Storage Downloader Utilities

We have built-in utilities to resolve shared folder/file links into readable streams. You can import these functions from `@shared/utils/graph` and `@shared/utils/dropbox`.

### A. SharePoint / OneDrive Downloader
Reuses the Microsoft Graph API to download files or folders using a base64-encoded share ID.

* **Import path**: `@shared/utils/graph`
* **API Details**:
  * `encodeShareUrl(url: string)`: Encodes a standard web share link into the MS Graph share ID format (`u!...`).
  * `fetchGraphShareItem(graphClient, shareId)`: Retrieves item metadata (detects if it is a file or folder).
  * `getGraphShareFileStream(graphClient, shareId)`: Retrieves a live Node.js download stream of the folder (ZIP format) or file.

```typescript
import { encodeShareUrl, fetchGraphShareItem, getGraphShareFileStream } from '@shared/utils/graph';

// Usage:
const shareId = encodeShareUrl('https://gfs.sharepoint.com/personal/...');
const item = await fetchGraphShareItem(graphClient, shareId);
const isFolder = !!item.folder;

const stream = await getGraphShareFileStream(graphClient, shareId);
if (isFolder) {
  // Pass to processZipStream...
} else {
  // Stage file stream directly...
}
```

### B. Dropbox Downloader
Resolves Dropbox share links via their REST content API.

* **Import path**: `@shared/utils/dropbox`
* **API Details**:
  * `getDropboxAccessToken(config)`: Obtains or refreshes short-lived OAuth2 tokens.
  * `fetchDropboxMetadata(url, token)`: Retrieves metadata (detects if file or folder).
  * `getDropboxFileStream(url, token)`: Downloads the shared resource as a stream. Dropbox folders are automatically returned as a single ZIP archive stream.

```typescript
import { getDropboxAccessToken, fetchDropboxMetadata, getDropboxFileStream } from '@shared/utils/dropbox';

const token = await getDropboxAccessToken({
  clientId: process.env.DROPBOX_CLIENT_ID,
  clientSecret: process.env.DROPBOX_CLIENT_SECRET,
  refreshToken: process.env.DROPBOX_REFRESH_TOKEN
});

const metadata = await fetchDropboxMetadata(sharedUrl, token);
const isFolder = metadata['.tag'] === 'folder';

const stream = await getDropboxFileStream(sharedUrl, token);
if (isFolder) {
  // Pass to processZipStream...
} else {
  // Stage file stream directly...
}
```

---

## 3. Sandboxing & File Safety Policy

When integrating these utilities into other parts of the application, be sure to enforce file safety sandboxing rules:

1. **Extension Checking**: Validate extensions against the allowed list:
   ```typescript
   import { env } from '@config/index';
   const ext = path.extname(fileName).toLowerCase();
   if (!env.cloudLinks.supportedExtensions.includes(ext)) {
     throw new Error(`Extension ${ext} blocked by security policy`);
   }
   ```
2. **Error Isolation**: Always catch and handle errors on individual file streams to prevent a single corrupted file from crashing the entire folder extraction pipeline.
