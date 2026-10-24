import { GFM, parser as baseParser } from "@lezer/markdown";
import type { SyntaxNode } from "@lezer/common";

// Markdown preview: HTML from the Lezer tree, the same parser as the editor, with no new
// dependencies. All text is escaped; the draft's raw HTML shows as text; images are not loaded
// (no external network): their alt text takes their place.

const parser = baseParser.configure(GFM);

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Nodes that only serve the syntax: not shown. */
const MARKS = new Set([
  "HeaderMark",
  "EmphasisMark",
  "LinkMark",
  "CodeMark",
  "QuoteMark",
  "ListMark",
  "URL",
  "LinkLabel",
  "LinkTitle",
  "TableDelimiter",
  "CodeInfo",
  "StrikethroughMark",
  "TaskMarker",
]);

const SAFE_URL = /^(https?:|mailto:)/i;

interface Ctx {
  src: string;
  /** footnote id → number, in order of appearance. */
  notes: Map<string, number>;
}

function children(n: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  for (let c = n.firstChild; c; c = c.nextSibling) out.push(c);
  return out;
}

/** A node's content: the text between the children (escaped) plus the rendered children. */
function inner(n: SyntaxNode, ctx: Ctx, from = n.from, to = n.to): string {
  let out = "";
  let pos = from;
  for (const c of children(n)) {
    if (c.to <= from || c.from >= to) continue;
    out += esc(ctx.src.slice(pos, Math.max(pos, c.from)));
    out += render(c, ctx);
    pos = Math.max(pos, c.to);
  }
  return out + esc(ctx.src.slice(pos, to));
}

function render(n: SyntaxNode, ctx: Ctx): string {
  const name = n.name;
  if (MARKS.has(name)) return "";
  const text = () => ctx.src.slice(n.from, n.to);
  const heading = /^(?:ATX|Setext)Heading(\d)$/.exec(name);
  if (heading) return `<h${heading[1]}>${inner(n, ctx).trim()}</h${heading[1]}>`;
  switch (name) {
    case "Document":
      return children(n)
        .map((c) => render(c, ctx))
        .join("\n");
    case "Paragraph":
      return `<p>${inner(n, ctx).trim()}</p>`;
    case "Emphasis":
      return `<em>${inner(n, ctx)}</em>`;
    case "StrongEmphasis":
      return `<strong>${inner(n, ctx)}</strong>`;
    case "Strikethrough":
      return `<del>${inner(n, ctx)}</del>`;
    case "InlineCode": {
      const t = text().replace(/^`+|`+$/g, "");
      return `<code>${esc(t)}</code>`;
    }
    case "FencedCode":
    case "CodeBlock": {
      const code = n.getChild("CodeText");
      return `<pre><code>${esc(code ? ctx.src.slice(code.from, code.to) : "")}</code></pre>`;
    }
    case "BulletList":
      return `<ul>${children(n)
        .map((c) => render(c, ctx))
        .join("")}</ul>`;
    case "OrderedList":
      return `<ol>${children(n)
        .map((c) => render(c, ctx))
        .join("")}</ol>`;
    case "ListItem":
      return `<li>${children(n)
        .filter((c) => c.name !== "ListMark")
        .map((c) => (c.name === "Paragraph" ? inner(c, ctx).trim() : render(c, ctx)))
        .join(" ")}</li>`;
    case "Blockquote":
      return `<blockquote>${children(n)
        .map((c) => render(c, ctx))
        .join("")}</blockquote>`;
    case "HorizontalRule":
      return "<hr>";
    case "HardBreak":
      return "<br>";
    case "Escape":
      return esc(text().slice(1));
    case "Entity":
      return /^&(#\d+|#x[\da-f]+|\w+);$/i.test(text()) ? text() : esc(text());
    case "Link": {
      const t = text();
      const note = /^\[\^([^\]\s]+)\]$/.exec(t);
      if (note) {
        const id = note[1]!;
        if (!ctx.notes.has(id)) ctx.notes.set(id, ctx.notes.size + 1);
        const k = ctx.notes.get(id)!;
        return `<sup class="fn-ref"><a href="#fn-${esc(id)}">${k}</a></sup>`;
      }
      const open = n.getChild("LinkMark");
      const close = children(n).filter((c) => c.name === "LinkMark")[1];
      const label = open && close ? inner(n, ctx, open.to, close.from) : esc(t);
      const url = n.getChild("URL");
      const href = url ? ctx.src.slice(url.from, url.to) : "";
      return SAFE_URL.test(href)
        ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`
        : `<span class="link">${label}</span>`;
    }
    case "Autolink": {
      const url = n.getChild("URL");
      const href = url ? ctx.src.slice(url.from, url.to) : "";
      return SAFE_URL.test(href)
        ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(href)}</a>`
        : esc(href);
    }
    case "Image": {
      const open = n.getChild("LinkMark");
      const close = children(n).filter((c) => c.name === "LinkMark")[1];
      const alt = open && close ? ctx.src.slice(open.to, close.from) : "";
      return `<span class="image-alt">[immagine${alt ? `: ${esc(alt)}` : ""}]</span>`;
    }
    case "Table": {
      const rows = children(n).filter((c) => c.name === "TableHeader" || c.name === "TableRow");
      const cells = (r: SyntaxNode, tag: string) =>
        children(r)
          .filter((c) => c.name === "TableCell")
          .map((c) => `<${tag}>${inner(c, ctx).trim()}</${tag}>`)
          .join("");
      const [head, ...body] = rows;
      return `<table>${head ? `<thead><tr>${cells(head, "th")}</tr></thead>` : ""}<tbody>${body
        .map((r) => `<tr>${cells(r, "td")}</tr>`)
        .join("")}</tbody></table>`;
    }
    case "LinkReference":
      return ""; // definitions (footnotes' too): collected separately
    case "HTMLBlock":
    case "CommentBlock":
    case "ProcessingInstructionBlock":
      return `<p class="raw">${esc(text())}</p>`;
    case "HTMLTag":
    case "Comment":
      return esc(text());
    default:
      return n.firstChild ? inner(n, ctx) : esc(text());
  }
}

/** The draft's body (without front matter) as safe HTML, with the footnotes at the end. */
export function renderMarkdown(body: string): string {
  // Section markers are comments for the app, not text for the reader.
  const src = body.replace(/<!--[\s\S]*?-->[ \t]*/g, "");
  const defs = new Map<string, string>();
  for (const m of src.matchAll(/^\[\^([^\]\s]+)\]:[ \t]*(.*)$/gm)) defs.set(m[1]!, m[2]!.trim());
  const ctx: Ctx = { src, notes: new Map() };
  let html = render(parser.parse(src).topNode, ctx);
  if (ctx.notes.size) {
    const items = [...ctx.notes]
      .map(([id]) => `<li id="fn-${esc(id)}">${esc(defs.get(id) ?? "")}</li>`)
      .join("");
    html += `\n<section class="footnotes" aria-label="Note"><ol>${items}</ol></section>`;
  }
  return html;
}
