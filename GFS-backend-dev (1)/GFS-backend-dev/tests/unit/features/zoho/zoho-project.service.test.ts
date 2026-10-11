import { ZohoProjectService } from '@features/zoho/zoho-project.service';

const mockLeadFindOne = jest.fn();
const mockLeadFindOneAndUpdate = jest.fn();
const mockLeadUpdateOne = jest.fn();

jest.mock('@db/models/zoho-lead.model', () => ({
  ZohoLead: {
    findOne: (...args: unknown[]) => mockLeadFindOne(...args),
    findOneAndUpdate: (...args: unknown[]) => mockLeadFindOneAndUpdate(...args),
    updateOne: (...args: unknown[]) => mockLeadUpdateOne(...args),
  },
}));

jest.mock('@db/models/project.model', () => ({
  ProjectCreationSource: { ZOHO_FIRST: 'ZOHO_FIRST', MAIL_FIRST: 'MAIL_FIRST', MANUAL: 'MANUAL' },
}));

const mockCreator = { create: jest.fn() };
const mockProjectRepo = { updateById: jest.fn(), findByZohoLeadId: jest.fn() };

let service: ZohoProjectService;

beforeEach(() => {
  jest.clearAllMocks();
  service = new ZohoProjectService(mockCreator as any, mockProjectRepo as any);
});

describe('ZohoProjectService — createProjectFromLead', () => {
  it('returns null and creates nothing when the lead does not exist', async () => {
    mockLeadFindOne.mockReturnValue({ lean: () => Promise.resolve(null) });

    const res = await service.createProjectFromLead('lead-1');

    expect(res).toBeNull();
    expect(mockCreator.create).not.toHaveBeenCalled();
    expect(mockLeadUpdateOne).not.toHaveBeenCalled();
  });

  it('returns null when the lead already has a projectId (idempotency guard)', async () => {
    mockLeadFindOne.mockReturnValue({
      lean: () => Promise.resolve({ zohoLeadId: 'lead-1', projectId: 'proj-existing' }),
    });

    const res = await service.createProjectFromLead('lead-1');

    expect(res).toBeNull();
    expect(mockCreator.create).not.toHaveBeenCalled();
  });

  it('maps the lead into the centralized input, delegates with ZOHO_FIRST, and writes projectId back', async () => {
    const createdTime = new Date('2026-06-22T09:14:00.000Z');
    const lead = {
      zohoLeadId: 'lead-1',
      projectId: null,
      fullName: 'Jane Doe',
      firstName: 'Jane',
      lastName: 'Doe',
      company: 'Acme Corp',
      email: 'jane@acme.com',
      phone: '0400000000',
      website: 'https://acme.com',
      jobAddress: '120 Market St',
      description: 'Replace panels',
      createdTime,
      street: '120 Market St',
      city: 'San Francisco',
      state: 'CA',
      zipCode: '94103',
      country: 'USA',
      raw: {},
    };
    // findOne = fast-path guard; findOneAndUpdate = atomic claim that returns
    // the locked lead used to build the project input.
    mockLeadFindOne.mockReturnValue({ lean: () => Promise.resolve(lead) });
    mockLeadFindOneAndUpdate.mockReturnValue({ lean: () => Promise.resolve(lead) });
    mockCreator.create.mockResolvedValue({
      id: 'new-proj-id',
      referenceNumber: 'GFS-2026-0001',
      creationSource: 'ZOHO_FIRST',
    });

    const res = await service.createProjectFromLead('lead-1');

    expect(mockCreator.create).toHaveBeenCalledWith(
      expect.objectContaining({
        projectName: '120 Market St',
        projectAddress: '120 Market St',
        description: 'Replace panels',
        receivedDate: createdTime,
        client: expect.objectContaining({
          customerName: 'Jane Doe',
          customerEmail: 'jane@acme.com',
          customerPhone: '0400000000',
          company: 'Acme Corp',
          website: 'https://acme.com',
        }),
        address: expect.objectContaining({
          street: '120 Market St',
          city: 'San Francisco',
          state: 'CA',
          zipcode: '94103',
          country: 'USA',
        }),
      }),
      { creationSource: 'ZOHO_FIRST', zohoLeadId: 'lead-1' },
    );
    expect(mockLeadUpdateOne).toHaveBeenCalledWith(
      { zohoLeadId: 'lead-1' },
      { $set: { projectId: 'new-proj-id', projectCreateLockAt: null } },
    );
    expect(res).not.toBeNull();
  });

  it('detects the MAIL_FIRST tag from the raw record', async () => {
    const lead = {
      zohoLeadId: 'lead-2',
      projectId: null,
      company: 'Acme',
      raw: { Platform_Source: 'MAIL_FIRST' },
    };
    mockLeadFindOne.mockReturnValue({ lean: () => Promise.resolve(lead) });
    mockLeadFindOneAndUpdate.mockReturnValue({ lean: () => Promise.resolve(lead) });
    mockCreator.create.mockResolvedValue({ id: 'p2', referenceNumber: 'r', creationSource: 'MAIL_FIRST' });

    await service.createProjectFromLead('lead-2');

    expect(mockCreator.create).toHaveBeenCalledWith(
      expect.any(Object),
      { creationSource: 'MAIL_FIRST', zohoLeadId: 'lead-2' },
    );
  });

  it('creates nothing when the atomic claim is lost to a concurrent caller', async () => {
    // Guard passes (projectId still null) but the claiming findOneAndUpdate
    // matches nothing — another caller already locked/created for this lead.
    mockLeadFindOne.mockReturnValue({ lean: () => Promise.resolve({ zohoLeadId: 'lead-3', projectId: null }) });
    mockLeadFindOneAndUpdate.mockReturnValue({ lean: () => Promise.resolve(null) });

    const res = await service.createProjectFromLead('lead-3');

    expect(res).toBeNull();
    expect(mockCreator.create).not.toHaveBeenCalled();
    expect(mockLeadUpdateOne).not.toHaveBeenCalled();
  });
});

describe('ZohoProjectService — syncProjectFromLead', () => {
  it('updates all mirrored Project fields and stamps lastZohoSyncedAt', async () => {
    mockProjectRepo.updateById.mockResolvedValue({});

    await service.syncProjectFromLead('proj-1', {
      fullName: 'New Name',
      email: 'new@x.com',
      phone: '9',
      company: 'NewCo',
      website: 'https://new.co',
      description: 'updated',
      jobAddress: 'addr',
      leadStatus: 'Need to Quote',
      street: 's',
      city: 'c',
      state: 'st',
      zipCode: 'z',
      country: 'co',
      createdTime: new Date('2026-02-02T00:00:00.000Z'),
    });

    expect(mockProjectRepo.updateById).toHaveBeenCalledWith(
      'proj-1',
      expect.objectContaining({
        customerName: 'New Name',
        customerEmail: 'new@x.com',
        customerPhone: '9',
        company: 'NewCo',
        customerWebsite: 'https://new.co',
        description: 'updated',
        jobAddress: 'addr',
        leadStatus: 'Need to Quote',
        address: expect.objectContaining({
          street: 's',
          city: 'c',
          state: 'st',
          zipcode: 'z',
          country: 'co',
        }),
      }),
    );
    const fields = mockProjectRepo.updateById.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(fields['lastZohoSyncedAt']).toBeInstanceOf(Date);
  });
});
