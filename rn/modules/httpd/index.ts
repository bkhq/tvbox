// Local HTTP server transport (native module `Httpd`). Native code only parses
// requests and writes responses; routing and auth live in JS:
//
//   const sub = addRequestListener((req) => {
//     respond(req.id, { status: 200, headers: { 'Content-Type': 'text/plain' }, body: 'OK' });
//   });
//   const port = await startServer({ portFrom: 9978, portTo: 9998, mdnsName: 'tvbox' });
//
// Every request must be answered with respond(id, ...) within 30 s, otherwise
// the native side replies 504. Upload temp files are deleted after the response.
export * from './src/Httpd';
export type * from './src/Httpd.types';
