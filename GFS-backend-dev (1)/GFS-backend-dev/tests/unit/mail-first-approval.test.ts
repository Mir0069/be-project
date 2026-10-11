jest.mock('@features/proposal/proposal.router', () => ({
  proposalService: { triggerStage0Extraction: jest.fn() },
}));
jest.mock('@features/outlook/outlook.router', () => ({
  outlookService: {},
}));
jest.mock('@features/projects/dropbox-sync.service', () => ({
  dropboxSyncService: { outwardSync: jest.fn() },
}));

import mongoose from 'mongoose';

import { OutlookEmail } from '@db/models/outlook-email.model';
import { ProjectCreationSource } from '@db/models/project.model';
import { MailFirstService } from '@features/mail-first/mail-first.service';
import { env } from '@config/index';

/** The draft/mocks shared by the lead-creation tests below. */
const buildApprovalHarness = () => {
  const draft = {
    _id: new mongoose.Types.ObjectId(),
    status: 'DRAFT',
    zohoLeadId: null,
    proposed: {
      isProject: true,
      projectName: 'Test project',
      customerName: 'Test customer',
      isCompetitiveBid: false,
    },
    attachments: [],
    subject: 'Quote request',
    fromAddress: 'customer@example.com',
    fromName: 'Test customer',
    bodyText: 'Please quote this project.',
  };
  jest.spyOn(OutlookEmail, 'updateOne').mockResolvedValue({} as any);
  jest.spyOn(OutlookEmail, 'findById').mockResolvedValue(draft as any);
  jest.spyOn(mongoose, 'model').mockReturnValue({
    findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
  } as any);
  jest.spyOn(global, 'setTimeout').mockImplementation(((callback: () => void) => {
    callback();
    return 0 as any;
  }) as any);

  const zohoService = {
    insertIntoZoho: jest.fn().mockResolvedValue({ data: [{ details: { id: 'lead-1' } }] }),
    resolveUserIdByEmail: jest.fn().mockResolvedValue('7344067000000096003'),
  };
  const syncService = { syncLeadById: jest.fn().mockResolvedValue(null) };
  const service = new MailFirstService(zohoService as any, syncService as any, {} as any);
  return { draft, zohoService, service };
};

// The owner of a mail-first lead is a business decision, not an accident of
// which account authorized our Zoho connection. See mail-first.service.ts.
describe('MailFirstService lead owner', () => {
  const original = env.zoho.defaultLeadOwner;
  afterEach(() => {
    (env.zoho as any).defaultLeadOwner = original;
    jest.restoreAllMocks();
  });

  it('resolves the configured email and owns the lead with that user', async () => {
    (env.zoho as any).defaultLeadOwner = 'greg@glassflooringsystems.com';
    const { draft, zohoService, service } = buildApprovalHarness();

    await expect(service.approveDraft(String(draft._id))).rejects.toThrow();

    expect(zohoService.resolveUserIdByEmail).toHaveBeenCalledWith('greg@glassflooringsystems.com');
    const [, body] = zohoService.insertIntoZoho.mock.calls[0]!;
    expect(body.data[0].Owner).toEqual({ id: '7344067000000096003' });
  });

  it('omits Owner when unconfigured so Zoho keeps its own default', async () => {
    (env.zoho as any).defaultLeadOwner = '';
    const { draft, zohoService, service } = buildApprovalHarness();

    await expect(service.approveDraft(String(draft._id))).rejects.toThrow();

    expect(zohoService.resolveUserIdByEmail).not.toHaveBeenCalled();
    const [, body] = zohoService.insertIntoZoho.mock.calls[0]!;
    expect(body.data[0]).not.toHaveProperty('Owner');
  });

  it('still creates the lead when the email matches no active Zoho user', async () => {
    (env.zoho as any).defaultLeadOwner = 'ghost@glassflooringsystems.com';
    const { draft, zohoService, service } = buildApprovalHarness();
    zohoService.resolveUserIdByEmail.mockResolvedValue(null);

    await expect(service.approveDraft(String(draft._id))).rejects.toThrow();

    const [, body] = zohoService.insertIntoZoho.mock.calls[0]!;
    expect(body.data[0]).not.toHaveProperty('Owner');
  });
});

describe('MailFirstService approval safety', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps a draft retryable when no local project is created', async () => {
    const draft = {
      _id: new mongoose.Types.ObjectId(),
      status: 'DRAFT',
      zohoLeadId: null,
      proposed: {
        isProject: true,
        projectName: 'Test project',
        customerName: 'Test customer',
        isCompetitiveBid: false,
      },
      attachments: [],
      subject: 'Quote request',
      fromAddress: 'customer@example.com',
      fromName: 'Test customer',
      bodyText: 'Please quote this project.',
    };
    const updateOne = jest.spyOn(OutlookEmail, 'updateOne').mockResolvedValue({} as any);
    jest.spyOn(OutlookEmail, 'findById').mockResolvedValue(draft as any);
    jest.spyOn(mongoose, 'model').mockReturnValue({
      findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
    } as any);
    jest.spyOn(global, 'setTimeout').mockImplementation(((callback: () => void) => {
      callback();
      return 0 as any;
    }) as any);

    const zohoService = {
      insertIntoZoho: jest.fn().mockResolvedValue({
        data: [{ details: { id: 'lead-1' } }],
      }),
    };
    const syncService = { syncLeadById: jest.fn().mockResolvedValue(null) };
    const service = new MailFirstService(zohoService as any, syncService as any, {} as any);

    await expect(service.approveDraft(String(draft._id))).rejects.toThrow('Project creation could not be completed');

    expect(syncService.syncLeadById).toHaveBeenCalledWith('lead-1', 'webhook', ProjectCreationSource.MAIL_FIRST);
    expect(updateOne).toHaveBeenCalledTimes(1);
    expect(updateOne).toHaveBeenCalledWith({ _id: draft._id }, { $set: { zohoLeadId: 'lead-1' } });
  });
});
