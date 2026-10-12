import type { LanResponse } from './types';

const TEXT = 'text/plain; charset=utf-8';
const JSON_MIME = 'application/json';

function text(status: number, body: string): LanResponse {
  return { status, headers: { 'Content-Type': TEXT }, body };
}

export const ok = (body = 'OK'): LanResponse => text(200, body);

export const json = (value: unknown): LanResponse => ({
  status: 200,
  headers: { 'Content-Type': JSON_MIME },
  body: JSON.stringify(value),
});

export const badRequest = (body: string): LanResponse => text(400, body);
export const unauthorized = (body: string): LanResponse => text(401, body);
export const forbidden = (body: string): LanResponse => text(403, body);
export const notFound = (body: string): LanResponse => text(404, body);
export const serverError = (body: string): LanResponse => text(500, body);
