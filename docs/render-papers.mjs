// Render the CAIRN white papers from Markdown to print-styled HTML (then Chrome
// prints them to PDF). Zero dependencies — a focused Markdown converter covering
// exactly what these documents use: headings, bold/italic/code, tables, lists,
// fenced code (the architecture diagrams), rules, and paragraphs.
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCS = [
  { md: "CAIRN-ONE-PAGER-2026-07-22.md", title: "CAIRN — One Page" },
  { md: "CAIRN-BRIEF-2026-07-22.md", title: "CAIRN — Brief" },
  { md: "CAIRN-WHITE-PAPER-2026-07-22.md", title: "CAIRN — White Paper" },
];

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}
const cells = (row) => row.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

function mdToHtml(md) {
  const lines = md.split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    let line = lines[i];

    // fenced code (architecture diagrams) — preserve verbatim
    if (/^```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(esc(lines[i])); i++; }
      i++; // closing fence
      out.push(`<pre class="diagram">${buf.join("\n")}</pre>`);
      continue;
    }
    // table: header row followed by a |---| separator
    if (/^\|.*\|$/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|.*\|$/.test(lines[i])) { rows.push(cells(lines[i])); i++; }
      out.push(
        `<table><thead><tr>${head.map((h) => `<th>${inline(h)}</th>`).join("")}</tr></thead><tbody>` +
        rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("") +
        `</tbody></table>`
      );
      continue;
    }
    // headings
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    // horizontal rule
    if (/^---+\s*$/.test(line)) { out.push("<hr/>"); i++; continue; }
    // unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(`<li>${inline(lines[i].replace(/^\s*[-*]\s+/, ""))}</li>`); i++; }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    // ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(`<li>${inline(lines[i].replace(/^\s*\d+\.\s+/, ""))}</li>`); i++; }
      out.push(`<ol>${items.join("")}</ol>`);
      continue;
    }
    // blank
    if (/^\s*$/.test(line)) { i++; continue; }
    // paragraph (gather until blank / block)
    const para = [line];
    i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,6}\s|```|\||---+\s*$|\s*[-*]\s|\s*\d+\.\s)/.test(lines[i])) { para.push(lines[i]); i++; }
    out.push(`<p>${inline(para.join(" "))}</p>`);
  }
  return out.join("\n");
}

const CSS = `
  @page { size: letter; margin: 0.85in 0.8in 0.95in; }
  :root {
    --paper:#fdfbf5; --ink:#2b2415; --soft:#6b5f49; --brass:#9a742a; --brass-deep:#7c5e1c;
    --sage:#5c6a48; --line:#e0d3b4; --line2:#cbb98f;
    --serif:"Hoefler Text","Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;
    --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
    --mono:"SF Mono",ui-monospace,Menlo,Consolas,monospace;
  }
  * { box-sizing:border-box; }
  html,body { margin:0; background:var(--paper); color:var(--ink); font-family:var(--serif);
    font-size:10.6pt; line-height:1.5; -webkit-font-smoothing:antialiased; }
  .sheet { max-width:7.1in; margin:0 auto; padding:6px 0 0; }
  .brandbar { display:flex; align-items:center; gap:8px; border-bottom:1.5px solid var(--brass);
    padding-bottom:6px; margin-bottom:16px; }
  .brandbar .mark { width:16px; height:16px; }
  .brandbar .name { font-family:var(--sans); font-weight:700; letter-spacing:.18em; font-size:9pt; color:var(--brass-deep); text-transform:uppercase; }
  .brandbar .lab { font-family:var(--sans); font-size:8pt; letter-spacing:.12em; color:var(--soft); margin-left:auto; text-transform:uppercase; }
  h1 { font-family:var(--serif); font-weight:600; font-size:22pt; line-height:1.12; color:#241d10; margin:2px 0 4px; letter-spacing:.01em; }
  h3:first-of-type, h1 + h3 { font-family:var(--serif); font-style:italic; font-weight:400; font-size:12.5pt; color:var(--sage); margin:0 0 10px; }
  h2 { font-family:var(--serif); font-weight:600; font-size:14.5pt; color:var(--brass-deep);
    margin:20px 0 6px; padding-top:8px; border-top:1px solid var(--line); break-after:avoid; }
  h3 { font-family:var(--serif); font-weight:600; font-size:11.6pt; color:#33291a; margin:13px 0 4px; break-after:avoid; }
  h4 { font-family:var(--sans); font-weight:700; font-size:9pt; letter-spacing:.06em; text-transform:uppercase; color:var(--soft); margin:11px 0 3px; }
  p { margin:0 0 8px; }
  strong { color:#241d10; }
  a { color:var(--brass-deep); text-decoration:none; }
  code { font-family:var(--mono); font-size:8.7pt; background:#f2ead6; border:1px solid var(--line); border-radius:2px; padding:0 3px; color:#4a3f28; }
  hr { border:0; border-top:1px solid var(--line2); margin:14px 0; }
  ul,ol { margin:2px 0 9px; padding-left:20px; }
  li { margin:2px 0; }
  table { width:100%; border-collapse:collapse; margin:8px 0 12px; font-size:9.4pt; break-inside:avoid; }
  th { font-family:var(--sans); font-weight:700; font-size:8pt; letter-spacing:.03em; text-transform:uppercase;
    text-align:left; color:#4a3f28; background:#f2ead6; border-bottom:1.5px solid var(--line2); padding:6px 8px; }
  td { padding:5px 8px; border-bottom:1px solid var(--line); vertical-align:top; font-variant-numeric:tabular-nums; }
  pre.diagram { font-family:var(--mono); font-size:7.6pt; line-height:1.35; background:#f6efdd; border:1px solid var(--line);
    border-radius:3px; padding:11px 12px; margin:10px 0; overflow:hidden; white-space:pre; break-inside:avoid; color:#463b24; }
  /* the status band: a lone paragraph that's just an inline-code run */
  p > code:only-child { display:block; }
`;

const MARK = `<svg class="mark" viewBox="0 0 32 32"><g fill="#9a742a"><ellipse cx="16" cy="24" rx="9" ry="3.4"/><ellipse cx="16" cy="17.5" rx="6.6" ry="2.9"/><ellipse cx="16" cy="12" rx="4.6" ry="2.3"/><ellipse cx="16" cy="7.4" rx="2.7" ry="1.7"/></g></svg>`;

function page(title, bodyHtml) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><title>${esc(title)}</title><style>${CSS}</style></head>
<body><div class="sheet"><div class="brandbar">${MARK}<span class="name">CAIRN</span><span class="lab">JourdanLabs · Knowledge Integrity</span></div>
${bodyHtml}</div></body></html>`;
}

for (const d of DOCS) {
  const md = readFileSync(join(HERE, d.md), "utf8");
  const html = page(d.title, mdToHtml(md));
  const outName = d.md.replace(/\.md$/, ".html");
  writeFileSync(join(HERE, outName), html);
  console.log("wrote", outName);
}
