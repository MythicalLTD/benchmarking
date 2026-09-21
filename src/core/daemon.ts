import { DockerTarget, Target } from './target.ts';

export abstract class Daemon extends Target {
  readonly kind = 'daemon';
}

export abstract class DockerDaemon extends DockerTarget {
  readonly kind = 'daemon';
}
