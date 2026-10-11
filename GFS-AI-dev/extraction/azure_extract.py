import os
import sys
import time
import httpx
import asyncio
from pathlib import Path
from PIL import Image
from dotenv import load_dotenv
from utils.io_utils import atomic_write_json

# Load local visualizer module
script_dir = Path(__file__).resolve().parent
sys.path.append(str(script_dir))
try:
    from .visualize_azure import visualize_document, get_bbox_from_polygon, HAVE_FITZ
except (ImportError, ValueError):
    try:
        from visualize_azure import visualize_document, get_bbox_from_polygon, HAVE_FITZ
    except ImportError:
        HAVE_FITZ = False

# Load environment variables
load_dotenv(script_dir / ".env")
load_dotenv()

ENDPOINT = (os.getenv("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT") or os.getenv("AZURE_DOC_INTELLIGENCE_ENDPOINT") or os.getenv("AZURE_AI_API_BASE") or "").strip()
KEY = (os.getenv("AZURE_DOCUMENT_INTELLIGENCE_KEY") or os.getenv("AZURE_DOC_INTELLIGENCE_KEY") or os.getenv("AZURE_AI_API_KEY") or "").strip()

SUPPORTED_EXT = {".pdf", ".png", ".jpg", ".jpeg", ".tiff", ".bmp", ".webp"}

async def call_azure_layout(file_bytes: bytes, pages: str = None) -> dict:
    """Send document to Azure Document Intelligence and poll for layout results."""
    if not ENDPOINT or not KEY:
        raise ValueError("Missing AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT or KEY in environment/.env")

    base_url = ENDPOINT.rstrip("/")
    analyze_url = f"{base_url}/documentintelligence/documentModels/prebuilt-layout:analyze?api-version=2024-11-30"
    if pages:
        analyze_url += f"&pages={pages}"

    headers = {
        "Ocp-Apim-Subscription-Key": KEY,
        "Content-Type": "application/octet-stream"
    }

    async with httpx.AsyncClient() as client:
        resp = None
        for post_attempt in range(1, 6):
            try:
                resp = await client.post(analyze_url, content=file_bytes, headers=headers, timeout=300.0)  # 5 min for large PDFs
                if resp.status_code == 202:
                    break
                elif resp.status_code == 429:
                    wait_time = 2 ** post_attempt
                    print(f"[AZURE] Rate limit (429) hit, retrying in {wait_time}s (attempt {post_attempt}/5)...")
                    await asyncio.sleep(wait_time)
                else:
                    raise RuntimeError(f"Azure rejected request ({resp.status_code}): {resp.text}")
            except Exception as post_exc:
                if post_attempt == 5:
                    raise post_exc
                wait_time = 2 ** post_attempt
                print(f"[AZURE] Request failed ({post_exc}), retrying in {wait_time}s (attempt {post_attempt}/5)...")
                await asyncio.sleep(wait_time)

        if resp is None or resp.status_code != 202:
            raise RuntimeError(f"Azure rejected request after retries ({resp.status_code if resp else 'No response'}): {resp.text if resp else ''}")

        operation_url = resp.headers.get("Operation-Location")
        if not operation_url:
            raise RuntimeError("Operation-Location header missing in response.")

        poll_headers = {"Ocp-Apim-Subscription-Key": KEY}
        for attempt in range(1, 90):  # Poll up to 180 seconds
            await asyncio.sleep(2)
            try:
                poll_resp = await client.get(operation_url, headers=poll_headers, timeout=120.0)
                poll_data = poll_resp.json()
                
                status = poll_data.get("status")
                if status == "succeeded":
                    return poll_data.get("analyzeResult", {})
                elif status == "failed":
                    raise RuntimeError(f"Azure analysis failed: {poll_data}")
            except (httpx.ReadTimeout, httpx.ConnectTimeout, httpx.HTTPError) as poll_exc:
                print(f"[AZURE] Poll attempt {attempt} transient error ({poll_exc}), retrying in 2s...")
                continue
        
        raise TimeoutError("Analysis request timed out on Azure.")

def calculate_dhash(image: Image.Image, hash_size: int = 8) -> str:
    """
    Compute the difference hash (dhash) of a PIL Image.
    Works by resizing the image to (hash_size + 1) x hash_size, converting to grayscale,
    and comparing horizontal pixel differences.
    """
    img_gray = image.convert("L").resize((hash_size + 1, hash_size), Image.Resampling.BILINEAR)
    pixels = list(img_gray.getdata())
    
    difference = []
    for row in range(hash_size):
        for col in range(hash_size):
            pixel_left = pixels[row * (hash_size + 1) + col]
            pixel_right = pixels[row * (hash_size + 1) + col + 1]
            difference.append(pixel_left > pixel_right)
            
    decimal_value = 0
    hex_string = []
    for index, value in enumerate(difference):
        if value:
            decimal_value += 2 ** (index % 8)
        if (index % 8) == 7:
            hex_string.append(hex(decimal_value)[2:].zfill(2))
            decimal_value = 0
            
    return "".join(hex_string)

def hamming_distance(hash1: str, hash2: str) -> int:
    """Calculate the Hamming distance between two hexadecimal hashes."""
    return sum(c1 != c2 for c1, c2 in zip(hash1, hash2))

def hamming_distance_bitwise(h1: str, h2: str) -> int:
    """Calculate the bitwise Hamming distance between two hexadecimal hashes."""
    try:
        return bin(int(h1, 16) ^ int(h2, 16)).count("1")
    except Exception:
        return 64

def load_ignored_templates() -> list[str]:
    """Load ignored image templates and return their dhash values."""
    templates_dir = script_dir / "ignored_templates"
    templates_dir.mkdir(parents=True, exist_ok=True)
    template_hashes = []
    for p in templates_dir.glob("*"):
        if p.suffix.lower() in {".png", ".jpg", ".jpeg", ".tiff", ".bmp", ".webp"}:
            try:
                with Image.open(p) as img:
                    h = calculate_dhash(img)
                    if h:
                        template_hashes.append(h)
            except Exception as e:
                print(f"    (could not load ignore template {p.name}: {e})")
    if template_hashes:
        print(f"Loaded {len(template_hashes)} ignore templates from {templates_dir.name}/")
    return template_hashes

def crop_figures(file_bytes: bytes, file_name: str, azure_result: dict, output_dir: Path, template_hashes: list[str] | None = None, global_seen_hashes: dict | None = None) -> list[dict]:
    """Crops detected figures from clean page images and saves them inside flagged_figures subdirectory."""
    ext = Path(file_name).suffix.lower()
    pages_data = azure_result.get("pages", [])
    figures = azure_result.get("figures", [])

    if ext != ".pdf" and ext not in {".png", ".jpg", ".jpeg", ".tiff", ".bmp", ".webp"}:
        return []

    flagged_figures_dir = output_dir / "flagged_figures"
    flagged_figures_dir.mkdir(parents=True, exist_ok=True)

    page_dimensions = {}
    if ext == ".pdf":
        for pg in pages_data:
            p_num = pg.get("pageNumber")
            if p_num:
                page_dimensions[p_num] = {
                    "width": pg.get("width", 8.5),
                    "height": pg.get("height", 11.0),
                    "unit": pg.get("unit", "inch")
                }
    else:
        az_page = pages_data[0] if pages_data else {}
        page_dimensions[1] = {
            "width": az_page.get("width", 8.5),
            "height": az_page.get("height", 11.0),
            "unit": az_page.get("unit", "inch")
        }

    def map_coords(val, page_num):
        dim = page_dimensions.get(page_num, {"unit": "pixel"})
        if dim.get("unit") == "inch":
            return val * 150
        return val

    if global_seen_hashes is None:
        global_seen_hashes = {}
    seen_hashes = global_seen_hashes
    figures_list = []
    
    candidates = []
    if ext in {".png", ".jpg", ".jpeg", ".tiff", ".bmp", ".webp"}:
        dim = page_dimensions.get(1, {"width": 1000, "height": 1000})
        w = dim["width"]
        h = dim["height"]
        candidates.append({
            "fig_idx": -1,
            "region_idx": 0,
            "page_num": 1,
            "bbox": (0.0, 0.0, w, h),
            "area": w * h,
            "polygon": [0.0, 0.0, w, 0.0, w, h, 0.0, h],
            "is_standalone_full": True
        })

    for fig_idx, fig in enumerate(figures):
        regions = fig.get("boundingRegions", [])
        for region_idx, region in enumerate(regions):
            page_num = region.get("pageNumber")
            polygon = region.get("polygon")
            if not page_num or not polygon:
                continue
            xmin, ymin, xmax, ymax = get_bbox_from_polygon(polygon)
            candidates.append({
                "fig_idx": fig_idx,
                "region_idx": region_idx,
                "page_num": page_num,
                "bbox": (xmin, ymin, xmax, ymax),
                "area": abs(xmax - xmin) * abs(ymax - ymin),
                "polygon": polygon,
                "is_standalone_full": False
            })

    candidates.sort(key=lambda c: c["area"], reverse=True)
    
    accepted_candidates = []
    for cand in candidates:
        page_num = cand["page_num"]
        cx0, cy0, cx1, cy1 = cand["bbox"]
        is_subpart = False
        eps = 0.05
        for parent in accepted_candidates:
            if parent["page_num"] == page_num:
                px0, py0, px1, py1 = parent["bbox"]
                if cx0 >= px0 - eps and cy0 >= py0 - eps and cx1 <= px1 + eps and cy1 <= py1 + eps:
                    is_subpart = True
                    print(f"  ⏭️ Skipping subpart figure on page {page_num} (contained within larger figure)")
                    break
        if is_subpart:
            continue
        accepted_candidates.append(cand)

    by_page_candidates = {}
    for cand in accepted_candidates:
        by_page_candidates.setdefault(cand["page_num"], []).append(cand)

    if ext == ".pdf":
        if not HAVE_FITZ:
            print(f"⚠️ PyMuPDF not installed, skipping figure crops for {file_name}")
            return []
        import fitz

        doc = fitz.open(stream=file_bytes, filetype="pdf")
        for page_num in sorted(by_page_candidates.keys()):
            if page_num > len(doc) or page_num < 1:
                continue
            page = doc[page_num - 1]
            pix = page.get_pixmap(dpi=150)
            img_data = pix.tobytes("png")
            
            from io import BytesIO
            clean_img = Image.open(BytesIO(img_data)).convert("RGBA")

            for cand in by_page_candidates[page_num]:
                fig_idx = cand["fig_idx"]
                region_idx = cand["region_idx"]
                xmin, ymin, xmax, ymax = cand["bbox"]

                w = abs(xmax - xmin)
                h = abs(ymax - ymin)
                dim = page_dimensions.get(page_num, {"unit": "pixel"})
                unit = dim.get("unit", "pixel")
                if unit == "inch":
                    if w < 0.83 and h < 0.83:
                        continue
                else:
                    if w < 100 and h < 100:
                        continue

                x0 = map_coords(xmin, page_num)
                y0 = map_coords(ymin, page_num)
                x1 = map_coords(xmax, page_num)
                y1 = map_coords(ymax, page_num)

                x0_c = max(0, min(x0, clean_img.width))
                y0_c = max(0, min(y0, clean_img.height))
                x1_c = max(0, min(x1, clean_img.width))
                y1_c = max(0, min(y1, clean_img.height))

                if abs(x1_c - x0_c) > 5 and abs(y1_c - y0_c) > 5:
                    crop = clean_img.crop((x0_c, y0_c, x1_c, y1_c))
                    img_hash = calculate_dhash(crop)

                    if template_hashes:
                        is_ignored = False
                        for th in template_hashes:
                            if hamming_distance_bitwise(img_hash, th) <= 12:
                                is_ignored = True
                                print(f"  🚫 Skipping ignored template figure on page {page_num}")
                                break
                        if is_ignored:
                            crop.close()
                            continue

                    is_duplicate = False
                    for existing_hash, existing_info in seen_hashes.items():
                        if hamming_distance_bitwise(img_hash, existing_hash) <= 4:
                            is_duplicate = True
                            matched_doc = existing_info.get("document")
                            if matched_doc and matched_doc != file_name:
                                print(f"  ⏭️ Skipping duplicate figure on page {page_num} (matches {matched_doc} page {existing_info['page']})")
                            else:
                                print(f"  ⏭️ Skipping duplicate figure on page {page_num} (matches page {existing_info['page']})")
                            break
                    if is_duplicate:
                        crop.close()
                        continue

                    crop_name = f"{Path(file_name).stem}_fig_{fig_idx}_{region_idx}_p{page_num}.png"
                    crop_path = flagged_figures_dir / crop_name
                    crop.convert("RGB").save(str(crop_path))

                    seen_hashes[img_hash] = {
                        "document": file_name,
                        "page": page_num,
                        "path": str(crop_path)
                    }

                    figures_list.append({
                        "figure_id": f"fig_{fig_idx}_p{page_num}",
                        "page": page_num,
                        "cropped_image_path": str(crop_path),
                        "bbox": {"x0": round(xmin, 2), "y0": round(ymin, 2), "x1": round(xmax, 2), "y1": round(ymax, 2)},
                        "reason": "Azure prebuilt-layout figure detection"
                    })
                    crop.close()
            clean_img.close()
        doc.close()
    else:
        from io import BytesIO
        clean_img = Image.open(BytesIO(file_bytes)).convert("RGBA")
        for cand in by_page_candidates.get(1, []):
            if cand["is_standalone_full"]:
                crop = clean_img.copy()
                crop_name = f"{Path(file_name).stem}_full.png"
                crop_path = flagged_figures_dir / crop_name
                crop.convert("RGB").save(str(crop_path))
                
                img_hash = calculate_dhash(crop)
                seen_hashes[img_hash] = {
                    "document": file_name,
                    "page": 1,
                    "path": str(crop_path)
                }
                
                figures_list.append({
                    "figure_id": "image_page_1",
                    "page": 1,
                    "cropped_image_path": str(crop_path),
                    "bbox": None,
                    "reason": "Standalone image file. Needs vision-LLM review."
                })
                crop.close()
        clean_img.close()

    return figures_list

async def call_azure_layout_chunked(file_bytes: bytes, chunk_size: int = 50, pages: str = None) -> dict:
    """
    Split large PDFs into chunks and process each through Azure DI.
    Merges results into one analyzeResult dict with correct page numbers.
    Used automatically for PDFs over 50MB to avoid upload timeouts.
    """
    import fitz  # PyMuPDF

    # Split PDF into chunks
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    total_pages = len(doc)
    doc.close()

    # Only chunk if more than 50 pages — files under 50 pages go directly (uses 300s timeout)
    if total_pages <= chunk_size or pages:
        return await call_azure_layout(file_bytes, pages=pages)

    print(f"[AZURE] Large PDF ({total_pages} pages) — processing in {chunk_size}-page chunks")

    all_pages = []
    all_figures = []
    all_tables = []
    all_paragraphs = []

    # Reopen to extract pages for chunking
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    chunks = []
    for start in range(0, total_pages, chunk_size):
        end = min(start + chunk_size, total_pages)
        chunk_doc = fitz.open()
        chunk_doc.insert_pdf(doc, from_page=start, to_page=end - 1)
        chunk_bytes = chunk_doc.tobytes()
        chunk_doc.close()
        chunks.append((start, end, chunk_bytes))
    doc.close()


    _sem = asyncio.Semaphore(3)
    async def _run_chunk(chunk_num, start, end, chunk_bytes):
        async with _sem:
            print(f"[AZURE] Chunk {chunk_num + 1}/{len(chunks)}: pages {start+1}-{end}")
            try:
                return start, end, await call_azure_layout(chunk_bytes)
            except Exception as e:
                print(f"[WARN] Chunk {chunk_num + 1} failed: {e}")
                return start, end, None
    _chunk_results = await asyncio.gather(*[
        _run_chunk(i, s, e, b) for i, (s, e, b) in enumerate(chunks)
    ])
    for start, end, result in _chunk_results:
        if result is None:
            continue

        # Remap page numbers to actual document page numbers
        for page in result.get("pages", []):
            local_pg = page.get("pageNumber", 0)
            page["pageNumber"] = start + local_pg
            all_pages.append(page)

        for fig in result.get("figures", []):
            for region in fig.get("boundingRegions", []):
                local_pg = region.get("pageNumber", 0)
                region["pageNumber"] = start + local_pg
            all_figures.append(fig)

        for table in result.get("tables", []):
            for region in table.get("boundingRegions", []):
                local_pg = region.get("pageNumber", 0)
                region["pageNumber"] = start + local_pg
            for cell in table.get("cells", []):
                for region in cell.get("boundingRegions", []):
                    local_pg = region.get("pageNumber", 0)
                    region["pageNumber"] = start + local_pg
            all_tables.append(table)

        for para in result.get("paragraphs", []):
            for region in para.get("boundingRegions", []):
                local_pg = region.get("pageNumber", 0)
                region["pageNumber"] = start + local_pg
            all_paragraphs.append(para)


    return {
        "pages": all_pages,
        "figures": all_figures,
        "tables": all_tables,
        "paragraphs": all_paragraphs,
    }


async def process_document_bytes(
    file_bytes: bytes,
    file_name: str,
    output_dir: Path,
    save_individual_json: bool = False,
    template_hashes: list[str] | None = None,
    global_seen_hashes: dict | None = None,
    pages: str = None,
    total_pages: int = None,
) -> dict:
    """Send document to Azure, run highlight renderings, crop figures, and return structured document dictionary."""
    if template_hashes is None:
        template_hashes = load_ignored_templates()
    if global_seen_hashes is None:
        global_seen_hashes = {}

    # Check if the entire document is a standalone image matching an ignore template or previously seen figure
    ext = Path(file_name).suffix.lower()
    if ext in {".png", ".jpg", ".jpeg", ".tiff", ".bmp", ".webp"}:
        try:
            from io import BytesIO
            with Image.open(BytesIO(file_bytes)) as img:
                img_hash = calculate_dhash(img)
                
                # Check template ignore hashes
                if template_hashes and any(hamming_distance_bitwise(img_hash, th) <= 12 for th in template_hashes):
                    print(f"  🚫 Skipping ignored standalone document: {file_name}")
                    return {
                        "n_pages": 0,
                        "headings": [],
                        "paragraphs": [],
                        "tables": [],
                        "figures": [],
                        "full_text_by_page": {},
                        "visual_pages": [],
                        "ignored": True
                    }
                
                # Check global seen hashes for duplicate
                is_duplicate = False
                for existing_hash, existing_info in global_seen_hashes.items():
                    if hamming_distance(img_hash, existing_hash) <= 4:
                        is_duplicate = True
                        print(f"  ⏭️ Skipping duplicate standalone image: {file_name} (matches {existing_info.get('document', 'another document')} page {existing_info.get('page', 1)})")
                        break
                if is_duplicate:
                    return {
                        "n_pages": 0,
                        "headings": [],
                        "paragraphs": [],
                        "tables": [],
                        "figures": [],
                        "full_text_by_page": {},
                        "visual_pages": [],
                        "ignored": True
                    }
                
        except Exception as e:
            print(f"  (could not check template/duplicate match for standalone document {file_name}: {e})")

    # 1. Call Azure layout engine
    # Use chunked processing for large PDFs (avoids 60s upload timeout)
    # or multi-page PDFs where parallel chunks are much faster
    file_size_mb = len(file_bytes) / (1024 * 1024)
    import fitz as _fitz
    _probe = _fitz.open(stream=file_bytes, filetype="pdf")
    total_pages_local = len(_probe)
    _probe.close()
    if total_pages is None:
        total_pages = total_pages_local

    if file_size_mb > 40 or total_pages > 6:
        print(f"[AZURE] {total_pages} pages, {file_size_mb:.1f}MB — using chunked processing")
        azure_result = await call_azure_layout_chunked(file_bytes, chunk_size=4, pages=pages)
    else:
        azure_result = await call_azure_layout(file_bytes, pages=pages)

    doc_stem = Path(file_name).stem
    # Save raw API JSON response if requested
    if save_individual_json:
        raw_json_path = output_dir / f"{doc_stem}_raw_result.json"
        atomic_write_json(raw_json_path, azure_result, indent=2)

    # 2. Render and save highlighted page images (Skipped as requested)
    visual_pages = []

    # 3. Crop figures
    figures_list = crop_figures(file_bytes, file_name, azure_result, output_dir, template_hashes=template_hashes, global_seen_hashes=global_seen_hashes)

    # 4. Generate structured document format
    full_text_by_page = {}
    for para in azure_result.get("paragraphs", []):
        regions = para.get("boundingRegions", [])
        if regions:
            page_num = regions[0].get("pageNumber", 1)
            full_text_by_page.setdefault(page_num, []).append(para.get("content", ""))

    extracted_lines = []
    extracted_words = []
    for p in azure_result.get("pages", []):
        page_num = p.get("pageNumber", 1)
        for line in p.get("lines", []):
            extracted_lines.append({
                "text": line.get("content", ""),
                "page": page_num,
                "bbox": get_bbox_from_polygon(line.get("polygon")) if line.get("polygon") else None,
            })
        for word in p.get("words", []):
            extracted_words.append({
                "text": word.get("content", ""),
                "page": page_num,
                "bbox": get_bbox_from_polygon(word.get("polygon")) if word.get("polygon") else None,
            })

    structured = {
        "n_pages": total_pages if total_pages is not None else len(azure_result.get("pages", [])),
        "headings": [],
        "lines": extracted_lines,
        "words": extracted_words,
        "paragraphs": [
            {
                "text": p.get("content", ""),
                "page": p.get("boundingRegions", [{}])[0].get("pageNumber"),
                "bbox": get_bbox_from_polygon(p.get("boundingRegions", [{}])[0].get("polygon")) if p.get("boundingRegions", [{}])[0].get("polygon") else None,
                "label": "text"
            } for p in azure_result.get("paragraphs", [])
        ],
        "tables": [
            {
                "page": t.get("boundingRegions", [{}])[0].get("pageNumber") if t.get("boundingRegions") else 1,
                "bbox": get_bbox_from_polygon(t.get("boundingRegions", [{}])[0].get("polygon")) if t.get("boundingRegions") and t.get("boundingRegions", [{}])[0].get("polygon") else None,
                "n_rows": t.get("rowCount", 0),
                "n_cols": t.get("columnCount", 0),
                "cells": [
                    {
                        "row": cell.get("rowIndex"),
                        "col": cell.get("columnIndex"),
                        "text": cell.get("content", "")
                    } for cell in t.get("cells", [])
                ]
            } for t in azure_result.get("tables", [])
        ],
        "figures": figures_list,
        "full_text_by_page": {
            str(p): "\n".join(lines) for p, lines in sorted(full_text_by_page.items())
        },
        "visual_pages": visual_pages
    }

    # Save clean JSON summary if requested
    if save_individual_json:
        clean_json_path = output_dir / f"{doc_stem}_extracted_data.json"
        atomic_write_json(clean_json_path, structured, indent=2)

    return structured

def extract_email_metadata(file_path: Path) -> tuple[dict, str, list[tuple[str, bytes]]]:
    """Parse EML file to extract metadata, body, and attachments."""
    import email
    from email import policy

    with open(file_path, "rb") as f:
        msg = email.message_from_bytes(f.read(), policy=policy.default)

    headers = {
        "subject": msg.get("Subject", ""),
        "from": msg.get("From", ""),
        "to": msg.get("To", ""),
        "date": msg.get("Date", "")
    }

    body_parts = []
    attachments = []

    if msg.is_multipart():
        for part in msg.walk():
            content_type = part.get_content_type()
            disposition = part.get_content_disposition()

            # Handle attachments
            if disposition == "attachment" or part.get_filename():
                filename = part.get_filename()
                if filename:
                    payload = part.get_payload(decode=True)
                    if payload:
                        attachments.append((filename, payload))
            # Handle email body text
            elif content_type == "text/plain":
                payload = part.get_payload(decode=True)
                if payload:
                    body_parts.append(payload.decode(part.get_content_charset() or "utf-8", errors="replace"))
            elif content_type == "text/html" and not body_parts:
                # Fallback to HTML if plain text not populated
                payload = part.get_payload(decode=True)
                if payload:
                    body_parts.append(payload.decode(part.get_content_charset() or "utf-8", errors="replace"))
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            body_parts.append(payload.decode(msg.get_content_charset() or "utf-8", errors="replace"))

    email_body = "\n".join(body_parts)
    return headers, email_body, attachments

async def process_folder(source_folder: str) -> dict:
    """Iterate through all files in folder, process EML/attachment/documents, and output to <source_folder>/azure_results/."""
    folder = Path(source_folder)
    if not folder.exists():
        raise FileNotFoundError(f"Source folder does not exist: {source_folder}")

    # Load ignore templates once
    template_hashes = load_ignored_templates()

    # Track all seen hashes globally across all documents in folder scan
    global_seen_hashes = {}

    output_dir = folder / "azure_results"
    output_dir.mkdir(parents=True, exist_ok=True)

    # Gather files (only direct files in source folder, skipping subfolders)
    files = sorted(
        p for p in folder.glob("*")
        if p.is_file() and p.suffix.lower() in SUPPORTED_EXT.union({".eml", ".msg"})
    )

    consolidated = {
        "project_folder": str(folder.resolve()),
        "documents": {},
        "summary": {
            "total_figures_flagged": 0,
            "total_tables": 0,
            "total_paragraphs": 0,
            "total_headings": 0
        },
        "errors": []
    }

    print(f"\n📁 Processing source folder: {folder.name} (Found {len(files)} files)")

    for f in files:
        t0 = time.time()
        ext = f.suffix.lower()

        if ext in {".eml", ".msg"}:
            print(f"\n✉️ Extracting Email: {f.name}")
            try:
                headers, email_body, attachments = extract_email_metadata(f)
                
                # Treat the email body text as a simplified document
                email_doc_name = f.name
                structured_email = {
                    "n_pages": 1,
                    "headings": [],
                    "paragraphs": [{"text": email_body, "page": 1, "bbox": None, "label": "email_body"}],
                    "tables": [],
                    "figures": [],
                    "full_text_by_page": {"1": email_body},
                    "visual_pages": [],
                    "is_email": True,
                    "email_headers": headers,
                    "attachments": []
                }

                consolidated["documents"][email_doc_name] = structured_email
                consolidated["summary"]["total_paragraphs"] += 1

                # Now process each email attachment
                for attach_name, attach_bytes in attachments:
                    attach_ext = Path(attach_name).suffix.lower()
                    if attach_ext in SUPPORTED_EXT:
                        print(f"  📎 Processing email attachment: {attach_name}")
                        # Prefix the file name with email name to keep it unique
                        unique_attach_name = f"{f.stem}_attachment_{attach_name}"
                        
                        try:
                            structured_attach = await process_document_bytes(attach_bytes, unique_attach_name, output_dir, template_hashes=template_hashes, global_seen_hashes=global_seen_hashes)
                            if structured_attach.get("ignored"):
                                print(f"    🚫 Skipping ignored attachment: {attach_name}")
                                continue
                            consolidated["documents"][unique_attach_name] = structured_attach
                            
                            # Add reference
                            structured_email["attachments"].append(unique_attach_name)

                            # Add to counts
                            consolidated["summary"]["total_figures_flagged"] += len(structured_attach.get("figures", []))
                            consolidated["summary"]["total_tables"] += len(structured_attach.get("tables", []))
                            consolidated["summary"]["total_paragraphs"] += len(structured_attach.get("paragraphs", []))
                        except Exception as ex:
                            print(f"    ✗ Failed to process email attachment {attach_name}: {ex}")
                            consolidated["errors"].append({"file": f"{f.name}/{attach_name}", "error": str(ex)})

            except Exception as e:
                print(f"  ✗ Failed to process EML file: {e}")
                consolidated["errors"].append({"file": f.name, "error": str(e)})

        elif ext in SUPPORTED_EXT:
            print(f"\n📄 Processing Document: {f.name}")
            try:
                with open(f, "rb") as fh:
                    file_bytes = fh.read()
                
                structured = await process_document_bytes(file_bytes, f.name, output_dir, template_hashes=template_hashes, global_seen_hashes=global_seen_hashes)
                if structured.get("ignored"):
                    print(f"  🚫 Skipping ignored standalone document: {f.name}")
                    continue
                
                consolidated["documents"][f.name] = structured
                consolidated["summary"]["total_figures_flagged"] += len(structured.get("figures", []))
                consolidated["summary"]["total_tables"] += len(structured.get("tables", []))
                consolidated["summary"]["total_paragraphs"] += len(structured.get("paragraphs", []))
                
                elapsed = round(time.time() - t0, 1)
                print(f"  ✓ {elapsed}s — {len(structured.get('paragraphs', []))} paragraphs, "
                      f"{len(structured.get('tables', []))} tables, "
                      f"{len(structured.get('figures', []))} figures flagged")

            except Exception as e:
                print(f"  ✗ Failed to process document: {e}")
                consolidated["errors"].append({"file": f.name, "error": str(e)})

    # Write consolidated summary
    consolidated_path = output_dir / "azure_extracted_data.json"
    atomic_write_json(consolidated_path, consolidated, ensure_ascii=False, indent=2)

    print(f"\n{'='*60}")
    print(f"✅ {len(consolidated['documents'])} documents (including attachments) processed successfully!")
    print(f"   {consolidated['summary']['total_tables']} tables extracted")
    print(f"   {consolidated['summary']['total_figures_flagged']} figures/drawings flagged & cropped")
    print(f"   Consolidated JSON Summary Saved: {consolidated_path}")
    print(f"{'='*60}\n")

    # Standalone vision run hook removed. Run ai_engine.py instead.
    pass

    return consolidated

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python azure_extract.py <source_folder>")
        print("Example: python azure_extract.py \"test/jane st\"")
        sys.exit(1)

    src_folder = sys.argv[1]
    asyncio.run(process_folder(src_folder))
