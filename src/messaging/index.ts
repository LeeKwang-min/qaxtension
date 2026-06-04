import type { InjectEnvelope, CmdEnvelope } from './types';

export const INJECT_SOURCE = 'qaxtension-inject' as const;
export const CMD_SOURCE = 'qaxtension-cmd' as const;

export type {
  InjectEnvelope,
  CmdEnvelope,
  RuntimeMessage,
  TabId,
  TabSessionState,
  PortMessage,
} from './types';

function hasObjectPayload(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) return false;
  const payload = (data as { payload?: unknown }).payload;
  return typeof payload === 'object' && payload !== null;
}

export function isInjectEnvelope(data: unknown): data is InjectEnvelope {
  return (
    hasObjectPayload(data) &&
    (data as { source?: unknown }).source === INJECT_SOURCE
  );
}

export function isCmdEnvelope(data: unknown): data is CmdEnvelope {
  return (
    hasObjectPayload(data) &&
    (data as { source?: unknown }).source === CMD_SOURCE
  );
}
