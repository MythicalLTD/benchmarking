import type { WingsConfigContext } from './wings.ts';

export const GO_WINGS_NOTES: readonly string[] = [
  'compress uses single-threaded pgzip; decompress checks archive size before extracting',
];

export function renderGoWingsConfig(prefix: string, username: string, context: WingsConfigContext): string {
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
  upload_limit: 1024
system:
  root_directory: /var/lib/${prefix}
  log_directory: /var/log/${prefix}
  data: /var/lib/${prefix}/volumes
  archive_directory: /var/lib/${prefix}/archives
  backup_directory: /var/lib/${prefix}/backups
  tmp_directory: /tmp/${prefix}
  username: ${username}
  timezone: Etc/UTC
  sftp:
    bind_address: 0.0.0.0
    bind_port: 2022
docker:
  network:
    interface: 172.${n}.0.1
    name: ${context.networkName}
    network_mode: ${context.networkName}
    interfaces:
      v4:
        subnet: 172.${n}.0.0/16
        gateway: 172.${n}.0.1
      v6:
        subnet: fd42:c0de:${n}::/64
        gateway: fd42:c0de:${n}::1011
remote: ${context.remote}
remote_query:
  timeout: 30
  boot_servers_per_page: 50
`;
}
