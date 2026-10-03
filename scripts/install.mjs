#!/usr/bin/env node
// Installs the goal-driven-implementation skill and its agent definitions into the local
// Claude Code and Codex CLI home directories.
//
//   node scripts/install.mjs               install for both harnesses
//   node scripts/install.mjs --only claude  (or --only codex)
//   node scripts/install.mjs --dry-run      print what would change
//   node scripts/install.mjs --no-agents    skill only, leave agent definitions alone
//   node scripts/install.mjs --no-backup    replace existing targets without keeping a copy
//
// A replaced target is moved to ~/.gdi-backups/<timestamp>/, outside every directory a harness
// scans: a copy left beside the skill is loaded as a second skill with the same description.
// `.bak-<timestamp>` copies that an earlier installer left in those directories are moved there
// too.
//
// Prefer `npx skills add carboni123/goal-driven-implementation` when the skills CLI is
// available; this script exists for machines without it and to place the agent definitions,
// which the skills CLI does not install.

import {
  cpSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const FLAGS = new Set(["--dry-run", "--no-agents", "--no-backup"]);
const usage =
  "usage: node scripts/install.mjs [--only claude|codex] [--dry-run] [--no-agents] [--no-backup]";
const argv = process.argv.slice(2);
let only = null;
const flags = new Set();
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === "--help" || argv[i] === "-h") {
    console.log(usage);
    process.exit(0);
  } else if (argv[i] === "--only" && ["claude", "codex"].includes(argv[i + 1])) {
    only = argv[++i];
  } else if (FLAGS.has(argv[i])) {
    flags.add(argv[i]);
  } else {
    // An unknown or misspelled flag must not fall through to a real install.
    console.error(`unknown argument: ${argv[i]}\n${usage}`);
    process.exit(2);
  }
}
const dryRun = flags.has("--dry-run");
const noAgents = flags.has("--no-agents");
const noBackup = flags.has("--no-backup");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillSrc = join(root, "skills", "goal-driven-implementation");
const version = readFileSync(
  join(skillSrc, "assets", "VERSION"),
  "utf8",
).trim();
const home = homedir();
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

const plan = [];
function copyDir(src, dest) {
  plan.push({ kind: "dir", src, dest });
}
function copyFiles(srcDir, dest, filter) {
  for (const name of readdirSync(srcDir)) {
    if (filter && !filter(name)) continue;
    plan.push({
      kind: "file",
      src: join(srcDir, name),
      dest: join(dest, name),
    });
  }
}

if (!only || only === "claude") {
  copyDir(
    skillSrc,
    join(home, ".claude", "skills", "goal-driven-implementation"),
  );
  if (!noAgents)
    copyFiles(
      join(skillSrc, "assets", "agents", "claude"),
      join(home, ".claude", "agents"),
      (n) => n.endsWith(".md"),
    );
}
if (!only || only === "codex") {
  copyDir(
    skillSrc,
    join(home, ".codex", "skills", "goal-driven-implementation"),
  );
  copyDir(
    skillSrc,
    join(home, ".agents", "skills", "goal-driven-implementation"),
  );
  if (!noAgents)
    copyFiles(
      join(skillSrc, "assets", "agents", "codex"),
      join(home, ".codex", "agents"),
      (n) => n.endsWith(".toml"),
    );
}

const stat = (path) => lstatSync(path, { throwIfNoEntry: false });
const real = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
};

// A backup directory is never reused: a second run in the same millisecond gets its own.
let backupRoot = join(home, ".gdi-backups", stamp);
for (let n = 2; stat(backupRoot); n += 1) backupRoot = join(home, ".gdi-backups", `${stamp}-${n}`);

// Refuse before changing anything when a target cannot be written safely.
const problems = new Set();
const within = (a, b) => a === b || a.startsWith(`${b}${sep}`);
for (const step of plan) {
  for (let dir = dirname(step.dest); within(dir, home) && dir !== home; dir = dirname(dir)) {
    if (stat(dir)?.isSymbolicLink() && !real(dir)) problems.add(`${dir} is a link whose target does not exist`);
  }
  const source = real(step.src);
  const parent = real(dirname(step.dest));
  for (const target of [real(step.dest), parent && join(parent, basename(step.dest))]) {
    if (target && (within(target, source) || within(source, target))) {
      problems.add(`${step.dest} resolves to ${target}, which is the source being installed; point it elsewhere first`);
    }
  }
}
if (problems.size) {
  console.error(`goal-driven-implementation ${version}: nothing was changed.`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

// Moves a path under the backup root, keeping its location relative to the home directory.
function moveToBackups(target) {
  const dest = join(backupRoot, relative(home, target));
  if (stat(dest)) throw new Error(`backup path already exists, not overwriting it: ${dest}`);
  if (!dryRun) {
    mkdirSync(dirname(dest), { recursive: true });
    try {
      renameSync(target, dest);
    } catch (error) {
      if (error.code !== "EXDEV") throw error;
      cpSync(target, dest, { recursive: true });
      rmSync(target, { recursive: true, force: true });
    }
  }
  return dest;
}

// Clears the destination and says what happened to what was there.
function retire(target) {
  const existing = stat(target);
  if (!existing) return "";
  if (existing.isSymbolicLink()) {
    // A link (the skills CLI makes them) holds nothing to keep; its target is left untouched.
    const to = readlinkSync(target);
    if (!dryRun) rmSync(target, { force: true });
    return `  (was a link to ${to})`;
  }
  if (noBackup) {
    if (!dryRun) rmSync(target, { recursive: true, force: true });
    return "";
  }
  return `  (previous copy: ${moveToBackups(target)})`;
}

console.log(
  `goal-driven-implementation ${version} → ${dryRun ? "dry run" : "installing"}`,
);
for (const step of plan) {
  const existed = Boolean(stat(step.dest));
  const note = retire(step.dest);
  if (!dryRun) {
    mkdirSync(dirname(step.dest), { recursive: true });
    if (step.kind === "dir") cpSync(step.src, step.dest, { recursive: true });
    else cpSync(step.src, step.dest);
  }
  const what = step.kind === "dir" ? "skill" : "agent";
  console.log(
    `  ${existed ? "replaced" : "created "} ${what.padEnd(5)} ${step.dest}${note}`,
  );
}

// `<name>.bak-<timestamp>` beside a target is a copy an earlier installer left in a scanned
// directory. A link among them is removed; a real copy is moved under the backup root.
for (const step of plan) {
  const dir = dirname(step.dest);
  if (!stat(dir)) continue;
  for (const name of readdirSync(dir)) {
    if (!name.startsWith(`${basename(step.dest)}.bak-`)) continue;
    const stray = join(dir, name);
    if (stat(stray).isSymbolicLink()) {
      if (!dryRun) rmSync(stray, { force: true });
      console.log(`  removed  stale link ${stray}`);
    } else {
      console.log(`  moved    old backup ${stray} → ${moveToBackups(stray)}`);
    }
  }
}

if (!only || only === "codex") {
  console.log(`
Codex: current releases auto-discover agents from ~/.codex/agents/. Older releases (0.144.x)
need this in ~/.codex/config.toml — add it yourself; the installer never edits your config:

  [features]
  multi_agent_v2 = true
  [agents.goal-implementer]
  config_file = "${join(home, ".codex", "agents", "goal-implementer.toml").replace(/\\/g, "/")}"
  [agents.goal-planner]
  config_file = "${join(home, ".codex", "agents", "goal-planner.toml").replace(/\\/g, "/")}"
  [agents.goal-reviewer]
  config_file = "${join(home, ".codex", "agents", "goal-reviewer.toml").replace(/\\/g, "/")}"
  [agents.goal-explorer]
  config_file = "${join(home, ".codex", "agents", "goal-explorer.toml").replace(/\\/g, "/")}"

Upgrading from goal-implementer-terra: migrate its config key/path and other references to
goal-implementer, then retire the old registration and old installed TOML. This installer leaves
them intact; reload Codex before using the renamed role.
`);
}
if (!only || only === "claude") {
  console.log(
    "Claude Code: a running session picks up the gdi-* agent types; if one is not listed, start a new session.",
  );
}
const installed = plan.find((step) => step.kind === "dir");
console.log(
  `Verify: node ${join(installed.dest, "assets", "validate-plan.mjs")} --self-test`,
);
