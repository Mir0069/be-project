# Classifier Bug Fix Details & Root Cause Analysis

**Branch:** `om/dev-copy`  
**Remote Repository:** `https://github.com/AmberfluxEAI/GFS-AI.git`  
**Commit Hash:** `a76901193513fbd4c5f14c220331f462cac86ca2`  
**Status:** Pushed to remote `origin/om/dev-copy`  

---

## 1. Summary of Bug Reports

1. **Attachment-less Email Bug:** Emails without attachments were automatically treated as SPAM by the classifier.
2. **Internal Email Discard Bug:** Internal team emails referencing project codes/names (such as `gfs1-gf2`, scope notes, or project updates) without attached drawings were unconditionally discarded as SPAM. Casual chit-chat (e.g., *"let's have lunch"*) needed to be discarded, but important project details were also being discarded incorrectly.

---

## 2. Root Cause Analysis (Code Lines Causing Bugs)

### Bug 1: Emails without attachments treated as SPAM
* **[prompts/1.classifier_pass1_system.md](file:///c:/Users/swapn/Coding%20by%20rak/Amberflux/GFS/GFS-AI/prompts/1.classifier_pass1_system.md)**
  - **Lines 18 & 31:** Prompt rules instructed the Pass 1 LLM filter that emails from internal staff without attached drawings or design documents *must always be classified as NOT_RELEVANT (SPAM)*.
  - **Line 33:** Default edge case rule stated: *"When genuinely ambiguous and it contains no attachments or explicit product specifications, default to NOT_RELEVANT (SPAM)."*
* **[classifier/prompt.py](file:///c:/Users/swapn/Coding%20by%20rak/Amberflux/GFS/GFS-AI/classifier/prompt.py)**
  - **Lines 31, 44, 46:** Contained duplicate hardcoded system prompt strings enforcing the same attachment-less SPAM rule.
* **[classifier/classifier.py](file:///c:/Users/swapn/Coding%20by%20rak/Amberflux/GFS/GFS-AI/classifier/classifier.py#L343-L351)**
  - **Lines 343–351:** When Pass 1 evaluated `isProjectRelevant: false`, execution short-circuited immediately and returned `"classification": "SPAM"` (`action: DISCARD`), skipping downstream candidate project matching.
* **[GFS-backend/src/features/outlook/outlook.service.ts](file:///c:/Users/swapn/Coding%20by%20rak/Amberflux/GFS/GFS-backend/src/features/outlook/outlook.service.ts#L208-L233)**
  - **Lines 208–233:** On receiving `action: 'DISCARD'` or `proposed.isProject === false`, the backend marked the email status as `DISCARDED`.

### Bug 2: Internal emails (e.g., referencing `gfs1-gf2`) discarded as SPAM
* **[prompts/1.classifier_pass1_system.md](file:///c:/Users/swapn/Coding%20by%20rak/Amberflux/GFS/GFS-AI/prompts/1.classifier_pass1_system.md)**
  - **Line 18:** Rule stated: *"Emails sent by GFS internal staff members (e.g. from the domain 'glassflooringsystems.com'...) that do NOT contain attached drawings or design documents... should be classified as NOT_RELEVANT (SPAM)."*
  - **Impact:** Any internal email mentioning project codes (like `gfs1`, `gfs2`, `gfs1-gf2`), quote updates, or technical scope was marked as SPAM simply because no drawings were attached. There was no distinction between internal project discussions vs. casual chit-chat (like *"let's have lunch"*).

---

## 3. How the Bugs Were Fixed

### 1. Updated Pass 1 System Prompt
Modified **[prompts/1.classifier_pass1_system.md](file:///c:/Users/swapn/Coding%20by%20rak/Amberflux/GFS/GFS-AI/prompts/1.classifier_pass1_system.md)** and **[classifier/prompt.py](file:///c:/Users/swapn/Coding%20by%20rak/Amberflux/GFS/GFS-AI/classifier/prompt.py)**:

* **Explicit Project Relevance for Internal Emails & References:**
  ```markdown
  - Discusses internal or external project details, engineering specs, scope, or references specific project identifiers/codes (e.g. "gfs1", "gfs2", "gfs1-gf2", "Q-2026-0428", "GFS-2026-0042") or job-site addresses — EVEN IF the email does NOT contain attached files or drawings. Having attached files is NOT required for an email to be PROJECT_RELEVANT.
  - Comes from internal GFS staff members (e.g. from 'glassflooringsystems.com' or GFS internal email addresses) sharing or discussing important project information, scope updates, engineering specs, or project references (such as `gfs1-gf2`).
  ```

* **Targeted SPAM Filtering for Social Chit-Chat Only:**
  ```markdown
  - Emails sent by GFS internal staff members (e.g. from the domain 'glassflooringsystems.com' or other GFS internal company email addresses) that are purely casual social conversation, personal chit-chat, or non-project administrative banter with no project details, specifications, or quote numbers (e.g., "let's have lunch", "coffee break", "happy weekend", "running late"). (Note: Internal emails discussing actual project scope, project identifiers like `gfs1-gf2`, quote numbers, site details, specifications, or forwarding project drawings ARE PROJECT_RELEVANT and must NOT be marked as spam).
  ```

* **Edge Case Clarifications:**
  ```markdown
  - If an email mixes administrative/internal banter WITH an actionable project request, project update, or project identifier (such as `gfs1-gf2`), classify it as PROJECT_RELEVANT.
  - A bare "thanks", "let's have lunch", or one-line social acknowledgement in an ongoing thread with no project request or project details is NOT_RELEVANT.
  ```

---

## 4. Verification & Automated Tests

Added **[tests/test_classifier_internal_emails.py](file:///c:/Users/swapn/Coding%20by%20rak/Amberflux/GFS/GFS-AI/tests/test_classifier_internal_emails.py)** to test prompt rules:

```bash
python -m unittest tests/test_classifier_internal_emails.py tests/test_bidder_contract.py
```

**Results:**
```text
Ran 10 tests in 0.003s
OK
```

---

## 5. Git & Deployment Metadata
- **Branch:** `om/dev-copy`
- **Commit SHA:** `a76901193513fbd4c5f14c220331f462cac86ca2`
- **Pushed To:** Remote `origin/om/dev-copy` (`https://github.com/AmberfluxEAI/GFS-AI.git`)
- **Shared Resource Safety:** MongoDB models, backend schemas, and production endpoints were 100% untouched.
