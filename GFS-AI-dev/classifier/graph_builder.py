# classifier/graph_builder.py
# ─────────────────────────────────────────────────────────────────────────────
# Real-time Knowledge Graph (NetworkX) builder.
#
# Fetches the absolute latest projects from the GFS API on-demand for
# every query, ensuring 100% fresh matching with no lag.
# ─────────────────────────────────────────────────────────────────────────────
import logging
from typing import List, Dict, Any

import networkx as nx

from .address_utils import normalize_address

logger = logging.getLogger(__name__)


def fetch_projects_from_api() -> List[Dict[str, Any]]:
    """Fetch active projects directly from the GFS Backend API."""
    try:
        from services.backend_config import get_app_base_url
        from services.auth import get_authenticated_session

        session = get_authenticated_session()
        url = f"{get_app_base_url()}/api/v1/project-workspace/ai-context"
        headers = {"Content-Type": "application/json"}

        logger.info("Real-time: Fetching active projects list from GFS API...")
        response = session.get(url, headers=headers, timeout=10)
        if response.status_code == 200:
            data = response.json()
            if isinstance(data, dict):
                data = data.get("data") or data.get("projects") or data.get("result") or []
            if isinstance(data, list):
                return data
            logger.warning("API response format invalid, expected list.")
        else:
            logger.warning("API returned status code %d: %s", response.status_code, response.text)
    except Exception as exc:
        logger.warning("Failed to fetch projects from GFS API: %s", exc)

    return []


def get_realtime_graph() -> nx.DiGraph:
    """
    Fetch the latest active projects and build the Relationship Graph.
    Builds a fresh graph for every classification request.
    """
    G = nx.DiGraph()

    # Fetch from GFS API only (MongoDB fallback removed for production deployment safety)
    projects = fetch_projects_from_api()

    if not projects:
        logger.warning("No projects could be retrieved from GFS API. Returning empty graph.")
        return G

    project_count = 0
    for proj in projects:
        pid = str(proj.get("projectId") or "")
        if not pid:
            continue

        project_count += 1
        proj_name = proj.get("projectName", "Unknown Project")
        status = proj.get("status", "")

        # Extract address safely
        job_addr = proj.get("jobAddress") or ""
        addr_data = proj.get("address")
        street_addr = ""
        if isinstance(addr_data, dict):
            parts = [
                addr_data.get("street"),
                addr_data.get("city"),
                addr_data.get("state"),
                addr_data.get("zip"),
                addr_data.get("country")
            ]
            street_addr = ", ".join([str(p).strip() for p in parts if p])
        elif isinstance(addr_data, str):
            street_addr = addr_data

        # ── Project node ──────────────────────────────────────────────────
        project_node = f"project:{pid}"
        G.add_node(
            project_node,
            type="Project",
            projectId=pid,
            projectName=proj_name,
            customerName=proj.get("customerName", ""),
            status=status,
            jobAddress=job_addr,
            address=street_addr,
            referenceNumber=proj.get("referenceNumber", ""),
        )

        # ── Person node + CONTACT_OF edge ─────────────────────────────────
        email = (proj.get("customerEmail") or "").lower().strip()
        if email:
            person_node = f"person:{email}"
            cust_name = proj.get("customerName", "")
            G.add_node(
                person_node,
                type="Person",
                email=email,
                name=cust_name,
            )
            G.add_edge(person_node, project_node, relation="CONTACT_OF")

            # ── Company node + WORKS_AT / HAS_PROJECT edges ───────────────
            domain = email.split("@")[-1] if "@" in email else ""
            if domain:
                company_node = f"company:{domain}"
                G.add_node(company_node, type="Company", domain=domain)
                G.add_edge(person_node, company_node, relation="WORKS_AT")
                G.add_edge(company_node, project_node, relation="HAS_PROJECT")

        # ── Address node + LOCATED_AT edge ────────────────────────────────
        raw_addr = job_addr or street_addr
        if raw_addr:
            norm_addr = normalize_address(raw_addr)
            if norm_addr:
                addr_node = f"address:{norm_addr}"
                G.add_node(
                    addr_node,
                    type="Address",
                    normalized=norm_addr,
                    raw=raw_addr,
                )
                G.add_edge(project_node, addr_node, relation="LOCATED_AT")

        # ── Quote node + BELONGS_TO edge ──────────────────────────────────
        ref = proj.get("referenceNumber")
        if ref:
            ref_clean = ref.strip()
            quote_node = f"quote:{ref_clean}"
            G.add_node(
                quote_node,
                type="Quote",
                referenceNumber=ref_clean,
            )
            G.add_edge(quote_node, project_node, relation="BELONGS_TO")

    logger.info(
        "Real-time graph built successfully | projects=%d | nodes=%d | edges=%d",
        project_count,
        G.number_of_nodes(),
        G.number_of_edges(),
    )

    return G
