import type { UmaClient } from '../protocol/uma-client';
import type { UserInfo } from './models/phase0.apitypes';

export async function changeName(
  client: UmaClient,
  name: string,
): Promise<UserInfo> {
  const envelope = await client.call<{ user_info: UserInfo }>(
    'user/change_name',
    { name },
  );
  return envelope.data.user_info;
}

export async function changeSex(
  client: UmaClient,
  sex: 1 | 2,
): Promise<UserInfo> {
  const envelope = await client.call<{ user_info: UserInfo }>(
    'user/change_sex',
    { sex },
  );
  return envelope.data.user_info;
}
