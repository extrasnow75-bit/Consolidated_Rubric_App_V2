#!/usr/bin/env python3
"""
Markdown -> HTML tuned for Google Docs' HTML importer.

Docs' importer is not a browser. Three things it does that a browser does not,
all learned the hard way in the sibling app:

  1. It sizes table columns from the FIRST ROW and does not expand rowspan or
     colspan when it does. A flat header row plus an explicit <colgroup> is the
     only reliable way to get sensible widths.
  2. It turns a paragraph border into a separate grey rule rather than ignoring
     it, so no border CSS goes on anything but table cells.
  3. It ignores stylesheets. Everything has to be an inline style attribute.
"""
import html, re, sys

BODY  = "font-family:Arial,sans-serif;font-size:11pt;color:#000000;line-height:1.45;"
CELL  = "border:1px solid #999999;padding:6px 8px;vertical-align:top;font-family:Arial,sans-serif;font-size:10pt;"
HEAD  = CELL + "background-color:#f1f3f4;font-weight:bold;"
CODE  = "font-family:'Courier New',monospace;font-size:10pt;background-color:#f1f3f4;"
PRE   = ("font-family:'Courier New',monospace;font-size:10pt;background-color:#f1f3f4;"
         "padding:10px;white-space:pre-wrap;")
# A blockquote becomes a one-cell table rather than a bordered paragraph: see (2) in the
# module docstring. A table cell border survives the import; a paragraph border becomes a
# stray grey rule above and below the text.
QUOTE = ("border:1px solid #b7b7b7;background-color:#f8f9fa;padding:10px 12px;"
         "font-family:Arial,sans-serif;font-size:10.5pt;")

# One width set per column count. Docs honours these; without them the last
# columns can collapse to about one character wide.
WIDTHS = {2: ["38%", "62%"], 3: ["24%", "20%", "56%"]}


def inline(t: str) -> str:
    """Inline markdown -> HTML. Code spans are extracted first so their
    contents are never re-scanned for emphasis or links."""
    spans: list[str] = []

    def stash(m):
        spans.append(f'<span style="{CODE}">{html.escape(m.group(1))}</span>')
        return f"\x00{len(spans) - 1}\x00"

    t = re.sub(r"`([^`]+)`", stash, t)
    t = html.escape(t)
    t = re.sub(r"\[([^\]]+)\]\(([^)]+)\)",
               lambda m: f'<a href="{m.group(2)}">{m.group(1)}</a>', t)
    t = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(r"(?<![\*\w])\*([^*\n]+?)\*(?!\*)", r"<em>\1</em>", t)
    # Backslash escapes: the source uses Confluence/Docs conventions such as `\+`, `1\.`
    # and `App\_V2`. They exist to stop *another* renderer reinterpreting the character, so
    # the backslash itself must never reach the page.
    t = re.sub(r"\\([\\`*_{}\[\]()#+.!|&-])", r"\1", t)
    return re.sub(r"\x00(\d+)\x00", lambda m: spans[int(m.group(1))], t)


def table(rows: list[str]) -> str:
    cells = [[c.strip() for c in r.strip().strip("|").split("|")] for r in rows]
    header, body = cells[0], cells[2:]          # cells[1] is the |:---| rule
    n = len(header)
    widths = WIDTHS.get(n, [f"{100 // n}%"] * n)
    out = ['<table style="border-collapse:collapse;width:100%;margin:0 0 12pt 0;">',
           "<colgroup>"]
    out += [f'<col style="width:{w};" />' for w in widths]
    out.append("</colgroup>")
    out.append("<tr>" + "".join(
        f'<td style="{HEAD}"><p style="margin:0;">{inline(c)}</p></td>' for c in header) + "</tr>")
    for row in body:
        row = (row + [""] * n)[:n]
        out.append("<tr>" + "".join(
            f'<td style="{CELL}"><p style="margin:0;">{inline(c)}</p></td>' for c in row) + "</tr>")
    out.append("</table>")
    return "\n".join(out)


def convert(md: str) -> str:
    lines, out, i = md.split("\n"), [], 0
    # Open list stack: each entry is 'ul' or 'ol', outermost first.
    stack: list[str] = []

    def close_to(depth: int):
        while len(stack) > depth:
            out.append(f"</{stack.pop()}>")

    while i < len(lines):
        ln = lines[i]

        if ln.startswith("```"):
            i += 1
            buf = []
            while i < len(lines) and not lines[i].startswith("```"):
                buf.append(lines[i]); i += 1
            i += 1
            close_to(0)
            out.append(f'<p style="{PRE}">{html.escape(chr(10).join(buf))}</p>')
            continue

        if re.match(r"^\|.*\|\s*$", ln) and i + 1 < len(lines) and re.match(r"^\|[\s:|-]+\|\s*$", lines[i + 1]):
            buf = []
            while i < len(lines) and ln.strip().startswith("|"):
                buf.append(lines[i]); i += 1
                ln = lines[i] if i < len(lines) else ""
            close_to(0)
            out.append(table(buf))
            continue

        if not ln.strip():
            close_to(0); i += 1; continue

        if ln.strip() == "---":
            close_to(0)
            out.append('<hr style="border:none;border-top:1px solid #cccccc;margin:18pt 0;" />')
            i += 1; continue

        m = re.match(r"^(#{1,4})\s+(.*)$", ln)
        if m:
            close_to(0)
            lvl, txt = len(m.group(1)), m.group(2).strip()
            txt = re.sub(r"^\*\*(.*)\*\*$", r"\1", txt)      # `# **Title**` is just a heading
            size = {1: "18pt", 2: "14pt", 3: "12pt", 4: "11pt"}[lvl]
            top = {1: "20pt", 2: "16pt", 3: "13pt", 4: "12pt"}[lvl]
            out.append(f'<h{lvl} style="font-family:Arial,sans-serif;font-size:{size};'
                       f'font-weight:bold;color:#000000;margin:{top} 0 8pt 0;">{inline(txt)}</h{lvl}>')
            i += 1; continue

        if ln.startswith(">"):
            buf = []
            while i < len(lines) and lines[i].startswith(">"):
                buf.append(lines[i][1:].strip()); i += 1
            close_to(0)
            out.append('<table style="border-collapse:collapse;width:100%;margin:0 0 12pt 0;">'
                       '<colgroup><col style="width:100%;" /></colgroup>'
                       f'<tr><td style="{QUOTE}"><p style="margin:0;">'
                       f'{inline(" ".join(buf))}</p></td></tr></table>')
            continue

        m = re.match(r"^(\s*)([*-]|\d+\.)\s+(.*)$", ln)
        if m:
            indent, marker, txt = m.group(1), m.group(2), m.group(3)
            depth = len(indent) // 2 + 1
            kind = "ul" if marker in "*-" else "ol"
            while len(stack) > depth:
                out.append(f"</{stack.pop()}>")
            if len(stack) == depth and stack[-1] != kind:
                out.append(f"</{stack.pop()}>")
            while len(stack) < depth:
                out.append(f'<{kind} style="{BODY}margin:0 0 10pt 0;padding-left:28px;">')
                stack.append(kind)
            out.append(f'<li style="margin:0 0 5pt 0;">{inline(txt)}</li>')
            i += 1; continue

        # Ordinary paragraph: fold following non-blank, non-special lines in.
        buf = [ln]
        i += 1
        while (i < len(lines) and lines[i].strip()
               and not re.match(r"^(#{1,4}\s|\s*[*-]\s|\s*\d+\.\s|\||>|```|---$)", lines[i])):
            buf.append(lines[i]); i += 1
        close_to(0)
        out.append(f'<p style="{BODY}margin:0 0 11pt 0;">{inline(" ".join(buf))}</p>')

    close_to(0)
    return "\n".join(out)


src, dst, title = sys.argv[1], sys.argv[2], sys.argv[3]
body = convert(open(src, encoding="utf-8").read())
open(dst, "w", encoding="utf-8").write(
    "<!DOCTYPE html>\n<html><head><meta charset=\"utf-8\" />\n"
    f"<title>{html.escape(title)}</title></head>\n"
    f'<body style="{BODY}">\n{body}\n</body></html>\n')
print(f"wrote {dst}")
