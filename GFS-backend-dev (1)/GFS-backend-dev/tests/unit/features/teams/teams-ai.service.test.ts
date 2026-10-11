import { TeamsAiService } from '@features/teams/teams-ai.service';
import { AppError } from '@shared/errors/app.error';
import type { ITeamsAiJobRepository } from '@repositories/interfaces/i-teams-ai-job.repository';
import type { ITeamsMeetingRepository } from '@repositories/interfaces/i-teams-meeting.repository';
import type { ITeamsMonitoredChannelRepository } from '@repositories/interfaces/i-teams-monitored-channel.repository';

let aiJobRepo: { findById: jest.Mock; complete: jest.Mock };
let meetingRepo: { setAiSummary: jest.Mock };
let channelRepo: { setChatSummary: jest.Mock; findById: jest.Mock };
let approvals: { isSourceProcessed: jest.Mock; createPendingApproval: jest.Mock };
let service: TeamsAiService;

const JOB = {
  id: 'job-1',
  correlationId: 'teamsAiJob:job-1',
  projectId: 'p1',
  teamId: 'team-A',
  channelId: 'chan-A',
  monitoredChannelDbId: 'mc-1',
};

beforeEach(() => {
  aiJobRepo = {
    findById: jest.fn().mockResolvedValue(JOB),
    complete: jest.fn().mockResolvedValue({ ...JOB, status: 'COMPLETED' }),
  };
  meetingRepo = {
    setAiSummary: jest
      .fn()
      .mockResolvedValue({ id: 'meeting-db-1', subject: 'Site walk', projectId: 'p1' }),
  };
  channelRepo = {
    setChatSummary: jest.fn().mockResolvedValue({ id: 'mc-1' }),
    findById: jest.fn().mockResolvedValue({
      id: 'mc-1',
      channelName: 'Project Alpha',
      projectIds: ['p1'],
    }),
  };
  approvals = {
    isSourceProcessed: jest.fn().mockResolvedValue(false),
    createPendingApproval: jest.fn().mockResolvedValue({}),
  };

  service = new TeamsAiService(
    aiJobRepo as unknown as ITeamsAiJobRepository,
    meetingRepo as unknown as ITeamsMeetingRepository,
    channelRepo as unknown as ITeamsMonitoredChannelRepository,
    approvals as unknown as never,
  );
});

describe('TeamsAiService — processAiResult', () => {
  it('fans a chat + meeting result to the channel and the meeting, then completes the job', async () => {
    const outcome = await service.processAiResult({
      correlationId: 'teamsAiJob:job-1',
      readinessState: 'READY',
      results: [
        { target: 'chat', summary: 'chat summary', keyPoints: ['k1'], requirements: ['r1'], confidence: 0.8 },
        { target: 'meeting', meetingId: 'meeting-db-1', summary: 'meeting summary', keyPoints: ['m1'] },
      ],
    });

    expect(aiJobRepo.findById).toHaveBeenCalledWith('job-1');

    expect(channelRepo.setChatSummary).toHaveBeenCalledTimes(1);
    expect(channelRepo.setChatSummary.mock.calls[0][0]).toBe('mc-1');
    expect(channelRepo.setChatSummary.mock.calls[0][1]).toMatchObject({
      summary: 'chat summary',
      keyPoints: ['k1'],
      requirements: ['r1'],
      confidence: 0.8,
    });

    expect(meetingRepo.setAiSummary).toHaveBeenCalledTimes(1);
    expect(meetingRepo.setAiSummary.mock.calls[0][0]).toBe('meeting-db-1');
    expect(meetingRepo.setAiSummary.mock.calls[0][1]).toMatchObject({ summary: 'meeting summary' });

    expect(aiJobRepo.complete).toHaveBeenCalledWith('job-1', expect.objectContaining({ readinessState: 'READY' }));
    expect(outcome).toEqual({ jobId: 'job-1', chatSummaryApplied: true, meetingSummariesApplied: 1, approvalsRaised: 2 });
  });

  it('skips a meeting result missing meetingId but still completes the job', async () => {
    const outcome = await service.processAiResult({
      correlationId: 'teamsAiJob:job-1',
      results: [{ target: 'meeting', summary: 'orphan' }],
    });
    expect(meetingRepo.setAiSummary).not.toHaveBeenCalled();
    expect(outcome.meetingSummariesApplied).toBe(0);
    expect(aiJobRepo.complete).toHaveBeenCalled();
  });

  it('does not overwrite with an empty summary (keeps the existing one)', async () => {
    const outcome = await service.processAiResult({
      correlationId: 'teamsAiJob:job-1',
      results: [
        { target: 'chat', summary: '   ', keyPoints: [], requirements: [] },
        { target: 'meeting', meetingId: 'meeting-db-1', summary: '', keyPoints: [], requirements: [] },
      ],
    });
    expect(channelRepo.setChatSummary).not.toHaveBeenCalled();
    expect(meetingRepo.setAiSummary).not.toHaveBeenCalled();
    expect(outcome).toEqual({ jobId: 'job-1', chatSummaryApplied: false, meetingSummariesApplied: 0, approvalsRaised: 0 });
    // The empty result is still audited on the job.
    expect(aiJobRepo.complete).toHaveBeenCalled();
  });

  it('rejects a correlationId with the wrong prefix', async () => {
    await expect(
      service.processAiResult({ correlationId: 'outlookEmail:abc', results: [] }),
    ).rejects.toBeInstanceOf(AppError);
    expect(aiJobRepo.findById).not.toHaveBeenCalled();
  });

  it('404s when the job does not exist', async () => {
    aiJobRepo.findById.mockResolvedValue(null);
    await expect(
      service.processAiResult({ correlationId: 'teamsAiJob:missing', results: [] }),
    ).rejects.toBeInstanceOf(AppError);
  });
});

describe('TeamsAiService — a new summary is what asks for a retrigger', () => {
  const chatResult = (over: Record<string, unknown> = {}) => ({
    correlationId: 'teamsAiJob:job-1',
    results: [
      {
        target: 'chat' as const,
        summary: 'Client wants 7 panels instead of 5.',
        keyPoints: ['panel count'],
        requirements: ['7 panels of 12x12'],
        confidence: 0.9,
        ...over,
      },
    ],
  });

  const input = (index = 0) => approvals.createPendingApproval.mock.calls[index][0];

  it('parks one approval per project for a new chat summary', async () => {
    const outcome = await service.processAiResult(chatResult());

    expect(approvals.createPendingApproval).toHaveBeenCalledTimes(1);
    expect(outcome.approvalsRaised).toBe(1);
    expect(input()).toMatchObject({
      projectId: 'p1',
      source: 'TEAMS',
      sourceId: expect.stringMatching(/^teamsSummary:chat:p1:[0-9a-f]{16}$/),
      documentIds: [],
      newExtractedData: {},
      subject: 'Teams chat summary: Project Alpha',
      sender: 'Teams',
    });
  });

  it('shows the summary and the requirements to the estimator', async () => {
    await service.processAiResult(chatResult());

    expect(input().aiReasoning).toContain('Client wants 7 panels instead of 5.');
    expect(input().aiReasoning).toContain('7 panels of 12x12');
  });

  it("uses the AI's own confidence rather than a default", async () => {
    await service.processAiResult(chatResult());
    expect(input().aiConfidence).toBe(0.9);
  });

  it('omits confidence when the AI sent none, so the default applies', async () => {
    await service.processAiResult(chatResult({ confidence: undefined }));
    expect(input()).not.toHaveProperty('aiConfidence');
  });

  it('raises nothing for an empty summary, so a trivial chat batch is silent', async () => {
    const outcome = await service.processAiResult(
      chatResult({ summary: '', keyPoints: [], requirements: [] }),
    );

    expect(approvals.createPendingApproval).not.toHaveBeenCalled();
    expect(outcome.approvalsRaised).toBe(0);
    expect(channelRepo.setChatSummary).not.toHaveBeenCalled();
  });

  it('raises one approval per project when the channel is shared', async () => {
    channelRepo.findById.mockResolvedValue({
      id: 'mc-1',
      channelName: 'Shared',
      projectIds: ['p1', 'p2'],
    });

    await service.processAiResult(chatResult());

    expect(approvals.createPendingApproval).toHaveBeenCalledTimes(2);
    expect([input(0).projectId, input(1).projectId]).toEqual(['p1', 'p2']);
  });

  it('raises nothing when the channel is linked to no project', async () => {
    channelRepo.findById.mockResolvedValue({ id: 'mc-1', channelName: 'Orphan', projectIds: [] });

    await service.processAiResult(chatResult());

    expect(approvals.createPendingApproval).not.toHaveBeenCalled();
  });

  it('parks an approval for a meeting summary against the meeting project', async () => {
    await service.processAiResult({
      correlationId: 'teamsAiJob:job-1',
      results: [
        { target: 'meeting', meetingId: 'meeting-db-1', summary: 'Owner approved thicker glass.' },
      ],
    });

    expect(input()).toMatchObject({
      projectId: 'p1',
      sourceId: expect.stringMatching(/^teamsSummary:meeting:meeting-db-1:[0-9a-f]{16}$/),
      subject: 'Teams meeting summary: Site walk',
    });
  });

  it('raises nothing for a meeting that is not linked to a project', async () => {
    meetingRepo.setAiSummary.mockResolvedValue({ id: 'meeting-db-1', subject: 'Ad hoc', projectId: null });

    await service.processAiResult({
      correlationId: 'teamsAiJob:job-1',
      results: [{ target: 'meeting', meetingId: 'meeting-db-1', summary: 'chat about weather' }],
    });

    expect(approvals.createPendingApproval).not.toHaveBeenCalled();
  });

  it('does not raise a second approval for a summary already handled', async () => {
    approvals.isSourceProcessed.mockResolvedValue(true);

    await service.processAiResult(chatResult());

    expect(approvals.createPendingApproval).not.toHaveBeenCalled();
  });

  it('still stores the summary and completes the job when the approval fails', async () => {
    approvals.createPendingApproval.mockRejectedValue(new Error('approval blew up'));

    const outcome = await service.processAiResult(chatResult());

    expect(channelRepo.setChatSummary).toHaveBeenCalledTimes(1);
    expect(aiJobRepo.complete).toHaveBeenCalledTimes(1);
    expect(outcome.chatSummaryApplied).toBe(true);
    expect(outcome.approvalsRaised).toBe(0);
  });
});

describe('TeamsAiService — the same summary must not be reviewed twice', () => {
  const chat = (summary: string) => ({
    correlationId: 'teamsAiJob:job-1',
    results: [{ target: 'chat' as const, summary, keyPoints: [], requirements: [] }],
  });

  const meeting = (summary: string) => ({
    correlationId: 'teamsAiJob:job-1',
    results: [{ target: 'meeting' as const, meetingId: 'meeting-db-1', summary }],
  });

  const keyOf = (index: number) => approvals.createPendingApproval.mock.calls[index][0].sourceId;

  it('gives an unchanged chat summary the same key, even under a different job', async () => {
    await service.processAiResult(chat('Client wants 7 panels.'));

    aiJobRepo.findById.mockResolvedValue({ ...JOB, id: 'job-2' });
    await service.processAiResult({ ...chat('Client wants 7 panels.'), correlationId: 'teamsAiJob:job-2' });

    expect(keyOf(0)).toBe(keyOf(1));
  });

  it('gives a changed chat summary a new key, so it is reviewed again', async () => {
    await service.processAiResult(chat('Client wants 7 panels.'));
    await service.processAiResult(chat('Client now wants 9 panels.'));

    expect(keyOf(0)).not.toBe(keyOf(1));
  });

  it('does not duplicate a meeting approval when a late transcript re-summarises it', async () => {
    await service.processAiResult(meeting('Owner approved thicker glass.'));

    aiJobRepo.findById.mockResolvedValue({ ...JOB, id: 'job-retry' });
    await service.processAiResult({
      ...meeting('Owner approved thicker glass.'),
      correlationId: 'teamsAiJob:job-retry',
    });

    expect(keyOf(0)).toBe(keyOf(1));
  });
});
