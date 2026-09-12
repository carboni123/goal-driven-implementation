#!/usr/bin/env node
// Installs the goal-driven-implementation skill and its agent definitions into the local
// Claude Code and Codex CLI home directories.
//
//   node scripts/install.mjs               install for both harnesses
//   node scripts/install.mjs --only claude  (or --only codex)
//   node scripts/install.mjs --dry-run      print what would change
//   node scripts/install.mjs --no-agents    skill only, leave agent definitions alone
//   node scripts/install.mjs --no-backup    replace existing targets without a .bak copy
//
// Prefer `npx skills add carboni123/goal-driven-implementation` when the skills CLI is
// available; this script exists for machines without it and to place the agent definitions,
// which the skills CLI does not install.

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = new Set(process.argv.slice(2));
const only = process.argv.includes("--only")
  ? process.argv[process.argv.indexOf("--only") + 1]
  : null;
const dryRun = args.has("--dry-run");
const noAgents = args.has("--no-agents");
const noBackup = args.has("--no-backup");

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

function backup(target) {
  if (noBackup || !existsSync(target)) return null;
  const bak = `${target}.bak-${stamp}`;
  if (!dryRun) renameSync(target, bak);
  return bak;
}

console.log(
  `goal-driven-implementation ${version} → ${dryRun ? "dry run" : "installing"}`,
);
for (const step of plan) {
  const existed = existsSync(step.dest);
  const bak = existed ? backup(step.dest) : null;
  if (!dryRun) {
    mkdirSync(dirname(step.dest), { recursive: true });
    if (step.kind === "dir") cpSync(step.src, step.dest, { recursive: true });
    else cpSync(step.src, step.dest);
  }
  const what = step.kind === "dir" ? "skill" : "agent";
  console.log(
    `  ${existed ? "replaced" : "created "} ${what.padEnd(5)} ${step.dest}${bak ? `  (backup: ${bak})` : ""}`,
  );
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
    "Claude Code: start a new session so the gdi-* agent types are listed.",
  );
}
if (
  existsSync(join(skillSrc, "assets", "validate-plan.mjs")) &&
  statSync(join(skillSrc, "assets", "validate-plan.mjs")).isFile()
) {
  console.log(
    `Verify: node ${join(home, ".claude", "skills", "goal-driven-implementation", "assets", "validate-plan.mjs")} --self-test`,
  );
}
