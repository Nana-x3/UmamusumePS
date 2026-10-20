import type { UmaClient } from '../protocol/uma-client';
import type { LoadIndexData } from './models/phase0.apitypes.ts';

/** The home payload: user info, wallet, roster, banners, notifications. */
export async function loadIndex(client: UmaClient): Promise<LoadIndexData> {
  const envelope = await client.call<LoadIndexData>('load/index', { adid: '' });
  return envelope.data;
}
