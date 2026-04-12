#!/usr/bin/env python3
"""
Toolbox Base — Web Build Script

Assembles a tool's web UI from the shared template + tool-specific files,
then optionally generates gzip C headers for embedding on ESP32.

Usage — standalone:
    python build_web.py --tool-dir tools/userial --out dist/

Usage — from PlatformIO (via extra_scripts):
    Automatically invoked pre-build. Reads tool files from src/ next to main.cpp,
    base from TOOLBOX_BASE env var or ../../toolbox-base.

Layout expected in a tool directory:
    web/
        app.html        — tool-specific HTML: tabs, tab contents, settings body
        app.css         — tool-specific CSS (optional)
        app.js          — tool-specific JS
        config.json     — {"title": "RS-232 Serial Tool"}
"""

from pathlib import Path
import gzip
import json
import argparse
import sys
import re

# ---------------------------------------------------------------------------
# Assembly
# ---------------------------------------------------------------------------

def read_text(p: Path) -> str:
    return p.read_text(encoding="utf-8") if p.exists() else ""


def parse_tool_html(html: str):
    """Split app.html into sections delimited by <!-- TABS -->, <!-- BODY -->, <!-- SETTINGS -->."""
    sections = {"tabs": "", "body": "", "settings": ""}
    current = None
    lines = html.splitlines(keepends=True)
    for line in lines:
        stripped = line.strip().upper()
        if "<!-- TABS -->" in stripped:
            current = "tabs"
            continue
        elif "<!-- BODY -->" in stripped:
            current = "body"
            continue
        elif "<!-- SETTINGS -->" in stripped:
            current = "settings"
            continue
        if current:
            sections[current] += line
    # If no markers found, treat entire content as body
    if not any(sections.values()):
        sections["body"] = html
    return sections


def assemble(base_dir: Path, tool_dir: Path) -> str:
    """Combine template + base assets + tool assets into one HTML string."""
    template = read_text(base_dir / "web" / "template.html")
    base_css = read_text(base_dir / "web" / "base.css")
    base_js = read_text(base_dir / "web" / "base.js")

    tool_web = tool_dir / "web"
    tool_css = read_text(tool_web / "app.css")
    tool_js = read_text(tool_web / "app.js")
    tool_html = read_text(tool_web / "app.html")

    config_path = tool_web / "config.json"
    config = json.loads(config_path.read_text(encoding="utf-8")) if config_path.exists() else {}
    title = config.get("title", "Tool")

    sections = parse_tool_html(tool_html)

    out = template
    out = out.replace("<!-- TOOL_TITLE -->", title)
    out = out.replace("/* {{BASE_CSS}} */", base_css)
    out = out.replace("/* {{TOOL_CSS}} */", tool_css)
    out = out.replace("// {{BASE_JS}}", base_js)
    out = out.replace("// {{TOOL_JS}}", tool_js)
    out = out.replace("<!-- {{TOOL_TABS}} -->", sections["tabs"])
    out = out.replace("<!-- {{TOOL_BODY}} -->", sections["body"])
    out = out.replace("<!-- {{SETTINGS_BODY}} -->", sections["settings"])

    return out


# ---------------------------------------------------------------------------
# Gzip C header generation (for ESP32 firmware embedding)
# ---------------------------------------------------------------------------

def bytes_to_c_array(data: bytes, per_line: int = 12) -> str:
    lines = []
    for i in range(0, len(data), per_line):
        chunk = data[i:i + per_line]
        lines.append("  " + ", ".join(f"0x{b:02x}" for b in chunk) + ",")
    if lines:
        lines[-1] = lines[-1].rstrip(",")
    return "\n".join(lines)


def generate_gz_header(html: str, out_path: Path, array_name: str = "INDEX_HTML_GZ"):
    compressed = gzip.compress(html.encode("utf-8"), compresslevel=9, mtime=0)
    guard = re.sub(r'[^A-Z0-9_]', '_', out_path.name.upper())

    content = (
        f"#ifndef {guard}\n"
        f"#define {guard}\n\n"
        f"#include <pgmspace.h>\n\n"
        f"const uint8_t {array_name}[] PROGMEM = {{\n"
        f"{bytes_to_c_array(compressed)}\n"
        f"}};\n"
        f"const size_t {array_name}_LEN = {len(compressed)};\n\n"
        f"#endif\n"
    )

    existing = out_path.read_text(encoding="utf-8") if out_path.exists() else ""
    if existing != content:
        out_path.write_text(content, encoding="utf-8")
        print(f"[build_web] Generated {out_path.name} ({len(compressed)} bytes gzip, {len(html)} raw)")
    else:
        print(f"[build_web] Up-to-date: {out_path.name}")


# ---------------------------------------------------------------------------
# PlatformIO hook
# ---------------------------------------------------------------------------

def pio_hook():
    """Called by PlatformIO as a pre-build script."""
    try:
        # Import is only available inside PlatformIO
        Import = globals().get("Import")
        if Import is None:
            return
        Import("env")
        env = globals()["env"]
    except Exception:
        return

    project_dir = Path(env.subst("$PROJECT_DIR"))
    src_dir = project_dir / "src"

    # Find toolbox base: check env var, then walk up looking for web/base.css
    base_dir = None
    env_base = env.subst("$TOOLBOX_BASE")
    if env_base and not env_base.startswith("$") and Path(env_base).is_dir():
        base_dir = Path(env_base)
    else:
        candidate = project_dir
        for _ in range(5):
            candidate = candidate.parent
            if (candidate / "web" / "base.css").is_file():
                base_dir = candidate.resolve()
                break

    if not base_dir:
        print("[build_web] WARNING: toolbox base not found, skipping web build")
        return

    html = assemble(base_dir, project_dir)

    # Write assembled HTML to src/ for reference and generate gzip header
    (src_dir / "_assembled.html").write_text(html, encoding="utf-8")
    generate_gz_header(html, src_dir / "web_ui_gz.h", "INDEX_HTML_GZ")


# ---------------------------------------------------------------------------
# Standalone CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Toolbox Base web assembler")
    parser.add_argument("--base-dir", type=Path, default=Path(__file__).resolve().parent.parent,
                        help="Path to toolbox-base root (default: parent of build/)")
    parser.add_argument("--tool-dir", type=Path, required=True,
                        help="Path to the tool project (containing web/ folder)")
    parser.add_argument("--out", type=Path, default=None,
                        help="Output directory for assembled HTML (default: tool-dir/dist/)")
    parser.add_argument("--gz-header", action="store_true",
                        help="Also generate gzip C header in tool-dir/src/")
    args = parser.parse_args()

    base_dir = args.base_dir.resolve()
    tool_dir = args.tool_dir.resolve()
    out_dir = (args.out or tool_dir / "dist").resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    html = assemble(base_dir, tool_dir)
    out_file = out_dir / "index.html"
    out_file.write_text(html, encoding="utf-8")
    print(f"[build_web] Assembled → {out_file}  ({len(html)} bytes)")

    if args.gz_header:
        src_dir = tool_dir / "src"
        src_dir.mkdir(exist_ok=True)
        generate_gz_header(html, src_dir / "web_ui_gz.h")

    return 0


if __name__ == "__main__":
    sys.exit(main())

# PlatformIO auto-detect: if 'Import' is available, run as PIO hook
try:
    Import
    pio_hook()
except NameError:
    pass
