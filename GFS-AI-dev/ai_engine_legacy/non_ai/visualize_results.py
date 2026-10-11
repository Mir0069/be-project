import os
import sys
import json
from pathlib import Path

# Force stdout/stderr to utf-8 encoding on Windows to prevent UnicodeEncodeError with emojis
if sys.platform.startswith("win"):
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")


try:
    import fitz  # PyMuPDF
    HAVE_FITZ = True
except ImportError:
    HAVE_FITZ = False
    print("PyMuPDF not installed — cannot highlight PDFs. Run: pip install pymupdf")

try:
    from PIL import Image, ImageDraw
    HAVE_PIL = True
except ImportError:
    HAVE_PIL = False
    print("Pillow not installed — cannot highlight PNG/JPG images. Run: pip install pillow")


def highlight_pdf_file(pdf_path: str, doc_data: dict, output_path: str):
    """Draw bounding boxes on a PDF using fitz (PyMuPDF)."""
    if not HAVE_FITZ:
        return
    
    doc = fitz.open(pdf_path)
    
    # 1. Highlight paragraphs & headings (Yellow)
    for p in doc_data.get("paragraphs", []) + doc_data.get("headings", []):
        bbox = p.get("bbox")
        if not bbox:
            continue
        page_no = bbox.get("page")
        if not page_no or page_no > len(doc):
            continue
        
        page = doc[page_no - 1]
        H = page.rect.height
        
        # Convert bottom-left coordinates to top-left fitz Rect
        # Since y0 > y1 in PDF bottom-left space, H - y0 < H - y1 in top-left space
        rect = fitz.Rect(
            bbox["x0"], 
            H - bbox["y0"], 
            bbox["x1"], 
            H - bbox["y1"]
        )
        if page.rotation != 0:
            rect = rect * page.derotation_matrix
        
        annot = page.add_highlight_annot(rect)
        if annot:
            annot.set_colors(stroke=(1.0, 0.9, 0.2))  # Yellow
            annot.update()

    # 2. Highlight tables (Blue)
    for t in doc_data.get("tables", []):
        bbox = t.get("bbox")
        if not bbox:
            continue
        page_no = bbox.get("page")
        if not page_no or page_no > len(doc):
            continue
        
        page = doc[page_no - 1]
        H = page.rect.height
        
        rect = fitz.Rect(
            bbox["x0"], 
            H - bbox["y0"], 
            bbox["x1"], 
            H - bbox["y1"]
        )
        if page.rotation != 0:
            rect = rect * page.derotation_matrix
        
        # Add a colored rectangle annotation for table boundary
        annot = page.add_rect_annot(rect)
        if annot:
            annot.set_colors(stroke=(0.2, 0.6, 1.0))  # Blue
            annot.update()

    # 3. Highlight figures / flagged regions (Red)
    for f in doc_data.get("figures", []):
        bbox = f.get("bbox")
        if not bbox:
            continue
        page_no = bbox.get("page")
        if not page_no or page_no > len(doc):
            continue
        
        page = doc[page_no - 1]
        H = page.rect.height
        
        rect = fitz.Rect(
            bbox["x0"], 
            H - bbox["y0"], 
            bbox["x1"], 
            H - bbox["y1"]
        )
        if page.rotation != 0:
            rect = rect * page.derotation_matrix
        
        annot = page.add_rect_annot(rect)
        if annot:
            annot.set_colors(stroke=(1.0, 0.3, 0.3))  # Red
            annot.update()
            
    doc.save(output_path)
    doc.close()


def highlight_image_file(img_path: str, doc_data: dict, output_path: str):
    """Draw bounding boxes on an image file using Pillow."""
    if not HAVE_PIL:
        return
    
    img = Image.open(img_path).convert("RGBA")
    draw = ImageDraw.Draw(img)
    
    W, H = img.size
    
    # In Pillow, y increases downwards (top-left is 0,0).
    # Since Docling coordinates for images are normalized to PDF-like space (where y increases upwards),
    # we need to map them. Let's inspect coordinates to see if they need flipping.
    # Usually Docling returns them in a standard height-based coordinate system.
    
    # 1. Highlight paragraphs & headings (Yellow rectangle)
    for p in doc_data.get("paragraphs", []) + doc_data.get("headings", []):
        bbox = p.get("bbox")
        if not bbox:
            continue
        
        y0_p = H - bbox["y0"]
        y1_p = H - bbox["y1"]
        
        # Draw translucent rectangle
        draw.rectangle(
            [bbox["x0"], min(y0_p, y1_p), bbox["x1"], max(y0_p, y1_p)],
            outline=(255, 230, 50, 255),
            width=3
        )

    # 2. Highlight tables (Blue rectangle)
    for t in doc_data.get("tables", []):
        bbox = t.get("bbox")
        if not bbox:
            continue
        
        y0_p = H - bbox["y0"]
        y1_p = H - bbox["y1"]
        
        draw.rectangle(
            [bbox["x0"], min(y0_p, y1_p), bbox["x1"], max(y0_p, y1_p)],
            outline=(50, 150, 255, 255),
            width=4
        )

    # 3. Highlight figures (Red rectangle)
    for f in doc_data.get("figures", []):
        bbox = f.get("bbox")
        if not bbox:
            continue
        
        y0_p = H - bbox["y0"]
        y1_p = H - bbox["y1"]
        
        draw.rectangle(
            [bbox["x0"], min(y0_p, y1_p), bbox["x1"], max(y0_p, y1_p)],
            outline=(255, 70, 70, 255),
            width=5
        )
        
    img.convert("RGB").save(output_path)


def visualize_folder(project_folder: str):
    """Orchestrate highlighting of all processed documents."""
    results_dir = os.path.join(project_folder, "non_ai_results")
    json_path = os.path.join(results_dir, "non_ai_extracted_data.json")
    
    if not os.path.exists(json_path):
        print(f"Error: {json_path} not found. Run docling_extract.py first.")
        sys.exit(1)
        
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)
        
    print(f"\nVisualizing extraction results for: {project_folder}")
    print(f"Reading from: {json_path}\n")
    
    for filename, doc_data in data.get("documents", {}).items():
        original_path = os.path.join(project_folder, filename)
        if not os.path.exists(original_path):
            print(f"  ✗ Original file not found: {filename}")
            continue
            
        ext = Path(filename).suffix.lower()
        output_filename = f"visualized_{Path(filename).stem}{ext}"
        output_path = os.path.join(results_dir, output_filename)
        
        print(f"  🎨 Highlighting: {filename} -> {output_filename}")
        
        try:
            if ext == ".pdf":
                highlight_pdf_file(original_path, doc_data, output_path)
            elif ext in {".png", ".jpg", ".jpeg", ".bmp"}:
                highlight_image_file(original_path, doc_data, output_path)
            else:
                print(f"    (Skipping visualization for unsupported extension: {ext})")
        except Exception as e:
            print(f"    ✗ Visualization failed: {e}")
            
    print(f"\n✅ Visualization complete! Annotated files saved in: {results_dir}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python visualize_results.py <project_folder>")
        sys.exit(1)
        
    visualize_folder(sys.argv[1])
