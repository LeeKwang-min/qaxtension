import type { Step } from '../messaging/types';
import { describeStep } from '../capture/recorder';

interface Props {
  recording: boolean;
  steps: Step[];
  injectReady: boolean;
  onToggleRecord: () => void;
  onClear: () => void;
}

/** kind별 배지 색 (네트워크/콘솔 탭과 동일한 톤) */
const KIND_COLOR: Record<Step['kind'], string> = {
  click: '#1e88e5',
  input: '#43a047',
  select: '#43a047',
  check: '#8e24aa',
  navigate: '#c47f00',
};

const KIND_LABEL: Record<Step['kind'], string> = {
  click: '클릭',
  input: '입력',
  select: '선택',
  check: '체크',
  navigate: '이동',
};

/** epoch ms → 'HH:mm:ss' (로컬) */
function fmtTime(ms: number): string {
  try {
    return new Date(ms).toLocaleTimeString();
  } catch {
    return '';
  }
}

export function RecordPanel({ recording, steps, injectReady, onToggleRecord, onClear }: Props) {
  return (
    <div data-testid="record-panel">
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
        <button
          type="button"
          onClick={onToggleRecord}
          disabled={!injectReady && !recording}
          data-testid="record-toggle"
          style={{
            fontWeight: 700,
            color: recording ? '#fff' : '#b00020',
            background: recording ? '#b00020' : '#fff',
            border: '1px solid #b00020',
            borderRadius: 4,
            padding: '3px 10px',
          }}
        >
          {recording ? '⏹ 기록 중지' : '⏺ 기록 시작'}
        </button>
        <button type="button" onClick={onClear} disabled={steps.length === 0}>
          기록 지우기
        </button>
        <span style={{ fontSize: 11, color: '#666' }}>{steps.length}개 단계</span>
      </div>

      {recording && (
        <p style={{ fontSize: 11, color: '#b00020', margin: '0 0 8px' }}>
          ● 기록 중 — 페이지에서 클릭·입력하면 재현 절차가 자동으로 쌓입니다. 페이지를 이동해도 이어집니다.
        </p>
      )}

      {!injectReady && !recording && (
        <p style={{ fontSize: 11, color: '#999' }}>
          페이지에 연결되면 기록을 시작할 수 있습니다. (연결되지 않으면 새로고침하세요)
        </p>
      )}

      {steps.length === 0 ? (
        <p style={{ fontSize: 12, color: '#999' }}>
          {recording ? '아직 기록된 행동이 없습니다. 페이지를 조작해보세요.' : '기록을 시작하면 행동이 여기에 단계로 표시됩니다.'}
        </p>
      ) : (
        <ol style={{ margin: 0, paddingLeft: 22, fontSize: 12 }}>
          {steps.map((s) => (
            <li key={s.id} style={{ padding: '2px 0', lineHeight: 1.5 }}>
              <span
                style={{
                  display: 'inline-block',
                  minWidth: 30,
                  textAlign: 'center',
                  fontSize: 10,
                  fontWeight: 700,
                  color: '#fff',
                  background: KIND_COLOR[s.kind],
                  borderRadius: 3,
                  padding: '0 4px',
                  marginRight: 6,
                }}
              >
                {KIND_LABEL[s.kind]}
              </span>
              <span style={{ wordBreak: 'break-all' }}>{describeStep(s)}</span>
              <span style={{ color: '#aaa', fontSize: 10, marginLeft: 6 }}>{fmtTime(s.at)}</span>
              {s.selector && (
                <div style={{ color: '#888', fontSize: 10, marginLeft: 36, wordBreak: 'break-all' }}>
                  ↳ <code style={{ fontFamily: 'ui-monospace, monospace' }}>{s.selector}</code>
                </div>
              )}
              {s.nearby.length > 0 && (
                <div style={{ color: '#999', fontSize: 10, marginLeft: 36, wordBreak: 'break-all' }}>
                  주변: {s.nearby.map((t) => `"${t}"`).join(', ')}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
