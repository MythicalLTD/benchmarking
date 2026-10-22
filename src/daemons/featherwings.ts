import path from 'node:path';
import { GO_WINGS_NOTES, renderGoWingsConfig } from '../core/go-wings.ts';
import { WingsDaemon, type WingsDaemonOptions, type WingsFlavor } from '../core/wings.ts';

/**
 * FeatherWings is a Pterodactyl Wings fork maintained by MythicalSystems, so it shares the Go wings
 * config layout and API. Its defaults live under /etc/featherpanel and /var/lib/featherpanel, and it
 * can create zip archives as well as tar.gz. Error reporting (Sentry) ships enabled, so it is turned
 * off here: the benchmark should not report to an external service or pay for it.
 */
const FLAVOR: WingsFlavor = {
  name: 'featherwings',
  username: 'featherpanel',
  networkName: 'featherwings_nw',
  compressFormats: ['tar.gz', 'zip'],
  subnetIndex: 30,
  composeFile: path.resolve(import.meta.dirname, '..', '..', 'docker', 'daemons', 'featherwings.compose.yml'),
  notes: [...GO_WINGS_NOTES, 'sentry error reporting is disabled in the benchmark config'],
  renderConfig: (context) => `${renderGoWingsConfig('featherpanel', 'featherpanel', context)}sentry:
  enabled: false
`,
};

export class FeatherWings extends WingsDaemon {
  constructor(options: WingsDaemonOptions = {}) {
    super(FLAVOR, options);
  }
}
