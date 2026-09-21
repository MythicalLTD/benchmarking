import { type ScenarioOptions, Suite, type SuiteObserver } from '../../core/suite.ts';
import type { ResourceLimit, Scenario } from '../../core/types.ts';
import { PterodactylPanel, type PterodactylPanelOptions } from '../../panels/pterodactyl.ts';

export interface PterodactylSuiteOptions {
  readonly panel?: PterodactylPanelOptions;
  readonly scenarios?: readonly Scenario[];
  readonly scenarioOptions?: ScenarioOptions;
  readonly variants?: readonly ResourceLimit[];
  readonly observer?: SuiteObserver;
  readonly pull?: boolean;
}

export function pterodactylSuite(options: PterodactylSuiteOptions = {}): Suite {
  return new Suite({
    target: new PterodactylPanel(options.panel),
    scenarios: options.scenarios,
    scenarioOptions: options.scenarioOptions,
    variants: options.variants,
    observer: options.observer,
    pull: options.pull,
  });
}
