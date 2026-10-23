import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import colors from 'ansi-colors';
import { DockerDaemon } from './daemon.ts';
import {
  ARCHIVE_FORMATS,
  archiveKey,
  CHUNK_PATH,
  cleanOutputs,
  copyTree,
  countFiles,
  type Dataset,
  type DatasetRequest,
  ensureDataset,
  fileSize,
  isGeneratedArchive,
  LIST_SIZES,
  listDirName,
  OUTPUT_PATHS,
  randomBytes,
  SMALL_PATH,
  syncFilesystem,
  TREE_IDS,
  treeDirName,
  UPLOAD_BYTES,
} from './dataset.ts';
import { networkExists, networkRemove } from './docker.ts';
import { bestEffort, removePath } from './fsutil.ts';
import { RemoteMock } from './remote-mock.ts';
import type { TaskOutcome, TaskRunner } from './target.ts';
import type {
  ArchiveFormat,
  AuthContext,
  HttpMethod,
  Operation,
  RequestSpec,
  ResourceLimit,
  Scenario,
  ScenarioParams,
  TaskScenario,
} from './types.ts';
import { benchPort } from './utils.ts';

export interface WingsDaemonOptions {
  readonly composeFile?: string;
  readonly project?: string;
  readonly host?: string;
  readonly port?: number;
  readonly image?: string;
  readonly service?: string;
  readonly workdir?: string;
  readonly settleMs?: number;
  readonly prune?: boolean;
}

export interface WingsConfigContext {
  readonly nodeUuid: string;
  readonly tokenId: string;
  readonly token: string;
  readonly remote: string;
  readonly networkName: string;
  readonly subnetIndex: number;
}

export interface WingsFlavor {
  readonly name: string;
  readonly username: string;
  readonly networkName: string;
  readonly subnetIndex: number;
  readonly composeFile: string;
  readonly compressFormats: readonly ArchiveFormat[];
  readonly notes: readonly string[];
  renderConfig(context: WingsConfigContext): string;
}

export const SERVER_UUID = '3f9d3c5e-0b0f-4d8e-9c1a-1b2c3d4e5f60';
const EGG_UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const NODE_UUID = '7c6b5a49-3827-4160-9f8e-7d6c5b4a3928';
const TOKEN_ID = 'benchmarkNodeId1';
const TOKEN = 'benchmarkbenchmarkbenchmarkbenchmarkbenchmarkbenchmarkbenchmark1';
const DEFAULT_WORKDIR = path.resolve(process.cwd(), '.bench');
const UPLOAD_SEED = 0x0bad_cafe;

const COMPRESS_FORMAT_NAMES: Readonly<Record<ArchiveFormat, string>> = {
  'tar.gz': 'tar_gz',
  zip: 'zip',
};

export abstract class WingsDaemon extends DockerDaemon implements TaskRunner {
  readonly name: string;

  protected readonly serviceName: string;
  protected readonly healthPath = '/api/system';
  protected readonly compose: {
    readonly file: string;
    readonly project: string;
    readonly env: Record<string, string>;
  };

  private readonly flavor: WingsFlavor;
  private readonly host: string;
  private port: number;
  private readonly workdir: string;
  private readonly settleMs: number;
  private readonly prune: boolean;
  private readonly mock: RemoteMock;
  private ownsNetwork = false;
  private dataset: Dataset | null = null;
  private uploadBody: Uint8Array<ArrayBuffer> | null = null;

  constructor(flavor: WingsFlavor, options: WingsDaemonOptions = {}) {
    super();
    this.flavor = flavor;
    this.name = flavor.name;
    this.host = options.host ?? 'localhost';
    this.port = options.port ?? benchPort(this.kind, this.name);
    this.portPinned = options.port !== undefined;
    this.serviceName = options.service ?? 'wings';
    this.workdir = path.resolve(options.workdir ?? DEFAULT_WORKDIR, `daemon-${flavor.name}`);
    this.settleMs = options.settleMs ?? 10_000;
    this.prune = options.prune === true;
    this.mock = new RemoteMock({
      tokenId: TOKEN_ID,
      token: TOKEN,
      serverUuid: SERVER_UUID,
      server: buildServerDocument(),
    });

    const env: Record<string, string> = {
      WINGS_PORT: String(this.port),
      WINGS_WORKDIR: this.workdir,
      WINGS_USERNAME: flavor.username,
    };
    if (options.image !== undefined) {
      env.WINGS_IMAGE = options.image;
    }
    this.compose = {
      file: options.composeFile ?? flavor.composeFile,
      project: options.project ?? `${flavor.name}-daemon-bench`,
      env,
    };
  }

  get baseUrl(): string {
    return `http://${this.host}:${this.port}`;
  }

  protected get hostPort(): number {
    return this.port;
  }

  protected rebindPort(port: number): void {
    this.port = port;
    this.compose.env.WINGS_PORT = String(port);
  }

  get serverRoot(): string {
    return path.join(this.workdir, 'lib', 'volumes', SERVER_UUID);
  }

  notes(): readonly string[] {
    const notes = [...this.flavor.notes];
    notes.push(
      'archive tasks run warm: the warmup run pulls the tree into page cache, so they compare codecs rather than cold-disk reads',
      'decompress is benchmarked for formats a daemon cannot create, so zip decompress is comparable even where zip compress is not',
      'large directory listings are timed one at a time rather than driven by a load generator, and run warm: the warmup run pulls the entries and inodes into cache, so they compare readdir/stat and serialisation rather than cold metadata reads',
    );
    if (this.dataset?.reflink === true) {
      notes.push(
        'the delete fixture is restored with a reflink clone, so no byte copy or writeback is charged to the timed delete',
      );
    }
    return notes;
  }

  tasks(): TaskRunner {
    return this;
  }

  protected resourceEnv(limit: ResourceLimit): Record<string, string> {
    return {
      WINGS_CPUS: String(limit.cpus),
      WINGS_MEM: limit.memoryMb !== undefined && limit.memoryMb > 0 ? `${limit.memoryMb}m` : '0',
    };
  }

  protected readinessHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${TOKEN}` };
  }

  async start(limit: ResourceLimit): Promise<void> {
    // Wings appends to its log forever and never rotates it, and some forks write a line per
    // request, so a repeated sweep grows the log past the fixtures it is measuring. Dropping it
    // as the variant starts bounds it to one variant's worth and still leaves it for a post-mortem.
    await removePath(path.join(this.workdir, 'log'));
    await Promise.all(
      ['etc', 'lib', 'log', 'tmp'].map((dir) => mkdir(path.join(this.workdir, dir), { recursive: true })),
    );
    await mkdir(this.serverRoot, { recursive: true });

    this.ownsNetwork = !(await networkExists(this.flavor.networkName));
    const port = await this.mock.start();
    console.log(colors.dim(`  remote api mock listening on :${port}`));
    const config = this.flavor.renderConfig({
      nodeUuid: NODE_UUID,
      tokenId: TOKEN_ID,
      token: TOKEN,
      remote: `http://host.docker.internal:${port}`,
      networkName: this.flavor.networkName,
      subnetIndex: this.flavor.subnetIndex,
    });
    await writeConfig(path.join(this.workdir, 'etc', 'config.yml'), config);

    await this.bringUp(limit);
    if (this.settleMs > 0) {
      console.log(colors.dim(`  settling for ${this.settleMs / 1000}s (boot-time disk walks)...`));
      await sleep(this.settleMs);
    }
  }

  async stop(): Promise<void> {
    try {
      await super.stop();
    } finally {
      if (this.ownsNetwork) {
        await networkRemove(this.flavor.networkName).catch(() => undefined);
      }
      await this.mock.stop();
    }
  }

  /**
   * The outputs cost nothing to rebuild, so they always go. The fixtures are cached across runs
   * and cost ~40s to regenerate, so they only go when asked: holding every daemon's set at once
   * is what makes a group sweep need tens of gigabytes.
   */
  override async release(): Promise<void> {
    // Cleanup never decides whether a target passed: its measurements are already in the report.
    await bestEffort('removing task outputs', () => cleanOutputs(this.serverRoot));
    if (this.prune) {
      await bestEffort('pruning fixtures', () => removePath(this.serverRoot));
      await bestEffort('pruning logs', () => removePath(path.join(this.workdir, 'log')));
    }
  }

  async authenticate(): Promise<AuthContext> {
    return { mode: 'authenticated', headers: { Authorization: `Bearer ${TOKEN}` } };
  }

  override async version(): Promise<string | null> {
    const response = await fetch(this.url('/api/system'), { headers: this.readinessHeaders() });
    if (!response.ok) {
      await response.arrayBuffer();
      return null;
    }
    const body = (await response.json()) as { version?: unknown };
    return typeof body.version === 'string' ? body.version : null;
  }

  buildRequest(operation: Operation, auth: AuthContext, params: ScenarioParams = {}): RequestSpec | null {
    switch (operation) {
      case 'system':
        return { method: 'GET', url: this.url('/api/system'), headers: this.authHeaders(auth) };
      case 'listDirectory': {
        const entries = entriesParam(params, operation);
        return {
          method: 'GET',
          url: this.serverUrl(`files/list-directory?directory=${encodeURIComponent(`/${listDirName(entries)}`)}`),
          headers: this.authHeaders(auth),
        };
      }
      case 'fileContents': {
        const file = params.file === 'small' ? SMALL_PATH : CHUNK_PATH;
        return {
          method: 'GET',
          url: this.serverUrl(`files/contents?file=${encodeURIComponent(`/${file}`)}&download=true`),
          headers: this.authHeaders(auth),
        };
      }
      case 'chmod':
        return {
          method: 'POST',
          url: this.serverUrl('files/chmod'),
          headers: { ...this.authHeaders(auth), 'Content-Type': 'application/json' },
          body: JSON.stringify({ root: '/', files: [{ file: SMALL_PATH, mode: '644' }] }),
        };
      default:
        return null;
    }
  }

  async prepare(scenarios: readonly Scenario[]): Promise<Dataset> {
    const trees = new Set<string>();
    const archives = new Set<string>();
    const listSizes = new Set<number>();
    for (const scenario of scenarios) {
      // Listing spans both kinds, so its fixture is claimed before load scenarios are skipped.
      if (scenario.operation === 'listDirectory') {
        listSizes.add(entriesParam(scenario.params, scenario.name));
        continue;
      }
      if (scenario.kind === 'load') {
        continue;
      }
      switch (scenario.operation) {
        case 'compress':
        case 'deleteTree':
          trees.add(treeParam(scenario));
          break;
        case 'decompress':
          trees.add(treeParam(scenario));
          archives.add(archiveKey(treeParam(scenario), formatParam(scenario)));
          break;
        default:
          break;
      }
    }
    const request: DatasetRequest = { trees, archives, listSizes };
    this.dataset = await ensureDataset(this.serverRoot, request);
    return this.dataset;
  }

  unsupported(scenario: TaskScenario, dataset: Dataset): string | null {
    switch (scenario.operation) {
      case 'compress': {
        const format = formatParam(scenario);
        return this.flavor.compressFormats.includes(format) ? null : `${this.label} cannot create ${format} archives`;
      }
      case 'decompress': {
        return dataset.archives.has(archiveKey(treeParam(scenario), formatParam(scenario)))
          ? null
          : 'input archive missing';
      }
      case 'listDirectory': {
        return dataset.lists.has(entriesParam(scenario.params, scenario.name)) ? null : 'list fixture missing';
      }
      default:
        return null;
    }
  }

  async reset(scenario: TaskScenario, dataset: Dataset): Promise<void> {
    const root = dataset.root;
    switch (scenario.operation) {
      case 'compress':
        await removeMatching(root, (name) => name.startsWith(OUTPUT_PATHS.compressOutput) || isGeneratedArchive(name));
        break;
      case 'decompress':
        await removePath(path.join(root, OUTPUT_PATHS.extracted));
        break;
      case 'deleteTree': {
        const tree = dataset.trees.get(treeParam(scenario));
        await removePath(path.join(root, OUTPUT_PATHS.deleteTree));
        if (tree !== undefined) {
          await copyTree(tree.dir, path.join(root, OUTPUT_PATHS.deleteTree));
        }
        break;
      }
      case 'writeFile':
        await removePath(path.join(root, OUTPUT_PATHS.upload), { recursive: false });
        break;
      case 'listDirectory':
        // Nothing to restore, and no writeback to flush.
        return;
      default:
        break;
    }
    await syncFilesystem(root);
  }

  async run(scenario: TaskScenario, dataset: Dataset, auth: AuthContext): Promise<TaskOutcome> {
    const root = dataset.root;
    switch (scenario.operation) {
      case 'compress': {
        const treeId = treeParam(scenario);
        const format = formatParam(scenario);
        const tree = dataset.trees.get(treeId);
        if (tree === undefined) {
          return failure(`tree '${treeId}' missing`);
        }
        const name = `${OUTPUT_PATHS.compressOutput}.${format}`;
        const outcome = await this.request(
          'files/compress',
          auth,
          { root: '/', files: [treeDirName(treeId)], name, format: COMPRESS_FORMAT_NAMES[format] },
          tree.bytes,
        );
        const archiveBytes = await producedArchiveBytes(root);
        return verify(
          outcome,
          archiveBytes >= tree.bytes * MIN_ARCHIVE_RATIO,
          archiveBytes === 0 ? 'archive missing' : `archive implausibly small (${archiveBytes} bytes)`,
        );
      }
      case 'decompress': {
        const treeId = treeParam(scenario);
        const tree = dataset.trees.get(treeId);
        const archive = dataset.archives.get(archiveKey(treeId, formatParam(scenario)));
        if (tree === undefined || archive === undefined) {
          return failure('input archive missing');
        }
        const outcome = await this.request('files/decompress', auth, { root: '/', file: archive }, tree.bytes);
        const extracted = path.join(root, OUTPUT_PATHS.extracted);
        const count = (await fileSize(extracted)) === null ? 0 : await countFiles(extracted);
        return verify(outcome, count === tree.files, `extracted ${count}/${tree.files} files`);
      }
      case 'deleteTree': {
        const tree = dataset.trees.get(treeParam(scenario));
        if (tree === undefined) {
          return failure('tree missing');
        }
        // Deletion cost tracks inode count, not bytes, so no byte total is reported: a MB/s
        // figure derived from the tree size would be meaningless.
        const outcome = await this.request('files/delete', auth, { root: '/', files: [OUTPUT_PATHS.deleteTree] }, 0);
        return verify(
          outcome,
          (await fileSize(path.join(root, OUTPUT_PATHS.deleteTree))) === null,
          'tree still present',
        );
      }
      case 'listDirectory': {
        const entries = entriesParam(scenario.params, scenario.name);
        const { outcome, body } = await this.timedRequest(
          `files/list-directory?directory=${encodeURIComponent(`/${listDirName(entries)}`)}`,
          auth,
          { method: 'GET' },
          0,
        );
        if (!outcome.ok) {
          return outcome;
        }
        const listed = listedEntries(body);
        return verify(
          outcome,
          listed === entries,
          listed === null ? 'listing was not a JSON array' : `listed ${listed}/${entries} entries`,
        );
      }
      case 'writeFile': {
        const body = this.upload(UPLOAD_BYTES);
        const outcome = await this.rawRequest(
          `files/write?file=${encodeURIComponent(`/${OUTPUT_PATHS.upload}`)}`,
          auth,
          body,
          body.length,
        );
        return verify(
          outcome,
          (await fileSize(path.join(root, OUTPUT_PATHS.upload))) === body.length,
          'upload size mismatch',
        );
      }
      default:
        return failure(`unsupported task '${scenario.operation}'`);
    }
  }

  private upload(bytes: number): Uint8Array<ArrayBuffer> {
    if (this.uploadBody === null || this.uploadBody.length !== bytes) {
      this.uploadBody = randomBytes(bytes, UPLOAD_SEED);
    }
    return this.uploadBody;
  }

  private serverUrl(suffix: string): string {
    return this.url(`/api/servers/${SERVER_UUID}/${suffix}`);
  }

  private request(suffix: string, auth: AuthContext, payload: unknown, bytes: number): Promise<TaskOutcome> {
    return this.rawRequest(suffix, auth, JSON.stringify(payload), bytes, { 'Content-Type': 'application/json' });
  }

  private async rawRequest(
    suffix: string,
    auth: AuthContext,
    body: string | Uint8Array<ArrayBuffer>,
    bytes: number,
    headers: Record<string, string> = {},
  ): Promise<TaskOutcome> {
    const { outcome } = await this.timedRequest(suffix, auth, { method: 'POST', headers, body }, bytes);
    return outcome;
  }

  /**
   * Times a request end to end, reading the body inside the window but leaving it undecoded:
   * parsing a multi-megabyte response is the harness's cost, not the daemon's.
   */
  private async timedRequest(
    suffix: string,
    auth: AuthContext,
    init: TaskRequest,
    bytes: number,
  ): Promise<{ outcome: TaskOutcome; body: Uint8Array }> {
    const empty = new Uint8Array(0);
    const started = performance.now();
    try {
      const response = await fetch(this.serverUrl(suffix), {
        method: init.method,
        headers: { ...this.authHeaders(auth), ...init.headers, Accept: 'application/json' },
        body: init.body,
      });
      const body = new Uint8Array(await response.arrayBuffer());
      const elapsedMs = performance.now() - started;
      if (!response.ok) {
        return {
          outcome: { ok: false, status: response.status, elapsedMs, bytes, detail: decodeDetail(body) },
          body: empty,
        };
      }
      return { outcome: { ok: true, status: response.status, elapsedMs, bytes }, body };
    } catch (error) {
      const elapsedMs = performance.now() - started;
      return { outcome: { ok: false, status: 0, elapsedMs, bytes, detail: String(error) }, body: empty };
    }
  }
}

interface TaskRequest {
  readonly method: HttpMethod;
  readonly headers?: Record<string, string>;
  readonly body?: string | Uint8Array<ArrayBuffer>;
}

export function treeParam(scenario: TaskScenario): string {
  const id = scenario.params?.tree;
  if (id === undefined) {
    throw new Error(`task scenario '${scenario.name}' is missing a 'tree' parameter`);
  }
  const treeId = String(id);
  if (!TREE_IDS.includes(treeId)) {
    throw new Error(`unknown tree '${treeId}' in scenario '${scenario.name}' (available: ${TREE_IDS.join(', ')})`);
  }
  return treeId;
}

export function formatParam(scenario: TaskScenario): ArchiveFormat {
  const format = String(scenario.params?.format ?? 'tar.gz');
  if (!ARCHIVE_FORMATS.includes(format as ArchiveFormat)) {
    throw new Error(`unknown archive format '${format}'`);
  }
  return format as ArchiveFormat;
}

export function entriesParam(params: ScenarioParams | undefined, label: string): number {
  const raw = params?.entries;
  if (raw === undefined) {
    throw new Error(`scenario '${label}' is missing an 'entries' parameter`);
  }
  const entries = Number(raw);
  if (!LIST_SIZES.includes(entries)) {
    throw new Error(`unknown list size '${entries}' in scenario '${label}' (available: ${LIST_SIZES.join(', ')})`);
  }
  return entries;
}

/**
 * Counts the entries a listing returned, or null if it was not the bare array every daemon serves
 * here. Guards against a daemon reporting success while truncating at a configured entry cap.
 */
function listedEntries(body: Uint8Array): number | null {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(body));
    return Array.isArray(parsed) ? parsed.length : null;
  } catch {
    return null;
  }
}

function decodeDetail(body: Uint8Array): string {
  return new TextDecoder().decode(body.subarray(0, 200));
}

/** Guards against a daemon reporting success while writing a truncated or empty archive. */
const MIN_ARCHIVE_RATIO = 0.01;

async function producedArchiveBytes(root: string): Promise<number> {
  const entries = await readdir(root);
  const archives = entries.filter(
    (entry) => entry.startsWith(OUTPUT_PATHS.compressOutput) || isGeneratedArchive(entry),
  );
  let bytes = 0;
  for (const entry of archives) {
    bytes += (await fileSize(path.join(root, entry))) ?? 0;
  }
  return bytes;
}

function failure(detail: string): TaskOutcome {
  return { ok: false, status: 0, elapsedMs: 0, bytes: 0, detail };
}

function verify(outcome: TaskOutcome, condition: boolean, detail: string): TaskOutcome {
  if (!outcome.ok || condition) {
    return outcome;
  }
  return { ...outcome, ok: false, detail };
}

async function removeMatching(dir: string, predicate: (name: string) => boolean): Promise<void> {
  const entries = await readdir(dir);
  await Promise.all(entries.filter(predicate).map((name) => removePath(path.join(dir, name))));
}

async function writeConfig(file: string, content: string): Promise<void> {
  await rm(file, { force: true });
  await writeFile(file, content, { mode: 0o600 });
}

function buildServerDocument(): unknown {
  return {
    uuid: SERVER_UUID,
    id: 1,
    settings: {
      uuid: SERVER_UUID,
      meta: { name: 'benchmark', description: 'benchmark server' },
      suspended: false,
      invocation: 'sleep infinity',
      skip_egg_scripts: true,
      environment: {},
      labels: {},
      allocations: {
        force_outgoing_ip: false,
        default: { ip: '127.0.0.1', port: 25565 },
        mappings: { '127.0.0.1': [25565] },
      },
      build: {
        memory_limit: 512,
        swap: 0,
        io_weight: 500,
        cpu_limit: 100,
        threads: null,
        disk_space: 0,
        oom_disabled: true,
      },
      crash_detection_enabled: false,
      mounts: [],
      egg: { id: EGG_UUID, file_denylist: [] },
      container: { image: '~busybox' },
    },
    process_configuration: {
      startup: { done: [], user_interaction: [], strip_ansi: false },
      stop: { type: 'command', value: 'stop' },
      configs: [],
    },
  };
}
