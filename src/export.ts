/**
 * Standalone HTML export of a plan (v0.3, narumiruna's plan-export). Plans
 * get shared with people who do not have the repository — a self-contained
 * file with no assets and no network is what actually travels.
 *
 * The renderer is a small markdown subset on purpose: plans are headings,
 * lists, code, and emphasis. Everything is escaped first, so a plan
 * containing HTML (or a prompt-injection attempt aimed at the reader) is
 * shown as text rather than executed.
 */

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Inline spans, applied to already-escaped text. */
function renderInline(escaped: string): string {
  return escaped
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
}

const STYLE = [
  ":root{color-scheme:light dark}",
  "body{max-width:46rem;margin:2.5rem auto;padding:0 1.25rem;",
  "font:16px/1.65 ui-sans-serif,-apple-system,Segoe UI,Roboto,sans-serif}",
  "h1,h2,h3,h4{line-height:1.25;margin:1.8em 0 .6em}",
  "h1{font-size:1.7rem}h2{font-size:1.3rem}h3{font-size:1.1rem}",
  "code{background:rgba(127,127,127,.16);padding:.12em .35em;border-radius:4px;font-size:.9em}",
  "pre{background:rgba(127,127,127,.12);padding:.9rem 1rem;border-radius:8px;overflow:auto}",
  "pre code{background:none;padding:0}",
  "li{margin:.3em 0}",
  "footer{margin-top:3rem;font-size:.85rem;opacity:.65;border-top:1px solid rgba(127,127,127,.3);padding-top:.8rem}",
  ".done{opacity:.55;text-decoration:line-through}",
].join("");

interface ListState {
  open: "ul" | "ol" | null;
}

function closeList(state: ListState, out: string[]): void {
  if (state.open) {
    out.push(`</${state.open}>`);
    state.open = null;
  }
}

function openList(state: ListState, kind: "ul" | "ol", out: string[]): void {
  if (state.open !== kind) {
    closeList(state, out);
    out.push(`<${kind}>`);
    state.open = kind;
  }
}

/** Render the markdown subset plans are written in. */
export function renderMarkdown(markdown: string): string {
  const out: string[] = [];
  const state: ListState = { open: null };
  let inCode = false;

  for (const rawLine of (markdown ?? "").split("\n")) {
    const line = rawLine.replace(/\r$/, "");

    if (/^\s*```/.test(line)) {
      closeList(state, out);
      out.push(inCode ? "</code></pre>" : "<pre><code>");
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push(escapeHtml(line));
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      closeList(state, out);
      const level = Math.min(heading[1]!.length, 6);
      out.push(`<h${level}>${renderInline(escapeHtml(heading[2]!))}</h${level}>`);
      continue;
    }

    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (ordered || bullet) {
      openList(state, ordered ? "ol" : "ul", out);
      const body = (ordered ?? bullet)![1]!;
      const checked = /^\[[xX]\]\s*/.test(body);
      const text = renderInline(escapeHtml(body.replace(/^\[[ xX]\]\s*/, "")));
      out.push(checked ? `<li class="done">${text}</li>` : `<li>${text}</li>`);
      continue;
    }

    if (!line.trim()) {
      closeList(state, out);
      continue;
    }
    closeList(state, out);
    out.push(`<p>${renderInline(escapeHtml(line))}</p>`);
  }

  if (inCode) out.push("</code></pre>");
  closeList(state, out);
  return out.join("\n");
}

export interface ExportOptions {
  title: string;
  /** Rendered into the footer; passed in so the module stays pure. */
  generatedAt: string;
  sourceFile?: string;
  progress?: string;
}

export function renderPlanHtml(markdown: string, options: ExportOptions): string {
  const title = escapeHtml(options.title);
  const footer = [
    options.sourceFile ? escapeHtml(options.sourceFile) : "",
    options.progress ? escapeHtml(options.progress) : "",
    `exported ${escapeHtml(options.generatedAt)} by @pify/plan-mode`,
  ]
    .filter(Boolean)
    .join(" · ");

  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${title}</title>`,
    `<style>${STYLE}</style>`,
    "</head>",
    "<body>",
    renderMarkdown(markdown),
    `<footer>${footer}</footer>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

/** Sibling .html path for a plan file. */
export function htmlPathFor(planFile: string): string {
  return planFile.replace(/\.md$/i, "") + ".html";
}
