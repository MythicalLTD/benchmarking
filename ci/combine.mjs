// Merges the artifacts of a benchmark run into one document the website can read.
// Usage: node ci/combine.mjs <artifacts-dir> <out-file>
//
// Each artifact (`bench-panels`, `bench-daemons`) is one job on one machine:
//   runner.json                      the machine the whole group ran on
//   round-<n>/<kind>-<name>.json     the suite report of each target, per round
// A target that ran in several rounds is published as the median of every numeric field,
// with `rounds` saying how many reports went into it.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [artifactsDir, outFile] = process.argv.slice(2);
if (!artifactsDir || !outFile) {
  console.error('usage: node ci/combine.mjs <artifacts-dir> <out-file>');
  process.exit(2);
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Arrays whose items are matched by identity across rounds rather than by position. */
const KEYED_ARRAYS = {
  variants: (v) => JSON.stringify(v?.limit ?? null),
  results: (r) => r?.scenario?.name ?? null,
};

function merge(nodes, key) {
  const present = nodes.filter((n) => n !== undefined && n !== null);
  if (present.length === 0) return nodes[0] ?? null;
  const first = present[0];
  if (typeof first === 'number') {
    const numbers = present.filter((n) => typeof n === 'number' && Number.isFinite(n));
    return numbers.length > 0 ? median(numbers) : first;
  }
  if (Array.isArray(first)) {
    const keyOf = KEYED_ARRAYS[key];
    if (!keyOf) return first; // notes, raw run lists, failure messages: keep the first round's
    return first.map((item) => {
      const id = keyOf(item);
      return merge(
        present.map((arr) => (Array.isArray(arr) ? arr.find((other) => keyOf(other) === id) : undefined)),
        undefined,
      );
    });
  }
  if (typeof first === 'object') {
    const out = {};
    for (const k of Object.keys(first)) {
      // The scenario definition is identical across rounds; never average its parameters.
      out[k] = k === 'scenario' || k === 'limit' ? first[k] : merge(present.map((n) => n?.[k]), k);
    }
    return out;
  }
  return first;
}

const targets = {};
const machines = {};
for (const dir of (await readdir(artifactsDir, { withFileTypes: true })).filter((d) => d.isDirectory())) {
  const group = dir.name.replace(/^bench-/, '');
  const root = path.join(artifactsDir, dir.name);
  const runner = await readJson(path.join(root, 'runner.json'));
  machines[group] = runner;

  const rounds = (await readdir(root, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && d.name.startsWith('round-'))
    .map((d) => d.name)
    .sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)));

  const reports = new Map();
  for (const round of rounds) {
    for (const file of (await readdir(path.join(root, round))).filter((f) => f.endsWith('.json'))) {
      const report = await readJson(path.join(root, round, file));
      if (!report?.target) continue;
      if (!reports.has(report.target)) reports.set(report.target, []);
      reports.get(report.target).push(report);
    }
  }

  const expected = group === 'panels' ? 'panel' : group === 'daemons' ? 'daemon' : null;
  for (const [target, list] of reports) {
    const merged = list.length === 1 ? list[0] : merge(list, undefined);
    merged.version = list.at(-1).version;
    merged.startedAt = list[0].startedAt;
    targets[target] = { status: 'ok', group, rounds: list.length, roundsRun: rounds.length, runner, report: merged };
  }
  // Targets the suite knows about but that produced no report in any round failed outright.
  for (const target of process.env.EXPECTED_TARGETS?.split(/\s+/).filter(Boolean) ?? []) {
    if (expected && target.startsWith(`${expected}:`) && !targets[target]) {
      targets[target] = { status: 'failed', group, rounds: 0, roundsRun: rounds.length, runner, report: null };
    }
  }
}

const ok = Object.values(targets).filter((t) => t.status === 'ok').length;
const server = process.env.GITHUB_SERVER_URL ?? 'https://github.com';
const repo = process.env.GITHUB_REPOSITORY ?? 'MythicalLTD/benchmarking';
const doc = {
  schema: 1,
  generatedAt: new Date().toISOString(),
  repository: `${server}/${repo}`,
  commit: process.env.GITHUB_SHA ?? null,
  runId: process.env.GITHUB_RUN_ID ?? null,
  runUrl: process.env.GITHUB_RUN_ID ? `${server}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}` : null,
  trigger: process.env.GITHUB_EVENT_NAME ?? null,
  machines,
  targets,
};

await writeFile(outFile, `${JSON.stringify(doc, null, 2)}\n`);
console.log(`combined ${Object.keys(targets).length} targets (${ok} ok) into ${outFile}`);
if (ok === 0) {
  console.error('no target produced a report; refusing to publish');
  process.exit(1);
}
