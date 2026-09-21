import path from 'node:path';
import { WingsDaemon, type WingsDaemonOptions, type WingsFlavor } from '../core/wings.ts';

const FLAVOR: WingsFlavor = {
  name: 'calagopus',
  username: 'calagopus',
  networkName: 'calagopus_nw',
  compressFormats: ['tar.gz', 'zip'],
  subnetIndex: 30,
  composeFile: path.resolve(import.meta.dirname, '..', '..', 'docker', 'daemons', 'calagopus.compose.yml'),
  notes: [
    'defaults: api.file_compression_threads=2, api.file_decompression_threads=2, api.file_copy_threads=4',
    'system.file_history records diffs for overwrites of files <= 1MiB (not triggered by the upload task)',
    'sftp and the firewall helper are disabled for the benchmark; api.directory_entry_limit raised from 10000 to 100000 so the 50000-entry listing is not truncated',
  ],
  renderConfig: (context) => {
    const n = context.subnetIndex;
    return `debug: false
uuid: ${context.nodeUuid}
token_id: ${context.tokenId}
token: ${context.token}
api:
  host: 0.0.0.0
  port: 8080
  ssl:
    enabled: false
  directory_entry_limit: 100000
system:
  timezone: Etc/UTC
  sftp:
    enabled: false
docker:
  network:
    interface: 172.${n}.0.1
    name: ${context.networkName}
    mode: ${context.networkName}
    interfaces:
      v4:
        enabled: true
        subnet: 172.${n}.0.0/16
        gateway: 172.${n}.0.1
      v6:
        enabled: false
        subnet: fd42:c0de:${n}::/64
        gateway: fd42:c0de:${n}::1011
  firewall:
    backend: disabled
remote: ${context.remote}
remote_query:
  timeout: 30
  boot_servers_per_page: 50
  retry_limit: 5
`;
  },
};

export class CalagopusWings extends WingsDaemon {
  constructor(options: WingsDaemonOptions = {}) {
    super(FLAVOR, options);
  }
}
