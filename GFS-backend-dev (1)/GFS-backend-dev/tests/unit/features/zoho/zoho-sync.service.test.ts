import { ZohoSyncService } from '@features/zoho/zoho-sync.service';


const svc = new ZohoSyncService({} as never, {} as never);
const diff = (oldRaw: Record<string, unknown>, newRaw: Record<string, unknown>) =>
  (svc as unknown as {
    diffRaw: (a: Record<string, unknown>, b: Record<string, unknown>) => Array<{
      field: string;
      oldValue: string | null;
      newValue: string | null;
    }>;
  }).diffRaw(oldRaw, newRaw);

const isIgnored = (raw: Record<string, unknown>) =>
  (ZohoSyncService as unknown as { isIgnored: (r: Record<string, unknown>) => boolean }).isIgnored(
    raw,
  );

const mapRawToDoc = (raw: Record<string, unknown>) =>
  (svc as unknown as {
    mapRawToDoc: (r: Record<string, unknown>) => Record<string, unknown>;
  }).mapRawToDoc(raw);

describe('ZohoSyncService — diffRaw (#6 field-level change detection)', () => {
  it('reports a changed scalar field with its old and new value', () => {
    expect(diff({ Phone: '111' }, { Phone: '222' })).toEqual([
      { field: 'Phone', oldValue: '111', newValue: '222' },
    ]);
  });

  it('reports nothing when scalar values are unchanged', () => {
    expect(diff({ Phone: '111', City: 'NYC' }, { Phone: '111', City: 'NYC' })).toEqual([]);
  });

  it('treats empty string as null — captures newly set and cleared fields', () => {
    expect(diff({ City: '' }, { City: 'NYC' })).toEqual([
      { field: 'City', oldValue: null, newValue: 'NYC' },
    ]);
    expect(diff({ City: 'NYC' }, { City: '' })).toEqual([
      { field: 'City', oldValue: 'NYC', newValue: null },
    ]);
  });

  it('skips $-prefixed keys and system noise fields (e.g. Modified_Time)', () => {
    expect(
      diff(
        { $approval: 'a', Modified_Time: 't1', Last_Activity_Time: 'x', Phone: '1' },
        { $approval: 'b', Modified_Time: 't2', Last_Activity_Time: 'y', Phone: '1' },
      ),
    ).toEqual([]);
  });

  it('skips non-scalar (object) values such as Owner on both sides', () => {
    expect(diff({ Owner: { name: 'A' } }, { Owner: { name: 'B' } })).toEqual([]);
  });

  it('captures multiple changed fields in a single diff', () => {
    const changes = diff({ Phone: '1', Company: 'Old Co' }, { Phone: '2', Company: 'New Co' });
    expect(changes.map((c) => c.field).sort()).toEqual(['Company', 'Phone']);
  });
});

describe('ZohoSyncService — mapRawToDoc (address mapping)', () => {
  it('feeds street from the standard Street field only, not the custom Address field', () => {
    const doc = mapRawToDoc({ id: '1', Address: '6 Juneau Way', Street: '' });
    // Zoho org leaves Street blank, so street stays null and the UI hides it —
    // the location must NOT leak into street from the custom Address field.
    expect(doc['street']).toBeNull();
  });

  it('keeps a single address: jobAddress wins over the stale custom Address field', () => {
    // Edited name "616..." lands in Job_Address; the un-edited extracted "6..." is in Address.
    const doc = mapRawToDoc({ id: '1', Address: '6 Juneau Way', Job_Address: '616 Juneau Way' });
    expect(doc['jobAddress']).toBe('616 Juneau Way');
    expect(doc['street']).toBeNull();
  });

  it('falls back to the custom Address field for jobAddress when Job_Address is empty', () => {
    const doc = mapRawToDoc({ id: '1', Address: '6 Juneau Way' });
    expect(doc['jobAddress']).toBe('6 Juneau Way');
  });

  it('surfaces a real standard Street when the lead actually has one', () => {
    const doc = mapRawToDoc({ id: '1', Street: '120 Market St' });
    expect(doc['street']).toBe('120 Market St');
  });
});

describe('ZohoSyncService — isIgnored (#7 ignored statuses)', () => {
  it.each(['spam', 'closed', 'dead', 'completed', 'sold', 'modular system sold', 'not qualified'])(
    'ignores the junk/dead/won status "%s"',
    (status) => {
      expect(isIgnored({ Lead_Status: status })).toBe(true);
    },
  );

  it('is case- and whitespace-insensitive', () => {
    expect(isIgnored({ Lead_Status: '  SPAM ' })).toBe(true);
    expect(isIgnored({ Lead_Status: 'Not Qualified' })).toBe(true);
  });

  it('does NOT ignore an active status like "Need to Quote"', () => {
    expect(isIgnored({ Lead_Status: 'Need to Quote' })).toBe(false);
  });

  it('does not ignore a lead with no status', () => {
    expect(isIgnored({})).toBe(false);
  });
});

describe('ZohoSyncService — syncModifiedSince (catching note-only changes)', () => {
  const NOW = Date.parse('2026-08-10T17:00:00Z');
  const inWindow = new Date(NOW - 60_000).toISOString();

  /**
   * Fakes Zoho, keyed by the sort field, and stops at the seam where the leads
   * have been gathered — runSync itself talks to Mongo.
   */
  const buildSvc = (byField: Record<string, Array<Record<string, unknown>>>) => {
    const fetchFromZoho = jest.fn().mockImplementation(async (_path: string, params: Record<string, string>) => ({
      data: byField[params['sort_by'] as string] ?? [],
      info: { more_records: false },
    }));
    const svc = new ZohoSyncService({ fetchFromZoho } as never, {} as never);
    const runSync = jest
      .spyOn(svc as unknown as { runSync: (...a: unknown[]) => Promise<unknown> }, 'runSync')
      .mockResolvedValue({ scanned: 0, ignored: 0, created: 0, updated: 0, changeEntries: 0 });
    return { svc, fetchFromZoho, runSync };
  };

  const syncedIds = (runSync: jest.SpyInstance): string[] =>
    ((runSync.mock.calls[0] as [Array<Record<string, unknown>>])[0]).map((l) => String(l['id']));

  it('scans both Modified_Time and Last_Activity_Time', async () => {
    const { svc, fetchFromZoho } = buildSvc({});
    await svc.syncModifiedSince(NOW - 15 * 60 * 1000);

    const sortFields = fetchFromZoho.mock.calls.map((c) => (c[1] as Record<string, string>)['sort_by']);
    expect(sortFields).toContain('Modified_Time');
    expect(sortFields).toContain('Last_Activity_Time');
  });

  it('picks up a lead whose only change was a new note, which leaves Modified_Time untouched', async () => {
    const { svc, runSync } = buildSvc({
      Modified_Time: [],
      // Zoho moves Last_Activity_Time on a note but not Modified_Time.
      Last_Activity_Time: [{ id: 'noted-lead', Modified_Time: '2026-08-01T00:00:00Z', Last_Activity_Time: inWindow }],
    });

    await svc.syncModifiedSince(NOW - 15 * 60 * 1000);
    expect(syncedIds(runSync)).toEqual(['noted-lead']);
  });

  it('syncs a lead returned by both scans only once', async () => {
    const lead = { id: 'both', Modified_Time: inWindow, Last_Activity_Time: inWindow };
    const { svc, runSync } = buildSvc({ Modified_Time: [lead], Last_Activity_Time: [lead] });

    await svc.syncModifiedSince(NOW - 15 * 60 * 1000);
    expect(syncedIds(runSync)).toEqual(['both']);
  });

  it('keeps leads that only the Modified_Time scan returns', async () => {
    const { svc, runSync } = buildSvc({
      Modified_Time: [{ id: 'edited', Modified_Time: inWindow, Last_Activity_Time: '2026-08-01T00:00:00Z' }],
      Last_Activity_Time: [],
    });

    await svc.syncModifiedSince(NOW - 15 * 60 * 1000);
    expect(syncedIds(runSync)).toEqual(['edited']);
  });

  it('drops leads whose timestamps fall outside the window', async () => {
    const old = '2026-07-01T00:00:00Z';
    const { svc, runSync } = buildSvc({
      Modified_Time: [{ id: 'stale', Modified_Time: old, Last_Activity_Time: old }],
      Last_Activity_Time: [{ id: 'stale', Modified_Time: old, Last_Activity_Time: old }],
    });

    await svc.syncModifiedSince(NOW - 15 * 60 * 1000);
    expect(syncedIds(runSync)).toEqual([]);
  });
});
