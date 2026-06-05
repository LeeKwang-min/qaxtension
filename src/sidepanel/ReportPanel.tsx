import { useEffect, useRef, useState } from 'react';
import type {
  EnvInfo,
  RequestRecord,
  LogRecord,
  ElementInfo,
  ReportInput,
} from '../messaging/types';
import { buildReport } from '../report/builder';
import { buildZip, type ZipFile } from '../report/zip';

interface Props {
  env: EnvInfo | null;
  requests: RequestRecord[];
  logs: LogRecord[];
  pickedElement: ElementInfo | null;
  /** background 가 돌려준 원본 스크린샷 dataURL (없으면 null) */
  screenshot: string | null;
  screenshotError: string | null;
  capturing: boolean;
  collectingEnv: boolean;
  onCaptureScreenshot: () => void;
  onCollectEnv: () => void;
}

type Tool = 'arrow' | 'box';
interface Shape {
  tool: Tool;
  color: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const COLORS = ['#e53935', '#1e88e5', '#fdd835'];

/** 'data:image/png;base64,XXXX' → 바이트 */
function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function download(name: string, content: Uint8Array | string, mime: string): void {
  // Uint8Array 는 ArrayBuffer 로 복사해 Blob 타입 호환성을 확보한다.
  let part: BlobPart;
  if (typeof content === 'string') {
    part = content;
  } else {
    const ab = new ArrayBuffer(content.byteLength);
    new Uint8Array(ab).set(content);
    part = ab;
  }
  const blob = new Blob([part], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function drawArrow(ctx: CanvasRenderingContext2D, s: Shape): void {
  const { x0, y0, x1, y1 } = s;
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  const angle = Math.atan2(y1 - y0, x1 - x0);
  const head = 12;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - head * Math.cos(angle - Math.PI / 6), y1 - head * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x1 - head * Math.cos(angle + Math.PI / 6), y1 - head * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

function drawBox(ctx: CanvasRenderingContext2D, s: Shape): void {
  ctx.strokeStyle = s.color;
  ctx.lineWidth = 3;
  ctx.strokeRect(Math.min(s.x0, s.x1), Math.min(s.y0, s.y1), Math.abs(s.x1 - s.x0), Math.abs(s.y1 - s.y0));
}

export function ReportPanel({
  env,
  requests,
  logs,
  pickedElement,
  screenshot,
  screenshotError,
  capturing,
  collectingEnv,
  onCaptureScreenshot,
  onCollectEnv,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [tool, setTool] = useState<Tool>('arrow');
  const [color, setColor] = useState<string>(COLORS[0]);
  const [drag, setDrag] = useState<Shape | null>(null);
  const [copied, setCopied] = useState(false);

  // 새 스크린샷이 오면 주석 초기화
  useEffect(() => {
    setShapes([]);
    imgRef.current = null;
  }, [screenshot]);

  // 이미지 로드 + 캔버스 redraw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !screenshot) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      imgRef.current = img;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      redraw();
    };
    img.src = screenshot;
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenshot]);

  // shapes/drag 변경 시 redraw
  useEffect(redraw, [shapes, drag]);

  function redraw(): void {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    const all = drag ? [...shapes, drag] : shapes;
    for (const s of all) (s.tool === 'arrow' ? drawArrow : drawBox)(ctx, s);
  }

  function toCanvasXY(e: React.PointerEvent): { x: number; y: number } {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function onPointerDown(e: React.PointerEvent): void {
    if (!imgRef.current) return;
    const { x, y } = toCanvasXY(e);
    setDrag({ tool, color, x0: x, y0: y, x1: x, y1: y });
  }
  function onPointerMove(e: React.PointerEvent): void {
    if (!drag) return;
    const { x, y } = toCanvasXY(e);
    setDrag({ ...drag, x1: x, y1: y });
  }
  function onPointerUp(): void {
    if (!drag) return;
    // 점 하나(드래그 거의 없음)는 버린다
    if (Math.abs(drag.x1 - drag.x0) > 3 || Math.abs(drag.y1 - drag.y0) > 3) {
      setShapes((prev) => [...prev, drag]);
    }
    setDrag(null);
  }

  /** 주석이 합쳐진 최종 스크린샷 dataURL (없으면 null) */
  function annotatedDataUrl(): string | null {
    const canvas = canvasRef.current;
    if (!canvas || !imgRef.current) return screenshot;
    try {
      return canvas.toDataURL('image/png');
    } catch {
      return screenshot;
    }
  }

  function reportInput(): ReportInput {
    return {
      generatedAt: Date.now(),
      env,
      pickedElement,
      requests,
      logs,
      screenshot: annotatedDataUrl(),
    };
  }

  const { markdown, attachments } = buildReport(reportInput());

  async function copyMarkdown(): Promise<void> {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  function downloadMd(): void {
    download('bug-report.md', markdown, 'text/markdown');
  }

  function downloadZip(): void {
    const files: ZipFile[] = [{ name: 'report.md', bytes: new TextEncoder().encode(markdown) }];
    for (const a of attachments) files.push({ name: a.name, bytes: dataUrlToBytes(a.dataUrl) });
    download('bug-report.zip', buildZip(files), 'application/zip');
  }

  const failedCount = requests.filter((r) => r.ok === false || r.error != null).length;

  return (
    <div data-testid="report-panel">
      {/* ── 스크린샷 + 주석 ── */}
      <section style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" onClick={onCaptureScreenshot} disabled={capturing}>
            {capturing ? '캡처 중…' : screenshot ? '다시 캡처' : '스크린샷 캡처'}
          </button>
          {screenshot && (
            <>
              <span style={{ fontSize: 11, color: '#666' }}>주석:</span>
              <button type="button" aria-pressed={tool === 'arrow'} onClick={() => setTool('arrow')} style={{ fontWeight: tool === 'arrow' ? 700 : 400 }}>
                화살표
              </button>
              <button type="button" aria-pressed={tool === 'box'} onClick={() => setTool('box')} style={{ fontWeight: tool === 'box' ? 700 : 400 }}>
                박스
              </button>
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`색상 ${c}`}
                  onClick={() => setColor(c)}
                  style={{
                    width: 18,
                    height: 18,
                    background: c,
                    border: color === c ? '2px solid #000' : '1px solid #ccc',
                    borderRadius: 3,
                    padding: 0,
                  }}
                />
              ))}
              <button type="button" onClick={() => setShapes([])} disabled={shapes.length === 0}>
                주석 지우기
              </button>
            </>
          )}
        </div>
        {screenshotError && (
          <p style={{ color: '#b00020', fontSize: 11, marginTop: 4 }}>스크린샷 실패: {screenshotError}</p>
        )}
        {screenshot && (
          <canvas
            ref={canvasRef}
            data-testid="report-canvas"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            style={{
              maxWidth: '100%',
              marginTop: 8,
              border: '1px solid #ddd',
              cursor: 'crosshair',
              touchAction: 'none',
            }}
          />
        )}
      </section>

      {/* ── 환경정보 ── */}
      <section style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <strong style={{ fontSize: 12 }}>환경정보</strong>
          <button type="button" onClick={onCollectEnv} disabled={collectingEnv}>
            {collectingEnv ? '수집 중…' : env ? '다시 수집' : '환경정보 수집'}
          </button>
        </div>
        {env ? (
          <ul style={{ margin: '6px 0 0', paddingLeft: 16, fontSize: 11, color: '#444' }}>
            <li data-testid="env-url">URL: {env.url ?? '(알 수 없음)'}</li>
            <li>OS: {env.os}</li>
            <li>
              뷰포트: {env.viewport.width} × {env.viewport.height} (DPR {env.viewport.dpr})
            </li>
            <li>언어: {env.language}</li>
            <li>
              로그인 추정:{' '}
              {env.loginGuess ? `${env.loginGuess.key} = ${env.loginGuess.value}` : '(감지 안 됨)'}
            </li>
          </ul>
        ) : (
          <p style={{ fontSize: 11, color: '#999', marginTop: 6 }}>
            아직 수집된 환경정보가 없습니다.
          </p>
        )}
      </section>

      {/* ── 요약 + 내보내기 ── */}
      <section>
        <div style={{ fontSize: 11, color: '#666', marginBottom: 6 }}>
          포함: 검사 요소 {pickedElement ? 1 : 0} · 실패 API {failedCount} · 에러·경고 {logs.length}
          {(annotatedDataUrl() ? ' · 스크린샷 1' : '')}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" onClick={copyMarkdown} data-testid="copy-md">
            {copied ? '복사됨 ✓' : '마크다운 복사'}
          </button>
          <button type="button" onClick={downloadMd}>.md 다운로드</button>
          <button type="button" onClick={downloadZip}>.zip 다운로드</button>
        </div>

        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12 }}>마크다운 미리보기</summary>
          <pre
            data-testid="md-preview"
            style={{
              marginTop: 6,
              padding: 8,
              background: '#f6f6f6',
              fontSize: 10,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              maxHeight: 300,
              overflow: 'auto',
            }}
          >
            {markdown}
          </pre>
        </details>
      </section>
    </div>
  );
}
