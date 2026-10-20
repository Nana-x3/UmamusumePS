import type { UmaClient } from '../protocol/uma-client';
import type { ReadInfoData } from './models/phase0.apitypes.ts';

/** Announcements / the "what's new" lists shown on the home screen. */
export async function readInfoIndex(
  client: UmaClient,
): Promise<ReadInfoData> {
  const envelope = await client.call<ReadInfoData>('read_info/index');
  return envelope.data;
}
