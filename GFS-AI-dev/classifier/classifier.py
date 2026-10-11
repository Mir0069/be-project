# classifier/classifier.py
# ─────────────────────────────────────────────────────────────────────────────
# Two-Pass AI-driven GFS Email Classifier (Production Version).
#
# Pass 1: AI relevance validation and structured signal extraction.
# Intermediate: Graph-based candidate filtering using AI-extracted signals.
# Pass 2: AI verification of candidates and final linkage classification.
# ─────────────────────────────────────────────────────────────────────────────
import json
import logging
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
import fitz  # PyMuPDF


def clean_json_text(text: str) -> str:
    """Strip markdown code fence blocks and return clean JSON string."""
    if not text:
        return ""
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return text.strip()

# Load .env from root if available
try:
    from dotenv import load_dotenv
    _root_env = Path(__file__).resolve().parent.parent / ".env"
    if not _root_env.exists():
        _root_env = Path(__file__).resolve().parent.parent.parent / ".env"
    load_dotenv(_root_env)
except ImportError:
    pass

from openai import OpenAI

from .graph_builder import get_realtime_graph
from .graph_matcher import find_candidates
from prompts.prompt_loader import load_prompt
from utils.io_utils import sanitize_vtt_and_zoho_text
from .prompt import (
    build_pass1_user_prompt,
    build_pass2_user_prompt,
)

logger = logging.getLogger(__name__)

# ── Azure OpenAI Configuration ────────────────────────────────────────────────
AZURE_API_KEY    = (os.getenv("AZURE_OPENAI_KEY") or os.getenv("AZURE_OPENAI_API_KEY", "")).strip()
AZURE_BASE_URL   = (os.getenv("AZURE_OPENAI_ENDPOINT") or os.getenv("AZURE_OPENAI_BASE_URL", "")).strip()
AZURE_DEPLOYMENT = (os.getenv("AZURE_OPENAI_CHAT_DEPLOYMENT") or os.getenv("AZURE_OPENAI_DEPLOYMENT") or "gpt-5").strip()

VALID_CLASSIFICATIONS = {"NEW_PROJECT", "EXISTING_PROJECT", "SPAM"}
_EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def to_confidence_percentage(value: Any) -> int:
    """Convert a confidence in EITHER scale to 0-100 int exactly once.

    Accepts 0.0-1.0 ratio (classifier LLM) or 0-100 percentage (retry/passthrough).
    Values > 1 are treated as already-percentaged and only clamped/rounded —
    never multiplied again. This fixes double-scaling (e.g. 95 -> 9500).
    """
    try:
        num = float(value)
    except (TypeError, ValueError):
        return 50
    if num <= 1.0 and num >= 0.0:
        return max(0, min(100, int(round(num * 100))))
    return max(0, min(100, int(round(num))))


def normalize_bidder_signals(raw_signals: Any) -> Dict[str, Any]:
    """Return bidder signals that are safe for the backend competitive-bid contract."""
    signals = dict(raw_signals) if isinstance(raw_signals, dict) else {}
    raw_bidders = signals.get("bidders")
    bidders: List[Dict[str, Any]] = []
    seen_emails = set()

    if isinstance(raw_bidders, list):
        for raw_bidder in raw_bidders:
            if not isinstance(raw_bidder, dict):
                continue

            email = str(raw_bidder.get("email") or "").strip().lower()
            if not _EMAIL_PATTERN.fullmatch(email) or email in seen_emails:
                continue

            company = str(raw_bidder.get("company") or "").strip() or None
            primary_value = raw_bidder.get("isPrimary")
            is_primary = primary_value is True or (
                isinstance(primary_value, str)
                and primary_value.strip().lower() == "true"
            )
            bidders.append(
                {"email": email, "company": company, "isPrimary": is_primary}
            )
            seen_emails.add(email)

    # Only one bidder can be primary. Preserve the first explicit selection.
    primary_seen = False
    for bidder in bidders:
        if bidder["isPrimary"] and not primary_seen:
            primary_seen = True
        elif bidder["isPrimary"]:
            bidder["isPrimary"] = False

    signals["bidders"] = bidders
    signals["isMultiBidder"] = len(bidders) >= 2
    return signals


def _get_client() -> OpenAI:
    """Create and return an OpenAI client pointing to Azure via base_url."""
    if not AZURE_API_KEY:
        raise RuntimeError("Azure OpenAI API key not found. Please set AZURE_OPENAI_KEY.")
    if not AZURE_BASE_URL:
        raise RuntimeError("Azure OpenAI endpoint URL not found. Please set AZURE_OPENAI_ENDPOINT.")
    return OpenAI(api_key=AZURE_API_KEY, base_url=AZURE_BASE_URL)


def fetch_existing_projects_fallback() -> list:
    """Fallback method: Query all active projects from GFS Backend REST API. MongoDB fallback is removed."""
    try:
        from services.backend_config import get_app_base_url
        from services.auth import get_authenticated_session

        session = get_authenticated_session()
        url = f"{get_app_base_url()}/api/v1/project-workspace/ai-context"
        headers = {"Content-Type": "application/json"}

        logger.info("Fallback: Fetching active projects list from API: %s", url)
        response = session.get(url, headers=headers, timeout=10)
        if response.status_code == 200:
            data = response.json()
            if isinstance(data, dict):
                data = data.get("data") or data.get("projects") or data.get("result") or []
            if isinstance(data, list):
                project_records = []
                for item in data:
                    project_records.append({
                        "projectId": item.get("projectId"),
                        "projectName": item.get("projectName") or "Unknown Project",
                        "customerName": item.get("customerName") or "Unknown Customer",
                        "email": item.get("customerEmail") or None,
                        "jobAddress": item.get("jobAddress") or None,
                        "address": item.get("address") or None,
                        "referenceNumber": item.get("referenceNumber") or None,
                        "match_reason": "Full List Fallback Match",
                    })
                return project_records
            logger.warning("Fallback API response format invalid.")
        else:
            logger.warning("Fallback API returned status code %d", response.status_code)
    except Exception as exc:
        logger.error("GFS Backend API fallback failed: %s. MongoDB direct lookup is disabled.", exc)

    return []


def call_azure_layout(file_bytes: bytes) -> dict:
    """Send document to Azure Document Intelligence and poll for layout results (synchronous)."""
    endpoint = os.getenv("AZURE_DOC_INTELLIGENCE_ENDPOINT") or os.getenv("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT")
    key = os.getenv("AZURE_DOC_INTELLIGENCE_KEY") or os.getenv("AZURE_DOCUMENT_INTELLIGENCE_KEY")
    
    if not endpoint or not key:
        logger.warning("Missing Azure Document Intelligence credentials in environment. Skipping Azure OCR.")
        return {}

    base_url = endpoint.rstrip("/")
    analyze_url = f"{base_url}/documentintelligence/documentModels/prebuilt-layout:analyze?api-version=2024-11-30"

    headers = {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/octet-stream"
    }

    try:
        # Ensure file_bytes is plain bytes — fitz or other sources can return memoryview/str
        if not isinstance(file_bytes, (bytes, bytearray)):
            try:
                file_bytes = bytes(file_bytes)
            except Exception as conv_exc:
                logger.warning("Could not convert pdf payload to bytes: %s", conv_exc)
                return {}
        logger.info("Submitting document to Azure Document Intelligence prebuilt-layout API...")
        response = httpx.post(analyze_url, content=file_bytes, headers=headers, timeout=60.0)
        if response.status_code != 202:
            logger.warning("Azure Document Intelligence rejected request (%d): %s", response.status_code, response.text)
            return {}

        operation_url = response.headers.get("Operation-Location")
        if not operation_url:
            logger.warning("Operation-Location header missing in response.")
            return {}

        poll_headers = {"Ocp-Apim-Subscription-Key": key}
        import time
        for attempt in range(1, 61):  # Poll up to 120 seconds
            time.sleep(2)
            poll_resp = httpx.get(operation_url, headers=poll_headers, timeout=30.0)
            poll_data = poll_resp.json()
            
            status = poll_data.get("status")
            if status == "succeeded":
                return poll_data.get("analyzeResult", {})
            elif status == "failed":
                logger.warning("Azure analysis failed: %s", poll_data)
                return {}
        logger.warning("Azure Document Intelligence analysis request timed out.")
    except Exception as exc:
        logger.warning("Azure Document Intelligence analysis request crashed: %s", exc)
    return {}


def extract_text_from_document_blobs(documents: list) -> str:
    """Download document blobs from documents list and extract layout-aware text content using Azure Document Intelligence (PDFs and Images)."""
    if not documents:
        return ""
    
    extracted_parts = []
    supported_extensions = (".pdf", ".png", ".jpg", ".jpeg", ".tiff", ".bmp", ".webp", ".txt", ".html")
    
    for doc in documents:
        name = doc.get("originalName", "").lower()
        url = doc.get("blobUrl", "")
        
        if not url or not name.endswith(supported_extensions):
            continue
            
        try:
            logger.info("Downloading attachment blob for text extraction: %s", name)
            response = httpx.get(url, timeout=30.0)
            if response.status_code == 200:
                if name.endswith((".txt", ".html")):
                    doc_text = response.content.decode("utf-8", errors="replace")
                    doc_type = "TEXT" if name.endswith(".txt") else "HTML"
                    extracted_parts.append(f"--- ATTACHED {doc_type} CONTENT: {doc.get('originalName')} ---\n{doc_text}")
                else:
                    is_pdf = name.endswith(".pdf")
                    
                    pdf_payload = response.content
                    # Slices PDF to first 5 pages if it's large to optimize speed/cost and avoid skipping
                    if is_pdf:
                        try:
                            pdf_doc = fitz.open(stream=response.content, filetype="pdf")
                            page_count = len(pdf_doc)
                            if page_count > 5:
                                logger.info("PDF '%s' has %d pages. Slicing to first 5 pages for text extraction.", name, page_count)
                                new_pdf = fitz.open()
                                new_pdf.insert_pdf(pdf_doc, from_page=0, to_page=4)
                                pdf_payload = new_pdf.tobytes()
                                new_pdf.close()
                            pdf_doc.close()
                        except Exception as pdf_exc:
                            logger.warning("Failed to parse or slice PDF '%s': %s. Proceeding with raw bytes.", name, pdf_exc)
                            pdf_payload = response.content  # reset to original bytes on fitz failure

                    # Ensure payload is bytes — fitz.tobytes() can return str on some versions
                    if isinstance(pdf_payload, str):
                        pdf_payload = pdf_payload.encode("latin-1")
                    if not isinstance(pdf_payload, (bytes, bytearray)):
                        logger.warning("PDF payload for '%s' is not bytes (%s) — skipping DI submission.", name, type(pdf_payload))
                        continue

                    doc_type = "PDF" if is_pdf else "IMAGE"
                    logger.info("Extracting layout text from %s '%s' via Azure Document Intelligence... payload type=%s len=%d", doc_type, name, type(pdf_payload).__name__, len(pdf_payload) if pdf_payload else 0)

                    azure_result = call_azure_layout(pdf_payload)
                    paragraphs = azure_result.get("paragraphs", [])
                    doc_text = "\n".join([p.get("content", "") for p in paragraphs if p.get("content")])
                    
                    if doc_text:
                        extracted_parts.append(f"--- ATTACHED {doc_type} (Azure OCR): {doc.get('originalName')} ---\n{doc_text}")
                    else:
                        logger.warning("No text could be extracted from %s '%s' via Azure Layout.", doc_type, name)
        except Exception as exc:
            logger.warning("Failed to download or extract text from blob '%s': %s", name, exc)
            
    return "\n\n".join(extracted_parts)


def classify_incoming_message(
    subject: Optional[str] = None,
    sender: Optional[str] = None,
    from_name: Optional[str] = None,
    to_recipients: Optional[list] = None,
    cc_recipients: Optional[list] = None,
    bcc_recipients: Optional[list] = None,
    document_names: Optional[list] = None,
    body_snippet: Optional[str] = None,
    document_text: Optional[str] = None,
    received_date: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Classify an incoming lead email using a two-pass AI workflow.
    """
    client = _get_client()

    # Clean raw VTT timestamps and Zoho sync wrappers from text inputs
    if body_snippet:
        body_snippet = sanitize_vtt_and_zoho_text(body_snippet)
    if document_text:
        document_text = sanitize_vtt_and_zoho_text(document_text)

    # =========================================================================
    # PASS 1: AI relevance validation and structured signal extraction
    # =========================================================================
    pass1_system = load_prompt("1.classifier_pass1_system.md")
    pass1_user = build_pass1_user_prompt(
        subject=subject,
        sender=sender,
        from_name=from_name,
        to_recipients=to_recipients,
        cc_recipients=cc_recipients,
        bcc_recipients=bcc_recipients,
        document_names=document_names,
        body_snippet=body_snippet,
        document_text=document_text,
        received_date=received_date,
    )

    try:
        response1 = client.chat.completions.create(
            model=AZURE_DEPLOYMENT,
            max_completion_tokens=8000,
            messages=[
                {"role": "system", "content": pass1_system},
                {"role": "user", "content": pass1_user},
            ],
            response_format={"type": "json_object"},
            seed=42,
        )

        pass1_raw = response1.choices[0].message.content or ""
        finish_reason = response1.choices[0].finish_reason
        if not pass1_raw.strip():
            logger.warning("Pass 1 returned empty response (finish_reason=%s) — treating as no signals", finish_reason)
            pass1_result = {"isProjectRelevant": True, "extractedSignals": {}}
        else:
            pass1_text = clean_json_text(pass1_raw)
            try:
                pass1_result = json.loads(pass1_text)
            except Exception as json_exc:
                logger.error("Pass 1 JSON parsing failed. Raw response: %r | Error: %s", pass1_raw, json_exc)
                pass1_result = {"isProjectRelevant": True, "extractedSignals": {}}
    except Exception as exc:
        logger.error("Pass 1 AI Analysis failed: %s. Handling safety block gracefully.", exc)
        if "content_filter" in str(exc) or "content management policy" in str(exc):
            return {
                "classification": "SPAM",
                "confidence": 0.95,
                "reasoning": f"Pass 1 blocked by Azure content safety filter (false positive jailbreak): {exc}",
                "address": None,
                "matchedProjectId": None,
            }
        pass1_result = {"isProjectRelevant": True, "extractedSignals": {}}

    # If Pass 1 classifies the email as SPAM, abort immediately and return SPAM
    is_project_relevant = pass1_result.get("isProjectRelevant", True)
    reasoning_pass1 = pass1_result.get("reasoning", "Spam classified in Pass 1.")
    
    if not is_project_relevant:
        logger.info("Pass 1 classified email as SPAM: %s", reasoning_pass1)
        return {
            "classification": "SPAM",
            "confidence": 0.9,
            "reasoning": reasoning_pass1,
            "address": None,
            "matchedProjectId": None,
        }

    # =========================================================================
    # INTERMEDIATE STEP: Candidate retrieval using AI-extracted signals
    # =========================================================================
    ai_signals = normalize_bidder_signals(pass1_result.get("extractedSignals", {}))
    logger.info("AI-Extracted Signals: %s", ai_signals)

    # Convert AI extracted signals to graph matcher format
    quote_numbers = ai_signals.get("quoteNumbers") or []
    addresses = ai_signals.get("addresses") or []
    project_keywords = ai_signals.get("projectKeywords") or subject or ""
    
    signals = {
        "sender_email": ai_signals.get("senderEmail") or sender or "",
        "sender_domain": (ai_signals.get("senderEmail") or sender or "").split("@")[-1] if "@" in (ai_signals.get("senderEmail") or sender or "") else "",
        "quote_numbers": quote_numbers if isinstance(quote_numbers, list) else [quote_numbers],
        "addresses": addresses if isinstance(addresses, list) else [addresses],
        "project_keywords": project_keywords,
        "doc_names": document_names or [],
    }

    graph = get_realtime_graph()
    if graph and graph.number_of_nodes() > 0:
        logger.info("Real-time Knowledge Graph built. Matching candidates using AI signals...")
        candidates = find_candidates(graph, signals)
    else:
        logger.warning("No projects could be retrieved to build the real-time graph.")
        candidates = []

    # =========================================================================
    # PASS 2: Candidate verification and final classification
    # =========================================================================
    logger.info("Starting Pass 2 AI Verification with %d candidates...", len(candidates))
    pass2_system = load_prompt("2.classifier_pass2_system.md").format(
        candidates=json.dumps(candidates, indent=2)
    )
    pass2_user = build_pass2_user_prompt(
        subject=subject,
        sender=sender,
        from_name=from_name,
        to_recipients=to_recipients,
        cc_recipients=cc_recipients,
        bcc_recipients=bcc_recipients,
        document_names=document_names,
        body_snippet=body_snippet,
        document_text=document_text,
        received_date=received_date,
        extracted_signals=ai_signals,
    )

    try:
        response2 = client.chat.completions.create(
            model=AZURE_DEPLOYMENT,
            max_completion_tokens=15000,
            messages=[
                {"role": "system", "content": pass2_system},
                {"role": "user", "content": pass2_user},
            ],
            response_format={"type": "json_object"},
            seed=42,
        )

        finish_reason = response2.choices[0].finish_reason
        logger.info("Pass 2 complete | finish_reason=%s", finish_reason)
        
        pass2_raw = response2.choices[0].message.content or ""
        pass2_text = clean_json_text(pass2_raw)
        try:
            result = json.loads(pass2_text)
        except Exception as json_exc:
            logger.error("Pass 2 JSON parsing failed. Raw response: %r | Error: %s", pass2_raw, json_exc)
            raise
    except Exception as exc:
        logger.error("Pass 2 AI Verification failed: %s. Handling safety block gracefully.", exc)
        if "content_filter" in str(exc) or "content management policy" in str(exc):
            return {
                "classification": "SPAM",
                "confidence": 0.95,
                "reasoning": f"Pass 2 blocked by Azure content safety filter (false positive jailbreak): {exc}",
                "address": None,
                "matchedProjectId": None,
            }
        return {
            "classification": "NEW_PROJECT",
            "confidence": 0.4,
            "reasoning": "New project opportunity. No matching project was identified in database candidates.",
            "address": None,
            "matchedProjectId": None,
        }

    # Normalize and validate result dictionary
    classification = result.get("classification", "NEW_PROJECT").upper().strip()
    if classification not in {"NEW_PROJECT", "EXISTING_PROJECT"}:
        logger.warning("Invalid Pass 2 classification '%s', defaulting to NEW_PROJECT", classification)
        classification = "NEW_PROJECT"

    confidence = result.get("confidence", 0.5)
    if not isinstance(confidence, (int, float)):
        confidence = 0.5
    confidence = max(0.0, min(1.0, float(confidence)))

    reasoning = result.get("reasoning", "No reasoning provided.")
    address = result.get("address")
    if isinstance(address, str):
        address = address.strip()
        if address.lower() in ("null", "none", ""):
            address = None

    matched_project_id = result.get("matchedProjectId")
    if isinstance(matched_project_id, str):
        matched_project_id = matched_project_id.strip()
        if matched_project_id.lower() in ("null", "none", ""):
            matched_project_id = None

    return {
        "classification": classification,
        "confidence": confidence,
        "reasoning": reasoning,
        "summary": result.get("summary"),
        "address": address,
        "matchedProjectId": matched_project_id,
        "ai_signals": ai_signals,
    }


def classify_service_bus_message(message_dict: Dict[str, Any]) -> Dict[str, Any]:
    """Convenience wrapper mapping Service Bus metadata into classify_incoming_message."""
    correlation_id = message_dict.get("correlationId", "") or message_dict.get("correlation_id", "")
    payload = message_dict.get("payload", {})

    subject = payload.get("subject")
    sender = payload.get("sender")
    
    # Extract rich email headers
    from_name = payload.get("fromName")
    to_recipients = payload.get("toRecipients")
    cc_recipients = payload.get("ccRecipients")
    bcc_recipients = payload.get("bccRecipients")
    received_date = payload.get("receivedDateTime") or message_dict.get("receivedDateTime")

    documents = payload.get("documents", [])
    doc_names = [d.get("originalName", "") for d in documents if d.get("originalName")]

    if not doc_names and payload.get("blobUrl"):
        from urllib.parse import urlparse
        blob_path = urlparse(payload["blobUrl"]).path
        blob_name = blob_path.rsplit("/", 1)[-1] if blob_path else ""
        if blob_name:
            doc_names = [blob_name]
            documents = [{"originalName": blob_name, "blobUrl": payload.get("blobUrl")}]

    body_snippet = payload.get("bodyText") or payload.get("bodyHtml")

    # Download attachments and extract text content in real-time
    document_text = ""
    if documents:
        document_text = extract_text_from_document_blobs(documents)

    result = classify_incoming_message(
        subject=subject,
        sender=sender,
        from_name=from_name,
        to_recipients=to_recipients,
        cc_recipients=cc_recipients,
        bcc_recipients=bcc_recipients,
        document_names=doc_names,
        body_snippet=body_snippet,
        document_text=document_text,
        received_date=received_date,
    )

    action_map = {
        "NEW_PROJECT": "CREATE",
        "EXISTING_PROJECT": "LINK",
        "SPAM": "DISCARD",
    }

    return {
        "correlationId": correlation_id,
        "classification": result["classification"],
        "confidence": result["confidence"],
        "reasoning": result["reasoning"],
        "summary": result.get("summary"),
        "address": result.get("address"),
        "projectId": result.get("matchedProjectId"),
        "action": action_map.get(result["classification"], "CREATE"),
        "ai_signals": result.get("ai_signals"),
    }


def _sanitize_summary_attachments(summary_text: str | None) -> str | None:
    if not summary_text:
        return summary_text
    import re
    # Clean up long hex hashes (24, 32, or 36 chars) ending in .pdf
    summary_text = re.sub(r'[a-fA-F0-9]{24,}\.pdf', 'Document Drawing.pdf', summary_text)
    summary_text = re.sub(r'[a-fA-F0-9-]{32,}\.pdf', 'Document Drawing.pdf', summary_text)
    
    lines = []
    for line in summary_text.strip().split("\n"):
        stripped = line.strip()
        if "attachments:" in stripped.lower():
            prefix, attachments_val = stripped.split(":", 1)
            parts = [p.strip() for p in attachments_val.split(",")]
            clean_parts = [p for p in parts if not (p.lower().startswith("email-") and ".txt" in p.lower())]
            line = f"{prefix}: {', '.join(clean_parts) if clean_parts else 'Architectural drawings and project documents.'}"
        lines.append(line)
    return "\n".join(lines)


def ensure_structured_summary(
    raw_summary: Optional[str],
    customer_name: Optional[str] = None,
    company_name: Optional[str] = None,
    address: Optional[str] = None,
    sender_name: Optional[str] = None,
    sender_email: Optional[str] = None,
    attachments_str: Optional[str] = None,
) -> str:
    """
    Guarantees the summary string strictly adheres to the multi-line 8-field template
    expected by the Frontend AI Insight component (Screenshot 3 view):
    - Customer Info: ...
    - Location: ...
    - Scope: ...
    - Request Summary: ...
    - Attachments: ...
    - Sender Name: ...
    - Sender Email: ...
    - Company Name: ...
    """
    parsed_fields: dict = {}
    if raw_summary and isinstance(raw_summary, str):
        for line in raw_summary.strip().split("\n"):
            line = line.strip()
            if line.startswith("- ") and ":" in line:
                key, val = line[2:].split(":", 1)
                parsed_fields[key.strip().lower()] = val.strip()

    # If raw_summary was plain text / unformatted string, treat it as request summary
    if not parsed_fields and raw_summary and isinstance(raw_summary, str):
        clean_req = sanitize_vtt_and_zoho_text(raw_summary)
        if clean_req:
            parsed_fields["request summary"] = clean_req.replace("\n", " ").strip()

    cust_info = parsed_fields.get("customer info")
    if not cust_info or cust_info.lower() in ("null", "unknown"):
        c_name = customer_name or "Customer"
        comp_name = company_name or "Company"
        cust_info = f"{c_name} from {comp_name}" if company_name else c_name

    loc = parsed_fields.get("location") or address or "Not specified"
    scope = parsed_fields.get("scope") or "Walkable glass flooring / skylight system pricing inquiry."
    req_sum = parsed_fields.get("request summary") or "Quoting and pricing requested based on project correspondence."
    att = parsed_fields.get("attachments") or attachments_str or "No attachments."
    s_name = parsed_fields.get("sender name") or sender_name or "null"
    s_email = parsed_fields.get("sender email") or sender_email or "null"
    comp = parsed_fields.get("company name") or company_name or "null"

    lines = [
        f"- Customer Info: {cust_info}",
        f"- Location: {loc}",
        f"- Scope: {scope}",
        f"- Request Summary: {req_sum}",
        f"- Attachments: {att}",
        f"- Sender Name: {s_name}",
        f"- Sender Email: {s_email}",
        f"- Company Name: {comp}",
    ]
    return "\n".join(lines)


def build_classifier_webhook_payload(
    message_dict: Dict[str, Any],
    classification_result: Dict[str, Any]
) -> Dict[str, Any]:
    """Build the exact nested JSON payload expected by GFS backend outlook webhook."""
    correlation_id = message_dict.get("correlationId") or message_dict.get("correlation_id") or ""
    payload = message_dict.get("payload") or {}

    # Map legacy flat format keys to standard payload keys if needed
    if not correlation_id and "document_id" in message_dict:
        doc_id = message_dict.get("document_id")
        correlation_id = f"doc:{doc_id}"
        payload = {
            "sender": message_dict.get("sender"),
            "subject": message_dict.get("subject"),
            "documents": [{
                "documentId": doc_id,
                "originalName": "document.pdf",
                "blobUrl": message_dict.get("blob_url")
            }]
        }
    
    summary_raw = classification_result.get("summary")
    summary = _sanitize_summary_attachments(summary_raw)
    classification = classification_result.get("classification", "NEW_PROJECT")
    confidence_float = classification_result.get("confidence", 0.5)
    address = classification_result.get("address")
    matched_project_id = classification_result.get("projectId") or classification_result.get("matchedProjectId")
    
    action_map = {
        "NEW_PROJECT": "CREATE",
        "EXISTING_PROJECT": "LINK",
        "SPAM": "DISCARD",
    }
    action = action_map.get(classification, "CREATE")
    is_project = action != "DISCARD"
    confidence_percentage = to_confidence_percentage(confidence_float)
    
    sender = payload.get("sender", "")
    subject = payload.get("subject", "")
    
    # Use LLM-extracted names first, fall back to email parsing
    ai_signals = normalize_bidder_signals(
        classification_result.get("ai_signals") or {}
    )
    
    # Extract bidders and multi-bidder flag
    bidders = ai_signals.get("bidders", [])
    is_multi_bidder = ai_signals.get("isMultiBidder", False)
    all_addresses = classification_result.get("all_addresses") or []

    # Generate groupId based on address (hash of normalized address)
    address = classification_result.get("address")
    group_id = None
    if address:
        import hashlib
        normalized = address.lower().strip().replace(" ", "").replace(",", "")
        group_id = hashlib.md5(normalized.encode()).hexdigest()[:16]

    customer_name = ai_signals.get("senderName") or "Unknown Customer"
    if customer_name == "Unknown Customer" and sender and "@" in sender:
        name_part = sender.split("@")[0]
        customer_name = " ".join(part.capitalize() for part in name_part.replace(".", " ").replace("_", " ").split())

    # Company-aware header contacts: prefer explicitly extracted company/contact
    # values over the raw transport sender. Sender is only a last resort so a
    # forwarder/architect does not become the project contact.
    company_email = (
        ai_signals.get("companyEmail")
        or ai_signals.get("customerEmail")
        or ai_signals.get("senderEmail")
        or (sender if sender and "@" in sender else None)
    )
    if isinstance(company_email, str):
        company_email = company_email.strip().lower() or None
    contact_phone = (
        ai_signals.get("contactPhone")
        or ai_signals.get("customerPhone")
        or ai_signals.get("phone")
        or payload.get("fromPhone")
    )
    if isinstance(contact_phone, str):
        contact_phone = contact_phone.strip() or None
    company_address = (
        ai_signals.get("companyAddress")
        or ai_signals.get("contactAddress")
        or ai_signals.get("contact_address")
    )
    if isinstance(company_address, str):
        company_address = company_address.strip() or None
    # Fall back to a COMPANY/BILLING-typed address from allAddresses when the
    # LLM did not populate companyAddress separately.
    if not company_address and isinstance(all_addresses, list):
        for _a in all_addresses:
            if isinstance(_a, dict) and str(_a.get("type", "")).upper() in ("COMPANY", "BILLING"):
                _addr = (_a.get("address") or "").strip()
                if _addr:
                    company_address = _addr
                    break

    company_name = ai_signals.get("companyName") or None
    if company_name and customer_name and company_name.lower().strip() == customer_name.lower().strip():
        company_name = None

    if not company_name and sender and "@" in sender:
        domain = sender.split("@")[-1].lower().strip()
        general_domains = {
            "gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "aol.com",
            "icloud.com", "mail.com", "zoho.com", "protonmail.com", "proton.me",
            "live.com", "msn.com", "comcast.net", "sbcglobal.net", "verizon.net",
            "cox.net", "att.net", "charter.net", "bellsouth.net"
        }
        if domain not in general_domains:
            parts = domain.split(".")
            if parts[0] == "www" and len(parts) > 1:
                parts = parts[1:]
            if len(parts) > 2 and parts[-2] in {"co", "com", "net", "org", "gov"}:
                base_name = parts[-3]
            elif len(parts) > 1:
                base_name = parts[-2]
            else:
                base_name = parts[0]
            company_name = base_name.capitalize()
        
    project_keywords = ai_signals.get("projectKeywords")
    project_name = "New GFS Project"

    if project_keywords and isinstance(project_keywords, str) and project_keywords.strip() and project_keywords.lower() not in ("null", "none"):
        project_name = project_keywords.strip()
    elif subject:
        clean_subject = subject.replace("RE:", "").replace("FW:", "").replace("RE :", "").replace("FW :", "").strip()
        if clean_subject and clean_subject.lower() not in ("quote request", "new quote request", "gfs quote request", "competitive bid"):
            project_name = clean_subject
        elif address:
            project_name = address
    elif company_name:
        project_name = f"Project from {company_name}"
    elif customer_name and customer_name != "Unknown Customer":
        project_name = f"Project from {customer_name}"
    elif address:
        project_name = address

    project_type_map = {
        "NEW_PROJECT": "NEW_ESTIMATE",
        "EXISTING_PROJECT": "EXISTING_PROJECT",
        "SPAM": "SPAM",
    }
    project_type = project_type_map.get(classification, "NEW_ESTIMATE")

    summary = ensure_structured_summary(
        raw_summary=summary,
        customer_name=customer_name,
        company_name=company_name,
        address=address,
        sender_name=ai_signals.get("senderName"),
        sender_email=company_email or sender,
        attachments_str=None if not payload.get("documents") else ", ".join(d.get("originalName", "Document.pdf") for d in payload.get("documents", []) if d.get("originalName")),
    )

    if action == "LINK":
        payload_data = {
            "correlationId": correlation_id,
            "action":        action,
            "projectId":     matched_project_id,
            "proposed": {
                "isProject":    is_project,
                "projectId":    matched_project_id,
                "projectType":  project_type,
                "summary":      summary,
                "reasoning":    classification_result.get("reasoning"),
                "confidence":   confidence_percentage,
            }
        }
    else:
        # If multiple bidders detected, create separate project for each bidder
        if is_multi_bidder and len(bidders) > 1:
            # Generate multiple payloads, one per bidder
            # Return the primary bidder's payload as the main response
            # The backend should handle creating additional projects for other bidders
            primary_bidder = next((b for b in bidders if b.get("isPrimary")), bidders[0])

            payload_data = {
                "correlationId": correlation_id,
                "action": action,
                "proposed": {
                    "isProject": is_project,
                    "customerName": customer_name,
                    "companyName": company_name,
                    "company": company_name,
                    "customerEmail": company_email,
                    "companyEmail": company_email,
                    "customerPhone": contact_phone,
                    "contactPhone": contact_phone,
                    "companyAddress": company_address,
                    "contactAddress": company_address,
                    "projectName": project_name,
                    "projectType": project_type,
                    "summary": summary,
                    "reasoning": classification_result.get("reasoning"),
                    "confidence": confidence_percentage,
                    "address": address,
                    "jobAddress": address,
                    "allAddresses": all_addresses,
                    "groupId": group_id,
                    "isCompetitiveBid": True,
                    "allBidders": bidders,
                    "primaryBidderEmail": primary_bidder.get("email") if primary_bidder else sender
                }
            }
        else:
            # Single bidder - normal flow
            payload_data = {
                "correlationId": correlation_id,
                "action": action,
                "proposed": {
                    "isProject": is_project,
                    "customerName": customer_name,
                    "companyName": company_name,
                    "company": company_name,
                    "customerEmail": company_email,
                    "companyEmail": company_email,
                    "customerPhone": contact_phone,
                    "contactPhone": contact_phone,
                    "companyAddress": company_address,
                    "contactAddress": company_address,
                    "projectName": project_name,
                    "projectType": project_type,
                    "summary": summary,
                    "reasoning": classification_result.get("reasoning"),
                    "confidence": confidence_percentage,
                    "address": address,
                    "jobAddress": address,
                    "allAddresses": all_addresses,
                    "groupId": group_id,
                    "isCompetitiveBid": False,
                }
            }
        
    return payload_data
