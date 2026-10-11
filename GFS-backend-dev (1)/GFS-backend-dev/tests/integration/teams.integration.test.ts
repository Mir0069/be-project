import mongoose from 'mongoose';

import { env } from '@config/index';
import { MongooseTeamsTokenRepository } from '@repositories/mongoose/teams-token.repository';
import { TeamsTokenService } from '@features/teams/teams-token.service';
import { TeamsGraphClient } from '@features/teams/teams.graph-client';
import type { GraphTeam } from '@features/teams/teams.types';
const RUN_INTEGRATION = process.env['TEAMS_INTEGRATION_TESTS'] === '1';
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip;

describeIntegration('teams integration (live Microsoft Graph)', () => {
  let tokenService: TeamsTokenService;
  let graphClient: TeamsGraphClient;

  beforeAll(async () => {
    await mongoose.connect(env.db.mongoUri);

    tokenService = new TeamsTokenService(new MongooseTeamsTokenRepository(), {
      clientId: env.teams.clientId,
      clientSecret: env.teams.clientSecret,
      tenantId: env.teams.tenantId,
      authority: env.teams.authority,
      scope: env.teams.scope,
    });

    if (!tokenService.isConfigured()) {
      throw new Error('TEAMS_* credentials are not set. Configure them before running integration tests.');
    }

    graphClient = new TeamsGraphClient(tokenService, env.teams.graphBaseUrl);
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  it('acquires an app-only access token', async () => {
    const token = await tokenService.getValidAccessToken();
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
  });

  it('lists teams from the tenant', async () => {
    const teams = await graphClient.getAllPages<GraphTeam>('/teams');
    expect(Array.isArray(teams)).toBe(true);
  });
});
