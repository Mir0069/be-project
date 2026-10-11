import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { previewDocument, getDownloadUrl } from "@/services/documents";
import { Loader2, Download, FileText, AlertCircle, Image as ImageIcon, FileSpreadsheet, Layers } from "lucide-react";
import { buildPdfOpenParams, consumeStagedPreview, normalizeBBox } from "@/shared/lib/filePreview";
import * as pdfjs from "pdfjs-dist";

// Configure PDF.js worker with local bundled worker and CDN fallback
try {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
} catch {
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;
}

// The slice of pdf.js's PDFPageProxy this viewer actually uses.
interface PdfPageProxy {
  getViewport: (options: { scale: number }) => { width: number; height: number };
  render: (options: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => {
    promise: Promise<void>;
    cancel: () => void;
  };
}

// Helper to extract readable text streams from legacy Word .doc binary files
const extractTextFromDocBinary = (arrayBuffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(arrayBuffer);
  let text = "";
  let inAscii = false;
  let currentWord = "";

  for (let i = 0; i < bytes.length; i++) {
    const code = bytes[i]!;
    // Printable ASCII or newline/tab
    if ((code >= 32 && code <= 126) || code === 10 || code === 13 || code === 9) {
      currentWord += String.fromCharCode(code);
      inAscii = true;
    } else {
      if (inAscii && currentWord.trim().length > 3) {
        // Filter out binary junk by keeping meaningful strings
        text += currentWord + "\n";
      }
      currentWord = "";
      inAscii = false;
    }
  }
  if (currentWord.trim().length > 3) {
    text += currentWord;
  }
  return text.trim();
};

export const DocumentPreviewPage = () => {
  const { documentId } = useParams<{ documentId: string }>();
  const [searchParams] = useSearchParams();
  const fileName = searchParams.get("name") || "Document";
  const pageNumber = searchParams.get("page") ? parseInt(searchParams.get("page")!, 10) : undefined;
  const zoom = searchParams.get("zoom") ? parseInt(searchParams.get("zoom")!, 10) : undefined;
  const bboxParam = searchParams.get("bbox");

  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [rawBlob, setRawBlob] = useState<Blob | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Word rendering state
  const [isDocxRendering, setIsDocxRendering] = useState(false);
  const docxContainerRef = useRef<HTMLDivElement>(null);

  // Excel rendering state
  const [isExcelLoading, setIsExcelLoading] = useState(false);
  const [workbook, setWorkbook] = useState<any | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState<string>("");
  const [sheetData, setSheetData] = useState<any[][]>([]);

  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  const isPdf = ext === "pdf";
  const isImage = ["png", "jpg", "jpeg", "webp", "gif", "svg", "bmp"].includes(ext);
  const isDocx = ext === "docx";
  const isDoc = ext === "doc";
  const isExcel = ["xlsx", "xls", "csv"].includes(ext);
  const isText = ["txt", "vtt", "log", "json"].includes(ext);

  useEffect(() => {
    document.title = fileName;
  }, [fileName]);

  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [pdfLoading, setPdfLoading] = useState<boolean>(false);
  const initialScale = useMemo(() => {
    if (zoom) return zoom / 100;
    if (bboxParam) return 1.5;
    return 1.25;
  }, [zoom, bboxParam]);

  const [pdfScale, setPdfScale] = useState<number>(initialScale);
  const [numPages, setNumPages] = useState<number | null>(null);
  // Which page the reader is looking at, derived from scroll position.
  const [visiblePage, setVisiblePage] = useState<number>(pageNumber || 1);
  // Unscaled page-1 dimensions, used to size placeholders so the scrollbar is
  // stable before a page has been rendered.
  const [baseSize, setBaseSize] = useState<{ width: number; height: number } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  // page -> the scale it currently holds, so a zoom invalidates it.
  const renderedPages = useRef<Map<number, number>>(new Map());
  const renderTasks = useRef<Map<number, { cancel: () => void }>>(new Map());
  const lastJumpKeyRef = useRef<string>("");

  const searchParam = searchParams.get("search") || searchParams.get("text") || searchParams.get("verbatim");

  const rawBbox = useMemo(() => {
    return normalizeBBox(bboxParam);
  }, [bboxParam]);

  const [highlightBbox, setHighlightBbox] = useState<[number, number, number, number] | null>(rawBbox);

  useEffect(() => {
    setHighlightBbox(rawBbox);
  }, [rawBbox]);

  // Automated text-layer snapping: locks onto exact verbatim text on the cited page
  useEffect(() => {
    if (!pdfDoc || !numPages || !isPdf || !searchParam?.trim()) return;
    let cancelled = false;
    const targetPage = Math.min(Math.max(pageNumber || 1, 1), numPages);

    pdfDoc.getPage(targetPage).then(async (page: any) => {
      if (cancelled) return;
      try {
        const textContent = await page.getTextContent();
        const viewport = page.getViewport({ scale: 1 });
        const pageHeightPt = viewport.height;

        const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
        const target = clean(searchParam);
        if (!target) return;

        interface ItemBox {
          str: string;
          x0: number;
          y0: number;
          x1: number;
          y1: number;
        }

        const items: ItemBox[] = [];
        for (const it of textContent.items as any[]) {
          if (!it || typeof it.str !== "string" || !it.transform) continue;
          const str = it.str;
          const h = it.height || Math.sqrt(it.transform[0] ** 2 + it.transform[1] ** 2) || 10;
          const x0 = it.transform[4] / 72;
          const y0 = (pageHeightPt - it.transform[5] - h) / 72;
          const x1 = (it.transform[4] + it.width) / 72;
          const y1 = (pageHeightPt - it.transform[5]) / 72;
          items.push({ str, x0, y0, x1, y1 });
        }

        const validItems = items.filter((it) => clean(it.str).length > 0);
        const matches: { bbox: [number, number, number, number]; score: number }[] = [];

        // 1. Check single item exact or substring match
        for (const it of validItems) {
          const itClean = clean(it.str);
          if (itClean.includes(target) || (target.length >= 4 && target.includes(itClean))) {
            const score = Math.min(itClean.length, target.length) / Math.max(itClean.length, target.length);
            matches.push({ bbox: [it.x0, it.y0, it.x1, it.y1], score });
          }
        }

        // 2. Check sliding multi-token sequence match
        for (let i = 0; i < validItems.length; i++) {
          for (let j = i + 1; j <= Math.min(i + 12, validItems.length); j++) {
            const windowItems = validItems.slice(i, j);
            const windowText = clean(windowItems.map((w) => w.str).join(""));
            if (windowText === target) {
              const x0 = Math.min(...windowItems.map((w) => w.x0));
              const y0 = Math.min(...windowItems.map((w) => w.y0));
              const x1 = Math.max(...windowItems.map((w) => w.x1));
              const y1 = Math.max(...windowItems.map((w) => w.y1));
              matches.push({ bbox: [x0, y0, x1, y1], score: 1.0 });
              break;
            } else if (windowText.includes(target)) {
              const x0 = Math.min(...windowItems.map((w) => w.x0));
              const y0 = Math.min(...windowItems.map((w) => w.y0));
              const x1 = Math.max(...windowItems.map((w) => w.x1));
              const y1 = Math.max(...windowItems.map((w) => w.y1));
              matches.push({ bbox: [x0, y0, x1, y1], score: 0.9 });
            }
          }
        }

        if (matches.length > 0) {
          const raw = normalizeBBox(bboxParam);
          // If raw bbox provided, select match nearest to raw bbox; otherwise highest score
          if (raw && matches.length > 1) {
            const rx = (raw[0] + raw[2]) / 2;
            const ry = (raw[1] + raw[3]) / 2;
            matches.sort((a, b) => {
              const da = Math.hypot((a.bbox[0] + a.bbox[2]) / 2 - rx, (a.bbox[1] + a.bbox[3]) / 2 - ry);
              const db = Math.hypot((b.bbox[0] + b.bbox[2]) / 2 - rx, (b.bbox[1] + b.bbox[3]) / 2 - ry);
              return da - db;
            });
          } else {
            matches.sort((a, b) => b.score - a.score);
          }

          const best = matches[0].bbox;
          // Apply slight padding for visual comfort (0.04" horizontal, 0.03" vertical)
          const snapped: [number, number, number, number] = [
            Math.max(0, best[0] - 0.04),
            Math.max(0, best[1] - 0.03),
            best[2] + 0.04,
            best[3] + 0.03,
          ];
          setHighlightBbox(snapped);
        }
      } catch (err) {
        console.warn("Failed to perform text-layer snapping:", err);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [pdfDoc, numPages, isPdf, searchParam, pageNumber, bboxParam]);

  useEffect(() => {
    if (!documentId) return;

    let activeObjectUrl: string | null = null;

    const fetchBlobWithFallback = async (id: string): Promise<Blob> => {
      try {
        return await previewDocument(id);
      } catch (previewErr) {
        console.warn("previewDocument failed, attempting download-url fallback:", previewErr);
        try {
          const downloadUrl = await getDownloadUrl(id, true);
          if (downloadUrl) {
            const res = await fetch(downloadUrl);
            if (res.ok) {
              return await res.blob();
            }
          }
        } catch (downloadErr) {
          console.warn("download-url fallback failed:", downloadErr);
        }
        throw previewErr;
      }
    };

    const loadBlob = documentId.startsWith("staged-")
      ? consumeStagedPreview(documentId).then((blob) => {
          if (!blob) throw new Error("The temporary preview has expired");
          return blob;
        })
      : fetchBlobWithFallback(documentId);

    loadBlob
      .then(async (blob) => {
        setRawBlob(blob);
        const objectUrl = URL.createObjectURL(blob);
        activeObjectUrl = objectUrl;

        if (isPdf) {
          setBlobUrl(objectUrl);
        } else if (isText) {
          const text = await blob.text();
          setTextContent(text);
          setBlobUrl(objectUrl);
        } else if (isDoc) {
          try {
            const buffer = await blob.arrayBuffer();
            const extracted = extractTextFromDocBinary(buffer);
            setTextContent(extracted || null);
          } catch (docErr) {
            console.error("Failed to parse .doc binary:", docErr);
          }
          setBlobUrl(objectUrl);
        } else if (isExcel) {
          setIsExcelLoading(true);
          try {
            const buffer = await blob.arrayBuffer();
            const XLSX = await import("xlsx");
            const wb = XLSX.read(buffer, { type: "array" });
            setWorkbook(wb);
            setSheetNames(wb.SheetNames);
            const firstSheet = wb.SheetNames[0] || "";
            setActiveSheet(firstSheet);
            if (firstSheet && wb.Sheets[firstSheet]) {
              const data: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[firstSheet], { header: 1 });
              setSheetData(data);
            }
          } catch (excelErr) {
            console.error("Failed to parse Excel document:", excelErr);
          } finally {
            setIsExcelLoading(false);
          }
          setBlobUrl(objectUrl);
        } else {
          setBlobUrl(objectUrl);
        }
      })
      .catch((err) => {
        console.error("Failed to load document preview:", err);
        if (err?.response?.status === 401) {
          window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
          return;
        }
        const serverMessage = err?.response?.data?.message || err?.message;
        setError(
          serverMessage && typeof serverMessage === "string" && !serverMessage.includes("Network Error")
            ? `Failed to load document preview: ${serverMessage}`
            : "Failed to load document preview. Please make sure you have permission to view this file."
        );
      });

    return () => {
      if (activeObjectUrl) {
        URL.revokeObjectURL(activeObjectUrl);
      }
    };
  }, [bboxParam, documentId, isPdf, isText, isDoc, isExcel, pageNumber, zoom]);

  // PDF.js document loader
  useEffect(() => {
    if (!rawBlob || !isPdf) return;
    setPdfLoading(true);
    rawBlob.arrayBuffer().then((buffer) => {
      const loadingTask = pdfjs.getDocument({ data: buffer });
      loadingTask.promise.then((pdf) => {
        setPdfDoc(pdf);
        setNumPages(pdf.numPages);
        setPdfLoading(false);
      }).catch((err) => {
        console.error("Error loading PDF via PDF.js:", err);
        setPdfLoading(false);
        setError("Failed to render PDF pages locally.");
      });
    }).catch((err) => {
      console.error("Failed to get array buffer of PDF:", err);
      setPdfLoading(false);
    });
  }, [rawBlob, isPdf]);

  // Page-1 geometry drives every placeholder, so the document has its full
  // height before a single page is rendered.
  useEffect(() => {
    if (!pdfDoc) return;
    let cancelled = false;
    pdfDoc
      .getPage(1)
      .then((page: PdfPageProxy) => {
        if (cancelled) return;
        const viewport = page.getViewport({ scale: 1 });
        setBaseSize({ width: viewport.width, height: viewport.height });

        // If it's a large architectural CAD blueprint (>1200px) and no explicit custom zoom was passed,
        // scale it to fit the window comfortably (0.75 - 1.0) so it doesn't blow up to 6000 pixels!
        // But if a bbox citation is present, keep the focused scale so the cited signal is clearly visible!
        if (!bboxParam && viewport.width > 1200 && (!zoom || zoom > 125)) {
          const containerWidth = containerRef.current?.clientWidth || window.innerWidth;
          const fitScale = Math.max(0.35, Math.min(1.0, (containerWidth - 64) / viewport.width));
          setPdfScale(fitScale);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pdfDoc, zoom, bboxParam]);

  const renderPdfPage = useCallback(
    async (pageNum: number) => {
      if (!pdfDoc) return;
      if (renderedPages.current.get(pageNum) === pdfScale) return;
      const canvas = pageRefs.current.get(pageNum)?.querySelector("canvas");
      if (!canvas) return;
      const context = canvas.getContext("2d");
      if (!context) return;

      // Claim the page before awaiting so a second observer callback for the
      // same page cannot start a competing render.
      renderedPages.current.set(pageNum, pdfScale);
      try {
        const page: PdfPageProxy = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: pdfScale });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        const task = page.render({ canvasContext: context, viewport });
        renderTasks.current.set(pageNum, task);
        await task.promise;
        renderTasks.current.delete(pageNum);
      } catch (err) {
        renderedPages.current.delete(pageNum);
        // Cancellation is routine: it happens on fast scrolling and on zoom.
        if ((err as { name?: string } | null)?.name !== "RenderingCancelledException") {
          console.error(`Error rendering PDF page ${pageNum}:`, err);
        }
      }
    },
    [pdfDoc, pdfScale],
  );

  // Frees a page that has scrolled well out of view. Without this a 400-page
  // drawing set would hold 400 full-size canvases in memory.
  const releasePdfPage = useCallback((pageNum: number) => {
    const task = renderTasks.current.get(pageNum);
    if (task) {
      try {
        task.cancel();
      } catch {
        /* already settled */
      }
      renderTasks.current.delete(pageNum);
    }
    const canvas = pageRefs.current.get(pageNum)?.querySelector("canvas");
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    renderedPages.current.delete(pageNum);
  }, []);

  // Render pages as they approach the viewport, drop them when they leave it.
  // Re-created on zoom, and observing fires an immediate callback, so the pages
  // on screen re-render at the new scale for free.
  useEffect(() => {
    const container = containerRef.current;
    if (!pdfDoc || !numPages || !container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const pageNum = Number((entry.target as HTMLElement).dataset["page"]);
          if (!pageNum) continue;
          if (entry.isIntersecting) void renderPdfPage(pageNum);
          else releasePdfPage(pageNum);
        }
      },
      { root: container, rootMargin: "600px 0px", threshold: 0 },
    );

    pageRefs.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [pdfDoc, numPages, renderPdfPage, releasePdfPage]);

  // Live page readout: whichever page owns the middle of the viewport.
  useEffect(() => {
    const container = containerRef.current;
    if (!numPages || !container) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const mid = container.getBoundingClientRect().top + container.clientHeight / 2;
      let current = 1;
      pageRefs.current.forEach((el, num) => {
        if (el.getBoundingClientRect().top <= mid) current = Math.max(current, num);
      });
      setVisiblePage(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => {
      container.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [numPages]);

  const hasJumpedRef = useRef(false);

  // Reset jump flag if document, page, or bbox changes
  useEffect(() => {
    hasJumpedRef.current = false;
  }, [documentId, pageNumber, bboxParam, highlightBbox]);

  // Citation deep link: smooth center into target bbox or page ONCE without locking user scroll
  useEffect(() => {
    const container = containerRef.current;
    if (!pdfDoc || !numPages || !baseSize || !container || hasJumpedRef.current) return;

    const targetPage = Math.min(Math.max(pageNumber || 1, 1), numPages);

    // Force pre-render target page so its canvas is painted immediately
    void renderPdfPage(targetPage);

    const performJump = () => {
      const currentContainer = containerRef.current;
      if (!currentContainer) return;

      const highlightEl = document.getElementById("cited-signal-highlight");
      if (highlightEl) {
        try {
          highlightEl.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
        } catch {
          const containerRect = currentContainer.getBoundingClientRect();
          const elRect = highlightEl.getBoundingClientRect();
          const scrollLeft = currentContainer.scrollLeft + (elRect.left - containerRect.left) - (containerRect.width / 2) + (elRect.width / 2);
          const scrollTop = currentContainer.scrollTop + (elRect.top - containerRect.top) - (containerRect.height / 2) + (elRect.height / 2);

          currentContainer.scrollTo({
            left: Math.max(0, scrollLeft),
            top: Math.max(0, scrollTop),
            behavior: "smooth",
          });
        }
        hasJumpedRef.current = true;
        return;
      }

      const targetEl = pageRefs.current.get(targetPage);
      if (targetEl) {
        try {
          targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
        } catch {
          const containerRect = currentContainer.getBoundingClientRect();
          const targetRect = targetEl.getBoundingClientRect();
          const scrollTop = currentContainer.scrollTop + (targetRect.top - containerRect.top) - 30;

          currentContainer.scrollTo({
            left: 0,
            top: Math.max(0, scrollTop),
            behavior: "smooth",
          });
        }
        if (!highlightBbox) {
          hasJumpedRef.current = true;
        }
      }
    };

    const raf = requestAnimationFrame(performJump);
    const t1 = setTimeout(performJump, 100);
    const t2 = setTimeout(performJump, 300);
    const t3 = setTimeout(performJump, 600);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [pdfDoc, numPages, baseSize, pageNumber, highlightBbox, renderPdfPage]);

  // Render Word document (.docx) directly into DOM
  useEffect(() => {
    if (isDocx && rawBlob && docxContainerRef.current) {
      setIsDocxRendering(true);
      docxContainerRef.current.innerHTML = "";
      import("docx-preview")
        .then(({ renderAsync }) => {
          if (!docxContainerRef.current) return;
          return renderAsync(rawBlob, docxContainerRef.current, undefined, {
            className: "docx-preview-wrapper",
            inWrapper: true,
            ignoreWidth: false,
            ignoreHeight: false,
            breakPages: true,
          });
        })
        .then(() => {
          setIsDocxRendering(false);
        })
        .catch((err) => {
          console.error("Failed to render docx:", err);
          setIsDocxRendering(false);
        });
    }
  }, [isDocx, rawBlob]);

  // Handle switching Excel sheets
  const handleSheetChange = async (sheetName: string) => {
    if (!workbook || !workbook.Sheets[sheetName]) return;
    setActiveSheet(sheetName);
    const XLSX = await import("xlsx");
    const data: any[][] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });
    setSheetData(data);
  };

  const handleDownload = () => {
    if (!rawBlob && !blobUrl) return;
    const url = blobUrl ? blobUrl.split("#")[0]! : URL.createObjectURL(rawBlob!);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const getHeaderBadge = () => {
    if (isDocx) return <span className="text-[10px] uppercase font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/30 px-1.5 py-0.5 rounded ml-1">Word Document (.docx)</span>;
    if (isDoc) return <span className="text-[10px] uppercase font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/30 px-1.5 py-0.5 rounded ml-1">Word Document (.doc)</span>;
    if (isExcel) return <span className="text-[10px] uppercase font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.5 rounded ml-1">Spreadsheet</span>;
    if (isImage) return <span className="text-[10px] uppercase font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/30 px-1.5 py-0.5 rounded ml-1">Image</span>;
    if (isPdf) return <span className="text-[10px] uppercase font-semibold bg-red-500/20 text-red-300 border border-red-500/30 px-1.5 py-0.5 rounded ml-1">PDF Document</span>;
    return null;
  };

  const getHeaderIcon = () => {
    if (isImage) return <ImageIcon size={18} className="text-purple-400 shrink-0" />;
    if (isExcel) return <FileSpreadsheet size={18} className="text-emerald-400 shrink-0" />;
    if (isDocx || isDoc) return <FileText size={18} className="text-blue-400 shrink-0" />;
    return <FileText size={18} className="text-red-400 shrink-0" />;
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#323639] text-white overflow-hidden">
      {/* Top Navigation Bar */}
      <header className="h-12 bg-[#2a2d30] border-b border-[#3c4043] flex items-center justify-between px-4 z-10 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {getHeaderIcon()}
          <span className="text-sm font-medium text-gray-200 truncate" title={fileName}>
            {fileName}
          </span>
          {getHeaderBadge()}
        </div>

        <div className="flex items-center gap-3">
          {(blobUrl || rawBlob) && (
            <button
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#3c4043] hover:bg-[#4a4e52] text-gray-200 rounded transition cursor-pointer"
              title="Download file"
            >
              <Download size={14} />
              <span>Download</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 w-full h-full relative bg-[#525659] overflow-auto flex flex-col">
        {error ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-6 text-gray-300">
            <AlertCircle size={40} className="text-red-400 mb-3" />
            <h3 className="text-base font-semibold text-white mb-1">Preview Unavailable</h3>
            <p className="text-sm text-gray-400 max-w-md">{error}</p>
          </div>
        ) : !blobUrl && !rawBlob ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-300">
            <Loader2 size={36} className="animate-spin text-red-500 mb-3" />
            <p className="text-sm font-medium text-gray-200">Loading {fileName}...</p>
            <p className="text-xs text-gray-400 mt-1">Please wait while the document is fetched securely</p>
          </div>
        ) : isDocx ? (
          /* Word Document (.docx) Direct Viewer */
          <div className="w-full min-h-full flex flex-col items-center py-8 px-4 bg-[#e8ebed] text-gray-900 select-text overflow-y-auto">
            {isDocxRendering && (
              <div className="flex items-center gap-2 mb-4 text-sm text-gray-600 bg-white/80 px-4 py-2 rounded-full shadow-xs">
                <Loader2 size={16} className="animate-spin text-blue-600" />
                <span>Rendering Word pages...</span>
              </div>
            )}
            <div
              ref={docxContainerRef}
              className="w-full max-w-[850px] bg-white shadow-xl rounded-sm p-4 sm:p-8 min-h-[900px]"
            />
          </div>
        ) : isDoc ? (
          /* Word Document (.doc) Reader & Text Extraction */
          <div className="w-full min-h-full flex flex-col items-center py-8 px-4 bg-[#e8ebed] text-gray-900 select-text overflow-y-auto">
            <div className="w-full max-w-[850px] bg-white shadow-xl rounded-sm p-6 sm:p-10 min-h-[600px] flex flex-col">
              <div className="border-b border-gray-200 pb-4 mb-6 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-gray-800">{fileName}</h2>
                  <p className="text-xs text-gray-500 mt-0.5">Word 97-2003 Document (.doc)</p>
                </div>
                <button
                  onClick={handleDownload}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium transition flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <Download size={13} />
                  <span>Open in Word</span>
                </button>
              </div>

              {textContent ? (
                <div className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap font-sans">
                  {textContent}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <FileText size={48} className="text-blue-500 mb-3" />
                  <p className="text-sm font-medium text-gray-700">Binary Word Document</p>
                  <p className="text-xs text-gray-500 mt-1 max-w-sm">
                    Click above to download and open the complete file in Microsoft Word or Office 365.
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : isExcel ? (
          /* Excel Spreadsheet (.xlsx, .xls, .csv) Direct Viewer */
          <div className="flex-1 flex flex-col h-full bg-[#f8fafc] text-gray-800 overflow-hidden">
            {/* Sheet Tabs Bar */}
            {sheetNames.length > 1 && (
              <div className="h-10 bg-[#e2e8f0] border-b border-gray-300 flex items-center px-3 gap-1 overflow-x-auto shrink-0 select-none">
                <div className="flex items-center gap-1.5 text-xs text-gray-500 mr-2 font-medium">
                  <Layers size={14} />
                  <span>Sheets:</span>
                </div>
                {sheetNames.map((sheet) => (
                  <button
                    key={sheet}
                    onClick={() => handleSheetChange(sheet)}
                    className={`px-3 py-1 text-xs font-medium rounded-t-md transition border-t border-x ${
                      activeSheet === sheet
                        ? "bg-white text-emerald-700 border-gray-300 shadow-xs"
                        : "bg-gray-200 hover:bg-gray-100 text-gray-600 border-transparent"
                    }`}
                  >
                    {sheet}
                  </button>
                ))}
              </div>
            )}

            {/* Spreadsheet Table Grid */}
            <div className="flex-1 overflow-auto p-4 select-text">
              {isExcelLoading ? (
                <div className="flex items-center justify-center h-64 text-gray-500">
                  <Loader2 size={24} className="animate-spin text-emerald-600 mr-2" />
                  <span>Loading spreadsheet data...</span>
                </div>
              ) : sheetData.length > 0 ? (
                <div className="bg-white border border-gray-300 rounded shadow-xs overflow-x-auto inline-block min-w-full">
                  <table className="min-w-full border-collapse text-xs">
                    <thead>
                      <tr className="bg-[#f1f5f9] border-b border-gray-300 text-gray-700 font-semibold">
                        <th className="w-12 px-2 py-1.5 border-r border-gray-300 bg-gray-200 text-center text-[10px] text-gray-500 font-mono">
                          #
                        </th>
                        {sheetData[0]?.map((col: any, colIdx: number) => (
                          <th
                            key={colIdx}
                            className="px-3 py-1.5 border-r border-gray-300 text-left whitespace-nowrap"
                          >
                            {String(col ?? "")}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {sheetData.slice(1).map((row: any[], rowIdx: number) => (
                        <tr key={rowIdx} className="hover:bg-blue-50/50 transition">
                          <td className="w-12 px-2 py-1 border-r border-gray-300 bg-gray-100 text-center text-[10px] text-gray-400 font-mono select-none">
                            {rowIdx + 2}
                          </td>
                          {sheetData[0]?.map((_, colIdx: number) => (
                            <td
                              key={colIdx}
                              className="px-3 py-1 border-r border-gray-200 whitespace-nowrap text-gray-700 font-normal"
                            >
                              {row[colIdx] !== undefined && row[colIdx] !== null ? String(row[colIdx]) : ""}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-16 text-gray-400">
                  <FileSpreadsheet size={36} className="mx-auto text-gray-300 mb-2" />
                  <p>This sheet is empty</p>
                </div>
              )}
            </div>
          </div>
        ) : isImage ? (
          /* Image Viewer */
          <div className="w-full h-full flex items-center justify-center p-6 overflow-auto">
            <img
              src={blobUrl!}
              alt={fileName}
              className="max-h-[calc(100vh-80px)] max-w-[calc(100vw-80px)] object-contain shadow-2xl rounded border border-black/20"
            />
          </div>
        ) : isText ? (
          /* Text / Log Viewer */
          <div className="w-full min-h-full flex justify-center py-6 px-4 bg-[#1e1e1e] overflow-auto">
            <pre className="w-full max-w-4xl p-6 bg-[#252526] text-gray-200 font-mono text-xs leading-relaxed rounded-lg border border-gray-700 shadow-xl overflow-x-auto whitespace-pre-wrap select-text">
              {textContent}
            </pre>
          </div>
        ) : isPdf ? (
          /* PDF Viewer: one continuously scrolling stack of pages */
          <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#525659]">
            {/* Toolbar */}
            <div className="h-10 bg-[#3c4043] border-b border-[#2a2d30] flex items-center justify-between px-4 text-xs select-none shrink-0 text-white">
              <span className="text-gray-300">
                Page {visiblePage} of {numPages || "?"}
              </span>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (baseSize && containerRef.current) {
                      const containerWidth = containerRef.current.clientWidth - 48;
                      setPdfScale(Math.max(0.25, Math.min(3.0, containerWidth / baseSize.width)));
                    }
                  }}
                  className="px-2 py-1 bg-[#2a2d30] rounded hover:bg-[#1e1e1e] cursor-pointer transition font-medium"
                  title="Fit to window width"
                >
                  Fit Width
                </button>
                <button
                  type="button"
                  onClick={() => setPdfScale(1.0)}
                  className="px-2 py-1 bg-[#2a2d30] rounded hover:bg-[#1e1e1e] cursor-pointer transition font-medium"
                  title="Actual Size (100%)"
                >
                  100%
                </button>
                <button
                  type="button"
                  onClick={() => setPdfScale(prev => Math.max(0.35, prev - 0.25))}
                  className="px-2 py-1 bg-[#2a2d30] rounded hover:bg-[#1e1e1e] cursor-pointer transition font-medium"
                >
                  Zoom -
                </button>
                <span className="text-gray-300 font-mono w-12 text-center">{Math.round(pdfScale * 100)}%</span>
                <button
                  type="button"
                  onClick={() => setPdfScale(prev => Math.min(4, prev + 0.25))}
                  className="px-2 py-1 bg-[#2a2d30] rounded hover:bg-[#1e1e1e] cursor-pointer transition font-medium"
                >
                  Zoom +
                </button>
              </div>
            </div>

            {/* Scrollable page stack */}
            <div ref={containerRef} className="flex-1 overflow-auto p-6">
              {pdfLoading ? (
                <div className="flex flex-col items-center justify-center py-20 text-gray-300">
                  <Loader2 size={30} className="animate-spin text-red-500 mb-2" />
                  <p className="text-sm font-medium">Loading document pages...</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-6 min-w-full w-fit mx-auto">
                  {Array.from({ length: numPages ?? 0 }, (_, idx) => idx + 1).map((num) => (
                    <div
                      key={num}
                      data-page={num}
                      ref={(el) => {
                        if (el) pageRefs.current.set(num, el);
                        else pageRefs.current.delete(num);
                      }}
                      className="relative shadow-2xl border border-black/20 bg-white"
                      style={
                        baseSize
                          ? {
                              minWidth: baseSize.width * pdfScale,
                              minHeight: baseSize.height * pdfScale,
                            }
                          : undefined
                      }
                    >
                      <canvas className="block" />

                      {/* BBox highlight, on the cited page only */}
                      {highlightBbox && num === (pageNumber || 1) && (() => {
                        const minX = Math.min(highlightBbox[0], highlightBbox[2]);
                        const minY = Math.min(highlightBbox[1], highlightBbox[3]);
                        const maxX = Math.max(highlightBbox[0], highlightBbox[2]);
                        const maxY = Math.max(highlightBbox[1], highlightBbox[3]);
                        const leftPx = minX * 72 * pdfScale;
                        const topPx = minY * 72 * pdfScale;
                        const widthPx = Math.max(Math.abs(maxX - minX) * 72 * pdfScale, 28);
                        const heightPx = Math.max(Math.abs(maxY - minY) * 72 * pdfScale, 20);

                        return (
                          <div
                            id="cited-signal-highlight"
                            style={{
                              position: "absolute",
                              left: `${leftPx}px`,
                              top: `${topPx}px`,
                              width: `${widthPx}px`,
                              height: `${heightPx}px`,
                              backgroundColor: "rgba(254, 240, 138, 0.45)", // yellow-200 with 45% opacity
                              border: "2.5px solid #ef4444", // bright red border
                              boxShadow: "0 0 0 4px rgba(239, 68, 68, 0.25), 0 4px 12px rgba(0, 0, 0, 0.2)",
                              borderRadius: "4px",
                              pointerEvents: "none",
                              zIndex: 20,
                            }}
                            className="animate-pulse"
                          >
                            <span className="absolute -top-5 left-0 bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow-xs whitespace-nowrap uppercase tracking-wider">
                              Cited Signal
                            </span>
                          </div>
                        );
                      })()}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Other native-embeddable formats */
          <iframe
            src={blobUrl!}
            title={fileName}
            className="w-full h-full border-0 block"
          />
        )}
      </main>
    </div>
  );
};

export default DocumentPreviewPage;
