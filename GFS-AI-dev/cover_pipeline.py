import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple

# Load dotenv if present to ensure environment variables are loaded in CLI runs
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# Set dynamic default cache directories within the workspace to avoid downloading weights repeatedly

# Load dotenv if present to ensure environment variables are loaded in CLI runs
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# Set dynamic default cache directories within the workspace to avoid downloading weights repeatedly
if "HF_HOME" not in os.environ:
    os.environ["HF_HOME"] = str(Path(__file__).parent.resolve() / ".cache" / "huggingface")
if "DOCLING_SERVE_ARTIFACTS_PATH" not in os.environ:
    os.environ["DOCLING_SERVE_ARTIFACTS_PATH"] = str(Path(__file__).parent.resolve() / ".cache" / "docling")


from extraction.vision_client import call_vision_batch
from extraction.vision_extract import render_pdf_to_images, chunk_pages, _encode_image_block
from extraction.content_parser import parse_content

# The cover stage prioritizes identifying the project lead and site location.
# 'project_address' is the single critical field that triggers vision fallback if missing.
# Tech spec fields (e.g., system_type, glass_type) are out-of-scope for the cover stage sufficiency check.
CRITICAL_FIELDS = {"project_address"}
INTERNAL_EMAIL_DOMAINS = {"glassflooringsystems.com"}
VALID_ACTIONS = {"CREATE", "LINK", "NOT_PROJECT"}


def normalize_action(action: Any, default: str = "CREATE") -> str:
    """Return an action accepted by the backend webhook schema."""
    if not isinstance(action, str):
        return default

    normalized = action.strip().upper().replace("-", "_").replace(" ", "_")
    if normalized in VALID_ACTIONS:
        return normalized
    if normalized in {"NOTPROJECT", "NOT_A_PROJECT", "NON_PROJECT"}:
        return "NOT_PROJECT"

    # Models sometimes echo the schema placeholder literally:
    # "CREATE | LINK | NOT_PROJECT". Treat that as the default branch rather
    # than leaking an invalid enum value to the backend.
    if "|" in normalized:
        parts = {part.strip() for part in normalized.split("|")}
        valid_parts = parts & VALID_ACTIONS
        if len(valid_parts) == 1:
            return valid_parts.pop()
        return default

    return default


def adapt_docling_output(doc_entries: List[Dict[str, Any]]) -> str:
    """Concatenate full_text_by_page across all documents in page order."""
    doc_texts: List[str] = []
    for doc in doc_entries:
        pages = doc.get("full_text_by_page", {})
        if not pages:
            continue
        sorted_keys = sorted(pages.keys(), key=int)
        doc_text = "\n".join(pages[k] for k in sorted_keys if pages[k])
        if doc_text.strip():
            doc_texts.append(doc_text.strip())
    return "\n\n=== DOCUMENT SEPARATOR ===\n\n".join(doc_texts)


def select_cover_pages(doc_entry: Dict[str, Any]) -> List[int]:
    """Return 1-indexed page numbers suitable for cover/email page analysis."""
    n_pages = doc_entry.get("n_pages", 0)
    if not n_pages:
        all_pages = (
            [p.get("page") for p in doc_entry.get("paragraphs", []) if p.get("page") is not None] +
            [h.get("page") for h in doc_entry.get("headings", []) if h.get("page") is not None] +
            [f.get("page") for f in doc_entry.get("figures", []) if f.get("page") is not None]
        )
        n_pages = max(all_pages) if all_pages else 0

    selected: List[int] = []
    for page_num in range(1, n_pages + 1):
        num_paragraphs = sum(1 for p in doc_entry.get("paragraphs", []) if p.get("page") == page_num)
        num_headings = sum(1 for h in doc_entry.get("headings", []) if h.get("page") == page_num)
        num_figures = sum(1 for f in doc_entry.get("figures", []) if f.get("page") == page_num)

        if (num_paragraphs + num_headings >= 1) and (num_figures <= num_paragraphs):
            selected.append(page_num)
    return selected


def is_sufficient(extracted_fields: Dict[str, Any], needs_llm: List[str]) -> bool:
    """Determine if direct text extraction yields sufficient cover-level information."""
    for field in needs_llm:
        if field in CRITICAL_FIELDS:
            return False
    if not extracted_fields.get("project_address"):
        return False
    return True


def build_fast_path_response(extracted_fields: Dict[str, Any]) -> Dict[str, Any]:
    """Construct pipeline response from direct non-AI extracted fields without API calls."""
    email = extracted_fields.get("contact_email") or ""
    customer_name = "Unknown Customer"
    if email and "@" in email:
        domain = email.split("@")[-1].lower()
        if domain not in INTERNAL_EMAIL_DOMAINS:
            name_part = email.split("@")[0]
            customer_name = " ".join(part.capitalize() for part in name_part.replace(".", " ").replace("_", " ").split())
    customer_name = " ".join(customer_name.split())
    
    address = extracted_fields.get("project_address") or ""
    address = " ".join(address.split())
    if len(address) > 80:
        address = ""  # regex over-matched, treat as not found
        
    project_name = f"Project at {address}" if address else "New GFS Project"
    
    system_type = extracted_fields.get("system_type") or ""
    system_type = " ".join(system_type.split())
    
    glass_type = extracted_fields.get("glass_type") or ""
    glass_type = " ".join(glass_type.split())
    
    summary_parts = []
    if customer_name != "Unknown Customer":
        summary_parts.append(f"Project inquiry from {customer_name}")
    else:
        summary_parts.append("New project inquiry")
    
    if address:
        summary_parts.append(f"located at {address}")
    
    specs = []
    if system_type:
        specs.append(system_type)
    if glass_type:
        specs.append(glass_type)
        
    if specs:
        summary_parts.append(f"requesting {' '.join(specs)}")
    
    quote = extracted_fields.get("quote_number")
    if quote:
        summary_parts.append(f"(matching existing quote #{quote})")
        
    summary = " ".join(summary_parts) + "."
    action = "LINK" if quote else "CREATE"
    is_project = action != "NOT_PROJECT"
    
    return {
        "action": action,
        "readinessState": "SUFFICIENT_DATA",
        "proposed": {
            "isProject": is_project,
            "customerName": customer_name,
            "projectName": project_name,
            "projectType": "NEW_ESTIMATE",
            "summary": summary,
            "confidence": 1.0,
            "reasoning": "all required fields found via direct text extraction, no AI inference needed."
        }
    }


def COVER_FALLBACK_PROMPT(email_text: str, extracted_fields: Dict[str, Any], needs_llm: List[str]) -> str:
    """Generate the structured instruction prompt for the fallback vision model."""
    import json
    fields_str = json.dumps(extracted_fields, ensure_ascii=False)
    needs_str = json.dumps(needs_llm, ensure_ascii=False)
    return (
        f"You are analyzing cover/email pages for a GFS project lead. Determine if this is a real project inquiry.\n\n"
        f"PRE-EXTRACTED FIELDS FROM TEXT:\n{fields_str}\n\n"
        f"MISSING OR FLAGGED FIELDS:\n{needs_str}\n\n"
        f"RAW TEXT LAYER:\n{email_text}\n\n"
        f"INSTRUCTIONS:\n"
        f"1. Prefer the pre-extracted fields where they are non-empty. Correct them only if they are clearly wrong.\n"
        f"2. Set 'action' to 'LINK' only if an existing quote, order, or proposal number is explicitly visible.\n"
        f"3. Set 'action' to 'NOT_PROJECT' if the pages are not a project inquiry (e.g. junk, general ads).\n"
        f"4. Otherwise, set 'action' to 'CREATE'.\n"
        f"5. Set 'readinessState' to:\n"
        f"   - 'SUFFICIENT_DATA' if enough scope exists to act on.\n"
        f"   - 'MISSING_DOCUMENTS' if drawings or key attachments are referenced but missing.\n"
        f"   - 'NEEDS_CLARIFICATION' if details are ambiguous or conflicting.\n"
        f"6. For 'proposed':\n"
        f"   - 'isProject': Boolean (true if action != 'NOT_PROJECT', false otherwise).\n"
        f"   - 'customerName': Use the company or individual name. Never invent one. Default to 'Unknown Customer'.\n"
        f"   - 'projectName': Descriptive name based on address or customer name. Never invent fictitious names.\n"
        f"   - 'projectType': Must be 'NEW_ESTIMATE'.\n"
        f"   - 'summary': A concise one-sentence description of the inquiry.\n"
        f"   - 'confidence': Float [0.0 - 1.0]. Lower it if you must make assumptions or infer fields.\n"
        f"   - 'reasoning': Simple explanation of decisions.\n\n"
        f"REQUIRED SCHEMA:\n"
        f"{{\n"
        f"  \"action\": \"CREATE | LINK | NOT_PROJECT\",\n"
        f"  \"readinessState\": \"SUFFICIENT_DATA | MISSING_DOCUMENTS | NEEDS_CLARIFICATION\",\n"
        f"  \"proposed\": {{\n"
        f"    \"isProject\": boolean,\n"
        f"    \"customerName\": \"string\",\n"
        f"    \"projectName\": \"string\",\n"
        f"    \"projectType\": \"NEW_ESTIMATE\",\n"
        f"    \"summary\": \"string\",\n"
        f"    \"confidence\": float,\n"
        f"    \"reasoning\": \"string\"\n"
        f"  }}\n"
        f"}}"
    )


def run_vision_fallback(
    doc_pairs: List[Tuple[Dict[str, Any], Path]],
    email_text: str,
    extracted_fields: Dict[str, Any],
    needs_llm: List[str]
) -> Dict[str, Any]:
    """Execute LLM Vision fallback analysis on cover pages for missing details."""
    import time
    render_seconds = 0.0
    api_call_seconds = 0.0

    # Exclude drawings from the vision review target set
    lead_pairs = [(d, p) for d, p in doc_pairs if "customer provided" not in str(p).lower()]
    active_pairs = lead_pairs or doc_pairs

    combined_pages: List[Tuple[bytes, int, str]] = []
    for doc_entry, pdf_path in active_pairs:
        cover_pages = select_cover_pages(doc_entry)
        if not cover_pages:
            continue
        try:
            t_start = time.perf_counter()
            rendered = render_pdf_to_images(pdf_path)
            render_seconds += time.perf_counter() - t_start
        except Exception as exc:
            print(f"      [WARNING] failed to render PDF {pdf_path.name}: {exc}")
            continue
        for png_bytes, page_num, raw_text in rendered:
            if page_num in cover_pages:
                combined_pages.append((png_bytes, page_num, raw_text))

    if not combined_pages:
        action = "NOT_PROJECT"
        is_project = action != "NOT_PROJECT"
        return {
            "action": action,
            "readinessState": "NEEDS_CLARIFICATION",
            "proposed": {
                "isProject": is_project,
                "customerName": "",
                "projectName": "",
                "projectType": "NEW_ESTIMATE",
                "summary": "",
                "confidence": 0.0,
                "reasoning": "No valid cover pages selected across all documents."
            },
            "_render_seconds": render_seconds,
            "_api_call_seconds": api_call_seconds
        }

    chunks = chunk_pages(combined_pages)
    best_result: Any = None
    max_confidence: float = -1.0

    prompt = COVER_FALLBACK_PROMPT(email_text, extracted_fields, needs_llm)

    for chunk in chunks:
        image_blocks = [_encode_image_block(page[0]) for page in chunk]
        
        t_start = time.perf_counter()
        raw = call_vision_batch(image_blocks, prompt)
        api_call_seconds += time.perf_counter() - t_start

        if not raw.get("ok"):
            err_msg = raw.get("error") or "Unknown API error"
            action = "NOT_PROJECT"
            is_project = action != "NOT_PROJECT"
            return {
                "action": action,
                "readinessState": "NEEDS_CLARIFICATION",
                "proposed": {
                    "isProject": is_project,
                    "customerName": "",
                    "projectName": "",
                    "projectType": "NEW_ESTIMATE",
                    "summary": "",
                    "confidence": 0.0,
                    "reasoning": f"vision extraction failed: {err_msg}"
                },
                "_render_seconds": render_seconds,
                "_api_call_seconds": api_call_seconds
            }

        data = raw.get("data") or {}
        proposed = data.get("proposed") or {}
        try:
            conf = float(proposed.get("confidence") if proposed.get("confidence") is not None else data.get("confidence", 0.0))
        except (TypeError, ValueError):
            conf = 0.0

        if conf > max_confidence:
            max_confidence = conf
            best_result = data

    if not best_result:
        action = "NOT_PROJECT"
        is_project = action != "NOT_PROJECT"
        return {
            "action": action,
            "readinessState": "NEEDS_CLARIFICATION",
            "proposed": {
                "isProject": is_project,
                "customerName": "",
                "projectName": "",
                "projectType": "NEW_ESTIMATE",
                "summary": "",
                "confidence": 0.0,
                "reasoning": "Vision extraction returned no data."
            },
            "_render_seconds": render_seconds,
            "_api_call_seconds": api_call_seconds
        }

    proposed = best_result.get("proposed") or {}
    action = normalize_action(best_result.get("action"), default="CREATE")
    is_project = action != "NOT_PROJECT"
    reasoning = proposed.get("reasoning") if proposed.get("reasoning") is not None else best_result.get("reasoning", "")
    return {
        "action": action,
        "readinessState": best_result.get("readinessState") or "NEEDS_CLARIFICATION",
        "proposed": {
            "isProject": is_project,
            "customerName": proposed.get("customerName") or "",
            "projectName": proposed.get("projectName") or "",
            "projectType": proposed.get("projectType") or "NEW_ESTIMATE",
            "summary": proposed.get("summary") or "",
            "confidence": max_confidence,
            "reasoning": reasoning or ""
        },
        "_render_seconds": render_seconds,
        "_api_call_seconds": api_call_seconds
    }


def run_cover_pipeline(
    doc_pairs: List[Tuple[Dict[str, Any], Path]], 
    lead_id: str | None = None,
    correlation_id: str | None = None
) -> Dict[str, Any]:
    """Run the complete cover page analysis pipeline."""
    import time
    import json
    import re
    import datetime

    t_start_total = time.perf_counter()

    t_start_adapt = time.perf_counter()
    # Prioritize files that are not pure drawings/CAD attachments.
    # Exclude files under "customer provided" directories as they are drawing-heavy.
    lead_pairs = [(d, p) for d, p in doc_pairs if "customer provided" not in str(p).lower()]
    active_pairs = lead_pairs or doc_pairs  # fallback if all files are under drawing folders
    
    doc_entries = [pair[0] for pair in active_pairs]
    text = adapt_docling_output(doc_entries)
    parsed = parse_content({"text_content": text, "flagged_items": []})
    adapt_seconds = time.perf_counter() - t_start_adapt

    extracted_fields = parsed.get("extracted_fields") or {}
    needs_llm = parsed.get("needs_llm") or []

    t_start_sufficiency = time.perf_counter()
    sufficient = is_sufficient(extracted_fields, needs_llm)
    sufficiency_seconds = time.perf_counter() - t_start_sufficiency

    render_seconds = 0.0
    api_call_seconds = 0.0

    if sufficient:
        response = build_fast_path_response(extracted_fields)
    else:
        response = run_vision_fallback(active_pairs, text, extracted_fields, needs_llm)
        render_seconds = response.pop("_render_seconds", 0.0)
        api_call_seconds = response.pop("_api_call_seconds", 0.0)

    total_seconds = time.perf_counter() - t_start_total

    # Add timing breakdown
    response["timing"] = {
        "adapt_seconds": round(adapt_seconds, 4),
        "sufficiency_seconds": round(sufficiency_seconds, 4),
        "render_seconds": round(render_seconds, 4),
        "api_call_seconds": round(api_call_seconds, 4),
        "total_seconds": round(total_seconds, 4)
    }

    # Remove the old duration_seconds key if it's there
    response.pop("duration_seconds", None)

    # Rebuild the dict to ensure exactly the requested top-level order with correlationId
    action = normalize_action(response.get("action"), default="CREATE")
    proposed = response["proposed"]
    proposed["isProject"] = action != "NOT_PROJECT"
    ordered_response = {
        "correlationId": correlation_id,
        "action": action,
        "readinessState": response["readinessState"],
        "proposed": proposed,
        "timing": response["timing"]
    }
    response = ordered_response
    
    import logging

    logger = logging.getLogger(__name__)

    logger.info(
        "FINAL AI RESULT\n%s",
        json.dumps(response, indent=2, ensure_ascii=False)
    )

    # Save the output as a JSON file in the extraction_results directory inside the lead's folder
    if doc_pairs:
        _, first_pdf_path = doc_pairs[0]
        extraction_results_dir = first_pdf_path.parent / "extraction_results"
    else:
        extraction_results_dir = Path(__file__).parent / "extraction_results"
        
    extraction_results_dir.mkdir(exist_ok=True)
    
    if lead_id:
        filename = lead_id if lead_id.endswith(".json") else f"{lead_id}.json"
    else:
        if doc_pairs:
            _, first_pdf_path = doc_pairs[0]
            stem = first_pdf_path.stem
            sanitized_stem = re.sub(r'[^a-zA-Z0-9_\-]', '_', stem)
            sanitized_stem = re.sub(r'_+', '_', sanitized_stem).strip('_')
            timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"{sanitized_stem}_{timestamp}.json"
        else:
            timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"unknown_lead_{timestamp}.json"
            
    output_path = extraction_results_dir / filename
    try:
        output_path.write_text(json.dumps(response, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"      [SAVED] cover pipeline output written to: {output_path}")
    except Exception as exc:
        print(f"      [WARNING] failed to save cover pipeline output to JSON: {exc}")

    response["_output_path"] = str(output_path)
    return response


def build_doc_pairs(pdf_paths: List[Path]) -> Tuple[List[Tuple[Dict[str, Any], Path]], float]:
    """Extract structured data from a list of PDF or email lead files.
    
    Returns a tuple of (doc_pairs, elapsed_seconds).
    """
    import time
    import json
    t_start = time.perf_counter()

    try:
        from non_ai.docling_extractv2 import build_converter, extract_structured, extract_email_content
    except ImportError:
        sys.path.append(os.path.join(current_dir, "non_ai"))
        from docling_extractv2 import build_converter, extract_structured, extract_email_content  # type: ignore

    # Filter out pure drawing/CAD attachments from being processed by Docling in the cover stage.
    lead_paths = [p for p in pdf_paths if "customer provided" not in str(p).lower()]
    active_paths = lead_paths or pdf_paths

    converter = build_converter(use_ocr=False)
    doc_pairs: List[Tuple[Dict[str, Any], Path]] = []

    for pdf_path in active_paths:
        suffix = pdf_path.suffix.lower()
        if suffix in {".eml", ".msg"}:
            try:
                email_text = extract_email_content(str(pdf_path))
                doc_entry = {
                    "n_pages": 1,
                    "headings": [],
                    "paragraphs": [{"text": email_text, "page": 1, "bbox": None, "label": "text"}],
                    "tables": [],
                    "figures": [],
                    "full_text_by_page": {"1": email_text},
                }
                
                # Save intermediate non-AI structured email data
                output_folder = pdf_path.parent / "non_ai_results"
                output_folder.mkdir(exist_ok=True)
                structured_json_path = output_folder / f"{pdf_path.stem}_structured.json"
                try:
                    structured_json_path.write_text(
                        json.dumps(doc_entry, indent=2, ensure_ascii=False, default=str), 
                        encoding="utf-8"
                    )
                    print(f"      [SAVED] intermediate non-AI email data written to: {structured_json_path}")
                except Exception as exc:
                    print(f"      [WARNING] failed to save intermediate non-AI email data: {exc}")

                doc_pairs.append((doc_entry, pdf_path))
            except Exception as exc:
                print(f"[WARNING] failed to parse email lead file {pdf_path.name}: {exc}")
                continue
        else:
            try:
                output_folder = pdf_path.parent / "non_ai_results"
                output_folder.mkdir(exist_ok=True)
                picture_dir = output_folder / "flagged_figures"
                picture_dir.mkdir(exist_ok=True)

                result = converter.convert(str(pdf_path))
                doc = result.document
                structured = extract_structured(doc, str(pdf_path), str(picture_dir))

                doc_entry = {
                    "n_pages": structured["n_pages"],
                    "headings": structured["headings"],
                    "paragraphs": structured["paragraphs"],
                    "tables": structured["tables"],
                    "figures": structured["figures"],
                    "full_text_by_page": structured["full_text_by_page"],
                }
                
                # Save intermediate non-AI structured PDF data
                structured_json_path = output_folder / f"{pdf_path.stem}_structured.json"
                try:
                    structured_json_path.write_text(
                        json.dumps(doc_entry, indent=2, ensure_ascii=False, default=str), 
                        encoding="utf-8"
                    )
                    print(f"      [SAVED] intermediate non-AI PDF data written to: {structured_json_path}")
                except Exception as exc:
                    print(f"      [WARNING] failed to save intermediate non-AI PDF data: {exc}")

                doc_pairs.append((doc_entry, pdf_path))
            except Exception as exc:
                print(f"[WARNING] failed to extract structured content from {pdf_path.name}: {exc}")
                continue

    elapsed = time.perf_counter() - t_start
    return doc_pairs, elapsed


def process_lead_files(
    pdf_paths: List[Path], 
    lead_id: str | None = None,
    correlation_id: str | None = None
) -> Dict[str, Any]:
    """Orchestrate document conversion and cover analysis for a list of lead files."""
    import json
    doc_pairs, extraction_seconds = build_doc_pairs(pdf_paths)
    res = run_cover_pipeline(doc_pairs, lead_id=lead_id, correlation_id=correlation_id)
    
    if "timing" in res:
        res["timing"]["extraction_seconds"] = round(extraction_seconds, 4)
        if "total_seconds" in res["timing"]:
            res["timing"]["total_seconds"] = round(res["timing"]["total_seconds"] + extraction_seconds, 4)
            
    # Re-serialize with the updated timing values
    output_path_str = res.pop("_output_path", None)
    if output_path_str:
        output_path = Path(output_path_str)
        try:
            output_path.write_text(json.dumps(res, indent=2, ensure_ascii=False), encoding="utf-8")
            print(f"      [UPDATED SAVED] cover pipeline output re-written to: {output_path}")
        except Exception as exc:
            print(f"      [WARNING] failed to update cover pipeline output to JSON: {exc}")
            
    return res


if __name__ == "__main__":
    import argparse
    import json
    
    parser = argparse.ArgumentParser(description="Run the GFS Cover Intake Pipeline on lead files")
    parser.add_argument("paths", nargs="+", help="One or more PDF/email file paths, or a directory containing lead files")
    parser.add_argument("--lead-id", help="Optional custom lead ID to use for output filename")
    args = parser.parse_args()
    
    # Resolve all file paths (including expanding directories)
    resolved_paths = []
    for p in args.paths:
        path_obj = Path(p).resolve()
        if path_obj.is_dir():
            # Find all PDFs and emails in the directory
            pdf_files = list(path_obj.rglob("*.pdf"))
            email_files = list(path_obj.rglob("*.eml")) + list(path_obj.rglob("*.msg"))
            resolved_paths.extend(pdf_files + email_files)
        elif path_obj.is_file():
            resolved_paths.append(path_obj)
            
    # Filter unique paths and ignore non-results/ephemeral files
    unique_paths = sorted(list(set(
        p for p in resolved_paths 
        if "non_ai_results" not in p.parts
        and "extraction_results" not in p.parts
        and not p.name.startswith("._")
    )))
    
    if not unique_paths:
        print("Error: No valid PDF or email lead files found.")
        sys.exit(1)
        
    print(f"Processing {len(unique_paths)} lead file(s)...")
    for p in unique_paths:
        print(f"  - {p.name}")
        
    result = process_lead_files(unique_paths, lead_id=args.lead_id)
    print("\n--- Pipeline Result ---")
    print(json.dumps(result, indent=2))
