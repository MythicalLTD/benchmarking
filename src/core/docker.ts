import { spawn } from 'node:child_process';

/** Carries the child's stderr so callers can classify a failure instead of only reporting it. */
export class CommandError extends Error {
  readonly stderr: string;

  constructor(message: string, stderr: string) {
    super(message);
    this.name = 'CommandError';
    this.stderr = stderr;
  }
}

/**
 * Docker reports a contended host port two different ways: `address already in use` when a
 * non-docker process holds it, and `port is already allocated` when another container does.
 */
const PORT_CONFLICT = /address already in use|port is already allocated/i;

export function isPortConflict(error: unknown): boolean {
  return error instanceof CommandError && PORT_CONFLICT.test(error.stderr);
}

export interface ComposeConfig {
  readonly file: string;
  readonly project: string;
  readonly env?: Readonly<Record<string, string>>;
}

export interface ExecResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export async function composeUp(config: ComposeConfig): Promise<void> {
  await run('docker', ['compose', '-p', config.project, '-f', config.file, 'up', '-d', '--wait'], config.env);
}

export async function composePull(config: ComposeConfig): Promise<void> {
  await run('docker', ['compose', '-p', config.project, '-f', config.file, 'pull'], config.env);
}

export async function composeDown(config: ComposeConfig): Promise<void> {
  await run('docker', ['compose', '-p', config.project, '-f', config.file, 'down', '-v'], config.env);
}

export function composeExec(config: ComposeConfig, service: string, command: readonly string[]): Promise<ExecResult> {
  const args = ['compose', '-p', config.project, '-f', config.file, 'exec', '-T', service, ...command];
  return capture('docker', args, config.env);
}

export async function composeServices(config: ComposeConfig): Promise<readonly string[]> {
  const result = await capture(
    'docker',
    ['compose', '-p', config.project, '-f', config.file, 'config', '--services'],
    config.env,
  );
  if (result.code !== 0) {
    return [];
  }
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export async function composeContainerId(config: ComposeConfig, service: string): Promise<string | null> {
  const result = await capture(
    'docker',
    ['compose', '-p', config.project, '-f', config.file, 'ps', '-q', service],
    config.env,
  );
  const id = result.stdout.trim();
  return id.length > 0 ? id : null;
}

export interface ImageInfo {
  /** The image reference the container was created from, as written in the compose file. */
  readonly ref: string | null;
  /** Content-addressed image id (`sha256:...`). */
  readonly id: string | null;
  /** Uncompressed size on disk, as `docker image inspect` reports it. */
  readonly sizeBytes: number | null;
}

/** Image of a running container. Null when docker cannot answer; never fatal to a run. */
export async function containerImage(containerId: string): Promise<ImageInfo | null> {
  const container = await capture('docker', ['inspect', '--format', '{{.Image}} {{.Config.Image}}', containerId]);
  if (container.code !== 0) {
    return null;
  }
  const [id, ref] = container.stdout.trim().split(/\s+/);
  if (id === undefined || id.length === 0) {
    return null;
  }
  const image = await capture('docker', ['image', 'inspect', '--format', '{{.Size}}', id]);
  const size = Number(image.stdout.trim());
  return {
    ref: ref ?? null,
    id,
    sizeBytes: image.code === 0 && Number.isFinite(size) && size > 0 ? size : null,
  };
}

export async function networkExists(name: string): Promise<boolean> {
  const result = await capture('docker', ['network', 'inspect', '--format', '{{.Id}}', name]);
  return result.code === 0 && result.stdout.trim().length > 0;
}

export async function networkRemove(name: string): Promise<void> {
  await capture('docker', ['network', 'rm', name]);
}

function run(command: string, args: readonly string[], env?: Readonly<Record<string, string>>): Promise<void> {
  return new Promise((resolve, reject) => {
    // stdout stays inherited: compose picks its progress renderer from stdout's TTY-ness, and
    // writes the rendering itself to stderr, so stderr is teed rather than swallowed.
    const child = spawn(command, args as string[], {
      stdio: ['inherit', 'inherit', 'pipe'],
      env: { ...process.env, ...env },
    });

    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk);
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new CommandError(`${command} ${args.join(' ')} exited with code ${code}`, stderr));
      }
    });
  });
}

function capture(
  command: string,
  args: readonly string[],
  env?: Readonly<Record<string, string>>,
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args as string[], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}
