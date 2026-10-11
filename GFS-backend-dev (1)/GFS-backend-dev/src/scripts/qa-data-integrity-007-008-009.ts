import mongoose from 'mongoose';

import { connectDB } from '@db/connection';
import { Project } from '@db/models/project.model';
import { ProposalModel } from '@db/models/proposal.model';
import { ProjectParameter } from '@db/models/project-parameter.model';
import { MongooseProposalRepository } from '@repositories/mongoose/proposal.repository';
import { MongooseSequenceRepository } from '@repositories/mongoose/sequence.repository';
import { MongooseProjectRepository } from '@repositories/mongoose/project.repository';
import { ProjectCreationService } from '@features/project-creation/project-creation.service';
import { Sequence } from '@db/models/sequence.model';
import { ProposalService } from '@features/proposal/proposal.service';

/**
 * GFS-TT-DATA-007 / 008 / 009 execution harness.
 *
 * Runs against the live `gfs` database by decision, so EVERY record it creates
 * is prefixed QA-DATA- and tracked in `created`. No real project is read or
 * written.
 *
 * Fixtures are RETAINED by default: a deleted fixture leaves a screenshot as the
 * only proof of a result, and the evidence behind a pass or fail should stay
 * inspectable. Pass --cleanup to delete this run's fixtures instead. The summary
 * runs in `finally`, so a thrown assertion still reports what was created.
 *
 * NOTE: since the reference-number fix, a failed create hands its number back,
 * so a run no longer burns one. That release is exactly what 009b asserts.
 *
 * Usage: npx ts-node --transpile-only -r tsconfig-paths/register src/scripts/qa-data-integrity-007-008-009.ts
 *        ... same command with --cleanup   to remove this run's fixtures
 */

// Fixtures are kept by default; pass --cleanup to delete this run's fixtures.
const CLEANUP = process.argv.includes('--cleanup');
const RUN = `QA-DATA-${Date.now()}`;
const created: Array<{ model: any; id: any; what: string }> = [];
const results: Array<{ id: string; title: string; pass: boolean; note: string }> = [];

const log = (msg = '') => console.log(msg);
const head = (t: string) => { log(); log('='.repeat(94)); log(t); log('='.repeat(94)); };
const check = (ok: boolean, label: string) => { log(`     [${ok ? 'PASS' : 'FAIL'}] ${label}`); return ok; };

/** A minimal but VALID project: every required field, obviously-QA naming. */
const makeProject = async (suffix: string) => {
  const doc = await Project.create({
    referenceNumber: `${RUN}-${suffix}`,
    projectName: `${RUN} ${suffix} (automated test fixture, safe to delete)`,
    customerName: 'QA Harness',
    projectType: 'NEW_ESTIMATE',
    isActive: true,
  } as any);
  created.push({ model: Project, id: doc._id, what: `Project ${doc.referenceNumber}` });
  return doc;
};

(async () => {
  await connectDB();
  const repo = new MongooseProposalRepository();

  try {
    // ─────────────────────────────────────────────────────────────────────────
    head('GFS-TT-DATA-007  Revision history (P1)  — versions retained without overwriting prior versions');

    const p7 = await makeProject('007');
    const proposal = await repo.ensureProposalExists(String(p7._id));
    created.push({ model: ProposalModel, id: (proposal as any)._id, what: 'Proposal for 007' });

    log(`  fixture project : ${p7.referenceNumber}  (_id ${p7._id})`);
    log(`  query BEFORE    : db.proposals.findOne({projectId:ObjectId("${p7._id}")},{versions:1})`);
    const before: any = await ProposalModel.findOne({ projectId: p7._id }).lean();
    log(`  versions before : stage_1=${(before.versions?.stage_1 ?? []).length}  stage_2=${(before.versions?.stage_2 ?? []).length}`);

    // Three successive edits to the SAME field. If history is retained, all three
    // snapshots survive and the earliest still holds the original value.
    const values = ['GLASS_NO_IGU', 'GLASS_WITH_IGU', 'GLASS_NO_IGU_V3'];
    for (const [i, v] of values.entries()) {
      const next: any = JSON.parse(JSON.stringify((await ProposalModel.findOne({ projectId: p7._id }).lean() as any).schema));
      next.stage_2 = next.stage_2 ?? {};
      next.stage_2.glass_type = { ...(next.stage_2.glass_type ?? {}), value: v };
      log(`  REQUEST  #${i + 1}   : appendVersion({ projectId, stage: 2, source: 'AI', updatedBy: '${RUN}', glass_type.value: '${v}' })`);
      const res = await repo.appendVersion({
        projectId: String(p7._id), nextSchema: next, changedFieldPaths: ['stage_2.glass_type'],
        source: 'AI', updatedBy: RUN, stage: 2,
      } as any);
      log(`  RESPONSE #${i + 1}   : stage_2 versions now = ${(res as any).versions.stage_2.length}`);
    }

    const after7: any = await ProposalModel.findOne({ projectId: p7._id }).lean();
    const snaps = (after7.versions.stage_2 ?? []).map((v: any) => v.snapshot?.glass_type?.value);
    log(`  query AFTER     : db.proposals.findOne({projectId:ObjectId("${p7._id}")},{"versions.stage_2":1})`);
    log(`  snapshots       : ${JSON.stringify(snaps)}`);

    const r7a = check((after7.versions.stage_2 ?? []).length === 3, 'all 3 versions retained, none overwritten');
    const r7b = check(snaps[0] === 'GLASS_NO_IGU', 'earliest version still holds the ORIGINAL value');
    const r7c = check(after7.schema.stage_2.glass_type.value === 'GLASS_NO_IGU_V3', 'current schema holds the LATEST value');
    const ts = (after7.versions.stage_2 ?? []).map((v: any) => +new Date(v.timestamp));
    const r7d = check(ts.every((t: number, i: number) => i === 0 || t >= ts[i - 1]), 'version timestamps are non-decreasing');
    const last = (after7.versions.stage_2 ?? []).at(-1);
    const r7e = check(
      JSON.stringify(last?.snapshot?.glass_type?.value) === JSON.stringify(after7.schema.stage_2.glass_type.value),
      'last snapshot equals current schema (drift detector)',
    );
    results.push({ id: 'DATA-007', title: 'Revision history', pass: r7a && r7b && r7c && r7d && r7e,
      note: `${(after7.versions.stage_2 ?? []).length} versions retained; snapshots ${JSON.stringify(snaps)}` });

    // ── 007 variant: through the SERVICE, which is where production writes go ──
    // The repo-level result above only proves appendVersion retains what it is
    // given. Production versions are written by pushDeepSchemaFromAI, and a
    // stage-0 re-extraction that also changes stages 2 and 3 must leave a trace
    // in THOSE stages' history, not silently change them under a stage_1 entry.
    log();
    log('  --- negative/boundary variant: stage-0 AI push that collaterally changes stages 2 and 3 ---');
    const svc: any = new ProposalService(repo as any, { updateById: async () => null, findById: async () => null } as any, {} as any, {} as any);

    const deep: any = JSON.parse(JSON.stringify(after7.schema));
    deep.stage_2 = { ...(deep.stage_2 ?? {}), glass_type: { value: 'GLASS_WITH_IGU_FROM_STAGE0' } };
    deep.stage_3 = { ...(deep.stage_3 ?? {}), frame_type: { value: 'SERIES_3000_FROM_STAGE0' } };
    log(`  REQUEST         : pushDeepSchemaFromAI(projectId, stage=0, { stage_2.glass_type, stage_3.frame_type }, '${RUN}')`);
    let pushErr = '';
    try { await svc.pushDeepSchemaFromAI(String(p7._id), 0, deep, RUN); }
    catch (e: any) { pushErr = `${e?.name}: ${e?.message}`; log(`  RESPONSE        : threw ${pushErr}`); }

    const post: any = await ProposalModel.findOne({ projectId: p7._id }).lean();
    const counts = [0, 1, 2, 3].map((s) => `stage_${s}=${(post.versions?.[`stage_${s}`] ?? []).length}`).join('  ');
    log(`  query AFTER     : db.proposals.findOne({projectId:ObjectId("${p7._id}")},{versions:1,schema:1})`);
    log(`  version counts  : ${counts}`);
    log(`  schema now      : stage_2.glass_type=${post.schema?.stage_2?.glass_type?.value}  stage_3.frame_type=${post.schema?.stage_3?.frame_type?.value}`);

    // The drift detector: if a stage's value changed, its OWN bucket must have grown.
    const s2Changed = post.schema?.stage_2?.glass_type?.value === 'GLASS_WITH_IGU_FROM_STAGE0';
    const s3Changed = post.schema?.stage_3?.frame_type?.value === 'SERIES_3000_FROM_STAGE0';
    const s2Versioned = (post.versions?.stage_2 ?? []).length > 3;   // had 3 before the push
    const s3Versioned = (post.versions?.stage_3 ?? []).length > 0;
    log(`  stage_2 changed=${s2Changed} versioned=${s2Versioned} | stage_3 changed=${s3Changed} versioned=${s3Versioned}`);
    const r7f = check(!s2Changed || s2Versioned, 'stage_2 changed by a stage-0 push left a version in stage_2 history');
    const r7g = check(!s3Changed || s3Versioned, 'stage_3 changed by a stage-0 push left a version in stage_3 history');
    results.push({ id: 'DATA-007b', title: 'Revision history via service (stage-0 collateral change)', pass: r7f && r7g,
      note: pushErr ? `push threw ${pushErr}` : `counts ${counts}; stage_2 changed=${s2Changed}/versioned=${s2Versioned}, stage_3 changed=${s3Changed}/versioned=${s3Versioned}` });

    // ─────────────────────────────────────────────────────────────────────────
    head('GFS-TT-DATA-008  Optimistic locking (P0)  — concurrent edits cannot silently overwrite each other');

    const p8 = await makeProject('008');
    const prop8 = await repo.ensureProposalExists(String(p8._id));
    created.push({ model: ProposalModel, id: (prop8 as any)._id, what: 'Proposal for 008' });

    const base: any = await ProposalModel.findOne({ projectId: p8._id }).lean();
    log(`  fixture project : ${p8.referenceNumber}`);
    log(`  __v before      : ${base.__v}`);

    // Two writers that BOTH read the same starting state, then both save.
    // Mongoose optimisticConcurrency must make the loser fail rather than win silently.
    const writer = async (who: string, value: string) => {
      const doc = await ProposalModel.findOne({ projectId: p8._id }).exec();
      const next: any = JSON.parse(JSON.stringify(doc!.schema));
      next.stage_2 = next.stage_2 ?? {};
      next.stage_2.frame_type = { ...(next.stage_2.frame_type ?? {}), value };
      doc!.set('schema', next);
      (doc!.versions as any).stage_2.push({ timestamp: new Date(), source: 'AI', updatedBy: who, snapshot: next.stage_2 });
      await doc!.save();          // both saves race on the SAME __v
      return who;
    };

    log(`  REQUEST         : two concurrent saves on the same proposal, both read __v=${base.__v}`);
    const outcome = await Promise.allSettled([writer('WRITER-A', 'SERIES_2000'), writer('WRITER-B', 'SERIES_3000')]);
    const okCount = outcome.filter((o) => o.status === 'fulfilled').length;
    const failures = outcome.filter((o) => o.status === 'rejected') as PromiseRejectedResult[];
    log(`  RESPONSE        : fulfilled=${okCount} rejected=${failures.length}`);
    failures.forEach((f) => log(`                    rejection: ${f.reason?.name}: ${String(f.reason?.message).slice(0, 110)}`));

    const after8: any = await ProposalModel.findOne({ projectId: p8._id }).lean();
    log(`  query AFTER     : db.proposals.findOne({projectId:ObjectId("${p8._id}")},{__v:1,"schema.stage_2.frame_type":1})`);
    log(`  __v after       : ${after8.__v}   frame_type = ${after8.schema?.stage_2?.frame_type?.value}`);
    log(`  stage_2 versions: ${(after8.versions.stage_2 ?? []).length}  (2 would mean BOTH writes landed)`);

    const r8a = check(okCount === 1 && failures.length === 1, 'exactly one writer succeeded; the loser was REJECTED, not silently dropped');
    const r8b = check(failures.every((f) => /version|VersionError|No matching document/i.test(String(f.reason?.name) + String(f.reason?.message))),
      'the rejection is a concurrency/version error, not an unrelated failure');
    const r8c = check((after8.versions.stage_2 ?? []).length === 1, 'only the winning write is persisted (no lost-update merge)');
    results.push({ id: 'DATA-008', title: 'Optimistic locking', pass: r8a && r8b && r8c,
      note: `fulfilled=${okCount} rejected=${failures.length}; final frame_type=${after8.schema?.stage_2?.frame_type?.value}` });

    // ── 008 boundary variant: the lock must reject only genuine conflicts ──
    log();
    log('  --- negative/boundary variant: two SEQUENTIAL writes must BOTH succeed ---');
    log('  REQUEST         : writer C, awaited to completion, then writer D');
    const seqA = await writer('WRITER-C', 'SERIES_1000').then(() => 'ok').catch((e) => `threw ${e?.name}`);
    const seqB = await writer('WRITER-D', 'SERIES_4000').then(() => 'ok').catch((e) => `threw ${e?.name}`);
    const afterSeq: any = await ProposalModel.findOne({ projectId: p8._id }).lean();
    log(`  RESPONSE        : C=${seqA}  D=${seqB}   final frame_type=${afterSeq.schema?.stage_2?.frame_type?.value}  __v=${afterSeq.__v}`);
    const r8d = check(seqA === 'ok' && seqB === 'ok', 'sequential writes both succeed (lock does not block non-conflicting edits)');
    const r8e = check(afterSeq.schema?.stage_2?.frame_type?.value === 'SERIES_4000', 'last sequential write is the surviving value');
    results.push({ id: 'DATA-008b', title: 'Optimistic locking boundary (sequential writes)', pass: r8d && r8e,
      note: `C=${seqA} D=${seqB}; final=${afterSeq.schema?.stage_2?.frame_type?.value}` });

    // ─────────────────────────────────────────────────────────────────────────
    head('GFS-TT-DATA-009  Transactional rollback (P0)  — dependent writes commit together or roll back together');

    // Exercises the REAL ProjectCreationService.create(), not a simulation, so
    // the result reflects production behaviour. The only substitution is the
    // parameter repository, which is made to fail on demand: that is the
    // dependent write whose failure must undo the parent.
    const projectRepo = new MongooseProjectRepository();
    const sequenceRepo = new MongooseSequenceRepository();
    const seqName = `GFS-${new Date().getFullYear()}`;
    const noStorage: any = {
      getProjectRootPath: () => `qa/${RUN}`,
      createFolderStructure: async () => undefined,
    };
    const failingParams: any = {
      ensureForProject: async () => { throw new Error('QA: forced dependent-write failure'); },
      create: async () => { throw new Error('QA: forced dependent-write failure'); },
      findByProjectId: async () => null,
      updateByProjectId: async () => null,
    };

    const seq9Before: any = await Sequence.findById(seqName).lean();
    log(`  query BEFORE    : db.sequences.findOne({_id:"${seqName}"})  ->  sequenceValue=${seq9Before?.sequenceValue}`);
    log(`  REQUEST         : ProjectCreationService.create({ projectName: '${RUN} 009' }) with the dependent parameter write forced to fail`);

    const svc9 = new ProjectCreationService(projectRepo, sequenceRepo, noStorage, failingParams);
    let createThrew = false; let thrown = '';
    let createdId: string | null = null;
    try {
      const made = await svc9.create({ projectName: `${RUN} 009 (rollback probe)` } as any, { creationSource: 'MANUAL' } as any);
      createdId = made.id;
      created.push({ model: Project, id: made.id, what: `Project ${made.referenceNumber} (unexpectedly survived)` });
    } catch (err: any) {
      createThrew = true; thrown = err?.message ?? String(err);
    }
    log(`  RESPONSE        : create threw = ${createThrew} (${thrown})`);

    // Did any project survive the failed create?
    const orphan: any = await Project.findOne({ projectName: `${RUN} 009 (rollback probe)` }).lean();
    log(`  query AFTER     : db.projects.findOne({projectName:"${RUN} 009 (rollback probe)"})`);
    log(`  orphan project  : ${orphan ? `YES  _id=${orphan._id}  ref=${orphan.referenceNumber}` : 'none — rolled back'}`);
    const strayParams = orphan ? await ProjectParameter.countDocuments({ projectId: orphan._id }) : 0;
    log(`  stray parameters: ${strayParams}`);

    const r9a = check(createThrew, 'a failed dependent write surfaces as an error instead of being swallowed');
    const r9b = check(!orphan, 'parent project rolled back with the failed dependent write (no partial commit)');
    results.push({ id: 'DATA-009', title: 'Transactional rollback', pass: r9a && r9b,
      note: orphan
        ? `PARTIAL COMMIT: project ${orphan.referenceNumber} persisted after its dependent write failed`
        : 'parent rolled back; no partially committed record left' });
    if (createdId) log(`  NOTE            : surviving project ${createdId} retained for inspection`);

    // ── 009 boundary variant: is the reference number handed back? ──────────
    // The number must be drawn before the write (it is required and unique), so
    // the test is not "never draw it" but "never leave it burned".
    log();
    log('  --- negative/boundary variant: reference number returned to the sequence after a failed create ---');
    const seq9After: any = await Sequence.findById(seqName).lean();
    log(`  query AFTER     : db.sequences.findOne({_id:"${seqName}"})  ->  sequenceValue=${seq9After?.sequenceValue}`);
    const consumed = (seq9After?.sequenceValue ?? 0) - (seq9Before?.sequenceValue ?? 0);
    log(`  net consumed    : ${consumed}  (0 means the drawn number was handed back)`);
    const r9c = check(consumed === 0, `reference number NOT burned by the failed create (net consumed=${consumed})`);
    results.push({ id: 'DATA-009b', title: 'Transactional rollback boundary (reference number release)', pass: r9c,
      note: consumed === 0
        ? 'drawn number returned to the sequence; no gap in client-facing reference numbers'
        : `GAP: sequence advanced by ${consumed} for a project that was never created (${seq9Before?.sequenceValue} -> ${seq9After?.sequenceValue})` });

    // ─────────────────────────────────────────────────────────────────────────
    head('RESULTS');
    for (const r of results) log(`  ${r.id}  ${r.pass ? 'PASS' : 'FAIL'}  ${r.title}\n         ${r.note}`);
  } finally {
    // Fixtures are RETAINED by default so the evidence behind a result stays
    // inspectable after the run. Deleting them would leave a screenshot as the
    // only proof. Pass --cleanup to remove this run's fixtures instead.
    if (CLEANUP) {
      head('CLEANUP — removing every fixture this run created');
      for (const c of created.reverse()) {
        const res = await c.model.deleteOne({ _id: c.id });
        log(`  deleted ${res.deletedCount} — ${c.what}`);
      }
      const leftovers = await Project.countDocuments({ referenceNumber: new RegExp(`^${RUN}`) });
      log(`  VERIFY: projects matching ${RUN}* remaining = ${leftovers}`);
      log(`  CLEANUP ${leftovers === 0 ? 'CONFIRMED CLEAN' : 'INCOMPLETE — INVESTIGATE'}`);
    } else {
      head('FIXTURES RETAINED — evidence kept for inspection');
      log(`  run id: ${RUN}`);
      for (const c of created) log(`  kept  _id=${c.id}  ${c.what}`);
      log('');
      log('  Inspect in Mongo:');
      log(`    db.projects.find({ referenceNumber: /^${RUN}/ })`);
      log(`    db.proposals.find({ projectId: { $in: [${created.filter((c) => c.what.startsWith('Project')).map((c) => `ObjectId("${c.id}")`).join(', ')}] } })`);
      log('');
      log(`  Remove this run later:  npx ts-node --transpile-only -r tsconfig-paths/register ${'src/scripts/qa-data-integrity-007-008-009.ts'} --cleanup`);
      log('  (or delete by the referenceNumber prefix above)');
      const kept = await Project.countDocuments({ referenceNumber: /^QA-DATA-/ });
      log(`  QA-DATA- projects now in the database (all runs): ${kept}`);
    }
    await mongoose.disconnect();
  }
})();
