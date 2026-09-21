import { type ComposeConfig, composeExec } from './docker.ts';
import { DockerTarget, Target } from './target.ts';

export abstract class Panel extends Target {
  readonly kind = 'panel';
}

export abstract class DockerPanel extends DockerTarget {
  readonly kind = 'panel';

  override notes(): readonly string[] {
    if (this.siblingServices.length === 0) {
      return [];
    }
    return [
      `the cpu/memory limit and the resource samples cover the '${this.serviceName}' container only: ` +
        `${this.siblingServices.join(', ')} run unlimited and unmeasured, so panels that push work into them ` +
        'get that work for free in these numbers',
    ];
  }
}

export async function versionFromCommand(
  compose: ComposeConfig,
  service: string,
  command: readonly string[],
  pattern?: RegExp,
): Promise<string | null> {
  const result = await composeExec(compose, service, command);
  if (result.code !== 0) {
    return null;
  }
  const output = result.stdout.trim();
  if (pattern === undefined) {
    return output.length > 0 ? output : null;
  }
  return pattern.exec(output)?.[1] ?? null;
}

/**
 * Laravel-based panels (Pterodactyl, Pelican, Hydrodactyl) all carry their version in
 * `config('app.version')`. `p:info` reports it too, but performs an upstream update check.
 */
export function laravelVersion(compose: ComposeConfig, service: string): Promise<string | null> {
  return versionFromCommand(compose, service, ['php', 'artisan', 'tinker', '--execute', 'echo config("app.version");']);
}
