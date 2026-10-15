"""Derive local regression data: python tests/ai/fixtures/generate.py INPUT_DIR.

Pillow is only used to prepare fixtures, never by the application or Node tests.
"""
import argparse
import json
from pathlib import Path
import struct
import zlib
from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument("source", type=Path)
parser.add_argument("--output", type=Path, default=Path(__file__).parent)
parser.add_argument("--width", type=int, default=252)
parser.add_argument("--height", type=int, default=352)
parser.add_argument("--lossless", action="store_true")
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
stats = json.loads((args.source / "stats.json").read_text(encoding="utf-8"))
size = (args.width, args.height)
for card in range(1, 5):
    name = f"card{card}"
    rgba = Image.open(args.source / f"{name}-image.png").convert("RGBA").resize(size, Image.Resampling.BOX)
    # Sample depth and truth at the same pixel centers; retain exact 0/1 plateaus.
    depth = Image.open(args.source / f"{name}-depth16.png").resize(size, Image.Resampling.NEAREST)
    mask = Image.open(args.source / f"{name}-mask.png").convert("L").resize(size, Image.Resampling.NEAREST)
    depth_bytes = struct.pack(f"<{size[0] * size[1]}H", *depth.getdata())
    if args.lossless:
        payload = rgba.tobytes() + depth_bytes + mask.tobytes()
    else:
        # RGB565 bounds color error to 4/2/4 levels, unlike palette reduction.
        rgb = rgba.tobytes()
        colors = [round(rgb[i] * 31 / 255) << 11 | round(rgb[i + 1] * 63 / 255) << 5 | round(rgb[i + 2] * 31 / 255)
                  for i in range(0, len(rgb), 4)]
        blocks = [(struct.pack(f"<{len(colors)}H", *colors), 2), (rgba.getchannel("A").tobytes(), 1),
                  (depth_bytes, 2), (mask.tobytes(), 1)]
        payload = b""
        for block, stride in blocks:
            payload += bytes((value - (block[i - stride] if i % (size[0] * stride) >= stride else 0)) % 256
                             for i, value in enumerate(block))
    (args.output / f"{name}.bin.z").write_bytes(zlib.compress(payload, 9))
    metadata = {"width": size[0], "height": size[1], "lossless": args.lossless,
                "encoding": "rgba" if args.lossless else "rgb565-delta",
                "baseline": stats["cards"][name]["current_bands3_default"]}
    (args.output / f"{name}.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(name, (args.output / f"{name}.bin.z").stat().st_size)
