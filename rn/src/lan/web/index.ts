import { notFound } from '../reply';
import type { LanResponse } from '../types';
import { type WebAsset, webAssets } from './assets.generated';

export { webAssets, type WebAsset };

const INDEX = 'index.html';

/** Serves a bundled web file; "/" is index.html (Nano.getAssets). */
export function serveAsset(path: string, assets: Record<string, WebAsset> = webAssets): LanResponse {
  const name = path.replace(/^\/+/, '') || INDEX;
  const asset = Object.prototype.hasOwnProperty.call(assets, name) ? assets[name] : undefined;
  if (!asset) return notFound('Not Found');
  return { status: 200, headers: { 'Content-Type': asset.mime }, body: asset.base64, bodyEncoding: 'base64' };
}
