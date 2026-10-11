# classifier/graph_matcher.py
# ─────────────────────────────────────────────────────────────────────────────
# Email signal extraction and similarity-based project retrieval.
#
# Extracts structured signals from an incoming email, then searches all
# active projects in the graph using direct field similarity matching.
# ─────────────────────────────────────────────────────────────────────────────
import logging
import re
from typing import Any, Dict, List, Optional

import networkx as nx
from rapidfuzz import fuzz

from .address_utils import (
    extract_addresses_from_text, 
    normalize_address
)

logger = logging.getLogger(__name__)


def clean_address_for_fuzz(address: str) -> str:
    """Replace non-alphanumeric separators (like underscores, hyphens, slashes, periods) with spaces for optimal fuzzy tokenization."""
    if not address:
        return ""
    address = re.sub(r"[\-_/\.]", " ", address)
    return " ".join(address.split())


# Regex patterns for quote/reference numbers
_QUOTE_PATTERNS = [
    re.compile(r'\bQ-?\d{4}-?\d{3,6}\b', re.IGNORECASE),                 # Q-2026-0428
    re.compile(r'\bPRJ-?\d{4}-?\d{3,6}\b', re.IGNORECASE),               # PRJ-2026-0118
    re.compile(r'\bGFS[- ]?\d{4}[- ]?\d{3,6}\b', re.IGNORECASE),         # GFS 2026 1234 (New format)
    re.compile(r'\bQuote\s*#?\s*(\d{3,8})\b', re.IGNORECASE),             # Quote #1234
    re.compile(r'\bREF-?\d{3,8}\b', re.IGNORECASE),                       # REF-12345
    re.compile(r'\bGFS-?\d{3,8}\b', re.IGNORECASE),                       # GFS-12345
]


# Common public/free email domain hosts that should not match as a company domain
IGNORED_DOMAINS = {
    "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com", "icloud.com",
    "zoho.com", "protonmail.com", "mail.com", "gmx.com", "yandex.com", "live.com",
    "msn.com", "comcast.net", "sbcglobal.net", "bellsouth.net", "verizon.net", "cox.net",
    "charter.net", "earthlink.net", "optonline.net"
}


def extract_signals(
    subject: Optional[str] = None,
    sender: Optional[str] = None,
    body_snippet: Optional[str] = None,
    document_names: Optional[List[str]] = None,
    document_text: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Extract structured matching signals from an incoming email.
    """
    signals: Dict[str, Any] = {
        "sender_email": "",
        "sender_domain": "",
        "sender_name": "",
        "quote_numbers": [],
        "addresses": [],
        "project_keywords": "",
        "doc_names": document_names or [],
    }

    # ── Sender parsing ────────────────────────────────────────────────────
    if sender:
        email_lower = sender.lower().strip()
        signals["sender_email"] = email_lower
        if "@" in email_lower:
            prefix, domain = email_lower.rsplit("@", 1)
            signals["sender_domain"] = domain
            signals["sender_name"] = " ".join(
                part.capitalize()
                for part in prefix.replace(".", " ").replace("_", " ").split()
            )

    # ── Combine all text sources for signal extraction ────────────────────
    all_text_parts = []
    if subject:
        all_text_parts.append(subject)
    if body_snippet:
        all_text_parts.append(body_snippet[:3000])
    if document_names:
        all_text_parts.append(" ".join(document_names))
    if document_text:
        all_text_parts.append(document_text)
    combined_text = "\n".join(all_text_parts)

    # ── Quote number extraction ───────────────────────────────────────────
    for pattern in _QUOTE_PATTERNS:
        for match in pattern.finditer(combined_text):
            qnum = match.group(0).strip()
            if qnum not in signals["quote_numbers"]:
                signals["quote_numbers"].append(qnum)

    # ── Address extraction ────────────────────────────────────────────────
    # Check if addresses are already processed (new format with types)
    input_addresses = signals.get("addresses", [])
    if input_addresses and isinstance(input_addresses[0], dict):
        # New format - extract raw addresses for backward compatibility
        signals["addresses"] = [addr.get("address", "") for addr in input_addresses if addr.get("address")]
    else:
        # Old format - use text extraction
        signals["addresses"] = extract_addresses_from_text(combined_text)

    # ── Project keywords from subject ─────────────────────────────────────
    if subject:
        clean = re.sub(r'^(RE|FW|FWD)\s*:\s*', '', subject, flags=re.IGNORECASE).strip()
        signals["project_keywords"] = clean

    return signals


def find_candidates(
    graph: nx.DiGraph,
    signals: Dict[str, Any],
    max_candidates: int = 5,
) -> List[Dict[str, Any]]:
    """
    Search all project nodes in the graph, compare their fields directly
    against the email signals, and gather the most similar projects.
    """
    if graph is None or graph.number_of_nodes() == 0:
        return []

    candidates: List[Dict[str, Any]] = []

    # Extract search keys from signals
    sender_email = signals.get("sender_email", "")
    sender_domain = signals.get("sender_domain", "")
    quote_numbers = signals.get("quote_numbers", [])
    addresses = signals.get("addresses", [])
    project_keywords = signals.get("project_keywords", "")

    # Loop through all project nodes in the graph
    for node_id, node_data in graph.nodes(data=True):
        if node_data.get("type") != "Project":
            continue

        proj_id = node_data.get("projectId", "")
        proj_name = node_data.get("projectName", "")
        cust_name = node_data.get("customerName", "")
        
        # Resolve email connected to this project node
        proj_email = ""
        for source, _, edge_data in graph.in_edges(node_id, data=True):
            if edge_data.get("relation") == "CONTACT_OF":
                proj_email = graph.nodes[source].get("email", "")
                break

        # Resolve address, quote values
        proj_job_address = node_data.get("jobAddress", "")
        proj_billing_address = node_data.get("address", "")
        proj_ref_num = node_data.get("referenceNumber", "")

        matched_fields = []
        max_score = 0

        # ── 1. Match Quote/Reference Number ──
        if proj_ref_num:
            norm_proj_ref = re.sub(r'[^a-zA-Z0-9]', '', proj_ref_num).lower()
            for qnum in quote_numbers:
                norm_qnum = re.sub(r'[^a-zA-Z0-9]', '', qnum).lower()
                if norm_qnum == norm_proj_ref:
                    matched_fields.append(f"Quote match: {proj_ref_num}")
                    max_score = max(max_score, 100)
                elif fuzz.ratio(qnum.lower(), proj_ref_num.lower()) >= 85:
                    matched_fields.append(f"Quote fuzzy match: {qnum} ~ {proj_ref_num}")
                    max_score = max(max_score, 90)

        # ── 2. Match Job Address / Address ──
        for addr in addresses:
            norm_addr = normalize_address(addr)
            if not norm_addr:
                continue
            
            clean_addr = clean_address_for_fuzz(norm_addr)

            # Check against jobAddress — token_set_ratio only (no partial to avoid substring inflation)
            address_matched = False
            address_disqualified = False
            if proj_job_address:
                norm_job = normalize_address(proj_job_address)
                clean_job = clean_address_for_fuzz(norm_job)
                score = fuzz.token_set_ratio(clean_addr, clean_job)
                if score >= 85:
                    matched_fields.append(f"Job Address match ({int(score)}%): {addr} ~ {proj_job_address}")
                    max_score = max(max_score, score)
                    address_matched = True
                else:
                    address_disqualified = True

            # Check against billing address
            if proj_billing_address and not address_matched:
                norm_bill = normalize_address(proj_billing_address)
                clean_bill = clean_address_for_fuzz(norm_bill)
                score = fuzz.token_set_ratio(clean_addr, clean_bill)
                if score >= 85:
                    matched_fields.append(f"Billing Address match ({int(score)}%): {addr} ~ {proj_billing_address}")
                    max_score = max(max_score, score)
                    address_matched = True
                    address_disqualified = False

        # If address in email does not match project address, cap score to prevent false match
        if addresses and address_disqualified and not address_matched:
            max_score = min(max_score, 40)
            matched_fields.append("Address mismatch -- candidate disqualified")
        # ── 3. Match Customer Email ──
        if proj_email and sender_email:
            if sender_email == proj_email:
                matched_fields.append(f"Customer email match: {sender_email}")
                max_score = max(max_score, 95)
            else:
                proj_domain = proj_email.split("@")[-1] if "@" in proj_email else ""
                sender_domain = sender_email.split("@")[-1] if "@" in sender_email else ""
                if proj_domain and sender_domain and proj_domain == sender_domain:
                    # Ignore common free email hosts to prevent false positives
                    if proj_domain not in IGNORED_DOMAINS:
                        matched_fields.append(f"Customer company domain match: {proj_domain} ({sender_email} ~ {proj_email})")
                        max_score = max(max_score, 90)  # High confidence it's the same company

        # ── 4. Match Project Name / Subject ──
        if proj_name and project_keywords:
            score = fuzz.token_set_ratio(project_keywords.lower(), proj_name.lower())
            if score >= 75:
                matched_fields.append(f"Project name match ({int(score)}%): \"{proj_name}\"")
                max_score = max(max_score, score)

        # ── 5. Competitive Bidding Detection (Same Address, Different Company) ──
        if proj_job_address and addresses:
            for addr in addresses:
                norm_addr = normalize_address(addr)
                if not norm_addr:
                    continue
                clean_addr = clean_address_for_fuzz(norm_addr)
                
                norm_job = normalize_address(proj_job_address)
                clean_job = clean_address_for_fuzz(norm_job)
                if clean_addr and clean_job:
                    addr_score = max(
                        fuzz.token_set_ratio(clean_addr, clean_job),
                        fuzz.partial_token_set_ratio(clean_addr, clean_job)
                    )
                    if addr_score >= 80:
                        # Same address - check if different company (domain)
                        if proj_email and sender_email:
                            proj_domain = proj_email.split("@")[-1] if "@" in proj_email else ""
                            sender_domain = sender_email.split("@")[-1] if "@" in sender_email else ""
                            
                            if proj_domain and sender_domain and proj_domain != sender_domain:
                                matched_fields.append(f"Competitive bidding: same address, different company ({sender_domain} vs {proj_domain})")
                                max_score = max(max_score, 85)  # High confidence it's related but different bidder

        # If any fields matched, add this project as a candidate
        if matched_fields:
            candidates.append({
                "projectId": proj_id,
                "projectName": proj_name,
                "customerName": cust_name,
                "email": proj_email or None,
                "jobAddress": proj_job_address or None,
                "address": proj_billing_address or None,
                "referenceNumber": proj_ref_num or None,
                "match_reason": " | ".join(matched_fields),
                "score": max_score,
            })

    # Sort candidates by similarity score (highest match score first)
    sorted_candidates = sorted(candidates, key=lambda x: x["score"], reverse=True)
    result = sorted_candidates[:max_candidates]

    if result:
        logger.info(
            "Graph matcher found %d candidate(s) | reasons: %s",
            len(result),
            [c["match_reason"] for c in result],
        )
    else:
        logger.info("Graph matcher found 0 candidates — no related projects.")

    return result
