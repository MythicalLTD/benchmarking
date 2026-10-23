import { createServer } from 'node:net';
import type { TargetKind } from './types.ts';

export const MIB = 1024 * 1024;

const PORT_BASE = 20000;
const PORT_STRIDE = 10;
const PORT_SLOTS = 100;

const PORT_SLOT_TABLE: Readonly<Record<string, number>> = {
  'panel:pterodactyl': 1,
  'panel:pelican': 2,
  'panel:featherpanel': 4,
  'panel:hydrodactyl': 5,
  'daemon:pterodactyl': 7,
  'daemon:pelican': 8,
  'daemon:featherwings': 9,
};

export function benchPort(kind: TargetKind, name: string): number {
  const key = `${kind}:${name}`;
  return PORT_BASE + (PORT_SLOT_TABLE[key] ?? hashSlot(key)) * PORT_STRIDE;
}

export const PORT_ATTEMPTS = PORT_STRIDE;

/**
 * docker-proxy binds v4 and v6 separately, so a port is only usable when both families are free.
 * Binding a listener and closing it leaves no TIME_WAIT, so probing is self-cleaning; it still
 * races anything that grabs the port in between, which is why callers also retry on the failure.
 */
export async function portAvailable(port: number): Promise<boolean> {
  return (await bindable(port, '0.0.0.0', false)) && (await bindable(port, '::', true));
}

function bindable(port: number, host: string, ipv6Only: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', (error: NodeJS.ErrnoException) => {
      // A host without the address family is not a conflict, so only a live occupant counts.
      resolve(error.code !== 'EADDRINUSE');
    });
    server.listen({ port, host, ipv6Only }, () => {
      server.close(() => {
        resolve(true);
      });
    });
  });
}

function hashSlot(key: string): number {
  let hash = 0x811c_9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash = Math.imul(hash ^ key.charCodeAt(i), 0x0100_0193);
  }
  return Math.abs(hash) % PORT_SLOTS;
}

export function parseSetCookies(response: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of response.headers.getSetCookie()) {
    const pair = entry.split(';', 1)[0] ?? '';
    const eq = pair.indexOf('=');
    if (eq > 0) {
      out[pair.slice(0, eq)] = pair.slice(eq + 1);
    }
  }
  return out;
}

export function cookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}
