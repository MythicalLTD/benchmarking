import { type ScenarioOptions, Suite, type SuiteObserver } from '../../core/suite.ts';
import type { ResourceLimit, Scenario } from '../../core/types.ts';
import { PelicanPanel, type PelicanPanelOptions } from '../../panels/pelican.ts';

export interface PelicanSuiteOptions {
  readonly panel?: PelicanPanelOptions;
  readonly scenarios?: readonly Scenario[];
  readonly scenarioOptions?: ScenarioOptions;
  readonly variants?: readonly ResourceLimit[];
  readonly observer?: SuiteObserver;
  readonly pull?: boolean;
}

export function pelicanSuite(options: PelicanSuiteOptions = {}): Suite {
  return new Suite({
    target: new PelicanPanel(options.panel),
    scenarios: options.scenarios,
    scenarioOptions: options.scenarioOptions,
    variants: options.variants,
    observer: options.observer,
    pull: options.pull,
  });
}
