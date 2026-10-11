/**
 * Opens an already-authorized remote file without exposing its storage URL in
 * the browser address bar. The file is loaded into memory and opened through
 * a temporary browser Object URL instead.
 */
export const openRemoteFileInNewTab = async (remoteUrl: string): Promise<void> => {
  const response = await fetch(remoteUrl);
  if (!response.ok) throw new Error(`Document preview failed with status ${response.status}`);
  openBlobInNewTab(await response.blob());
};

export const loadRemoteFileIntoWindow = async (
  remoteUrl: string,
  previewWindow: Window,
): Promise<void> => {
  const response = await fetch(remoteUrl);
  if (!response.ok) throw new Error(`Document preview failed with status ${response.status}`);
  openBlobInWindow(await response.blob(), previewWindow);
};

export type BBoxInput =
  | [number, number, number, number]
  | { x0: number; y0: number; x1: number; y1: number }
  | string
  | unknown;

export const normalizeBBox = (bboxInput: unknown): [number, number, number, number] | null => {
  if (!bboxInput) return null;
  if (Array.isArray(bboxInput) && bboxInput.length >= 4) {
    const parsed = bboxInput.slice(0, 4).map(Number);
    if (parsed.every(Number.isFinite)) return [parsed[0], parsed[1], parsed[2], parsed[3]];
  }
  if (typeof bboxInput === "string") {
    const trimmed = bboxInput.trim();
    if (!trimmed) return null;
    try {
      const parsedJson = JSON.parse(trimmed);
      const res = normalizeBBox(parsedJson);
      if (res) return res;
    } catch {}
    const matches = trimmed.match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g);
    if (matches && matches.length >= 4) {
      const parsed = matches.slice(0, 4).map(Number);
      if (parsed.every(Number.isFinite)) return [parsed[0], parsed[1], parsed[2], parsed[3]];
    }
  }
  if (typeof bboxInput === "object" && bboxInput !== null) {
    const b = bboxInput as any;
    const x0 = Number(b.x0 ?? b.left ?? b.minX ?? b.xmin);
    const y0 = Number(b.y0 ?? b.top ?? b.minY ?? b.ymin);
    const x1 = Number(b.x1 ?? b.right ?? b.maxX ?? b.xmax);
    const y1 = Number(b.y1 ?? b.bottom ?? b.maxY ?? b.ymax);
    if ([x0, y0, x1, y1].every(Number.isFinite)) return [x0, y0, x1, y1];
  }
  return null;
};

export interface PreviewLocationOptions {
  pageNumber?: number;
  bboxInches?: BBoxInput;
  zoomPercent?: number;
  searchText?: string;
}

const STAGED_PREVIEW_CACHE = "gfs-document-previews-v1";
const STAGED_PREVIEW_PREFIX = "staged-";

const buildPreviewSearch = (
  fileName: string,
  options?: number | PreviewLocationOptions,
): string => {
  const params = new URLSearchParams({ name: fileName || "Document" });
  const normalized = typeof options === "number" ? { pageNumber: options } : options;

  if (normalized?.pageNumber) {
    const p = Math.max(1, parseInt(String(normalized.pageNumber), 10) || 1);
    params.set("page", String(p));
  }
  if (normalized?.bboxInches) {
    const bbox = normalizeBBox(normalized.bboxInches);
    if (bbox) {
      params.set("bbox", bbox.join(","));
    }
  }
  if (normalized?.searchText && normalized.searchText.trim()) {
    params.set("search", normalized.searchText.trim());
  }
  if (normalized?.zoomPercent) {
    params.set("zoom", String(normalized.zoomPercent));
  } else if (normalized?.bboxInches || normalized?.searchText) {
    params.set("zoom", "150");
  }

  return params.toString();
};

/** Opens a persisted project document in the shared, authenticated viewer. */
export const openDocumentPreview = (
  documentId: string,
  fileName: string,
  options?: number | PreviewLocationOptions,
): Window | null => {
  const previewWindow = window.open(
    `/preview/${encodeURIComponent(documentId)}?${buildPreviewSearch(fileName, options)}`,
    "_blank",
  );
  if (previewWindow) previewWindow.opener = null;
  return previewWindow;
};

/**
 * Hands an already-authorized blob to the shared viewer through a short-lived,
 * same-origin browser cache entry. This keeps draft storage keys and blob URLs
 * out of the address bar while giving every file the same preview experience.
 */
export const openStagedBlobInWindow = async (
  blob: Blob,
  previewWindow: Window,
  fileName: string,
  options?: number | PreviewLocationOptions,
): Promise<void> => {
  if (!("caches" in window)) {
    openNamedBlobInWindow(blob, previewWindow, fileName, options);
    return;
  }

  const token = crypto.randomUUID();
  const cacheKey = `${window.location.origin}/__gfs-preview/${token}`;
  const cache = await caches.open(STAGED_PREVIEW_CACHE);
  await cache.put(
    cacheKey,
    new Response(blob, {
      headers: {
        "Content-Type": blob.type || "application/octet-stream",
        "X-GFS-Preview-Created": String(Date.now()),
      },
    }),
  );
  previewWindow.opener = null;
  previewWindow.location.replace(
    `/preview/${STAGED_PREVIEW_PREFIX}${token}?${buildPreviewSearch(fileName, options)}`,
  );
};

/** Reads a short-lived staged preview without exposing its source identifiers. */
export const consumeStagedPreview = async (documentId: string): Promise<Blob | null> => {
  if (!documentId.startsWith(STAGED_PREVIEW_PREFIX) || !("caches" in window)) return null;
  const token = documentId.slice(STAGED_PREVIEW_PREFIX.length);
  const cacheKey = `${window.location.origin}/__gfs-preview/${token}`;
  const cache = await caches.open(STAGED_PREVIEW_CACHE);
  const response = await cache.match(cacheKey);
  if (!response) return null;
  // Keep the entry briefly so React StrictMode and a user reload do not turn a
  // successful preview into an error. It remains local to this browser only.
  window.setTimeout(() => void cache.delete(cacheKey), 5 * 60 * 1000);
  return response.blob();
};

export const buildPdfOpenParams = (options?: number | PreviewLocationOptions): string => {
  if (!options) return "";
  if (typeof options === "number") {
    return options > 0 ? `#page=${options}&zoom=150` : "";
  }

  const { pageNumber, bboxInches, zoomPercent = 175 } = options;
  const parts: string[] = [];

  if (pageNumber && pageNumber > 0) {
    parts.push(`page=${pageNumber}`);
  }

  if (bboxInches) {
    let x0: number, y0: number;
    if (Array.isArray(bboxInches)) {
      [x0, y0] = bboxInches;
    } else {
      x0 = bboxInches.x0;
      y0 = bboxInches.y0;
    }

    // Convert inches to PDF points (72 points = 1 inch)
    // Align viewport to the top-left of the target bounding box with a 0.25" comfort margin
    const leftPt = Math.max(0, Math.round((x0 - 0.25) * 72));
    const topPt = Math.max(0, Math.round((y0 - 0.25) * 72));

    parts.push(`zoom=${zoomPercent || 140},${leftPt},${topPt}`);
  } else if (pageNumber && zoomPercent) {
    parts.push(`zoom=${zoomPercent}`);
  }

  return parts.length > 0 ? `#${parts.join("&")}` : "";
};

export const openBlobInWindow = (
  blob: Blob,
  previewWindow: Window,
  options?: number | PreviewLocationOptions,
): void => {
  const objectUrl = URL.createObjectURL(blob);
  const hashParams = buildPdfOpenParams(options);
  const targetUrl = `${objectUrl}${hashParams}`;
  previewWindow.opener = null;
  previewWindow.location.href = targetUrl;
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60 * 60 * 1000);
};

export const openBlobInNewTab = (
  blob: Blob,
  options?: number | PreviewLocationOptions,
): void => {
  const previewWindow = window.open("", "_blank");
  if (!previewWindow) throw new Error("The browser blocked the preview window");
  openBlobInWindow(blob, previewWindow, options);
};

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (ch) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[ch] as string,
  );

/**
 * Opens a file in a new tab identified by its document name rather than a URL.
 *
 * Pointing the tab straight at an Object URL leaves a `blob:...<uuid>` string on
 * screen, which tells the user nothing. Instead we render a minimal same-origin
 * shell whose <title> is the file name and embed the file in a full-bleed frame,
 * so the tab reads "A-110 - Dimensions.png". The storage URL appears nowhere.
 */
export const openNamedBlobInWindow = (
  blob: Blob,
  previewWindow: Window,
  fileName: string,
  options?: number | PreviewLocationOptions,
): void => {
  const objectUrl = URL.createObjectURL(blob);
  const hashParams = buildPdfOpenParams(options);
  const targetUrl = `${objectUrl}${hashParams}`;
  previewWindow.opener = null;
  previewWindow.document.write(
    `<!doctype html><html><head><meta charset="utf-8">` +
      `<title>${escapeHtml(fileName)}</title>` +
      `<style>html,body{margin:0;height:100%;background:#3c3c3c}` +
      `iframe{border:0;width:100%;height:100%;display:block}</style>` +
      `</head><body><iframe src="${targetUrl}" title="${escapeHtml(fileName)}"></iframe></body></html>`,
  );
  previewWindow.document.close();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60 * 60 * 1000);
};
