import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { collectResources } from '../src/audit/links';

function collect(html: string, url = 'https://site.test/page') {
  const dom = new JSDOM(html, { url });
  return collectResources(dom.window.document);
}

describe('collectResources', () => {
  it('collects img/link/script/anchor references as absolute URLs', () => {
    const refs = collect(
      '<html><head>' +
        '<link rel="stylesheet" href="/style.css">' +
        '<script src="/app.js"></script>' +
        '</head><body>' +
        '<img src="/logo.png">' +
        '<a href="/about">about</a>' +
        '</body></html>',
    );
    const byKind = (k: string) => refs.filter((r) => r.kind === k);
    expect(byKind('stylesheet')[0]?.url).toBe('https://site.test/style.css');
    expect(byKind('script')[0]?.url).toBe('https://site.test/app.js');
    expect(byKind('img')[0]?.url).toBe('https://site.test/logo.png');
    expect(byKind('link')[0]?.url).toBe('https://site.test/about');
  });

  it('excludes non-http references (javascript:, mailto:, tel:, data:, fragment)', () => {
    const refs = collect(
      '<html><body>' +
        '<a href="javascript:void(0)">x</a>' +
        '<a href="mailto:a@b.com">mail</a>' +
        '<a href="tel:123">call</a>' +
        '<a href="#section">jump</a>' +
        '<img src="data:image/png;base64,AAAA">' +
        '</body></html>',
    );
    expect(refs).toHaveLength(0);
  });

  it('skips elements with empty/missing url', () => {
    const refs = collect('<html><body><img src=""><a href="">x</a><script></script></body></html>');
    expect(refs).toHaveLength(0);
  });

  it('marks an image broken when complete && naturalWidth === 0', () => {
    const dom = new JSDOM('<html><body><img src="/a.png"><img src="/b.png"></body></html>', {
      url: 'https://site.test/',
    });
    const imgs = dom.window.document.querySelectorAll('img');
    Object.defineProperty(imgs[0], 'complete', { value: true });
    Object.defineProperty(imgs[0], 'naturalWidth', { value: 0 });
    Object.defineProperty(imgs[1], 'complete', { value: true });
    Object.defineProperty(imgs[1], 'naturalWidth', { value: 120 });
    const refs = collectResources(dom.window.document);
    const a = refs.find((r) => r.url.endsWith('a.png'));
    const b = refs.find((r) => r.url.endsWith('b.png'));
    expect(a?.broken).toBe(true);
    expect(b?.broken).toBe(false);
  });

  it('does not mark image broken while still loading (complete === false)', () => {
    const dom = new JSDOM('<html><body><img src="/c.png"></body></html>', { url: 'https://site.test/' });
    const img = dom.window.document.querySelector('img')!;
    Object.defineProperty(img, 'complete', { value: false });
    Object.defineProperty(img, 'naturalWidth', { value: 0 });
    const refs = collectResources(dom.window.document);
    expect(refs[0]?.broken).toBe(false);
  });

  it('includes a selector for each ref', () => {
    const refs = collect('<html><body><img id="hero" src="/x.png"></body></html>');
    expect(refs[0]?.selector).toBe('#hero');
  });

  it('dedupes identical url+kind references', () => {
    const refs = collect('<html><body><img src="/dup.png"><img src="/dup.png"></body></html>');
    expect(refs.filter((r) => r.url.endsWith('dup.png'))).toHaveLength(1);
  });
});
