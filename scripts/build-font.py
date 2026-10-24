"""Build the two woff2 assets used by the homepage.

Source: 文风字体 (Windfonts) — a mainland-China font CDN that ships each family
as pre-split, `unicode-range`-addressed woff2 shards. We pull the shards we
need from `cn.windfonts.com` and repack the glyphs the page prints into two
small files. That keeps both the build and the runtime inside China: no
fonts.googleapis.com, no raw.githubusercontent.com.

Families:
    display  Alibaba PuHuiTi  Heavy   headline glyphs only
    mono     Martian Mono     Medium  printable ASCII

Refresh when the headline changes:

    npm run fonts

Outputs:
    assets/display.woff2
    assets/mono.woff2
"""

from __future__ import annotations

import re
import sys
import urllib.request
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.misc.psCharStrings import T2CharString
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
CACHE = ROOT / ".cache" / "windfonts"
COPY = ROOT / "src" / "home-copy.js"

CDN = "https://cn.windfonts.com/fonts-packages"

FACES = {
    "display": {
        "package": "Albbpht/Heavy/full",
        "out": "display.woff2",
        "ps_name": "HeadlineSerif-Bold",
        "family": "Headline Serif",
        "weight": 700,
        "kind": "headline",
    },
    "mono": {
        "package": "Albbpht/Heavy/full",
        "out": "mono.woff2",
        "ps_name": "TextMono-Medium",
        "family": "Text Mono",
        "weight": 500,
        "kind": "ascii",
    },
}

ASCII = [chr(c) for c in range(0x20, 0x7F)]


def headline() -> str:
    text = COPY.read_text(encoding="utf-8")
    block = re.search(r"DISPLAY_TEXTS = \[(.*?)\];", text, re.S)
    if not block:
        raise SystemExit("DISPLAY_TEXTS not found in src/home-copy.js")
    return "".join(re.findall(r"'([^']*)'", block.group(1)))


def http_get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "gh-relay-build/1.0"})
    with urllib.request.urlopen(req, timeout=60) as res:
        return res.read()


def shards(package: str) -> list[Path]:
    """Download every shard of a Windfonts package (result.css + N.woff2)."""
    CACHE.mkdir(parents=True, exist_ok=True)
    slug = package.replace("/", "_")
    css_path = CACHE / f"{slug}.css"
    if not css_path.exists():
        print(f"  css {CDN}/{package}/result.css")
        css_path.write_bytes(http_get(f"{CDN}/{package}/result.css"))
    css = css_path.read_text(encoding="utf-8", errors="replace")
    names = sorted(set(re.findall(r'url\("\./(\w+)\.woff2"\)', css)))
    out = []
    for name in names:
        dest = CACHE / f"{slug}-{name}.woff2"
        if not dest.exists() or dest.stat().st_size == 0:
            try:
                dest.write_bytes(http_get(f"{CDN}/{package}/{name}.woff2"))
            except Exception as exc:  # noqa: BLE001
                print(f"  shard {name} unavailable: {exc}")
                continue
        # Some shards are byte-identical placeholders for rare ranges.
        try:
            TTFont(dest)
        except Exception:  # noqa: BLE001
            continue
        out.append(dest)
    print(f"  {len(out)} usable shards for {package}")
    return out


def collect(package: str, chars: list[str]) -> dict[str, tuple[TTFont, str]]:
    wanted: dict[str, tuple[TTFont, str]] = {}
    for path in shards(package):
        font = TTFont(path)
        cmap = font.getBestCmap()
        for ch in chars:
            if ch in wanted:
                continue
            glyph = cmap.get(ord(ch))
            if glyph:
                wanted[ch] = (font, glyph)
        if len(wanted) == len(set(chars)):
            break
    missing = [c for c in chars if c not in wanted]
    if missing:
        print(f"  missing glyphs: {''.join(missing)!r}")
    return wanted


def build(name: str, cfg: dict, chars: list[str]) -> None:
    wanted = collect(cfg["package"], chars)
    if not wanted:
        raise SystemExit(f"{name}: no glyphs resolved")

    sample = next(iter(wanted.values()))[0]
    upm = sample["head"].unitsPerEm
    asc, desc = sample["hhea"].ascent, sample["hhea"].descent

    charstrings: dict[str, T2CharString] = {}
    metrics: dict[str, tuple[int, int]] = {}
    cmap: dict[int, str] = {}
    for ch, (font, glyph) in wanted.items():
        glyphset = font.getGlyphSet()
        pen = T2CharStringPen(font["hmtx"][glyph][0], glyphset)
        glyphset[glyph].draw(pen)
        key = "space" if ch == " " else f"uni{ord(ch):04X}"
        charstrings[key] = pen.getCharString()
        metrics[key] = font["hmtx"][glyph]
        cmap[ord(ch)] = key

    order = [".notdef", *charstrings]
    metrics[".notdef"] = (0, 0)
    charstrings[".notdef"] = T2CharString(program=["endchar"])

    builder = FontBuilder(upm, isTTF=False)
    builder.setupGlyphOrder(order)
    builder.setupCharacterMap(cmap)
    builder.setupCFF(
        psName=cfg["ps_name"],
        fontInfo={
            "FullName": cfg["family"],
            "FamilyName": cfg["family"],
            "Weight": str(cfg["weight"]),
            "FontBBox": [0, desc, upm, asc],
        },
        charStringsDict={k: charstrings[k] for k in order},
        privateDict={},
    )
    builder.setupHorizontalMetrics({g: metrics[g] for g in order})
    builder.setupHorizontalHeader(ascent=asc, descent=desc)
    builder.setupNameTable({"familyName": cfg["family"], "styleName": str(cfg["weight"])})
    builder.setupOS2(
        sTypoAscender=asc,
        sTypoDescender=desc,
        usWinAscent=asc,
        usWinDescent=-desc,
        usWeightClass=cfg["weight"],
    )
    builder.setupPost()
    builder.font.flavor = "woff2"

    out = ASSETS / cfg["out"]
    builder.save(out)
    verify = TTFont(out)
    verify.flavor = None
    print(
        f"{name}: {len(cmap)} glyphs, cmap {len(verify.getBestCmap())}, "
        f"{out.stat().st_size / 1024:.1f} KB"
    )


def main() -> int:
    ASSETS.mkdir(exist_ok=True)
    head = list(dict.fromkeys(headline()))
    print(f"headline: {len(head)} unique characters")
    build("display", FACES["display"], head)
    build("mono", FACES["mono"], ASCII)

    total = sum(p.stat().st_size for p in ASSETS.glob("*.woff2"))
    print(f"fonts total {total / 1024:.1f} KB")
    if total > 25 * 1024:
        raise SystemExit("font budget exceeded: 25 KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
