import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import colors from 'ansi-colors';

/**
 * Throwaway image used to delete files a daemon container created as root. Wings runs as root
 * inside its container, so anything it writes into a bind-mounted volume (extracted archives,
 * compressed outputs, uploads) comes back root-owned and the user running the suite cannot remove
 * it. Deleting through a container with the same mount sidesteps that without needing sudo.
 */
const CLEANUP_IMAGE = 'busybox:1.37';

const PERMISSION_CODES = new Set(['EACCES', 'EPERM', 'ENOTEMPTY']);

function run(command: string, args: readonly string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, args as string[], { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });
}

function isPermissionError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return typeof code === 'string' && PERMISSION_CODES.has(code);
}

/**
 * `rm -rf` that also copes with root-owned files left behind by a daemon container: on a
 * permission error it deletes through a short-lived container, and in CI (where passwordless sudo
 * is available on GitHub-hosted runners) falls back to `sudo -n rm -rf`.
 */
export async function removePath(target: string, options: { recursive?: boolean } = {}): Promise<void> {
  const recursive = options.recursive ?? true;
  try {
    await rm(target, { recursive, force: true });
    return;
  } catch (error) {
    if (!isPermissionError(error)) {
      throw error;
    }
  }
  const absolute = path.resolve(target);
  const parent = path.dirname(absolute);
  const name = path.basename(absolute);
  if (
    await run('docker', [
      'run',
      '--rm',
      '--network',
      'none',
      '-v',
      `${parent}:/reclaim`,
      CLEANUP_IMAGE,
      'rm',
      '-rf',
      `/reclaim/${name}`,
    ])
  ) {
    return;
  }
  if (process.env.CI && (await run('sudo', ['-n', 'rm', '-rf', '--', absolute]))) {
    return;
  }
  // Last attempt surfaces the original error to the caller.
  await rm(target, { recursive, force: true });
}

/** Runs a cleanup step and downgrades any failure to a warning: measured results are kept. */
export async function bestEffort(what: string, step: () => Promise<void>): Promise<void> {
  try {
    await step();
  } catch (error) {
    console.warn(colors.yellow(`  warning: ${what} failed, continuing (results are unaffected):`), error);
  }
}
