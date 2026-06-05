import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: 'QA Companion',
  version: '0.1.0',
  description: '비개발자를 위한 웹 서비스 QA 유틸리티',
  minimum_chrome_version: '114',
  action: { default_title: 'QA Companion' },
  background: { service_worker: 'src/background/index.ts', type: 'module' },
  side_panel: { default_path: 'src/sidepanel/index.html' },
  permissions: ['sidePanel', 'storage', 'tabs', 'scripting', 'webRequest', 'clipboardWrite', 'cookies'],
  host_permissions: ['<all_urls>'],
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/index.ts'],
      run_at: 'document_start',
      all_frames: false,
    },
    {
      matches: ['<all_urls>'],
      js: ['src/inject/index.ts'],
      run_at: 'document_start',
      world: 'MAIN',
      all_frames: false,
    },
  ],
});
