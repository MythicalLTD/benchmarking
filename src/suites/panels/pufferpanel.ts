import { type ScenarioOptions, Suite, type SuiteObserver } from '../../core/suite.ts';
import type { ResourceLimit, Scenario } from '../../core/types.ts';
import { PufferPanel, type PufferPanelOptions } from '../../panels/pufferpanel.ts';

export interface PufferPanelSuiteOptions {
  readonly panel?: PufferPanelOptions;
  readonly scenarios?: readonly Scenario[];
  readonly scenarioOptions?: ScenarioOptions;
  readonly variants?: readonly ResourceLimit[];
  readonly observer?: SuiteObserver;
  readonly pull?: boolean;
}

export function pufferpanelSuite(options: PufferPanelSuiteOptions = {}): Suite {
  return new Suite({
    target: new PufferPanel(options.panel),
    scenarios: options.scenarios,
    scenarioOptions: options.scenarioOptions,
    variants: options.variants,
    observer: options.observer,
    pull: options.pull,
  });
}
