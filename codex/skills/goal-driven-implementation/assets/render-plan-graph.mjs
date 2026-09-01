#!/usr/bin/env node
// Render a goal-driven plan's Mermaid blocks, lifecycle gate budget, graph findings,
// and progress ledger.
//
// Usage:
//   node render-plan-graph.mjs <plan.md> [--out <file.html>] [--no-open]

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
let planArg;
let outArg;
let noOpen = false;

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === '--no-open') {
    noOpen = true;
  } else if (arg === '--out') {
    outArg = args[index + 1];
    if (!outArg) {
      console.error('--out requires a file path.');
      process.exit(1);
    }
    index += 1;
  } else if (arg.startsWith('--')) {
    console.error(`Unknown option: ${arg}`);
    process.exit(1);
  } else if (planArg) {
    console.error('Provide exactly one plan Markdown file.');
    process.exit(1);
  } else {
    planArg = arg;
  }
}

if (!planArg) {
  console.error('Usage: node render-plan-graph.mjs <plan.md> [--out <file.html>] [--no-open]');
  process.exit(1);
}

const planPath = resolve(planArg);
const markdown = readFileSync(planPath, 'utf8');
const lines = markdown.split(/\r?\n/);
const title =
  lines.find((line) => /^#\s+/.test(line))?.replace(/^#\s+/, '') ?? basename(planPath);

// Collect Mermaid blocks and label each with its nearest preceding heading.
const graphs = [];
let heading = '';
let inMermaid = false;
let graphLines = [];

for (const line of lines) {
  if (!inMermaid && /^#{2,4}\s+/.test(line)) {
    heading = line.replace(/^#{2,4}\s+/, '');
  }
  if (!inMermaid && /^```mermaid\s*$/.test(line)) {
    inMermaid = true;
    graphLines = [];
    continue;
  }
  if (inMermaid && /^```\s*$/.test(line)) {
    inMermaid = false;
    graphs.push({ heading, source: graphLines.join('\n') });
    continue;
  }
  if (inMermaid) {
    graphLines.push(line);
  }
}

if (graphs.length === 0) {
  console.error(`No Mermaid blocks found in ${planPath}.`);
  process.exit(2);
}

function extractSection(headingPattern) {
  const start = lines.findIndex((line) => headingPattern.test(line));
  if (start === -1) {
    return undefined;
  }
  const body = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^#{1,4}\s+/.test(lines[index])) {
      break;
    }
    body.push(lines[index]);
  }
  return {
    heading: lines[start].replace(/^#{1,4}\s+/, ''),
    body,
  };
}

const lifecycleBudget = extractSection(
  /^#{2,4}\s+Expensive or mutating lifecycle gate budget/i,
);
const findings = extractSection(/^#{2,4}\s+Graph Findings/i);

// Restrict checkbox parsing to the Progress Ledger section so goal checkboxes do not
// inflate progress. Support both CommonMark task-list bullets and legacy bare checkboxes.
const ledger = [];
const ledgerStart = lines.findIndex((line) => /^#{1,4}\s+(?:\d+\.\s+)?Progress ledger/i.test(line));
if (ledgerStart !== -1) {
  for (let index = ledgerStart + 1; index < lines.length; index += 1) {
    if (/^##\s+Completion\b/i.test(lines[index])) {
      break;
    }
    const match = lines[index].match(/^\s*(?:-\s+)?\[( |x|X)\]\s+(.+)$/);
    if (match) {
      ledger.push({ done: match[1] !== ' ', text: match[2] });
    }
  }
}

const escapeHtml = (value) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const renderInline = (value) => {
  const codeSpans = [];
  let rendered = escapeHtml(value).replace(/`([^`]+)`/g, (_match, code) => {
    codeSpans.push(code);
    return `\uE000${codeSpans.length - 1}\uE001`;
  });
  rendered = rendered
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_([^_\s][^_]*)_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
  return rendered.replace(/\uE000(\d+)\uE001/g, (_match, index) => {
    return `<code>${codeSpans[Number(index)]}</code>`;
  });
};

function renderFindings(body) {
  const output = [];
  let paragraph = [];
  let items = [];
  let currentItem;

  const endParagraph = () => {
    if (paragraph.length > 0) {
      output.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
      paragraph = [];
    }
  };
  const endItem = () => {
    if (currentItem !== undefined) {
      items.push(`<li>${currentItem}</li>`);
      currentItem = undefined;
    }
  };
  const endList = () => {
    endItem();
    if (items.length > 0) {
      output.push(`<ul>${items.join('\n')}</ul>`);
      items = [];
    }
  };

  for (const rawLine of body) {
    const line = rawLine.trim();
    if (!line) {
      endParagraph();
      endItem();
    } else if (line.startsWith('- ')) {
      endParagraph();
      endItem();
      currentItem = renderInline(line.slice(2));
    } else if (currentItem !== undefined) {
      currentItem += ` ${renderInline(line)}`;
    } else {
      endList();
      paragraph.push(line);
    }
  }
  endParagraph();
  endList();
  return output.join('\n');
}

function renderLifecycleBudget(body) {
  const tableStart = body.findIndex((line) => /^\s*\|.+\|\s*$/.test(line));
  if (tableStart === -1) {
    return renderFindings(body);
  }

  let tableEnd = tableStart;
  while (tableEnd < body.length && /^\s*\|.+\|\s*$/.test(body[tableEnd])) {
    tableEnd += 1;
  }

  const rows = body.slice(tableStart, tableEnd).map((line) =>
    line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => cell.trim()),
  );
  const hasSeparator =
    rows.length > 1 && rows[1].every((cell) => /^:?-{3,}:?$/.test(cell));
  const header = rows[0] ?? [];
  const dataRows = hasSeparator ? rows.slice(2) : rows.slice(1);
  const table = `<table>
    <thead><tr>${header.map((cell) => `<th>${renderInline(cell)}</th>`).join('')}</tr></thead>
    <tbody>${dataRows
      .map(
        (row) =>
          `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join('')}</tr>`,
      )
      .join('')}</tbody>
  </table>`;

  return [
    renderFindings(body.slice(0, tableStart)),
    table,
    renderFindings(body.slice(tableEnd)),
  ]
    .filter(Boolean)
    .join('\n');
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:,">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font: 15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif;
         background: #f6f7f9; color: #1a1d21; }
  @media (prefers-color-scheme: dark) {
    body { background: #101214; color: #e6e8ea; }
  }
  main { max-width: 1100px; margin: 0 auto; padding: 2rem 1.5rem 4rem; }
  h1 { font-size: 1.35rem; margin: 0 0 .25rem; }
  h2 { font-size: 1.02rem; opacity: .85; border-bottom: 1px solid rgba(128,128,128,.25);
       padding-bottom: .35rem; }
  section { margin-bottom: 2.5rem; }
  .meta { opacity: .6; font-size: .85rem; margin-bottom: 2rem; }
  .graph { background: rgba(128,128,128,.06); border: 1px solid rgba(128,128,128,.18);
           border-radius: 10px; padding: 1rem; overflow-x: auto; }
  pre.mermaid { margin: 0; text-align: center; }
  #offline { display: none; background: #8a2d2d; color: #fff; padding: .6rem 1rem;
             border-radius: 8px; margin-bottom: 1.5rem; }
  code { background: rgba(128,128,128,.15); padding: .05em .35em; border-radius: 4px;
         font-size: .88em; }
  .findings { background: rgba(128,128,128,.06); border: 1px solid rgba(128,128,128,.18);
              border-left: 3px solid #b58a2d; border-radius: 10px; padding: .35rem 1.15rem; }
  .findings li { margin: .55rem 0; }
  .budget { background: rgba(128,128,128,.06); border: 1px solid rgba(128,128,128,.18);
            border-left: 3px solid #3b6fa0; border-radius: 10px; padding: .8rem 1.15rem; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border-bottom: 1px solid rgba(128,128,128,.25); padding: .45rem .55rem;
           text-align: left; vertical-align: top; }
  th { font-size: .82rem; opacity: .75; }
  ul.ledger { list-style: none; padding: 0; }
  ul.ledger li { padding: .2rem 0; }
  .pill { display: inline-block; min-width: 4.2em; text-align: center; font-size: .72rem;
          border-radius: 999px; padding: .08rem .55rem; margin-right: .6rem;
          font-weight: 600; letter-spacing: .02em; }
  .done { background: #1f6f3f; color: #fff; }
  .todo { background: rgba(128,128,128,.25); }
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">${escapeHtml(basename(planPath))} · rendered by goal-driven-implementation</div>
  <div id="offline">Mermaid could not load. The raw graph source remains visible below.</div>
  ${graphs
    .map(
      (graph) => `<section>
    <h2>${escapeHtml(graph.heading || 'Graph')}</h2>
    <div class="graph"><pre class="mermaid">${escapeHtml(graph.source)}</pre></div>
  </section>`,
    )
    .join('\n')}
  ${
    lifecycleBudget
      ? `<section>
    <h2>${escapeHtml(lifecycleBudget.heading)}</h2>
    <div class="budget">${renderLifecycleBudget(lifecycleBudget.body)}</div>
  </section>`
      : ''
  }
  ${
    findings
      ? `<section>
    <h2>${escapeHtml(findings.heading)}</h2>
    <div class="findings">${renderFindings(findings.body)}</div>
  </section>`
      : ''
  }
  ${
    ledger.length > 0
      ? `<section>
    <h2>Progress ledger — ${ledger.filter((item) => item.done).length}/${ledger.length} done</h2>
    <ul class="ledger">
      ${ledger
        .map(
          (item) =>
            `<li><span class="pill ${item.done ? 'done' : 'todo'}">${item.done ? 'DONE' : 'TODO'}</span>${escapeHtml(item.text)}</li>`,
        )
        .join('\n      ')}
    </ul>
  </section>`
      : ''
  }
</main>
<script type="module">
  try {
    const { default: mermaid } = await import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs');
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'neutral' });
    await mermaid.run({ querySelector: 'pre.mermaid' });
  } catch {
    document.getElementById('offline').style.display = 'block';
  }
</script>
</body>
</html>
`;

const outputPath = outArg
  ? resolve(outArg)
  : join(tmpdir(), 'goal-driven-plans', `${basename(planPath).replace(/\.md$/i, '')}.graph.html`);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, html, 'utf8');
console.log(
  `graph page: ${outputPath} (${graphs.length} graph${graphs.length === 1 ? '' : 's'}, ` +
    `${ledger.length} ledger items${lifecycleBudget ? ', lifecycle budget shown' : ''}` +
    `${findings ? ', findings shown' : ''})`,
);

if (!noOpen) {
  const [command, commandArgs] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', outputPath]]
      : process.platform === 'darwin'
        ? ['open', [outputPath]]
        : ['xdg-open', [outputPath]];
  const child = spawn(command, commandArgs, { detached: true, stdio: 'ignore' });
  child.on('error', (error) => {
    console.warn(`Could not open a browser (${error.message}); use ${outputPath}`);
  });
  child.unref();
}
