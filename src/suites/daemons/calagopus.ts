import { type ScenarioOptions, Suite, type SuiteObserver } from '../../core/suite.ts';
import type { ResourceLimit, Scenario } from '../../core/types.ts';
import type { WingsDaemonOptions } from '../../core/wings.ts';
import { CalagopusWings } from '../../daemons/calagopus.ts';

export interface CalagopusDaemonSuiteOptions {
  readonly daemon?: WingsDaemonOptions;
  readonly scenarios?: readonly Scenario[];
  readonly scenarioOptions?: ScenarioOptions;
  readonly variants?: readonly ResourceLimit[];
  readonly observer?: SuiteObserver;
  readonly pull?: boolean;
}

export function calagopusDaemonSuite(options: CalagopusDaemonSuiteOptions = {}): Suite {
  return new Suite({
    target: new CalagopusWings(options.daemon),
    scenarios: options.scenarios,
    scenarioOptions: options.scenarioOptions,
    variants: options.variants,
    observer: options.observer,
    pull: options.pull,
  });
}
