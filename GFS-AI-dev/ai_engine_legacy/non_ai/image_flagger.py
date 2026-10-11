"""
Image Flagger — Identifies what needs LLM Vision extraction.
Determines which flagged items to send to LLM and what to extract.
"""

import os


def prepare_for_llm(flagged_items: list[dict], text_content: str) -> list[dict]:
    """
    Prepare flagged items for LLM Vision processing.
    Returns a list of items to send to the LLM with context.

    Args:
        flagged_items: From docling_extractor — images/CAD that need LLM.
        text_content: The text content Docling already extracted (for context).

    Returns:
        List of prepared items for LLM.
    """
    prepared = []

    for item in flagged_items:
        file_path = item.get("file", "")
        item_type = item.get("type", "unknown")

        if not os.path.exists(file_path):
            continue

        prepared_item = {
            "file": file_path,
            "type": item_type,
            "reason": item.get("reason", ""),
            "context_from_text": text_content[:2000] if text_content else "",
        }

        # Determine what to extract based on file type
        if item_type == "image":
            prepared_item["extract_what"] = [
                "dimensions (width, length in inches)",
                "opening shape (rectangular, oval, circular)",
                "panel count",
                "any text annotations visible on the image",
                "contact info if visible in email screenshot",
            ]
        elif item_type in {"scanned_pdf", "unreadable_page"}:
            prepared_item["extract_what"] = [
                "all text content via OCR",
                "dimensions and measurements",
                "contact information",
                "project details",
            ]

        prepared.append(prepared_item)

    return prepared


def get_llm_images(prepared_items: list[dict]) -> list[str]:
    """Get image paths to send to LLM Vision."""
    return [item["file"] for item in prepared_items if item["type"] in {"image", "scanned_pdf", "unreadable_page"}]


def get_context_summary(text_content: str, max_chars: int = 3000) -> str:
    """Get a summary of the text content to provide context to LLM."""
    if not text_content:
        return "No text content extracted from documents."

    if len(text_content) <= max_chars:
        return text_content

    # Take first part + key sections
    return text_content[:max_chars] + "\n... (truncated)"
