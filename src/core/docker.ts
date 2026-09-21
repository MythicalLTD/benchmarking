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
