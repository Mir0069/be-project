from pathlib import Path
from PIL import Image, ImageDraw

try:
    import fitz  # PyMuPDF
    HAVE_FITZ = True
except ImportError:
    HAVE_FITZ = False

DPI = 150
SCALE_INCH_TO_PIXEL = DPI

def get_bbox_from_polygon(polygon: list) -> tuple:
    """Convert an 8-element polygon list [x1,y1,x2,y2,x3,y3,x4,y4] to (xmin, ymin, xmax, ymax)."""
    xs = [polygon[0], polygon[2], polygon[4], polygon[6]]
    ys = [polygon[1], polygon[3], polygon[5], polygon[7]]
    return min(xs), min(ys), max(xs), max(ys)

def visualize_document(file_bytes: bytes, file_name: str, azure_result: dict, output_dir: Path) -> list[str]:
    """
    Renders pages of the file, draws transparent highlight overlays, and saves to output_dir.
    Returns list of saved page filenames.
    """
    ext = Path(file_name).suffix.lower()
    pages_data = azure_result.get("pages", [])
    paragraphs = azure_result.get("paragraphs", [])
    tables = azure_result.get("tables", [])
    figures = azure_result.get("figures", [])

    page_images = {}
    page_dimensions = {}

    # 1. Render or load pages as PIL images
    if ext == ".pdf":
        if not HAVE_FITZ:
            print(f"❌ PyMuPDF is not installed. Cannot render PDF page visualizers for {file_name}.")
            return []
        
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        for page_idx in range(len(doc)):
            page_num = page_idx + 1
            page = doc[page_idx]
            pix = page.get_pixmap(dpi=DPI)
            img_data = pix.tobytes("png")
            
            from io import BytesIO
            img = Image.open(BytesIO(img_data)).convert("RGBA")
            page_images[page_num] = img
            
            az_page = next((pg for pg in pages_data if pg.get("pageNumber") == page_num), None)
            if az_page:
                page_dimensions[page_num] = {
                    "width": az_page.get("width", 8.5),
                    "height": az_page.get("height", 11.0),
                    "unit": az_page.get("unit", "inch")
                }
        doc.close()
    elif ext in {".png", ".jpg", ".jpeg", ".tiff", ".bmp", ".webp"}:
        from io import BytesIO
        img = Image.open(BytesIO(file_bytes)).convert("RGBA")
        page_images[1] = img
        az_page = pages_data[0] if pages_data else {}
        page_dimensions[1] = {
            "width": az_page.get("width", img.width),
            "height": az_page.get("height", img.height),
            "unit": az_page.get("unit", "pixel")
        }
    else:
        # Non-visual file format (like email or excel)
        return []

    # Helper to map coordinates to pixel values
    def map_coords(val, page_num):
        dim = page_dimensions.get(page_num, {"unit": "pixel"})
        if dim.get("unit") == "inch":
            return val * SCALE_INCH_TO_PIXEL
        return val

    # 2. Draw paragraph highlights (Yellow boxes)
    for para in paragraphs:
        regions = para.get("boundingRegions", [])
        for region in regions:
            page_num = region.get("pageNumber")
            polygon = region.get("polygon")
            if not page_num or not polygon or page_num not in page_images:
                continue

            xmin, ymin, xmax, ymax = get_bbox_from_polygon(polygon)
            x0 = map_coords(xmin, page_num)
            y0 = map_coords(ymin, page_num)
            x1 = map_coords(xmax, page_num)
            y1 = map_coords(ymax, page_num)

            img = page_images[page_num]
            overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
            draw = ImageDraw.Draw(overlay)
            draw.rectangle([x0, y0, x1, y1], fill=(255, 230, 50, 80))
            page_images[page_num] = Image.alpha_composite(img, overlay)

    # 3. Draw table highlights (Blue borders)
    for table in tables:
        regions = table.get("boundingRegions", [])
        for region in regions:
            page_num = region.get("pageNumber")
            polygon = region.get("polygon")
            if not page_num or not polygon or page_num not in page_images:
                continue

            xmin, ymin, xmax, ymax = get_bbox_from_polygon(polygon)
            x0 = map_coords(xmin, page_num)
            y0 = map_coords(ymin, page_num)
            x1 = map_coords(xmax, page_num)
            y1 = map_coords(ymax, page_num)

            img = page_images[page_num]
            overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
            draw = ImageDraw.Draw(overlay)
            draw.rectangle([x0, y0, x1, y1], outline=(30, 144, 255, 255), width=5)
            page_images[page_num] = Image.alpha_composite(img, overlay)

    # 4. Draw figure highlights (Red borders)
    for fig in figures:
        regions = fig.get("boundingRegions", [])
        for region in regions:
            page_num = region.get("pageNumber")
            polygon = region.get("polygon")
            if not page_num or not polygon or page_num not in page_images:
                continue

            xmin, ymin, xmax, ymax = get_bbox_from_polygon(polygon)
            x0 = map_coords(xmin, page_num)
            y0 = map_coords(ymin, page_num)
            x1 = map_coords(xmax, page_num)
            y1 = map_coords(ymax, page_num)

            img = page_images[page_num]
            overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
            draw = ImageDraw.Draw(overlay)
            draw.rectangle([x0, y0, x1, y1], outline=(255, 70, 70, 255), width=5)
            page_images[page_num] = Image.alpha_composite(img, overlay)

    # 5. Save highlighted page images
    saved_filenames = []
    doc_stem = Path(file_name).stem
    for page_num, img in page_images.items():
        out_name = f"{doc_stem}_page_{page_num}_highlighted.png"
        out_path = output_dir / out_name
        img.convert("RGB").save(str(out_path))
        saved_filenames.append(out_name)

    return saved_filenames
