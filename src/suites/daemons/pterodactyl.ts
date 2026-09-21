import { type ScenarioOptions, Suite, type SuiteObserver } from '../../core/suite.ts';
import type { ResourceLimit, Scenario } from '../../core/types.ts';
import type { WingsDaemonOptions } from '../../core/wings.ts';
import { PterodactylWings } from '../../daemons/pterodactyl.ts';

export interface PterodactylDaemonSuiteOptions {
  readonly daemon?: WingsDaemonOptions;
  readonly scenarios?: readonly Scenario[];
  readonly scenarioOptions?: ScenarioOptions;
  readonly variants?: readonly ResourceLimit[];
  readonly observer?: SuiteObserver;
  readonly pull?: boolean;
}

export function pterodactylDaemonSuite(options: PterodactylDaemonSuiteOptions = {}): Suite {
  return new Suite({
    target: new PterodactylWings(options.daemon),
    scenarios: options.scenarios,
    scenarioOptions: options.scenarioOptions,
    variants: options.variants,
    observer: options.observer,
    pull: options.pull,
  });
}
