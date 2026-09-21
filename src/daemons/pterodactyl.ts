import path from 'node:path';
import { GO_WINGS_NOTES, renderGoWingsConfig } from '../core/go-wings.ts';
import { WingsDaemon, type WingsDaemonOptions, type WingsFlavor } from '../core/wings.ts';

const FLAVOR: WingsFlavor = {
  name: 'pterodactyl',
  username: 'pterodactyl',
  networkName: 'pterodactyl_nw',
  compressFormats: ['tar.gz'],
  subnetIndex: 28,
  composeFile: path.resolve(import.meta.dirname, '..', '..', 'docker', 'daemons', 'pterodactyl.compose.yml'),
  notes: GO_WINGS_NOTES,
  renderConfig: (context) => renderGoWingsConfig('pterodactyl', 'pterodactyl', context),
};

export class PterodactylWings extends WingsDaemon {
  constructor(options: WingsDaemonOptions = {}) {
    super(FLAVOR, options);
  }
}
