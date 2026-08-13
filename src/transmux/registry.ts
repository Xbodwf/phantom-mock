import type { TransmuxAdapter, TransmuxProtocol } from './types.js';

const adapters = new Map<TransmuxProtocol, TransmuxAdapter>();

export function registerAdapter(adapter: TransmuxAdapter): void {
  adapters.set(adapter.protocol, adapter);
}

export function getAdapter(protocol: TransmuxProtocol): TransmuxAdapter {
  const adapter = adapters.get(protocol);
  if (!adapter) throw new Error(`No transmux adapter registered for ${protocol}`);
  return adapter;
}

export function listAdapters(): TransmuxAdapter[] {
  return [...adapters.values()];
}
