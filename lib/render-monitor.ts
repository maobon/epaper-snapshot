import { createHash } from 'node:crypto';

export type RenderSource = 'live' | 'fallback';

export type RenderManifest = {
  view: string;
  source: RenderSource;
  fingerprint: string;
};

export function createRenderManifest(view: string, source: RenderSource, data: unknown): RenderManifest {
  const fingerprint = createHash('sha256').update(JSON.stringify({ view, data })).digest('hex').slice(0, 24);
  return { view, source, fingerprint };
}

export function serializeRenderManifest(manifest: RenderManifest) {
  return JSON.stringify(manifest).replaceAll('<', '\\u003c');
}
