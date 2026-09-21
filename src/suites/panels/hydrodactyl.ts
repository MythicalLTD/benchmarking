import { type ScenarioOptions, Suite, type SuiteObserver } from '../../core/suite.ts';
import type { ResourceLimit, Scenario } from '../../core/types.ts';
import { HydrodactylPanel, type HydrodactylPanelOptions } from '../../panels/hydrodactyl.ts';

export interface HydrodactylSuiteOptions {
  readonly panel?: HydrodactylPanelOptions;
  readonly scenarios?: readonly Scenario[];
  readonly scenarioOptions?: ScenarioOptions;
  readonly variants?: readonly ResourceLimit[];
  readonly observer?: SuiteObserver;
  readonly pull?: boolean;
}

export function hydrodactylSuite(options: HydrodactylSuiteOptions = {}): Suite {
  return new Suite({
    target: new HydrodactylPanel(options.panel),
    scenarios: options.scenarios,
    scenarioOptions: options.scenarioOptions,
    variants: options.variants,
    observer: options.observer,
    pull: options.pull,
  });
}
