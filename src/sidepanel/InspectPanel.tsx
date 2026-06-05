import type { ReactNode } from 'react';
import type { ElementInfo } from '../messaging/types';

interface Props {
  picking: boolean;
  picked: ElementInfo | null;
  onTogglePick: () => void;
}

function Swatch({ hex }: { hex: string }) {
  const isTransparent = hex === 'transparent';
  return (
    <span
      style={{
        display: 'inline-block',
        width: 12,
        height: 12,
        borderRadius: 2,
        marginRight: 6,
        verticalAlign: 'middle',
        border: '1px solid #ccc',
        background: isTransparent ? 'none' : hex,
      }}
    />
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 8, padding: '2px 0', fontSize: 12 }}>
      <span style={{ minWidth: 92, color: '#666' }}>{label}</span>
      <span style={{ wordBreak: 'break-all' }}>{children}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginTop: 12 }}>
      <h3 style={{ fontSize: 12, margin: '0 0 4px', color: '#333' }}>{title}</h3>
      {children}
    </section>
  );
}

export function InspectPanel({ picking, picked, onTogglePick }: Props) {
  return (
    <div>
      <button onClick={onTogglePick} style={{ fontWeight: picking ? 700 : 400 }}>
        {picking ? '선택 중지 (ESC)' : '요소 선택'}
      </button>

      {!picked && (
        <p style={{ color: '#999', fontSize: 12, marginTop: 12 }}>
          {picking ? '페이지에서 검사할 요소를 클릭하세요.' : '"요소 선택"을 눌러 시작하세요.'}
        </p>
      )}

      {picked && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, fontFamily: 'monospace', color: '#0a58ca', wordBreak: 'break-all' }}>
            {picked.selector}
          </div>
          {picked.text && (
            <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>"{picked.text}"</div>
          )}

          <Section title="색상">
            <Row label="텍스트"><Swatch hex={picked.colors.color.hex} />{picked.colors.color.hex}</Row>
            <Row label="배경"><Swatch hex={picked.colors.backgroundColor.hex} />{picked.colors.backgroundColor.hex}</Row>
            <Row label="테두리"><Swatch hex={picked.colors.borderColor.hex} />{picked.colors.borderColor.hex}</Row>
          </Section>

          <Section title="타이포그래피">
            <Row label="글꼴">{picked.typography.fontFamily}</Row>
            <Row label="크기">{picked.typography.fontSize}</Row>
            <Row label="굵기">{picked.typography.fontWeight}</Row>
            <Row label="줄 높이">{picked.typography.lineHeight}</Row>
            <Row label="자간">{picked.typography.letterSpacing}</Row>
          </Section>

          <Section title="박스모델">
            <Row label="크기">{picked.boxModel.width} × {picked.boxModel.height}</Row>
            <Row label="여백(margin)">{picked.boxModel.margin}</Row>
            <Row label="안쪽(padding)">{picked.boxModel.padding}</Row>
            <Row label="모서리">{picked.boxModel.borderRadius}</Row>
            <Row label="테두리">{picked.boxModel.border}</Row>
          </Section>

          <Section title="접근성">
            <Row label="대비비">
              {picked.accessibility.contrast
                ? `${picked.accessibility.contrast.ratio} (${picked.accessibility.contrast.level})`
                : '계산 불가 (배경 투명)'}
            </Row>
            <Row label="alt">{picked.accessibility.alt ?? '—'}</Row>
            <Row label="role">{picked.accessibility.role ?? '—'}</Row>
            <Row label="aria-label">{picked.accessibility.ariaLabel ?? '—'}</Row>
          </Section>
        </div>
      )}
    </div>
  );
}
