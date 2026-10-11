import mongoose from 'mongoose';

import { connectDB } from '@db/connection';
import { zohoTokenRepository } from '@repositories/index';
import { ZohoService } from '@features/zoho/zoho.service';

/**
 * Read-only diagnostic: count Leads created in a date window, broken down by
 * Lead_Status, and report the total excluding "Dead"/"Closed".
 *
 * Nothing is written to Zoho or to our DB — this only reads.
 *
 * Run:
 *   npx ts-node --files -r tsconfig-paths/register src/scripts/zoho-lead-count.ts
 */

// --- Tweakables ------------------------------------------------------------
// Org is a .in account, so timestamps use the +05:30 offset.
const FROM = '2026-01-01T00:00:00+05:30';
const TO = '2026-06-15T23:59:59+05:30';
const DATE_FIELD = 'Created_Time'; // switch to 'Modified_Time' if that's what you meant
const EXCLUDE_STATUSES = ['dead', 'closed']; // matched case-insensitively
const PAGE = 200; // Zoho COQL max rows per call
// ---------------------------------------------------------------------------

interface Lead {
  id: string;
  Lead_Status?: string | null;
  Created_Time?: string | null;
  Modified_Time?: string | null;
}

interface RecordsResponse {
  data?: Lead[];
  info?: { more_records?: boolean; page?: number; count?: number };
}

const main = async (): Promise<void> => {
  await connectDB();

  const zoho = new ZohoService(zohoTokenRepository);

  const fromMs = new Date(FROM).getTime();
  const toMs = new Date(TO).getTime();

  const all: Lead[] = [];
  let page = 1;
  let cappedEarly = false;

  // Records API is covered by ZohoCRM.modules.ALL. We sort by the date field
  // descending and walk pages until we cross below the FROM boundary.
  for (;;) {
    const resp = await zoho.fetchFromZoho<RecordsResponse | string>('/crm/v2/Leads', {
      fields: `Lead_Status,${DATE_FIELD}`,
      sort_by: DATE_FIELD,
      sort_order: 'desc',
      page: String(page),
      per_page: String(PAGE),
    });

    // Zoho returns HTTP 204 (empty body) when there are no rows.
    const rows = typeof resp === 'object' && resp !== null ? (resp.data ?? []) : [];
    if (rows.length === 0) break;

    let crossedBelowFrom = false;
    for (const lead of rows) {
      const ts = new Date((lead[DATE_FIELD] as string | null | undefined) ?? '').getTime();
      if (Number.isNaN(ts)) continue;
      if (ts < fromMs) {
        crossedBelowFrom = true; // sorted desc → everything after this is older
        continue;
      }
      if (ts <= toMs) all.push(lead);
    }

    process.stdout.write(`  page ${page}: scanned ${rows.length}, kept ${all.length} in window...\n`);

    const more = typeof resp === 'object' && resp !== null ? resp.info?.more_records : false;
    if (crossedBelowFrom || !more) break;

    page += 1;
    if (page > 50) {
      cappedEarly = true; // 50 * 200 = 10k records scanned without crossing FROM
      process.stdout.write('  ! Reached page cap (50). Window may extend further back.\n');
      break;
    }
  }

  // Tally by status.
  const byStatus = new Map<string, number>();
  for (const lead of all) {
    const key = lead.Lead_Status?.trim() || '(no status)';
    byStatus.set(key, (byStatus.get(key) ?? 0) + 1);
  }

  const excluded = all.filter((l) => EXCLUDE_STATUSES.includes((l.Lead_Status ?? '').trim().toLowerCase())).length;

  console.log('\n=========================================');
  console.log(`Leads ${DATE_FIELD} between ${FROM}  and  ${TO}`);
  console.log('=========================================');
  console.log('\nStatus breakdown:');
  for (const [status, count] of [...byStatus.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${count.toString().padStart(5)}  ${status}`);
  }
  console.log('\n-----------------------------------------');
  console.log(`  TOTAL created in window:            ${all.length}`);
  console.log(`  Excluded (Dead/Closed):             ${excluded}`);
  console.log(`  >> COUNT excluding Dead/Closed:     ${all.length - excluded}`);
  console.log('-----------------------------------------');
  if (cappedEarly) {
    console.log('  NOTE: page cap hit — there may be MORE leads in this window than counted above.');
  }
  console.log('');

  await mongoose.disconnect();
  process.exit(0);
};

main().catch((err) => {
  console.error('\nzoho-lead-count failed:', err instanceof Error ? err.message : err);
  if (err && typeof err === 'object' && 'details' in err) {
    console.error('details:', JSON.stringify((err as { details: unknown }).details));
  }
  process.exit(1);
});
