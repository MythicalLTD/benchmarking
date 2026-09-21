import { type ScenarioOptions, Suite, type SuiteObserver } from '../../core/suite.ts';
import type { ResourceLimit, Scenario } from '../../core/types.ts';
import { FeatherPanelPanel, type FeatherPanelPanelOptions } from '../../panels/featherpanel.ts';

export interface FeatherPanelSuiteOptions {
  readonly panel?: FeatherPanelPanelOptions;
  readonly scenarios?: readonly Scenario[];
  readonly scenarioOptions?: ScenarioOptions;
  readonly variants?: readonly ResourceLimit[];
  readonly observer?: SuiteObserver;
  readonly pull?: boolean;
}

export function featherpanelSuite(options: FeatherPanelSuiteOptions = {}): Suite {
  return new Suite({
    target: new FeatherPanelPanel(options.panel),
    scenarios: options.scenarios,
    scenarioOptions: options.scenarioOptions,
    variants: options.variants,
    observer: options.observer,
    pull: options.pull,
  });
}
