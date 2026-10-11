"""
Docling Structural Extractor — GFS-AI
========================================
PURPOSE
  Run a NON-LLM, mostly-deterministic extraction pass over every document
  in a folder BEFORE the vision-LLM agents (agent_header / agent_dimensions /
  agent_glass_spec) run. This gives you:

    1. Real document structure as JSON: headings, paragraphs, tables (as
       actual 2D cell arrays, not flattened text), reading order, per-page
       text — with NO AI/LLM API calls, so it's free and fast to re-run.

    2. A list of every embedded picture/figure/CAD-drawing region in each
       document, each one FLAGGED with its page number and bounding box.
       This list is what you feed to the vision LLM agents so they know
       exactly which regions are "must look visually, can't read as text"
       (a CAD drawing, a site photo, a hand-marked dimension) versus plain
       text docling already extracted cleanly (an email body, a contact
       form, a spec sheet paragraph).

WHY THIS HELPS THE EXISTING 3-AGENT LLM PIPELINE
  - Cuts vision-LLM token usage: pages that are 100% text (emails, lead
    forms, spec sheets) don't need to be sent as images at all — the
    extracted text is enough. Only pages/regions containing real drawings
    or photos need to go to the vision model.
  - Gives Agent 2 (Dimension Finder) a head start: docling table extraction
    often catches CAD dimension/unit schedule TABLES outright as structured
    rows, instead of asking the vision LLM to read a table from pixels.
  - Feeds the highlighter: docling's text comes with real bounding boxes,
    which is a second, independent way to verify "did this value actually
    appeared in the source" alongside the existing search_text approach.

WHAT THIS IS NOT
  Docling's layout detection model itself IS an AI model (this is true of
  every modern document-structure tool — there is no longer a "pure rules"
  way to reliably find headings/tables/figures in arbitrary PDFs). What
  THIS script turns off is the EXPENSIVE/optional AI add-ons docling can
  also do (image captioning via a vision-language model, chart-to-data
  extraction, code/formula recognition) — none of which you need here.
  Default OCR is also disabled in fast mode since your PDFs are typically
  digitally generated (text already embedded), not scans; enable it with
  --ocr for scanned/photographed documents.

USAGE
  python docling_extract.py <source_folder> <output_folder>
  python docling_extract.py <source_folder> <output_folder> --ocr

OUTPUT
  <output_folder>/<doc_stem>.structured.json   — one per source document
  <output_folder>/extraction_index.json        — summary across all docs

Dependencies:
  pip install docling
"""

from __future__ import annotations

import os
import sys
import json
import time
from pathlib import Path

# Force stdout/stderr to utf-8 encoding on Windows to prevent UnicodeEncodeError with emojis
if sys.platform.startswith("win"):
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")


try:
    from docling.document_converter import DocumentConverter, PdfFormatOption
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions
    from docling_core.types.doc import (
        TextItem, TableItem, PictureItem, SectionHeaderItem, DocItemLabel,
    )
except ImportError as e:
    print(f"Docling not installed or import failed: {e}")
    print("Run: pip install docling")
    sys.exit(1)


SUPPORTED_EXT = {".pdf", ".docx", ".pptx", ".xlsx", ".html", ".md",
                  ".png", ".jpg", ".jpeg", ".tiff", ".bmp", ".eml", ".msg"}


def extract_email_content(file_path: str) -> str:
    """Extract content from email files (.eml, .msg)."""
    try:
        import email
        from email import policy

        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            msg = email.message_from_file(f, policy=policy.default)

        parts = []
        parts.append(f"From: {msg.get('From', '')}")
        parts.append(f"To: {msg.get('To', '')}")
        parts.append(f"Subject: {msg.get('Subject', '')}")
        parts.append(f"Date: {msg.get('Date', '')}")
        parts.append("")

        if msg.is_multipart():
            for part in msg.walk():
                if part.get_content_type() == "text/plain":
                    parts.append(part.get_content())
        else:
            parts.append(msg.get_content())

        return "\n".join(parts)
    except Exception as e:
        return f"Error parsing email: {e}"


# Coverage-check thresholds (relative, not absolute)
# Instead of a fixed character count, we compare Docling output against
# PyMuPDF's native text layer.  A page is flagged when:
#   - BOTH engines find < MIN_TEXT_CHARS  → pure drawing/image
#   - PyMuPDF finds > MIN_PYMUPDF_CHARS but Docling got < COVERAGE_RATIO
#     of that → Docling missed significant text (font-encoding, layout)
MIN_TEXT_CHARS   = 20   # below this, consider "no real text"
MIN_PYMUPDF_CHARS = 50  # PyMuPDF must see at least this many to compare
COVERAGE_RATIO   = 0.3  # Docling must capture at least 30% of PyMuPDF text

# Vector-path density: architectural/CAD drawing pages have hundreds of
# vector line segments.  Docling's PictureItem detector only catches
# raster images (embedded JPEGs/PNGs), NOT vector drawings.  If a page
# has more than MIN_VECTOR_PATHS drawing operations it is almost certainly
# a CAD/architectural sheet that needs vision-LLM review.
MIN_VECTOR_PATHS = 100

# Minimum dimensions (width and height in PDF points) for a picture/figure
# to be flagged for vision review. Images where BOTH width and height are below this
# (e.g. social media icons, email signature graphics) are ignored to save LLM costs.
MIN_IMAGE_DIMENSION = 60



# ═══════════════════════════════════════════════════════════════════════════
# Converter setup — AI extras OFF, layout+text+tables ON
# ═══════════════════════════════════════════════════════════════════════════

def build_converter(use_ocr: bool = False) -> DocumentConverter:
    """
    Layout detection and table-structure recognition stay ON — these are
    what make docling useful at all (real reading order, real table cells
    instead of a flattened text blob). Everything else that costs extra
    time/compute and that you don't need for this pipeline is OFF:

      do_picture_description = False   (no VLM image captioning)
      do_picture_classification = False
      do_chart_extraction = False
      do_code_enrichment = False
      do_formula_enrichment = False
      do_ocr = use_ocr                 (off by default — your PDFs already
                                         have a text layer; turn on for
                                         scanned/photographed documents)
    """
    opts = PdfPipelineOptions()
    opts.do_ocr = use_ocr
    opts.do_table_structure = True
    opts.do_picture_classification = False
    opts.do_picture_description = False
    opts.do_chart_extraction = False
    opts.do_code_enrichment = False
    opts.do_formula_enrichment = False
    opts.generate_page_images = True     # needed so we can crop picture regions
    opts.generate_picture_images = True  # saves each figure as its own image
    opts.images_scale = 1.0

    return DocumentConverter(
        format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opts)}
    )


# ═══════════════════════════════════════════════════════════════════════════
# Walk the DoclingDocument -> clean JSON
# ═══════════════════════════════════════════════════════════════════════════

def bbox_to_dict(prov) -> dict | None:
    """Docling provenance -> simple {page, x0, y0, x1, y1} in PDF points."""
    if not prov:
        return None
    p = prov[0]
    box = p.bbox
    return {
        "page": p.page_no,
        "x0": round(box.l, 1), "y0": round(box.t, 1),
        "x1": round(box.r, 1), "y1": round(box.b, 1),
    }


def extract_structured(doc, source_file: str, picture_out_dir: str) -> dict:
    """
    Walk every item in reading order and bucket it into a clean,
    LLM/agent-friendly structure:

      headings   — section titles, in order
      paragraphs — body text blocks, in order, each with page + bbox
      tables     — REAL 2D cell arrays (row x col), not flattened text
      figures    — every picture / drawing / photo region, FLAGGED for
                   vision-LLM follow-up, with its own cropped image saved
                   to disk and bbox/page recorded
      full_text_by_page — page_no -> all text on that page, concatenated
                   (handy as a single string per page for the existing
                   agents' text_content field)

    FIX: Previously only TextItem, TableItem, PictureItem, SectionHeaderItem
    were handled. Docling also emits ListItem, KeyValueItem, FormItem etc.
    (common in Outlook-printed PDFs, forms, structured emails). Those fell
    through all isinstance checks silently — text was dropped entirely.
    The catch-all `else` block below captures any item type that has a
    `.text` attribute so nothing is lost.
    """
    headings, paragraphs, tables, figures = [], [], [], []
    full_text_by_page: dict[int, list[str]] = {}
    os.makedirs(picture_out_dir, exist_ok=True)

    fig_counter = 0

    for item, _level in doc.iterate_items():
        prov = getattr(item, "prov", None)
        loc = bbox_to_dict(prov)
        page_no = loc["page"] if loc else None

        # ── Section headers ──────────────────────────────────────────────
        if isinstance(item, SectionHeaderItem) or (
            isinstance(item, TextItem) and item.label == DocItemLabel.SECTION_HEADER
        ):
            headings.append({"text": item.text, "page": page_no, "bbox": loc})
            if page_no:
                full_text_by_page.setdefault(page_no, []).append(item.text)

        # ── Tables ───────────────────────────────────────────────────────
        elif isinstance(item, TableItem):
            try:
                df = item.export_to_dataframe(doc)
                rows = df.values.tolist()
                cols = df.columns.tolist()
            except Exception:
                rows, cols = [], []
            tables.append({
                "page": page_no,
                "bbox": loc,
                "columns": cols,
                "rows": rows,
                "n_rows": len(rows),
                "n_cols": len(cols),
                "as_markdown": item.export_to_markdown(doc) if hasattr(item, "export_to_markdown") else None,
            })
            if page_no:
                flat = " | ".join(str(c) for row in rows for c in row)
                full_text_by_page.setdefault(page_no, []).append(f"[TABLE] {flat}")

        # ── Pictures / figures / CAD regions ────────────────────────────
        elif isinstance(item, PictureItem):
            if loc:
                w = abs(loc["x1"] - loc["x0"])
                h = abs(loc["y1"] - loc["y0"])
                if w < MIN_IMAGE_DIMENSION and h < MIN_IMAGE_DIMENSION:
                    # Skip tiny decorative icons/social logos to save LLM costs
                    continue

            fig_counter += 1
            crop_path = None

            try:
                pil_img = item.get_image(doc)
                if pil_img is not None:
                    crop_path = os.path.join(
                        picture_out_dir,
                        f"{Path(source_file).stem}_fig{fig_counter:02d}_p{page_no or 0}.png"
                    )
                    pil_img.save(crop_path)
            except Exception as e:
                print(f"    (could not export figure image: {e})")

            figures.append({
                "figure_id": f"fig{fig_counter:02d}",
                "page": page_no,
                "bbox": loc,
                "cropped_image_path": crop_path,
                "needs_vision_review": True,
                "flag_reason": "picture",
                "reason": (
                    "Picture/drawing region — docling cannot read this as text. "
                    "Likely a CAD drawing, site photo, hand annotation, or diagram. "
                    "Send the cropped image (or the full page image) to the vision-LLM agent."
                ),
            })

        # ── Plain text items ─────────────────────────────────────────────
        elif isinstance(item, TextItem):
            text = (item.text or "").strip()
            if not text:
                continue
            paragraphs.append({
                "text": text,
                "page": page_no,
                "bbox": loc,
                "label": str(item.label),
            })
            if page_no:
                full_text_by_page.setdefault(page_no, []).append(text)

        # ── CATCH-ALL: ListItem, KeyValueItem, FormItem, etc. ────────────
        # Docling classifies some document types (Outlook emails, structured
        # forms, key-value layouts) into item types not listed above.
        # Previously these were silently dropped — now we capture any item
        # that carries text and treat it as a paragraph so nothing is lost.
        else:
            text = getattr(item, "text", None)
            if not text:
                continue
            text = text.strip()
            if not text:
                continue
            item_label = str(getattr(item, "label", type(item).__name__))
            paragraphs.append({
                "text": text,
                "page": page_no,
                "bbox": loc,
                "label": item_label,
            })
            if page_no:
                full_text_by_page.setdefault(page_no, []).append(text)

    n_pages = len(doc.pages) if hasattr(doc, "pages") else max(full_text_by_page.keys(), default=0)

    # ── Post-pass: smart text-coverage check ─────────────────────────────
    # Compare Docling's extraction against PyMuPDF's native text layer
    # (for PDFs) to detect pages where Docling missed significant text.
    # For image files, flag pages where Docling extracted essentially nothing.
    # This replaces the old fixed-threshold approach (EMPTY_PAGE_CHAR_THRESHOLD)
    # with a relative comparison — no more arbitrary character counts.
    suffix = Path(source_file).suffix.lower()

    if suffix == ".pdf":
        try:
            import fitz
            from PIL import Image
            pdf_doc = fitz.open(source_file)

            # Trust PyMuPDF's page count over Docling's — see note below on
            # why n_pages can be 0 even for a real, openable, N-page PDF.
            if len(pdf_doc) > n_pages:
                n_pages = len(pdf_doc)

            # IMPORTANT: loop over PyMuPDF's own page count, not n_pages.
            # n_pages falls back to max(full_text_by_page.keys(), default=0)
            # when Docling's doc.pages is missing/empty — which is exactly
            # what happens on the broken-font PDFs this check exists to
            # catch (Docling extracts nothing -> full_text_by_page == {}
            # -> n_pages == 0 -> loop never runs -> coverage gap goes
            # undetected on the worst-case file). PyMuPDF can always open
            # the PDF and report its real page count independently of
            # whatever Docling did or didn't extract.
            for page_idx in range(len(pdf_doc)):
                page_no_int = page_idx + 1
                page = pdf_doc[page_idx]

                # ── What PyMuPDF sees natively in the PDF text layer ──
                blocks = page.get_text("blocks")
                # block tuple: (x0, y0, x1, y1, text, block_no, block_type)
                text_blocks = [b for b in blocks if b[6] == 0 and b[4].strip()]
                pymupdf_chars = sum(len(b[4].strip()) for b in text_blocks)

                # ── What Docling extracted for this page ──
                docling_parts = full_text_by_page.get(page_no_int, [])
                docling_chars = sum(len(p.strip()) for p in docling_parts)

                # Skip pages already covered by a whole-page figure flag
                already_flagged = any(
                    f["page"] == page_no_int and f.get("bbox") is None
                    for f in figures
                )
                if already_flagged:
                    continue

                needs_flag = False
                reason = ""

                if pymupdf_chars < MIN_TEXT_CHARS and docling_chars < MIN_TEXT_CHARS:
                    # Neither engine found text → pure drawing / image page
                    needs_flag = True
                    reason = (
                        f"Page {page_no_int} contains no extractable text layer "
                        f"(PyMuPDF: {pymupdf_chars} chars, Docling: {docling_chars} chars). "
                        "Likely a CAD drawing, photo, or rasterised image. "
                        "Send the full page image to the vision-LLM agent."
                    )
                elif pymupdf_chars >= MIN_PYMUPDF_CHARS and docling_chars < pymupdf_chars * COVERAGE_RATIO:
                    # PyMuPDF sees substantial text that Docling missed
                    pct = round(docling_chars / max(pymupdf_chars, 1) * 100)
                    needs_flag = True
                    reason = (
                        f"Page {page_no_int}: PyMuPDF detects ~{pymupdf_chars} chars "
                        f"but Docling only extracted ~{docling_chars} ({pct}% coverage). "
                        "Likely font-encoding issues or complex layout that Docling "
                        "cannot decode. Send the full page image to the vision-LLM agent."
                    )

                if needs_flag:
                    crop_path = None
                    try:
                        pix = page.get_pixmap(dpi=150)
                        pil_img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                        crop_path = os.path.join(
                            picture_out_dir,
                            f"{Path(source_file).stem}_page_{page_no_int}.png"
                        )
                        pil_img.save(crop_path)
                    except Exception as e:
                        print(f"    (could not render fallback page image: {e})")

                    figures.append({
                        "figure_id": f"coverage_gap_page_{page_no_int}",
                        "page": page_no_int,
                        "bbox": None,
                        "cropped_image_path": crop_path,
                        "needs_vision_review": True,
                        "flag_reason": "low_text_coverage",
                        "reason": reason,
                    })
                    print(f"    ⚠ Page {page_no_int} flagged — Docling coverage gap "
                          f"(PyMuPDF: {pymupdf_chars}, Docling: {docling_chars})")
                else:
                    # ── Vector-path density check ──────────────────────
                    # Even when text coverage is fine, check if the page
                    # contains heavy vector graphics (CAD / architectural
                    # drawings).  Docling reads the TEXT labels but cannot
                    # flag the vector drawings as PictureItems.
                    try:
                        n_paths = len(page.get_drawings())
                    except Exception:
                        n_paths = 0

                    if n_paths >= MIN_VECTOR_PATHS:
                        crop_path = None
                        try:
                            pix = page.get_pixmap(dpi=150)
                            pil_img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                            crop_path = os.path.join(
                                picture_out_dir,
                                f"{Path(source_file).stem}_page_{page_no_int}.png"
                            )
                            pil_img.save(crop_path)
                        except Exception as e:
                            print(f"    (could not render drawing page image: {e})")

                        figures.append({
                            "figure_id": f"drawing_page_{page_no_int}",
                            "page": page_no_int,
                            "bbox": None,
                            "cropped_image_path": crop_path,
                            "needs_vision_review": True,
                            "flag_reason": "vector_drawing_page",
                            "reason": (
                                f"Page {page_no_int} contains {n_paths} vector drawing "
                                "operations — likely a CAD / architectural drawing sheet. "
                                "Docling extracted the text labels but the drawings "
                                "themselves are vector graphics that need vision-LLM "
                                "review for dimensions, details, and annotations."
                            ),
                        })
                        print(f"    📐 Page {page_no_int} flagged — vector drawing page "
                              f"({n_paths} paths detected)")

            pdf_doc.close()
        except ImportError:
            pass  # PyMuPDF not installed — skip coverage check
        except Exception as e:
            print(f"    (coverage check error: {e})")

    elif suffix in {".png", ".jpg", ".jpeg", ".tiff", ".bmp", ".webp"}:
        # Image files: flag if Docling extracted essentially nothing
        for page_no_int in range(1, n_pages + 1):
            docling_text = "\n".join(full_text_by_page.get(page_no_int, []))
            already_flagged = any(
                f["page"] == page_no_int and f.get("bbox") is None
                for f in figures
            )
            if already_flagged:
                continue

            if len(docling_text.strip()) < MIN_TEXT_CHARS:
                crop_path = None
                try:
                    import shutil
                    crop_path = os.path.join(
                        picture_out_dir,
                        f"{Path(source_file).name}"
                    )
                    shutil.copy2(source_file, crop_path)
                except Exception as e:
                    print(f"    (could not copy source image: {e})")

                figures.append({
                    "figure_id": f"image_page_{page_no_int}",
                    "page": page_no_int,
                    "bbox": None,
                    "cropped_image_path": crop_path,
                    "needs_vision_review": True,
                    "flag_reason": "image_no_text",
                    "reason": (
                        "Image file — Docling extracted little or no text. "
                        "Needs vision-LLM review for dimensions and content."
                    ),
                })
                print(f"    ⚠ Page {page_no_int} flagged — image with minimal text extraction")

    return {
        "source_file": source_file,
        "n_pages": n_pages,
        "headings": headings,
        "paragraphs": paragraphs,
        "tables": tables,
        "figures": figures,
        "full_text_by_page": {
            str(p): "\n".join(lines) for p, lines in sorted(full_text_by_page.items())
        },
        "summary": {
            "n_headings": len(headings),
            "n_paragraphs": len(paragraphs),
            "n_tables": len(tables),
            "n_figures_flagged_for_vision": len(figures),
        },
    }


# ═══════════════════════════════════════════════════════════════════════════
# Orchestration
# ═══════════════════════════════════════════════════════════════════════════

def process_folder(source_folder: str, use_ocr: bool = False) -> dict:
    output_folder = os.path.join(source_folder, "non_ai_results")
    os.makedirs(output_folder, exist_ok=True)
    picture_dir = os.path.join(output_folder, "flagged_figures")

    converter = build_converter(use_ocr=use_ocr)

    folder = Path(source_folder)
    files = sorted(
        p for p in folder.rglob("*")
        if p.is_file() and p.suffix.lower() in SUPPORTED_EXT
        and "annotated" not in p.parts
        and "non_ai_results" not in p.parts
        and "flagged_figures" not in p.parts
    )

    consolidated = {
        "project_folder": str(Path(source_folder).resolve()),
        "documents": {},
        "summary": {
            "total_figures_flagged": 0,
            "total_tables": 0,
            "total_paragraphs": 0,
            "total_headings": 0
        },
        "errors": []
    }

    for f in files:
        t0 = time.time()
        if f.suffix.lower() in {".eml", ".msg"}:
            print(f"\n✉ {f.name}")
            try:
                email_text = extract_email_content(str(f))
                structured = {
                    "n_pages": 1,
                    "headings": [],
                    "paragraphs": [{"text": email_text, "page": 1, "bbox": None, "label": "text"}],
                    "tables": [],
                    "figures": [],
                    "full_text_by_page": {"1": email_text},
                    "summary": {
                        "n_headings": 0,
                        "n_paragraphs": 1,
                        "n_tables": 0,
                        "n_figures_flagged_for_vision": 0
                    }
                }
            except Exception as e:
                print(f"  ✗ Email parsing failed: {e}")
                consolidated["errors"].append({"file": f.name, "error": str(e)})
                continue
        else:
            print(f"\n📄 {f.name}")
            try:
                result = converter.convert(str(f))
                doc = result.document
            except Exception as e:
                print(f"  ✗ Conversion failed: {e}")
                consolidated["errors"].append({"file": f.name, "error": str(e)})
                import gc; gc.collect()
                continue

            structured = extract_structured(doc, str(f), picture_dir)
        elapsed = round(time.time() - t0, 1)

        consolidated["documents"][f.name] = {
            "n_pages": structured["n_pages"],
            "headings": structured["headings"],
            "paragraphs": structured["paragraphs"],
            "tables": structured["tables"],
            "figures": structured["figures"],
            "full_text_by_page": structured["full_text_by_page"],
            "seconds_elapsed": elapsed
        }

        s = structured["summary"]
        consolidated["summary"]["total_figures_flagged"] += s["n_figures_flagged_for_vision"]
        consolidated["summary"]["total_tables"] += s["n_tables"]
        consolidated["summary"]["total_paragraphs"] += s["n_paragraphs"]
        consolidated["summary"]["total_headings"] += s["n_headings"]

        print(f"  ✓ {elapsed}s — {s['n_paragraphs']} paragraphs, "
              f"{s['n_tables']} tables, {s['n_headings']} headings, "
              f"{s['n_figures_flagged_for_vision']} figures flagged for vision review")

        import gc
        gc.collect()

    index_path = os.path.join(output_folder, "non_ai_extracted_data.json")
    with open(index_path, "w", encoding="utf-8") as fh:
        json.dump(consolidated, fh, indent=2, ensure_ascii=False, default=str)

    print(f"\n{'='*60}")
    print(f"✅ {len(consolidated['documents'])} documents processed")
    print(f"   {consolidated['summary']['total_tables']} tables extracted as structured data")
    print(f"   {consolidated['summary']['total_figures_flagged']} figures/drawings flagged for vision-LLM review")
    if consolidated["errors"]:
        print(f"   ⚠ {len(consolidated['errors'])} files failed — see non_ai_extracted_data.json")
    print(f"   Result Saved: {index_path}")

    # Auto-run visualization
    try:
        parent_dir = str(Path(__file__).resolve().parent.parent)
        if parent_dir not in sys.path:
            sys.path.insert(0, parent_dir)
        from non_ai.visualize_results import visualize_folder
        visualize_folder(source_folder)
    except Exception as e:
        print(f"   ⚠ Visualization auto-run failed: {e}")

    return consolidated


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("source_folder")
    ap.add_argument("--ocr", action="store_true",
                     help="Enable OCR — use for scanned/photographed documents")
    args = ap.parse_args()

    if not os.path.isdir(args.source_folder):
        print(f"Error: {args.source_folder} is not a directory")
        sys.exit(1)

    process_folder(args.source_folder, use_ocr=args.ocr)