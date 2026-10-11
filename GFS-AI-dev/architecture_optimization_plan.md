# GFS-AI Ingestion Architecture Optimization Plan

This document outlines the architectural and codebase optimizations proposed for the GFS-AI document extraction pipeline to resolve high processing latency and high Azure resource billing.

---

## 📈 Combined Target Impact
* **Ingestion Time:** Slashing a typical 35-page drawing set processing from **3 minutes** down to **~20 seconds**.
* **Azure Billing:** Slashing OCR and OpenAI billing by **75% to 80%** per project submittal.

---

## 🛠️ Phase 1: High-Return, Immediate Optimizations (Low Effort)

### 1. Sheet Classification & Prefix Filtering (Cost Savings: ~70%)
* **Current Bottleneck:** The system sends every sheet to Azure Document Intelligence OCR and GPT-4o, regardless of relevance.
* **Optimization:** Extract the Sheet Title or Page Title Block locally (e.g. from Page Index or fast sub-second corner scans) to identify the sheet prefix.
* **The Rules:**
  * Skip structural (**`S-*`**), civil (**`C-*`**), mechanical (**`M-*`**), electrical (**`E-*`**), plumbing (**`P-*`**), and landscaping (**`L-*`**) drawing sheets.
  * Only process architectural (**`A-*`**) and glazing/window schedules (**`G-*`** / **`GL-*`**).
* **Impact:** For a 35-page drawing set (like Flagler Drive), this instantly filters out ~25 pages, leaving only ~8 relevant pages for downstream OCR and LLM parsing.

### 2. Native Vector Text Extraction (Cost Savings: ~100% on Vector PDFs)
* **Current Bottleneck:** Azure OCR is used on all PDF files, including digitally exported vector CAD blueprints that already contain extractable text characters.
* **Optimization:** Use a fast local text parsing library like `PyMuPDF` (fitz) or `pdfplumber` to check for embedded characters. 
* **Implementation:** If vector characters are found, extract them directly (takes **10 milliseconds** locally for **$0.00**). Only fall back to Azure Document Intelligence OCR if the text extraction returns empty blocks (indicating a scanned paper raster image).
* **Impact:** Eliminates Azure OCR service charges for over 80% of incoming documents.

### 3. OpenAI Prompt Caching (Cost Savings: ~50% on LLM Inputs)
* **Current Bottleneck:** The rules engine prompt containing the complete 10-section GFS business logic rules is sent with every API call, multiplying input token bills.
* **Optimization:** Structure API prompts to place static rule templates at the beginning of the context. 
* **Implementation:** Keep system instructions static. Azure OpenAI automatically caches system prompts larger than 1,024 tokens.
* **Impact:** Saves **50% of input token costs** on all sequential page requests.

---

## 🛠️ Phase 2: Pipeline Refinements (Medium Effort)

### 4. Bounding Box Region-of-Interest Cropping
* **Current Bottleneck:** Full cover sheets and title drawings are sent to GPT-4o, wasting context window budget on drawings when only text metadata is needed.
* **Optimization:** Segment the page and crop only the **Title Block bounding box** (usually the bottom-right coordinate block `[36", 15", 41.5", 19.5"]`).
* **Implementation:** Only run OCR and LLM parsing on this cropped coordinate segment to extract project names, quotes, and architects.
* **Impact:** Reduces input tokens from ~50,000 down to ~2,000 per cover page.

### 5. Local OCR for Text/Email Pages
* **Current Bottleneck:** Text emails (`email-*.txt` files) and specification indexes are uploaded to Azure OCR.
* **Optimization:** Route email threads and simple document attachments to local Tesseract OCR.
* **Impact:** Limits Azure OCR consumption exclusively to high-resolution CAD elevations.

---

## 🛠️ Phase 3: Infrastructure Parallelism (Speed Only)

### 6. Concurrent Page Processing
* **Current Bottleneck:** PDF pages are processed sequentially inside a single-threaded loop, bottlenecking on large documents.
* **Optimization:** Implement parallel tasks using Python's `concurrent.futures.ThreadPoolExecutor` or `ProcessPoolExecutor` to run OCR and page classification concurrently.
* **Impact:** Processes all relevant pages in parallel, bringing total processing times to under **25 seconds** for 10-page drawing subsets.
