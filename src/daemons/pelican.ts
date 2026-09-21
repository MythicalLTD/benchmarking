import path from 'node:path';
import { GO_WINGS_NOTES, renderGoWingsConfig } from '../core/go-wings.ts';
import { WingsDaemon, type WingsDaemonOptions, type WingsFlavor } from '../core/wings.ts';

const FLAVOR: WingsFlavor = {
  name: 'pelican',
  username: 'pelican',
  networkName: 'pelican_nw',
  compressFormats: ['tar.gz'],
  subnetIndex: 29,
  composeFile: path.resolve(import.meta.dirname, '..', '..', 'docker', 'daemons', 'pelican.compose.yml'),
  notes: GO_WINGS_NOTES,
  renderConfig: (context) => renderGoWingsConfig('pelican', 'pelican', context),
};

export class PelicanWings extends WingsDaemon {
  constructor(options: WingsDaemonOptions = {}) {
    super(FLAVOR, options);
  }
}
