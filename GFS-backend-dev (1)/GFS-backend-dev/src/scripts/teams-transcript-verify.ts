import mongoose from 'mongoose';

import { env } from '@config/index';
import { connectDB } from '@db/connection';
import { TeamsTokenModel } from '@db/models/teams-token.model';
import { MongooseTeamsTokenRepository } from '@repositories/mongoose/teams-token.repository';
import { MongooseTeamsTranscriptRepository } from '@repositories/mongoose/teams-transcript.repository';
import { MongooseProjectRepository } from '@repositories/mongoose/project.repository';
import { TeamsTokenService } from '@features/teams/teams-token.service';
import { TeamsGraphClient } from '@features/teams/teams.graph-client';
import { TeamsAssociationService } from '@features/teams/teams-association.service';
import { LoggingDocumentIngestionPort } from '@features/teams/document-ingestion.port';
import { TeamsTranscriptsService } from '@features/teams/teams-transcripts.service';
import { TeamsMeetingsService } from '@features/teams/teams-meetings.service';
import { MongooseTeamsMeetingRepository } from '@repositories/mongoose/teams-meeting.repository';
import { MongooseTeamsMessageRepository } from '@repositories/mongoose/teams-message.repository';
import { MongooseTeamsMonitoredChannelRepository } from '@repositories/mongoose/teams-monitored-channel.repository';
import { MongooseDocumentRepository } from '@repositories/mongoose/document.repository';
import type { GraphList, GraphOnlineMeeting } from '@features/teams/teams.types';

const main = async (): Promise<void> => {
  const userId = process.env['TEAMS_TEST_USER_ID'];
  const meetingIdEnv = process.env['TEAMS_TEST_MEETING_ID'];
  const joinUrl = process.env['TEAMS_TEST_MEETING_JOIN_URL'];

  if (!userId) {
    console.error('Set TEAMS_TEST_USER_ID (e.g. jamunesh@amberflux123.onmicrosoft.com).');
    process.exit(1);
  }
  if (!meetingIdEnv && !joinUrl) {
    console.error('Set TEAMS_TEST_MEETING_ID or TEAMS_TEST_MEETING_JOIN_URL.');
    process.exit(1);
  }

  const tokenService = new TeamsTokenService(new MongooseTeamsTokenRepository(), {
    clientId: env.teams.clientId,
    clientSecret: env.teams.clientSecret,
    tenantId: env.teams.tenantId,
    authority: env.teams.authority,
    scope: env.teams.scope,
  });
  if (!tokenService.isConfigured()) {
    console.error('TEAMS creds missing in .env');
    process.exit(1);
  }

  await connectDB();
  await TeamsTokenModel.deleteMany({}); // ensure a fresh token carries the latest permissions

  const graph = new TeamsGraphClient(tokenService, env.teams.graphBaseUrl);

  // Resolve meeting id from join URL if not provided directly.
  let meetingId = meetingIdEnv;
  if (!meetingId) {
    console.log(`Looking up meeting by join URL for ${userId}…`);
    const res = await graph.get<GraphList<GraphOnlineMeeting>>(
      `/users/${encodeURIComponent(userId)}/onlineMeetings`,
      { $filter: `joinWebUrl eq '${joinUrl}'` },
    );
    meetingId = res.value?.[0]?.id;
    if (!meetingId) {
      console.error('No meeting found for that joinWebUrl under that user.');
      await mongoose.disconnect();
      process.exit(1);
    }
    console.log(`Resolved meetingId: ${meetingId}`);
  }

  const transcriptRepo = new MongooseTeamsTranscriptRepository();
  const projectRepo = new MongooseProjectRepository();
  const association = new TeamsAssociationService(projectRepo);
  const port = new LoggingDocumentIngestionPort();
  const meetingsService = new TeamsMeetingsService(
    new MongooseTeamsMeetingRepository(),
    transcriptRepo,
    new MongooseTeamsMessageRepository(),
    new MongooseDocumentRepository(),
    new MongooseTeamsMonitoredChannelRepository(),
  );
  const service = new TeamsTranscriptsService(
    graph,
    transcriptRepo,
    projectRepo,
    association,
    port,
    meetingsService,
    true,
  );

  try {
    const summary = await service.fetchAndStore({ userId, meetingId });
    console.log('\n=== Transcript fetch summary ===');
    console.log(JSON.stringify(summary, null, 2));
    if (summary.transcripts.length === 0) {
      console.log(
        '\nNo transcripts found. Make sure the meeting was RECORDED with TRANSCRIPTION turned ON, then wait a few minutes for Teams to finalize.',
      );
    }
  } catch (err) {
    const e = err as { message?: string; details?: unknown };
    console.error('Failed:', e.message ?? String(err));
    if (e.details) console.error('Details:', JSON.stringify(e.details, null, 2));
  }

  await mongoose.disconnect();
  process.exit(0);
};

main().catch((err) => {
  console.error('verify failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
