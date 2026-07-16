"""Document conversion microservice — Docling → markdown (+ PDF page previews)."""

from __future__ import annotations

import base64
import io
import logging
import tempfile
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from PIL import Image

logger = logging.getLogger("ingest")
logging.basicConfig(level=logging.INFO)

MAX_UPLOAD_BYTES = 25 * 1024 * 1024
# Keep preview/OCR payloads manageable.
MAX_PAGE_IMAGES = 40
PAGE_IMAGE_MAX_WIDTH = 1280
PAGE_JPEG_QUALITY = 72

app = FastAPI(title="kherad-ingest", version="0.1.0")

_converter: Any | None = None


def get_converter() -> Any:
    global _converter
    if _converter is None:
        from docling.datamodel.base_models import InputFormat
        from docling.datamodel.pipeline_options import PdfPipelineOptions
        from docling.document_converter import DocumentConverter, PdfFormatOption

        pipeline = PdfPipelineOptions(
            generate_page_images=True,
            images_scale=1.5,
        )
        _converter = DocumentConverter(
            format_options={
                InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline),
            }
        )
    return _converter


def _pil_to_jpeg_b64(img: Image.Image) -> tuple[str, str]:
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    elif img.mode == "L":
        img = img.convert("RGB")
    if img.width > PAGE_IMAGE_MAX_WIDTH:
        ratio = PAGE_IMAGE_MAX_WIDTH / img.width
        img = img.resize(
            (PAGE_IMAGE_MAX_WIDTH, max(1, int(img.height * ratio))),
            Image.Resampling.LANCZOS,
        )
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=PAGE_JPEG_QUALITY, optimize=True)
    return "image/jpeg", base64.b64encode(buf.getvalue()).decode("ascii")


def _extract_page_images(document: Any, source_suffix: str) -> list[dict[str, Any]]:
    pages_out: list[dict[str, Any]] = []

    # Image uploads: treat the file itself as a single preview page.
    if source_suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff"}:
        return pages_out

    pages = getattr(document, "pages", None)
    if not pages:
        return pages_out

    # docling pages may be a dict keyed by page no, or a list-like.
    items: list[tuple[int, Any]]
    if isinstance(pages, dict):
        items = sorted(((int(k), v) for k, v in pages.items()), key=lambda x: x[0])
    else:
        items = list(enumerate(pages, start=1))

    for page_no, page in items[:MAX_PAGE_IMAGES]:
        image = getattr(page, "image", None)
        if image is None:
            continue
        pil = getattr(image, "pil_image", None) or image
        if not isinstance(pil, Image.Image):
            continue
        mime, b64 = _pil_to_jpeg_b64(pil)
        pages_out.append({"page": page_no, "mime": mime, "base64": b64})

    return pages_out


def _title_hint(filename: str, markdown: str) -> str:
    stem = Path(filename).stem.replace("_", " ").replace("-", " ").strip()
    for line in markdown.splitlines():
        stripped = line.strip()
        if stripped.startswith("# "):
            return stripped[2:].strip() or stem
    return stem or "Untitled"


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/convert")
async def convert(file: UploadFile = File(...)) -> JSONResponse:
    if not file.filename:
        raise HTTPException(status_code=400, detail="filename is required")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 25 MB)")

    suffix = Path(file.filename).suffix or ".bin"
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(data)
            tmp_path = Path(tmp.name)

        converter = get_converter()
        result = converter.convert(str(tmp_path))
        document = result.document
        markdown = document.export_to_markdown(image_mode="embedded")
        page_images = _extract_page_images(document, suffix)

        # For standalone image files, include the original as the preview page.
        if suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"} and not page_images:
            try:
                with Image.open(io.BytesIO(data)) as img:
                    mime, b64 = _pil_to_jpeg_b64(img)
                    page_images = [{"page": 1, "mime": mime, "base64": b64}]
            except Exception:
                logger.exception("Failed to open image for preview")

        format_name = suffix.lstrip(".").lower() or "unknown"
        payload = {
            "markdown": markdown,
            "pageImages": page_images,
            "titleHint": _title_hint(file.filename, markdown),
            "format": format_name,
            "filename": file.filename,
        }
        return JSONResponse(payload)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Conversion failed")
        raise HTTPException(status_code=422, detail=f"Conversion failed: {exc}") from exc
    finally:
        try:
            if "tmp_path" in locals() and tmp_path.exists():
                tmp_path.unlink(missing_ok=True)
        except Exception:
            pass
