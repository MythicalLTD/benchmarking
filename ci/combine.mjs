// Merges the per-target artifacts of a benchmark run into one document the website can read.
// Usage: node ci/combine.mjs <artifacts-dir> <out-file>
// Each artifact directory holds `<kind>-<name>.json` (the suite report, absent when the target
// failed) and `runner-<kind>-<name>.json` (the machine it ran on).
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

const targets = {};
for (const dir of (await readdir(artifactsDir, { withFileTypes: true })).filter((d) => d.isDirectory())) {
  const root = path.join(artifactsDir, dir.name);
  const files = await readdir(root);
  const runnerFile = files.find((f) => f.startsWith('runner-'));
  const runner = runnerFile ? await readJson(path.join(root, runnerFile)) : null;
  const key = runner?.target ?? dir.name.replace(/^bench-/, '').replace('-', ':');
  const reportFile = files.find((f) => !f.startsWith('runner-') && f.endsWith('.json'));
  const report = reportFile ? await readJson(path.join(root, reportFile)) : null;
  targets[key] = { status: report ? 'ok' : 'failed', runner, report };
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
  targets,
};

await writeFile(outFile, `${JSON.stringify(doc, null, 2)}\n`);
console.log(`combined ${Object.keys(targets).length} targets (${ok} ok) into ${outFile}`);
if (ok === 0) {
  console.error('no target produced a report; refusing to publish');
  process.exit(1);
}
