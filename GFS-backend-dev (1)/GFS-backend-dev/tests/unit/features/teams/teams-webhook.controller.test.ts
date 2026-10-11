import type { Request, Response } from 'express';

import { env } from '@config/index';
import { TeamsController } from '@features/teams/teams.controller';
import type { TeamsService } from '@features/teams/teams.service';
import type { TeamsTranscriptsService } from '@features/teams/teams-transcripts.service';
import type { TeamsMeetingsService } from '@features/teams/teams-meetings.service';
import type { TeamsSubscriptionService } from '@features/teams/teams-subscription.service';
import type { TeamsAiService } from '@features/teams/teams-ai.service';
import type { TeamsProvisionDecisionService } from '@features/teams/teams-provision-decision.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
const makeRes = (): any => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.type = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const makeReq = (over: Record<string, unknown>): Request =>
  ({ query: {}, body: {}, params: {}, ...over }) as unknown as Request;

// Let the fire-and-forget background processing settle.
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const VALID_STATE = env.teams.webhookClientState;

describe('TeamsController.handleWebhook', () => {
  let teamsService: any;
  let subscriptionService: any;
  let controller: TeamsController;

  beforeEach(() => {
    teamsService = { sync: jest.fn().mockResolvedValue({ channels: [], errors: [] }) };
    subscriptionService = {
      getChannelDbIdForSubscription: jest.fn(),
      handleLifecycleEvent: jest.fn().mockResolvedValue(undefined),
    };
    controller = new TeamsController(
      teamsService as TeamsService,
      {} as TeamsTranscriptsService,
      {} as TeamsMeetingsService,
      subscriptionService as TeamsSubscriptionService,
      {} as TeamsAiService,
      {} as TeamsProvisionDecisionService,
    );
  });

  it('echoes the validationToken as text/plain 200 (handshake)', async () => {
    const res = makeRes();
    await controller.handleWebhook(makeReq({ query: { validationToken: 'abc123' } }), res as Response);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.type).toHaveBeenCalledWith('text/plain');
    expect(res.send).toHaveBeenCalledWith('abc123');
    expect(teamsService.sync).not.toHaveBeenCalled();
  });

  it('ACKs 202 and triggers a channel sync for a valid notification', async () => {
    subscriptionService.getChannelDbIdForSubscription.mockResolvedValue('mc-1');
    const res = makeRes();
    await controller.handleWebhook(
      makeReq({ body: { value: [{ subscriptionId: 's1', clientState: VALID_STATE }] } }),
      res as Response,
    );
    expect(res.status).toHaveBeenCalledWith(202);
    await flush();
    expect(teamsService.sync).toHaveBeenCalledWith('mc-1');
  });

  it('skips a notification with a mismatched clientState', async () => {
    const res = makeRes();
    await controller.handleWebhook(
      makeReq({ body: { value: [{ subscriptionId: 's1', clientState: `${VALID_STATE}-WRONG` }] } }),
      res as Response,
    );
    await flush();
    expect(subscriptionService.getChannelDbIdForSubscription).not.toHaveBeenCalled();
    expect(teamsService.sync).not.toHaveBeenCalled();
  });

  it('dedupes multiple notifications for the same channel into one sync', async () => {
    subscriptionService.getChannelDbIdForSubscription.mockResolvedValue('mc-1');
    const res = makeRes();
    await controller.handleWebhook(
      makeReq({
        body: {
          value: [
            { subscriptionId: 's1', clientState: VALID_STATE },
            { subscriptionId: 's1', clientState: VALID_STATE },
          ],
        },
      }),
      res as Response,
    );
    await flush();
    expect(teamsService.sync).toHaveBeenCalledTimes(1);
  });

  it('ignores an unknown subscriptionId', async () => {
    subscriptionService.getChannelDbIdForSubscription.mockResolvedValue(null);
    const res = makeRes();
    await controller.handleWebhook(
      makeReq({ body: { value: [{ subscriptionId: 'unknown', clientState: VALID_STATE }] } }),
      res as Response,
    );
    await flush();
    expect(teamsService.sync).not.toHaveBeenCalled();
  });

  it('routes a lifecycle event to the subscription service without syncing', async () => {
    const res = makeRes();
    await controller.handleWebhook(
      makeReq({
        body: {
          value: [
            { subscriptionId: 's1', clientState: VALID_STATE, lifecycleEvent: 'reauthorizationRequired' },
          ],
        },
      }),
      res as Response,
    );
    await flush();
    expect(subscriptionService.handleLifecycleEvent).toHaveBeenCalledWith('s1', 'reauthorizationRequired');
    expect(teamsService.sync).not.toHaveBeenCalled();
  });
});
