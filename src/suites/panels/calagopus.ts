import { type ScenarioOptions, Suite, type SuiteObserver } from '../../core/suite.ts';
import type { ResourceLimit, Scenario } from '../../core/types.ts';
import { CalagopusPanel, type CalagopusPanelOptions } from '../../panels/calagopus.ts';

export interface CalagopusSuiteOptions {
  readonly panel?: CalagopusPanelOptions;
  readonly scenarios?: readonly Scenario[];
  readonly scenarioOptions?: ScenarioOptions;
  readonly variants?: readonly ResourceLimit[];
  readonly observer?: SuiteObserver;
  readonly pull?: boolean;
}

export function calagopusSuite(options: CalagopusSuiteOptions = {}): Suite {
  return new Suite({
    target: new CalagopusPanel(options.panel),
    scenarios: options.scenarios,
    scenarioOptions: options.scenarioOptions,
    variants: options.variants,
    observer: options.observer,
    pull: options.pull,
  });
}
