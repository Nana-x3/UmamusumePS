import type { UmaClient } from "../protocol/uma-client";
import type {
  PreSignupData,
  SignupData,
  StartSessionData,
} from './models/phase0.apitypes';


export async function preSignup(client: UmaClient): Promise<PreSignupData> {
  const envelope = await client.call<PreSignupData>('tool/pre_signup');
  return envelope.data;
}


export async function signup(
  client: UmaClient,
  params: { country: string; optinUserBirth: number; dmaState: number },
): Promise<SignupData> {
  const envelope = await client.call<SignupData>('tool/signup', {
    country: params.country,
    optin_user_birth: params.optinUserBirth,
    dma_state: params.dmaState,
  });

  // The client is now "logged in" as this account.
  client.setViewerId(String(envelope.data.viewer_id));

  return envelope.data;
}


export async function startSession(
  client: UmaClient,
): Promise<StartSessionData> {
  const envelope = await client.call<StartSessionData>('tool/start_session', {
    attestation_type: 0,
    device_token: null,
  });
  return envelope.data;
}

