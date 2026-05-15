#!/usr/bin/env python3
"""Inventory customer-provided files for evidence gathering."""

from __future__ import annotations

import argparse
import csv
import json
import mimetypes
import struct
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable


IMAGE_EXTENSIONS = {
    ".avif",
    ".bmp",
    ".gif",
    ".jpeg",
    ".jpg",
    ".png",
    ".svg",
    ".tif",
    ".tiff",
    ".webp",
}


@dataclass
class InventoryItem:
    path: str
    type: str
    size_bytes: int
    image_width: int | None = None
    image_height: int | None = None
    note: str = ""


def detect_image_size(path: Path) -> tuple[int | None, int | None, str]:
    try:
        with path.open("rb") as handle:
            header = handle.read(32)
            if header.startswith(b"\x89PNG\r\n\x1a\n"):
                return (*struct.unpack(">II", header[16:24]), "")
            if header[:6] in (b"GIF87a", b"GIF89a"):
                return (*struct.unpack("<HH", header[6:10]), "")
            if header.startswith(b"\xff\xd8"):
                return read_jpeg_size(path)
    except OSError as exc:
        return None, None, f"image size unavailable: {exc}"

    try:
        from PIL import Image

        with Image.open(path) as image:
            return image.width, image.height, ""
    except Exception as exc:  # noqa: BLE001 - optional dependency varies by runtime
        return None, None, f"image size unavailable: {exc}"


def read_jpeg_size(path: Path) -> tuple[int | None, int | None, str]:
    try:
        with path.open("rb") as handle:
            handle.read(2)
            while True:
                marker_start = handle.read(1)
                if not marker_start:
                    return None, None, "image size unavailable: JPEG marker not found"
                if marker_start != b"\xff":
                    continue
                marker = handle.read(1)
                while marker == b"\xff":
                    marker = handle.read(1)
                if marker in {b"\xc0", b"\xc1", b"\xc2", b"\xc3", b"\xc5", b"\xc6", b"\xc7", b"\xc9", b"\xca", b"\xcb", b"\xcd", b"\xce", b"\xcf"}:
                    handle.read(3)
                    height, width = struct.unpack(">HH", handle.read(4))
                    return width, height, ""
                if marker in {b"\xd8", b"\xd9"}:
                    continue
                length_bytes = handle.read(2)
                if len(length_bytes) != 2:
                    return None, None, "image size unavailable: JPEG segment truncated"
                segment_length = struct.unpack(">H", length_bytes)[0]
                handle.seek(segment_length - 2, 1)
    except OSError as exc:
        return None, None, f"image size unavailable: {exc}"


def inventory(root: Path, include_hidden: bool) -> list[InventoryItem]:
    items: list[InventoryItem] = []
    for path in sorted(root.rglob("*")):
        if path.is_dir():
            continue
        relative = path.relative_to(root)
        if not include_hidden and any(part.startswith(".") for part in relative.parts):
            continue

        stat = path.stat()
        mime_type = mimetypes.guess_type(path.name)[0] or "unknown"
        item = InventoryItem(path=str(relative), type=mime_type, size_bytes=stat.st_size)

        if path.suffix.lower() in IMAGE_EXTENSIONS or mime_type.startswith("image/"):
            width, height, note = detect_image_size(path)
            item.image_width = width
            item.image_height = height
            item.note = note

        items.append(item)
    return items


def write_markdown(items: Iterable[InventoryItem]) -> None:
    print("| Path | Type | Size bytes | Image dimensions | Note |")
    print("|---|---:|---:|---|---|")
    for item in items:
        dimensions = ""
        if item.image_width is not None and item.image_height is not None:
            dimensions = f"{item.image_width}x{item.image_height}"
        print(f"| `{item.path}` | {item.type} | {item.size_bytes} | {dimensions} | {item.note} |")


def write_csv(items: Iterable[InventoryItem]) -> None:
    writer = csv.DictWriter(
        sys.stdout,
        fieldnames=["path", "type", "size_bytes", "image_width", "image_height", "note"],
    )
    writer.writeheader()
    for item in items:
        writer.writerow(asdict(item))


def main() -> int:
    parser = argparse.ArgumentParser(
        description="List customer files and image dimensions for evidence gathering. This script does not decide compliance."
    )
    parser.add_argument("folder", help="Customer materials folder to inventory")
    parser.add_argument("--format", choices=["markdown", "json", "csv"], default="markdown")
    parser.add_argument("--include-hidden", action="store_true", help="Include dotfiles and files in hidden folders")
    args = parser.parse_args()

    root = Path(args.folder).expanduser().resolve()
    if not root.exists():
        parser.error(f"folder does not exist: {root}")
    if not root.is_dir():
        parser.error(f"not a folder: {root}")

    items = inventory(root, args.include_hidden)
    if args.format == "json":
        print(json.dumps([asdict(item) for item in items], ensure_ascii=False, indent=2))
    elif args.format == "csv":
        write_csv(items)
    else:
        write_markdown(items)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
