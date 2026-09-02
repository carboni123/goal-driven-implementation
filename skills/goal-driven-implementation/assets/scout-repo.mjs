#!/usr/bin/env node
// Scout a repository into a feature map — apps, feature slices, shared kernels — with no LLM
// call, then classify changed paths against it. Ported from the aiq-lite code-research scout
// (Python) so the skill stays dependency-free Node.
//
//   node scout-repo.mjs <repo-root> [--out <file.yml>] [--json] [--exclude dir,dir]
//   node scout-repo.mjs <repo-root> --classify <path,path,...>     classify changed paths
//   git diff --name-only | node scout-repo.mjs <repo-root> --classify -
//   node scout-repo.mjs --self-test
//
// Detection is structural and deterministic:
//   apps            children of apps/ or services/ (entry point reported when found)
//   features        children of packages/modules, packages/features, src/features, src/modules,
//                   app/features, backend/app/features; any directory carrying PRD.md,
//                   FEATURE.md, STORIES.md, or CATALOG.md; any directory whose children include
//                   two or more backend layers (api, application, domain, infrastructure,
//                   usecases, commands, queries, services) or frontend layers (model, ui, api,
//                   lib, config)
//   shared_kernels  children of packages/platform, packages/shared, packages/core,
//                   packages/tooling, packages/ui, packages/adapters, src/shared, src/lib
// Each unit reports path, file and char counts, signals, layers, anchor docs, package name, and
// a one-line description taken from the first paragraph under the H1 of its README or PRD.
//
// --classify maps each path to the unit that owns it (longest matching unit path) and
// summarizes how many units and shared kernels the set touches. That summary is the structural
// signal the bounded-fix lane eligibility check and the reader-sweep class ask for.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";

const DEFAULT_EXCLUDE_DIRS = new Set([
  ".git", ".hg", ".svn",
  "node_modules", "bower_components",
  "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache",
  "dist", "build", "out", "target",
  ".venv", "venv", "env", ".env",
  ".next", ".nuxt", ".turbo", ".cache",
  "coverage", ".coverage",
  ".idea", ".vscode",
  ".pnpm-store", ".yarn", ".worktrees", ".tox", ".nox", ".eggs", "site-packages",
]);
// A directory carrying its own .git (directory or worktree file) is another repository or a
// worktree checkout, never part of this repository's map.
const isNestedRepo = (abs) => existsSync(join(abs, ".git"));

const SOURCE_EXTS = new Set([
  ".py", ".pyi",
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".go", ".rs", ".rb", ".php", ".java", ".kt", ".scala",
  ".c", ".h", ".cpp", ".hpp", ".cc", ".cs",
  ".sh", ".bash", ".zsh", ".ps1",
  ".sql",
  ".html", ".css", ".scss",
  ".md", ".mdx", ".rst",
  ".yml", ".yaml", ".toml", ".json",
  ".j2", ".jinja", ".jinja2",
]);
const EXTENSIONLESS_SOURCE = new Set(["Dockerfile", "Makefile"]);
const MARKDOWN_EXTS = new Set([".md", ".mdx", ".rst"]);

const FEATURE_ANCHOR_FILES = new Set(["PRD.md", "FEATURE.md", "STORIES.md", "CATALOG.md"]);
const DESCRIPTION_DOC_FILES = ["README.md", "PRD.md", "FEATURE.md"];
const BACKEND_LAYER_DIRS = new Set([
  "api", "application", "domain", "infrastructure",
  "usecases", "use-cases", "commands", "queries", "services",
]);
const FRONTEND_LAYER_DIRS = new Set(["model", "ui", "api", "lib", "config"]);
const FEATURE_PARENT_PATHS = [
  "packages/modules", "packages/features", "src/features", "src/modules",
  "app/features", "backend/app/features",
];
const APP_PARENT_PATHS = ["apps", "services"];
const SHARED_KERNEL_PARENT_PATHS = [
  "packages/platform", "packages/shared", "packages/core", "packages/tooling",
  "packages/ui", "packages/adapters", "src/shared", "src/lib",
];
const ENTRY_POINT_BASENAMES = [
  "main.ts", "main.tsx", "main.js", "main.mjs", "main.py",
  "server.ts", "server.js", "server.py",
  "index.ts",
];
const DESCRIPTION_SCAN_BYTES = 4000;
const MAX_DESCRIPTION_LEN = 240;
const MIN_CODE_FILES_FOR_ANCHOR_ONLY = 3;
const ANCHOR_WALK_MAX_DEPTH = 5;

// ---------- filesystem helpers ----------

const norm = (p) => p.split(sep).join("/").replace(/\\/g, "/");
const extOf = (name) => {
  const i = name.lastIndexOf(".");
  return i <= 0 ? "" : name.slice(i).toLowerCase();
};
const parentOf = (rel) => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");

function listDirs(abs, exclude) {
  let entries;
  try {
    entries = readdirSync(abs, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(
      (e) =>
        e.isDirectory() &&
        !exclude.has(e.name) &&
        !e.name.startsWith(".") &&
        !isNestedRepo(join(abs, e.name)),
    )
    .map((e) => e.name)
    .sort();
}

function listFiles(abs) {
  let entries;
  try {
    entries = readdirSync(abs, { withFileTypes: true });
  } catch {
    return new Set();
  }
  return new Set(entries.filter((e) => e.isFile()).map((e) => e.name));
}

function walk(root, exclude, visit) {
  const stack = [""];
  while (stack.length) {
    const rel = stack.pop();
    const abs = rel ? join(root, rel) : root;
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    const dirs = [];
    const files = [];
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!exclude.has(e.name) && !isNestedRepo(join(abs, e.name))) dirs.push(e.name);
      } else if (e.isFile()) files.push(e.name);
    }
    const descend = visit(rel, dirs, files);
    if (descend === false) continue;
    for (const d of dirs) stack.push(rel ? `${rel}/${d}` : d);
  }
}

// ---------- counting ----------

function walkCounts(root, exclude) {
  const counts = new Map();
  const bump = (rel, size, isCode) => {
    const parts = rel.split("/");
    for (let i = 0; i < parts.length; i += 1) {
      const ancestor = parts.slice(0, i).join("/");
      const c = counts.get(ancestor) ?? { files: 0, chars: 0, code_files: 0 };
      c.files += 1;
      c.chars += size;
      if (isCode) c.code_files += 1;
      counts.set(ancestor, c);
    }
  };
  walk(root, exclude, (rel, _dirs, files) => {
    for (const name of files) {
      const ext = extOf(name);
      if (!SOURCE_EXTS.has(ext) && !EXTENSIONLESS_SOURCE.has(name)) continue;
      let size;
      try {
        size = statSync(join(root, rel, name)).size;
      } catch {
        continue;
      }
      bump(rel ? `${rel}/${name}` : name, size, !MARKDOWN_EXTS.has(ext));
    }
  });
  return counts;
}

// ---------- heuristics ----------

function detectLayers(childDirs) {
  const set = new Set(childDirs);
  const backend = [...BACKEND_LAYER_DIRS].filter((d) => set.has(d)).sort();
  const frontend = [...FRONTEND_LAYER_DIRS].filter((d) => set.has(d)).sort();
  return { backend, frontend };
}

function classifyDir(rel, childDirs, childFiles) {
  const parent = parentOf(rel);
  if (rel && SHARED_KERNEL_PARENT_PATHS.includes(parent))
    return { category: "shared_kernel", signals: ["shared-kernel-location"] };
  if (rel && APP_PARENT_PATHS.includes(parent))
    return { category: "app", signals: ["app-location"] };
  const signals = [];
  if (rel && FEATURE_PARENT_PATHS.includes(parent)) signals.push("monorepo-convention");
  if ([...FEATURE_ANCHOR_FILES].some((f) => childFiles.has(f))) signals.push("anchor-doc");
  const { backend, frontend } = detectLayers(childDirs);
  if (backend.length >= 2) signals.push("backend-layers");
  if (frontend.length >= 2) signals.push("frontend-layers");
  if (signals.length) return { category: "feature", signals };
  return { category: "", signals: [] };
}

function extractDescription(absDoc) {
  let text;
  try {
    text = readFileSync(absDoc, "utf8").slice(0, DESCRIPTION_SCAN_BYTES);
  } catch {
    return "";
  }
  let sawH1 = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("# ")) {
      sawH1 = true;
      continue;
    }
    if (!sawH1) continue;
    if (/^(#|>|-|\*|\||```)/.test(line)) continue;
    const cleaned = line.replace(/[*_`]/g, "");
    return cleaned.length > MAX_DESCRIPTION_LEN
      ? `${cleaned.slice(0, MAX_DESCRIPTION_LEN - 1).trimEnd()}…`
      : cleaned;
  }
  return "";
}

function packageName(absDir) {
  const pkg = join(absDir, "package.json");
  if (!existsSync(pkg)) return "";
  try {
    const name = JSON.parse(readFileSync(pkg, "utf8")).name;
    return typeof name === "string" ? name : "";
  } catch {
    return "";
  }
}

function findEntryPoint(absDir) {
  for (const d of [join(absDir, "src"), absDir]) {
    if (!existsSync(d)) continue;
    for (const name of ENTRY_POINT_BASENAMES) {
      if (existsSync(join(d, name))) return norm(join(d, name).slice(absDir.length + 1));
    }
  }
  return "";
}

function candidateDirs(root, exclude) {
  const candidates = new Set();
  for (const parent of [...FEATURE_PARENT_PATHS, ...APP_PARENT_PATHS, ...SHARED_KERNEL_PARENT_PATHS]) {
    const abs = join(root, parent);
    if (!existsSync(abs)) continue;
    for (const child of listDirs(abs, exclude)) candidates.add(`${parent}/${child}`);
  }
  walk(root, exclude, (rel, _dirs, files) => {
    if (rel && files.some((f) => FEATURE_ANCHOR_FILES.has(f))) candidates.add(rel);
    const depth = rel ? rel.split("/").length : 0;
    return depth < ANCHOR_WALK_MAX_DEPTH;
  });
  return [...candidates].sort();
}

// ---------- scout ----------

export function scout(rootArg, extraExclude = []) {
  const root = resolve(rootArg);
  const exclude = new Set([...DEFAULT_EXCLUDE_DIRS, ...extraExclude]);
  const counts = walkCounts(root, exclude);
  const apps = [];
  const features = [];
  const shared = [];
  for (const rel of candidateDirs(root, exclude)) {
    const abs = join(root, rel);
    const childDirs = listDirs(abs, exclude);
    const childFiles = listFiles(abs);
    const { category, signals } = classifyDir(rel, childDirs, childFiles);
    if (!category) continue;
    const c = counts.get(rel) ?? { files: 0, chars: 0, code_files: 0 };
    if (
      category === "feature" &&
      signals.length === 1 &&
      signals[0] === "anchor-doc" &&
      c.code_files < MIN_CODE_FILES_FOR_ANCHOR_ONLY
    )
      continue;
    const record = { name: basename(rel), path: rel, files: c.files, chars: c.chars, signals };
    if (category === "feature") {
      const { backend, frontend } = detectLayers(childDirs);
      const layers = [...new Set([...backend, ...frontend])];
      if (layers.length) record.layers = layers;
    }
    const anchors = [...FEATURE_ANCHOR_FILES].filter((f) => childFiles.has(f)).sort();
    if (anchors.length) record.anchors = anchors;
    for (const doc of DESCRIPTION_DOC_FILES) {
      if (!childFiles.has(doc)) continue;
      const desc = extractDescription(join(abs, doc));
      if (desc) {
        record.description = desc;
        record.description_source = doc;
        break;
      }
    }
    const pkg = packageName(abs);
    if (pkg) record.package_name = pkg;
    if (category === "app") {
      const ep = findEntryPoint(abs);
      if (ep) record.entry_point = ep;
      apps.push(record);
    } else if (category === "feature") features.push(record);
    else shared.push(record);
  }
  apps.sort((a, b) => a.name.localeCompare(b.name));
  features.sort((a, b) => b.chars - a.chars);
  shared.sort((a, b) => a.name.localeCompare(b.name));
  const total = counts.get("") ?? { files: 0, chars: 0 };
  return {
    scout_version: 1,
    root: norm(root),
    generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    summary: {
      apps: apps.length,
      features: features.length,
      shared_kernels: shared.length,
      total_files: total.files,
      total_chars: total.chars,
    },
    apps,
    features,
    shared_kernels: shared,
  };
}

// ---------- classify changed paths ----------

export function classifyPaths(map, paths) {
  const units = [
    ...map.apps.map((u) => ({ ...u, category: "app" })),
    ...map.features.map((u) => ({ ...u, category: "feature" })),
    ...map.shared_kernels.map((u) => ({ ...u, category: "shared_kernel" })),
  ].sort((a, b) => b.path.length - a.path.length);
  const rows = [];
  const touched = new Map();
  let unowned = 0;
  for (const raw of paths) {
    const p = norm(raw.trim()).replace(/^\.\//, "");
    if (!p) continue;
    const owner = units.find((u) => p === u.path || p.startsWith(`${u.path}/`));
    if (!owner) {
      unowned += 1;
      rows.push({ path: p, category: "unowned", unit: "" });
      continue;
    }
    rows.push({ path: p, category: owner.category, unit: owner.path });
    touched.set(owner.path, owner.category);
  }
  const sharedKernels = [...touched].filter(([, c]) => c === "shared_kernel").map(([p]) => p);
  return {
    rows,
    summary: {
      paths: rows.length,
      units: touched.size,
      shared_kernels: sharedKernels.length,
      unowned,
    },
    units: [...touched].map(([path, category]) => ({ path, category })),
    shared_kernel_paths: sharedKernels,
  };
}

// ---------- YAML (hand-rolled, quoted strings only) ----------

const yamlStr = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const yamlScalar = (v) =>
  typeof v === "number" || typeof v === "boolean" ? String(v) : v == null ? "null" : yamlStr(v);

function emitYaml(out, obj, indent = 0) {
  const pad = "  ".repeat(indent);
  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const keys = Object.keys(item);
        if (!keys.length) {
          out.push(`${pad}- {}`);
          continue;
        }
        const [first, ...rest] = keys;
        const v0 = item[first];
        if (Array.isArray(v0) || (v0 && typeof v0 === "object")) {
          if (Array.isArray(v0) && !v0.length) out.push(`${pad}- ${first}: []`);
          else {
            out.push(`${pad}- ${first}:`);
            emitYaml(out, v0, indent + 2);
          }
        } else out.push(`${pad}- ${first}: ${yamlScalar(v0)}`);
        const restObj = {};
        for (const k of rest) restObj[k] = item[k];
        if (rest.length) emitYaml(out, restObj, indent + 1);
      } else out.push(`${pad}- ${yamlScalar(item)}`);
    }
    return;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) {
      if (!v.length) out.push(`${pad}${k}: []`);
      else {
        out.push(`${pad}${k}:`);
        emitYaml(out, v, indent + 1);
      }
    } else if (v && typeof v === "object") {
      out.push(`${pad}${k}:`);
      emitYaml(out, v, indent + 1);
    } else out.push(`${pad}${k}: ${yamlScalar(v)}`);
  }
}

export function toYaml(obj) {
  const out = [];
  emitYaml(out, obj);
  return `${out.join("\n")}\n`;
}

// ---------- self-test ----------

function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), "gdi-scout-"));
  const put = (rel, content = "x\n") => {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  };
  try {
    put("apps/api/src/main.ts", "export {};\n");
    put("apps/api/package.json", '{"name":"@x/api"}\n');
    put("apps/api/README.md", "# API\n\nHTTP entrypoint for **X**.\n");
    put("packages/modules/orders/api/routes.ts");
    put("packages/modules/orders/domain/order.ts");
    put("packages/modules/orders/PRD.md", "# Orders\n\n> quote\n\nOrder lifecycle.\n");
    put("packages/platform/db/index.ts");
    put("docs/PRD.md", "# Docs\n\nOnly a doc.\n");
    put("node_modules/junk/index.js");
    put("services/worker/server.py");
    put("src/features/billing/model/a.ts");
    put("src/features/billing/ui/b.tsx");
    // A nested checkout (worktree file or full .git dir) is skipped even under a known parent.
    put("packages/modules/vendored/.git", "gitdir: ../../../.git/worktrees/vendored\n");
    put("packages/modules/vendored/api/x.ts");
    put("packages/modules/vendored/domain/y.ts");
    put(".pnpm-store/v3/files/00/abc.js");

    const map = scout(dir);
    const assert = (cond, msg) => {
      if (!cond) throw new Error(`self-test: ${msg}`);
    };
    assert(map.summary.apps === 2, `apps=${map.summary.apps}, want 2`);
    assert(map.summary.features === 2, `features=${map.summary.features}, want 2 (docs/ excluded as anchor-only)`);
    assert(map.summary.shared_kernels === 1, `shared_kernels=${map.summary.shared_kernels}, want 1`);
    const api = map.apps.find((a) => a.name === "api");
    assert(api.entry_point === "src/main.ts", `api entry_point=${api.entry_point}`);
    assert(api.package_name === "@x/api", `api package_name=${api.package_name}`);
    assert(api.description === "HTTP entrypoint for X.", `api description=${JSON.stringify(api.description)}`);
    const orders = map.features.find((f) => f.name === "orders");
    assert(orders.signals.join(",") === "monorepo-convention,anchor-doc,backend-layers", `orders signals=${orders.signals}`);
    assert(orders.description === "Order lifecycle.", `orders description=${JSON.stringify(orders.description)}`);
    assert(orders.layers.join(",") === "api,domain", `orders layers=${orders.layers}`);
    const billing = map.features.find((f) => f.name === "billing");
    assert(billing.signals.join(",") === "monorepo-convention,frontend-layers", `billing signals=${billing.signals}`);
    assert(!map.root.includes("\\"), "root uses forward slashes");
    assert(map.summary.total_files === 11, `total_files=${map.summary.total_files}, want 11 (node_modules, nested repo, .pnpm-store excluded)`);
    assert(!map.features.some((f) => f.name === "vendored"), "nested checkout is not a feature");

    const cls = classifyPaths(map, [
      "packages/modules/orders/api/routes.ts",
      "./packages/modules/orders/domain/order.ts",
      "packages/platform/db/index.ts",
      "README.md",
    ]);
    assert(cls.summary.units === 2, `classify units=${cls.summary.units}, want 2`);
    assert(cls.summary.shared_kernels === 1, `classify shared_kernels=${cls.summary.shared_kernels}, want 1`);
    assert(cls.summary.unowned === 1, `classify unowned=${cls.summary.unowned}, want 1`);
    assert(cls.rows[1].unit === "packages/modules/orders", "./ prefix stripped");

    const yaml = toYaml(map);
    assert(yaml.includes('description: "HTTP entrypoint for X."'), "yaml carries description");
    assert(yaml.includes("- name: \"api\""), "yaml list item inline first key");
    assert(/^\s+signals:\n\s+- "app-location"/m.test(yaml), "yaml nested list");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("scout-repo self-test passed");
}

// ---------- CLI ----------

function main(argv) {
  const args = [...argv];
  if (args.includes("--self-test")) {
    selfTest();
    return 0;
  }
  const opt = (name) => {
    const i = args.indexOf(name);
    if (i === -1) return null;
    const v = args[i + 1];
    if (v === undefined || v.startsWith("--")) {
      console.error(`${name} requires a value`);
      process.exit(2);
    }
    args.splice(i, 2);
    return v;
  };
  const out = opt("--out");
  const exclude = opt("--exclude");
  const classifyArg = opt("--classify");
  const json = args.includes("--json");
  const positional = args.filter((a) => !a.startsWith("--"));
  if (positional.length !== 1) {
    console.error("usage: scout-repo.mjs <repo-root> [--out file] [--json] [--exclude a,b] [--classify paths|-] | --self-test");
    return 2;
  }
  const root = resolve(positional[0]);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`error: ${root} is not a directory`);
    return 2;
  }
  const map = scout(root, exclude ? exclude.split(",").map((s) => s.trim()).filter(Boolean) : []);

  if (classifyArg !== null) {
    const raw =
      classifyArg === "-" ? readFileSync(0, "utf8") : classifyArg;
    const paths = raw.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    const result = classifyPaths(map, paths);
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      for (const r of result.rows)
        console.log(`${r.category.padEnd(13)} ${r.unit || "-"}  ${r.path}`);
      const s = result.summary;
      console.log(
        `units touched: ${s.units}; shared kernels touched: ${s.shared_kernels}; unowned paths: ${s.unowned}`,
      );
    }
    return 0;
  }

  const text = json ? `${JSON.stringify(map, null, 2)}\n` : toYaml(map);
  if (out) {
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(out, text);
    const s = map.summary;
    console.log(
      `wrote ${out} (apps=${s.apps}, features=${s.features}, shared_kernels=${s.shared_kernels}, files=${s.total_files}, chars=${s.total_chars})`,
    );
  } else process.stdout.write(text);
  return 0;
}

if (process.argv[1] && basename(process.argv[1]) === "scout-repo.mjs") {
  process.exit(main(process.argv.slice(2)));
}
