import type { InjectEnvelope, CmdEnvelope } from './types';

export const INJECT_SOURCE = 'qaxtension-inject' as const;
export const CMD_SOURCE = 'qaxtension-cmd' as const;

export function isInjectEnvelope(data: unknown): data is InjectEnvelope {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { source?: unknown }).source === INJECT_SOURCE
  );
}

export function isCmdEnvelope(data: unknown): data is CmdEnvelope {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { source?: unknown }).source === CMD_SOURCE
  );
}
