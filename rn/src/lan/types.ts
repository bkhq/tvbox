/** Request and response shapes shared with the native HTTP transport (modules/httpd). */

export interface LanUpload {
  path: string;
  name: string;
  size: number;
}

export interface LanRequest {
  id: string;
  method: string;
  path: string;
  query: Record<string, string>;
  form: Record<string, string>;
  files: Record<string, LanUpload>;
  /** Header names are lower-case. */
  headers: Record<string, string>;
  body: string;
  remoteAddress: string;
}

export interface LanResponse {
  status: number;
  headers?: Record<string, string>;
  body?: string;
  bodyEncoding?: 'utf8' | 'base64';
  filePath?: string;
}

export type LanParams = Record<string, string>;

/** Query merged with form fields, form wins (NanoHTTPD getParms). */
export function paramsOf(req: Pick<LanRequest, 'query' | 'form'>): LanParams {
  return { ...req.query, ...req.form };
}

/** An /api/<name> handler; thrown errors become 500 responses. */
export type LanEndpoint = (req: LanRequest, params: LanParams) => LanResponse | Promise<LanResponse>;

/** A non-api route (file browser, upload, ...), tried after /api/ and before the web assets. */
export interface LanProcess {
  matches(path: string): boolean;
  handle(req: LanRequest, params: LanParams): LanResponse | Promise<LanResponse>;
}
