/**
 * A terminal check for the client -- the same code path the browser uses,
 * minus the browser.
 *
 * Why this exists: the Angular dev server does NOT serve source files by
 * path (every /src/**.ts request 404s -- it only ships the built app), so
 * you cannot `import()` a module from the browser console. This script gives
 * you the same feedback in one command.
 *
 * Usage:
 *   npm run check:client                      # against the dev server (:4200)
 *   RELAY_BASE=http://localhost:4000/g npm run check:client
 */

import { UmaClient } from '../src/app/core/protocol/uma-client';

const baseUrl = process.env['RELAY_BASE'] ?? 'http://localhost:4200/g';

async function main(): Promise<void> {
  const client = new UmaClient({ baseUrl, storage: null });

  console.log('udid      :', client.getUdidHex());
  console.log('relay     :', baseUrl);

  const pre = await client.call('tool/pre_signup');
  const countries = (pre.data as { country_list: unknown[] }).country_list;

  console.log('pre_signup: result_code =', pre.data_headers.result_code);
  console.log('           countries   =', countries.length);
  console.log('           first       =', JSON.stringify(countries[0]));
  console.log('           sid         =', pre.data_headers.sid);

  console.log('\nOK: the client talked to the live server through the relay.');
}

main().catch((error: unknown) => {
  console.error('FAILED:', error);
  process.exitCode = 1;
});
