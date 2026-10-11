import mongoose from 'mongoose';

import { env } from '@config/index';
import { connectDB } from '@db/connection';
import { TeamsTokenModel } from '@db/models/teams-token.model';
import { MongooseTeamsTokenRepository } from '@repositories/mongoose/teams-token.repository';
import { TeamsTokenService } from '@features/teams/teams-token.service';
import { TeamsGraphClient } from '@features/teams/teams.graph-client';

/**
 * READ-ONLY: resolve a numeric Teams "Meeting ID" app-only and test the
 * transcript directly (bypasses the flaky joinWebUrl filter). Tells us 200 vs
 * 403 vs 404.
 *   TEAMS_TEST_USER_ID=... TEAMS_MEETING_ID="486 561 781 553 54" npx ts-node --transpile-only -r tsconfig-paths/register src/scripts/teams-meeting-id-test.ts
 */
const enc = encodeURIComponent;
const errInfo = (err: unknown): string => {
  const e = err as { statusCode?: number; details?: { error?: { code?: string; message?: string } } };
  return `${e.statusCode ?? '?'} ${e.details?.error?.code ?? ''} ${e.details?.error?.message ?? ''}`.trim();
};

const main = async (): Promise<void> => {
  const upn = process.env['TEAMS_TEST_USER_ID'] ?? 'jamunesh@amberflux123.onmicrosoft.com';
  const raw = process.env['TEAMS_MEETING_ID'] ?? '486 561 781 553 54';
  const id = raw.replace(/\s+/g, '');

  const tokenService = new TeamsTokenService(new MongooseTeamsTokenRepository(), {
    clientId: env.teams.clientId,
    clientSecret: env.teams.clientSecret,
    tenantId: env.teams.tenantId,
    authority: env.teams.authority,
    scope: env.teams.scope,
  });
  if (!tokenService.isConfigured()) {
    console.error('creds missing');
    process.exit(1);
  }
  await connectDB();
  await TeamsTokenModel.deleteMany({});
  const graph = new TeamsGraphClient(tokenService, env.teams.graphBaseUrl);

  console.log(`\nupn=${upn}  numericMeetingId=${id}\n`);

  const tryGet = async (
    label: string,
    path: string,
    params?: Record<string, string | undefined>,
  ): Promise<unknown> => {
    try {
      const r = await graph.get<unknown>(path, params);
      console.log(`✅ ${label} → ${JSON.stringify(r).slice(0, 400)}`);
      return r;
    } catch (err) {
      console.log(`❌ ${label} → ${errInfo(err)}`);
      return null;
    }
  };

  // 1) Resolve via VideoTeleconferenceId filter (app-only).
  const vtc = (await tryGet('VideoTeleconferenceId filter', `/users/${enc(upn)}/onlineMeetings`, {
    $filter: `VideoTeleconferenceId eq '${id}'`,
  })) as { value?: Array<{ id?: string; subject?: string }> } | null;

  const realId = vtc?.value?.[0]?.id;
  if (realId) {
    console.log(`\n→ Resolved real onlineMeeting.id: ${realId}`);
    console.log(`→ subject: ${vtc?.value?.[0]?.subject ?? ''}\n`);
    await tryGet(
      'TRANSCRIPTS app-only (real id)',
      `/users/${enc(upn)}/onlineMeetings/${enc(realId)}/transcripts`,
    );
  } else {
    console.log('\n(VTC filter did not resolve a meeting — trying the numeric id directly)\n');
    await tryGet('direct onlineMeeting by numeric id', `/users/${enc(upn)}/onlineMeetings/${id}`);
    await tryGet(
      'direct transcripts by numeric id',
      `/users/${enc(upn)}/onlineMeetings/${id}/transcripts`,
    );
  }

  console.log('\nKEY: 200/✅ = app-only WORKS · 403 Forbidden = policy inactive · 404 = id/lookup not found');

  await mongoose.disconnect();
  process.exit(0);
};

main().catch((err) => {
  console.error('meeting-id-test failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
