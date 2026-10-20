import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { join } from 'node:path';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

/**
 * Example Express Rest API endpoints can be defined here.
 * Uncomment and define endpoints as necessary.
 *
 * Example:
 * ```ts
 * app.get('/api/{*splat}', (req, res) => {
 *   // Handle API request
 * });
 * ```
 */

/**
 * Serve static files from /browser
 */


  //uma-server relay for build
const RELAY_TARGET = 'https://umaserver.nanax3.xyz';
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

app.all(
  '/g/{*splat}',
  express.raw({ type: '*/*', limit: '4mb' }),
  async (req, res) => {
    // Express 5 hands wildcard params over as an ARRAY of path segments
    // (['tool', 'pre_signup']), not as a single string -- so they have to be
    // joined back with slashes before the upstream URL is built.
    const splat: unknown = req.params['splat'];
    const endpoint = Array.isArray(splat)
      ? splat.join('/')
      : typeof splat === 'string'
        ? splat
        : '';

    const upstream = await fetch(`${RELAY_TARGET}/${endpoint}`, {
      method: req.method,
      headers: {
        'Content-Type': req.headers['content-type'] ?? 'application/x-msgpack',
        'User-Agent': BROWSER_UA,
      },
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body,
    });
    res
      .status(upstream.status)
      .set('Content-Type', upstream.headers.get('content-type') ?? 'application/x-msgpack')
      .send(Buffer.from(await upstream.arrayBuffer()));
  },
);




app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
