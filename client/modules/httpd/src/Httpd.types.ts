export interface HttpdUpload {
  /** Temp file in the app cache dir, deleted after the response is written. */
  path: string;
  name: string;
  size: number;
}

export interface HttpdRequest {
  id: string;
  /** Upper-case, e.g. 'GET' | 'POST'. */
  method: string;
  /** Decoded path without query, e.g. '/api/state'. */
  path: string;
  /** Decoded query string params (last value wins). */
  query: Record<string, string>;
  /** Urlencoded body fields or multipart text fields (UTF-8). */
  form: Record<string, string>;
  /** Multipart file fields, keyed by field name. */
  files: Record<string, HttpdUpload>;
  /** Lower-case header names. */
  headers: Record<string, string>;
  /** Raw UTF-8 body for non-form bodies, else ''. */
  body: string;
  /** Client IP, e.g. '192.168.1.5' or '127.0.0.1' / '::1'. */
  remoteAddress: string;
}

export interface HttpdResponse {
  status: number;
  headers?: Record<string, string>;
  body?: string;
  /** Default 'utf8'. */
  bodyEncoding?: 'utf8' | 'base64';
  /** Stream this local file as the body instead of `body` (HEAD and single Range supported). */
  filePath?: string;
}

export interface HttpdStartOptions {
  portFrom: number;
  portTo: number;
  mdnsName?: string;
}

export type HttpdKey = 'up' | 'down' | 'left' | 'right' | 'ok' | 'back' | 'menu';

export type HttpdVolumeDirection = 'up' | 'down' | 'mute';

export interface HttpdSubscription {
  remove(): void;
}
