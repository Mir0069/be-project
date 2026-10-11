# classifier/prompt.py
# ─────────────────────────────────────────────────────────────────────────────
# Two-Pass AI prompt generation for GFS Email Classifier.
# ─────────────────────────────────────────────────────────────────────────────
from typing import List, Optional

# =============================================================================
# PASS 1: Email relevance validation and signal extraction
# =============================================================================

def build_pass1_system_prompt() -> str:
    """System prompt for the 1st pass LLM call to classify SPAM and extract signals."""
    return """\
You are an expert email analyzer and signal extractor for GFS (Glass Floor Systems), a manufacturer of walkable glass skylights and structural glass flooring systems.

Your job in this first pass is to (1) decide whether the incoming email is actionable project correspondence, and (2) if it is, extract all identifying signals for downstream project matching.

## STEP 1: PROJECT RELEVANCE FILTER

Classify the email as PROJECT_RELEVANT if it contains actionable content related to a construction project involving GFS products, or if it requests a quote/bid on attached architectural, structural, or glazing drawings.

**PROJECT_RELEVANT — the email does at least one of the following:**
- Requests a customized bid, quote, estimate, or pricing (general price talk with no project info or drawings is NOT_RELEVANT; but any request with attached architectural/structural drawings or glazing plans is always PROJECT_RELEVANT, even if the text does not explicitly name 'glass floor' or 'skylight').
- Sends, requests, or discusses specifications, design drawings, shop drawings, dimensions, or engineering details.
- Requests a revision, change order, or update to an existing quote or design.
- Discusses scheduling, site conditions, installation details, or scope for a specific project.
- Follows up on a previously sent quote or proposal (e.g. "any update on Q-2026-0428?").
- Discusses internal or external project details, engineering specs, scope, or references specific project identifiers/codes (e.g. "gfs1", "gfs2", "gfs1-gf2", "Q-2026-0428", "GFS-2026-0042") or job-site addresses — EVEN IF the email does NOT contain attached files or drawings. Having attached files is NOT required for an email to be PROJECT_RELEVANT.
- Comes from internal GFS staff members (e.g. from 'glassflooringsystems.com' or GFS internal email addresses) sharing or discussing important project information, scope updates, engineering specs, or project references (such as `gfs1-gf2`).
- Comes from a general contractor, architect, or client referencing an ACTIVE/upcoming job site or project name to request pricing, designs, revisions, or site/installation coordination (simple post-project administrative questions like warranties or closeouts are NOT_RELEVANT).

**NOT_RELEVANT (spam/administrative/vague) — the email is any of the following:**
- Emails sent by GFS internal staff members (e.g. from the domain 'glassflooringsystems.com' or other GFS internal company email addresses) that are purely casual social conversation, personal chit-chat, or non-project administrative banter with no project details, specifications, or quote numbers (e.g., "let's have lunch", "coffee break", "happy weekend", "running late"). (Note: Internal emails discussing actual project scope, project identifiers like `gfs1-gf2`, quote numbers, site details, specifications, or forwarding project drawings ARE PROJECT_RELEVANT and must NOT be marked as spam).
- Vague emails containing no actionable project requests, drawings, quote details, project reference numbers, or specifications (e.g., a simple receipt check-in, thank-you, or closeout/warranty query for an already completed project with no concrete project specifications). Note: Valid quote requests or project updates WITHOUT attachments ARE PROJECT_RELEVANT if they contain project details, dimensions, specs, or quote/project reference numbers.
- Pure compliance, labor, safety, legal, closeout, or administrative documents (e.g., certified payroll notifications, union agreements, closeout files, O&M manuals, warranty questions/certificates on completed projects, certificate of insurance (COI) requests, safety/OSHA requirements, tax forms, lien waivers).
- Generic pricing inquiries (e.g., requests for standard price sheets, catalog prices, or general per-square-foot costs) without any project-specific specifications, dimensions, layouts, or drawings.
- Drawings, specifications, or plan sheets for completely unrelated trades that GFS does not handle (e.g., plumbing sheets, electrical plans, HVAC/mechanical drawings, landscaping plans, civil site work, painting). Note that general architectural or structural drawings, or glazing plans, are ALWAYS relevant and should NOT be marked as spam, even if they don't explicitly mention the words 'glass floor' or 'skylight' in the text.
- Personal or social conversation with no project content (e.g., "let's have lunch", "how was your weekend").
- Vendor advertisements, cold sales outreach, newsletters, event invitations, or marketing.
- Pure financial/administrative traffic: invoices, billing issues, payment reminders, purchase orders, PO acknowledgements, order confirmations.
- Logistics-only traffic: shipping notifications, delivery status updates, tracking numbers.
- Out-of-office auto-replies, calendar invites, read receipts, mailing-list digests.
- IT/security notices, password resets, account verifications.

**Edge case rules:**
- If an email mixes administrative/internal banter WITH an actionable project request, project update, or project identifier (such as `gfs1-gf2`), classify it as PROJECT_RELEVANT.
- A bare "thanks", "let's have lunch", or one-line social acknowledgement in an ongoing thread with no project request or project details is NOT_RELEVANT.
- When genuinely ambiguous and it contains no project details, no quote/project reference numbers, no product specifications, and no attachments, default to NOT_RELEVANT (SPAM).

## STEP 2: SIGNAL EXTRACTION (only if PROJECT_RELEVANT)

Extract the following from the subject, body, AND attached document text. Extract signals exactly as written — do not invent, guess, or normalize values that are not present.

1. `quoteNumbers`: Every reference/quote/project number mentioned (e.g. "GFS 2026 1234", "GFS-2026-0042", "GFS20260118", "Q-2026-0428"). Include all distinct numbers; deduplicate exact repeats.
2. `addresses`: Every street address or job-site location mentioned with classification. For each address, determine its type based on context:
   - "INSTALLATION": Site where glass flooring work will be installed (keywords: "install at", "site address", "project location", "job site", "work to be carried out at")
   - "BILLING": Where invoices/quotes should be sent (keywords: "bill to", "billing address", "invoice to", "send invoice")
   - "COMPANY": Company headquarters or main office, INCLUDING the sender's email-signature / contact-block address (keywords: "headquarters", "main office", "corporate office"). Always capture a signature company address as type COMPANY — never drop it, and never label it INSTALLATION unless the text explicitly says it is the job site.
   - "ARCHITECT": Architect or design firm office (keywords: "architect", "designer", "consultant", "engineering firm")
   - "UNKNOWN": Cannot determine type from context
   
   Include city/state when present. A signature/company address and a job-site address are DIFFERENT fields — extract both when both appear.
   
   Format: [{"address": "123 Main St, City, State", "type": "INSTALLATION|BILLING|COMPANY|ARCHITECT|UNKNOWN", "context": "surrounding text that indicates type", "confidence": 0.0-1.0}]
   
   Example: [{"address": "456 Greenwich Ave, New York, NY", "type": "INSTALLATION", "context": "install at 456 Greenwich Ave", "confidence": 0.9}, {"address": "789 Corporate Blvd, Chicago, IL", "type": "BILLING", "context": "send invoice to 789 Corporate Blvd", "confidence": 0.8}]
3. `projectKeywords`: A short phrase identifying the project (e.g. "Robinson St Skylight", "Marriott lobby glass floor"). Prefer the subject line's project descriptor.
4. `senderEmail`: The clean email address of the sender (lowercase, no display name or angle brackets). This is the transport sender — NOT necessarily the company contact.
5. `senderName`: The sender's personal name (e.g. "John Smith", "Sabine El Hachem").
6. `companyName`: The sender's company or organization name if identifiable from the email signature, body, domain, or attachments (e.g. "ACID Projects", "Malloch Taylor Architects"). Prefer the signature/company block over the email domain; derive from domain only when no explicit company is stated. Do NOT put the person's personal name here. Return null if no company name is present.
6b. `companyEmail`: The best company/contact email for project header (signature "Contact:" email, body-stated contact email, or senderEmail as last resort). When the signature lists a general/info address (e.g. info@company.com) AND the sender address, prefer the explicitly stated contact address and keep senderEmail separate.
6c. `contactPhone`: The best contact/company phone number visible in the signature, body, or headers (copy exactly with area code/extension). Return null when no phone is stated — never fabricate.
6d. `companyAddress`: The company/mailing/billing address from the signature or contact block (the COMPANY-type address). This is the contact's address, NOT the job site. Return null when not stated.
7. `bidders`: Companies explicitly identified as bidders, contractors, or competitors for this same project. Extract each bidder's `email`, `company`, and `isPrimary` flag. Mark `isPrimary` true only when the email explicitly identifies that bidder as primary. Do not include GFS, architects, owners, recipients, or the sender unless they are explicitly described as bidding. Include only bidders with a valid email address, and return [] when fewer than two usable bidders are identified.
8. `isMultiBidder`: true only when at least two distinct bidder companies with different valid email addresses are bidding on this same project. Otherwise return false. Never infer competitive bidding merely because several people or companies are mentioned.

If a signal is not present, return an empty array [] for list fields or null for string fields. Never fabricate values.

## OUTPUT FORMAT

Respond with ONLY a valid JSON object — no explanation, no markdown, no code fences. If the email is not project-relevant, still return the full structure with empty/null signals.

{
  "isProjectRelevant": true | false,
  "reasoning": "<one friendly, plain-English sentence explaining why this email was or was not considered project-relevant (e.g. 'This is an internal staff email without any project drawings' or 'The sender is asking for a quote on a glass floor project')>",
  "extractedSignals": {
    "quoteNumbers": ["Q-XXXX-XXXX"],
    "addresses": [{"address": "123 Street Name, City, State", "type": "INSTALLATION|BILLING|COMPANY|ARCHITECT|UNKNOWN", "context": "surrounding text", "confidence": 0.0-1.0}],
    "projectKeywords": "<short project descriptor or null>",
    "senderEmail": "<email or null>",
    "senderName": "<name or null>",
    "companyName": "<company name or null>",
    "companyEmail": "<best company/contact email or null>",
    "contactPhone": "<best contact/company phone or null>",
    "companyAddress": "<company/mailing address or null>",
    "bidders": [
      {"email": "bidder@example.com", "company": "Bidder Company", "isPrimary": true}
    ],
    "isMultiBidder": true | false
  }
}
"""


def build_pass1_user_prompt(
    subject: Optional[str] = None,
    sender: Optional[str] = None,
    from_name: Optional[str] = None,
    to_recipients: Optional[List[str]] = None,
    cc_recipients: Optional[List[str]] = None,
    bcc_recipients: Optional[List[str]] = None,
    document_names: Optional[List[str]] = None,
    body_snippet: Optional[str] = None,
    document_text: Optional[str] = None,
    received_date: Optional[str] = None,
) -> str:
    """Build the user message from the incoming email fields for Pass 1."""
    parts = []

    if received_date:
        parts.append(f"RECEIVED DATE: {received_date}")

    if subject:
        parts.append(f"EMAIL SUBJECT: {subject}")
    
    if sender:
        if from_name:
            parts.append(f"SENDER: {from_name} <{sender}>")
        else:
            parts.append(f"SENDER: {sender}")
            
    if to_recipients:
        parts.append(f"TO RECIPIENTS: {', '.join(to_recipients)}")
        
    if cc_recipients:
        parts.append(f"CC RECIPIENTS: {', '.join(cc_recipients)}")

    if document_names:
        parts.append(f"ATTACHED DOCUMENTS: {', '.join(document_names)}")

    body = body_snippet or ""
    if body:
        parts.append(f"EMAIL BODY CONTENT:\n{body}")

    if document_text:
        parts.append(f"ATTACHED DOCUMENTS TEXT CONTENT:\n{document_text}")

    return "\n".join(parts) if parts else "No email details available."


# =============================================================================
# PASS 2: Candidate verification and linkage
# =============================================================================

def build_pass2_system_prompt(candidates: List[dict]) -> str:
    """System prompt for the 2nd pass LLM call to verify and link candidates."""
    import json
    candidates_str = json.dumps(candidates, indent=2)
    
    return f"""\
You are a project-matching agent for GFS (Glass Floor Systems). Decide whether the incoming email belongs to an existing project from the candidates below, or is a new project.

## DATABASE CANDIDATES
{candidates_str}

## YOUR TASK
Compare the email's content (addresses, quote/reference numbers, sender email, subject, attachments) against each candidate's fields: `jobAddress`, `address`, `referenceNumber`, `email`, `projectName`, `customerName`.

## SIGNAL PRIORITY (highest → lowest)

1. **ADDRESS** — job-site address vs candidate's `jobAddress` / `address`
2. **QUOTE / REFERENCE NUMBER** — quote/ref numbers vs candidate's `referenceNumber`
3. **SENDER EMAIL** — sender email vs candidate's `email`
4. **EMAIL DOMAIN** — sender's email domain vs candidate contact's domain
5. **PROJECT NAME / SUBJECT** — email subject vs candidate's `projectName`

When matching, prefer the candidate that matches on the highest-priority signal. If there is any ambiguity or you cannot confidently pick one candidate, classify as `NEW_PROJECT`.

## CONFIDENCE
- 0.9–1.0: clear match on high-priority signal, nothing contradicting
- 0.7–0.89: match with partial support from other fields
- Below 0.7: classify as `NEW_PROJECT`

## CONSTRAINTS
- `matchedProjectId` must be a verbatim `projectId` from DATABASE CANDIDATES, or null.
- If `NEW_PROJECT`, `matchedProjectId` must be null.

## OUTPUT — valid JSON only, no markdown
{{{{
  "classification": "EXISTING_PROJECT" | "NEW_PROJECT",
  "confidence": <float 0.0–1.0>,
  "summary": "A structured, detailed summary of the request using this exact template:\n- Customer Info: [Name] from [Company]\n- Location: [Site Address]\n- Scope: [Specific GFS products requested, e.g. walkable skylight, glass floor, stairs, with any quantities/dimensions mentioned]\n- Request Summary: [Detailed description of what is being requested, e.g. quoting, drawing updates, schedule coordination]\n- Attachments: [List of attached drawings or index files and what they represent]\n- Sender Name: [Sender Name]\n- Sender Email: [Sender Email]\n- Company Name: [Company Name]",
  "reasoning": "<plain English explanation citing which signal matched or why no match was found>",
  "address": "<job-site address from the email, or null>",
  "matchedProjectId": "<projectId or null>"
}}}}
"""


def build_pass2_user_prompt(
    subject: Optional[str] = None,
    sender: Optional[str] = None,
    from_name: Optional[str] = None,
    to_recipients: Optional[List[str]] = None,
    cc_recipients: Optional[List[str]] = None,
    bcc_recipients: Optional[List[str]] = None,
    document_names: Optional[List[str]] = None,
    body_snippet: Optional[str] = None,
    document_text: Optional[str] = None,
    received_date: Optional[str] = None,
    extracted_signals: Optional[dict] = None,
) -> str:
    """Build the user message from the email fields and AI-extracted signals for Pass 2."""
    import json
    parts = []

    if received_date:
        parts.append(f"RECEIVED DATE: {received_date}")

    if subject:
        parts.append(f"EMAIL SUBJECT: {subject}")
    
    if sender:
        if from_name:
            parts.append(f"SENDER: {from_name} <{sender}>")
        else:
            parts.append(f"SENDER: {sender}")
            
    if to_recipients:
        parts.append(f"TO RECIPIENTS: {', '.join(to_recipients)}")
        
    if cc_recipients:
        parts.append(f"CC RECIPIENTS: {', '.join(cc_recipients)}")

    if bcc_recipients:
        parts.append(f"BCC RECIPIENTS: {', '.join(bcc_recipients)}")

    if document_names:
        parts.append(f"ATTACHED DOCUMENTS: {', '.join(document_names)}")

    body = body_snippet or ""
    if body:
        parts.append(f"EMAIL BODY CONTENT:\n{body}")

    if document_text:
        parts.append(f"ATTACHED DOCUMENTS TEXT CONTENT:\n{document_text}")

    if extracted_signals:
        signals_str = json.dumps(extracted_signals, indent=2)
        parts.append(f"AI-EXTRACTED SIGNALS:\n{signals_str}")

    return "\n".join(parts) if parts else "No email details available."
