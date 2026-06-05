import type { ResourceRef, ResourceKind } from '../messaging/types';
import { cssPath } from '../inspect/element-info';

/** 검증 대상이 아닌 스킴(raw 속성 기준 빠른 제외) */
const SKIP_PREFIX = ['javascript:', 'mailto:', 'tel:', 'data:', 'blob:', '#'];

/** 이미지가 DOM 상 깨진(로드 실패) 것으로 확정됐는지 */
function isImageBroken(img: HTMLImageElement): boolean {
  // 로드 완료(complete) 인데 실제 픽셀 폭이 0 이면 깨진 것.
  // 로딩 중(complete=false)엔 판정 보류(false).
  return img.complete === true && img.naturalWidth === 0;
}

/** raw href/src → http(s) 절대 URL (검증 대상 아니면 null) */
function normalizeUrl(raw: string | null, absolute: string): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (SKIP_PREFIX.some((p) => trimmed.toLowerCase().startsWith(p))) return null;
  try {
    const u = new URL(absolute);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href;
  } catch {
    return null;
  }
}

/**
 * 페이지가 참조하는 리소스(이미지·링크·스타일시트·스크립트)를 절대 URL 로 수집한다.
 * 이미지는 DOM 상 깨짐 여부를 즉시 판정한다(권한 불필요).
 * 외부 HTTP 검증(404 등)은 background fetch 의 몫이다.
 */
export function collectResources(doc: Document): ResourceRef[] {
  const out: ResourceRef[] = [];
  const seen = new Set<string>();

  const add = (kind: ResourceKind, url: string | null, el: Element, broken: boolean) => {
    if (url == null) return;
    const dedup = `${kind}|${url}`;
    if (seen.has(dedup)) return;
    seen.add(dedup);
    out.push({ kind, url, selector: cssPath(el), broken });
  };

  for (const img of Array.from(doc.querySelectorAll('img'))) {
    const el = img as HTMLImageElement;
    add('img', normalizeUrl(el.getAttribute('src'), el.src), el, isImageBroken(el));
  }
  for (const link of Array.from(doc.querySelectorAll('link[href]'))) {
    const el = link as HTMLLinkElement;
    add('stylesheet', normalizeUrl(el.getAttribute('href'), el.href), el, false);
  }
  for (const script of Array.from(doc.querySelectorAll('script[src]'))) {
    const el = script as HTMLScriptElement;
    add('script', normalizeUrl(el.getAttribute('src'), el.src), el, false);
  }
  for (const a of Array.from(doc.querySelectorAll('a[href]'))) {
    const el = a as HTMLAnchorElement;
    add('link', normalizeUrl(el.getAttribute('href'), el.href), el, false);
  }

  return out;
}
