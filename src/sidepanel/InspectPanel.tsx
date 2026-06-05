import type { ReactNode } from 'react';
import type { ElementInfo, DomTreeNode } from '../messaging/types';
import { DomTree } from './DomTree';

interface Props {
  picking: boolean;
  picked: ElementInfo | null;
  hovered: ElementInfo | null;
  injectReady: boolean;
  onTogglePick: () => void;
  onClearPicked: () => void;
  /** DOM 트리: path 키 → 자식들 (루트는 '') */
  treeChildren: Record<string, DomTreeNode[]>;
  /** 트리 remount 키 (페이지 바뀌면 확장 상태 초기화) */
  treeKey: string;
  onTreeExpand: (path: number[]) => void;
  onTreeSelect: (path: number[]) => void;
  onTreeHighlight: (path: number[] | null) => void;
  /** 페이지에서 가리킨 요소의 트리 경로 (동기화용) */
  treeSyncPath: number[] | null;
  /** "모두 접기" 신호 (변경 시 트리 접힘) */
  treeCollapseSignal: number;
  onTreeCollapse: () => void;
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

export function InspectPanel({
  picking,
  picked,
  hovered,
  injectReady,
  onTogglePick,
  onClearPicked,
  treeChildren,
  treeKey,
  onTreeExpand,
  onTreeSelect,
  onTreeHighlight,
  treeSyncPath,
  treeCollapseSignal,
  onTreeCollapse,
}: Props) {
  // 고정 선택(picked)이 우선, 없으면 호버 미리보기(picking 중에만)
  const display = picked ?? (picking ? hovered : null);
  const isPreview = !picked && display != null;
  return (
    <div>
      <span style={{ display: 'inline-flex', gap: 6 }}>
        <button
          type="button"
          aria-pressed={picking}
          onClick={onTogglePick}
          disabled={!injectReady}
          style={{ fontWeight: picking ? 700 : 400 }}
        >
          {picking ? '선택 중지 (ESC)' : '요소 선택'}
        </button>
        {picked && (
          <button type="button" onClick={onClearPicked}>
            선택 해제
          </button>
        )}
      </span>

      {!injectReady && (
        <p style={{ color: '#c00', fontSize: 12, marginTop: 12 }}>
          페이지가 연결되지 않았습니다. 페이지를 새로고침한 뒤 다시 시도하세요.
        </p>
      )}

      {injectReady && (
        <section style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 4px' }}>
            <h3 style={{ fontSize: 12, margin: 0, color: '#333' }}>DOM 트리</h3>
            <button type="button" onClick={onTreeCollapse} style={{ fontSize: 10, padding: '1px 6px' }}>
              모두 접기
            </button>
          </div>
          <DomTree
            key={treeKey}
            childrenMap={treeChildren}
            onExpand={onTreeExpand}
            onSelect={onTreeSelect}
            onHighlight={onTreeHighlight}
            syncPath={treeSyncPath}
            collapseSignal={treeCollapseSignal}
          />
        </section>
      )}

      {injectReady && !display && (
        <p style={{ color: '#999', fontSize: 12, marginTop: 12 }}>
          {picking
            ? '페이지에서 요소 위에 마우스를 올리면 정보가 표시되고, 클릭하면 고정됩니다.'
            : '"요소 선택"을 눌러 시작하세요.'}
        </p>
      )}

      {display && (
        <div style={{ marginTop: 12 }}>
          {isPreview && (
            <div style={{ fontSize: 11, color: '#c47f00', marginBottom: 2 }}>
              호버 미리보기 · 클릭하면 고정
            </div>
          )}
          <div style={{ fontSize: 12, fontFamily: 'monospace', color: '#0a58ca', wordBreak: 'break-all' }}>
            {display.selector}
          </div>
          {display.text && (
            <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>"{display.text}"</div>
          )}

          <Section title="색상">
            <Row label="텍스트"><Swatch hex={display.colors.color.hex} />{display.colors.color.hex}</Row>
            <Row label="배경"><Swatch hex={display.colors.backgroundColor.hex} />{display.colors.backgroundColor.hex}</Row>
            <Row label="테두리"><Swatch hex={display.colors.borderColor.hex} />{display.colors.borderColor.hex}</Row>
          </Section>

          <Section title="타이포그래피">
            <Row label="글꼴">{display.typography.fontFamily}</Row>
            <Row label="크기">{display.typography.fontSize}</Row>
            <Row label="굵기">{display.typography.fontWeight}</Row>
            <Row label="줄 높이">{display.typography.lineHeight}</Row>
            <Row label="자간">{display.typography.letterSpacing}</Row>
          </Section>

          <Section title="박스모델">
            <Row label="크기">{display.boxModel.width} × {display.boxModel.height}</Row>
            <Row label="여백(margin)">{display.boxModel.margin}</Row>
            <Row label="안쪽(padding)">{display.boxModel.padding}</Row>
            <Row label="모서리">{display.boxModel.borderRadius}</Row>
            <Row label="테두리">{display.boxModel.border}</Row>
          </Section>

          <Section title="접근성">
            <Row label="대비비">
              {display.accessibility.contrast
                ? `${display.accessibility.contrast.ratio} (${display.accessibility.contrast.level})`
                : '계산 불가 (배경 투명)'}
            </Row>
            <Row label="alt">{display.accessibility.alt ?? '—'}</Row>
            <Row label="role">{display.accessibility.role ?? '—'}</Row>
            <Row label="aria-label">{display.accessibility.ariaLabel ?? '—'}</Row>
          </Section>
        </div>
      )}
    </div>
  );
}
