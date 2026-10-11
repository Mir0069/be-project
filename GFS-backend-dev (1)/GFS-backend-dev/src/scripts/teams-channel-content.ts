import mongoose from 'mongoose';

import { env } from '@config/index';
import { connectDB } from '@db/connection';
import { TeamsTokenModel } from '@db/models/teams-token.model';
import { MongooseTeamsTokenRepository } from '@repositories/mongoose/teams-token.repository';
import { TeamsTokenService } from '@features/teams/teams-token.service';
import { TeamsGraphClient } from '@features/teams/teams.graph-client';
import type { GraphList, GraphTeam, GraphChannel } from '@features/teams/teams.types';

/**
 * READ-ONLY: lists every file in a channel's SharePoint document library
 * (documents shared in the channel/meeting + the Recordings folder), recursing
 * into subfolders, and download-tests one document + one recording to prove the
 * bytes come through. App-only (Files.Read.All) — no login.
 *
 * The correct path is `/teams/{t}/channels/{c}/filesFolder` → get its driveId +
 * item id → `/drives/{driveId}/items/{id}/children` (the `filesFolder/children`
 * shortcut does NOT work and silently fails).
 *
 * Run:
 *   TEAMS_CHANNEL="jemu testing one" npx ts-node --transpile-only -r tsconfig-paths/register src/scripts/teams-channel-content.ts
 */

interface DriveItem {
  id: string;
  name?: string;
  size?: number;
  webUrl?: string;
  file?: { mimeType?: string };
  folder?: { childCount?: number };
  parentReference?: { driveId?: string };
}

const found: Array<{ driveId: string; item: DriveItem; kind: string }> = [];

const kindOf = (name: string): string => {
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  if (['mp4', 'webm'].includes(ext)) return 'recording';
  if (['vtt', 'srt'].includes(ext)) return 'transcript';
  if (['pdf', 'docx', 'doc', 'xlsx', 'pptx', 'txt', 'loop'].includes(ext)) return 'document';
  if (['png', 'jpg', 'jpeg', 'gif'].includes(ext)) return 'image';
  return 'file';
};

const walk = async (
  graph: TeamsGraphClient,
  driveId: string,
  itemId: string,
  indent: string,
  depth: number,
): Promise<void> => {
  let children: GraphList<DriveItem>;
  try {
    children = await graph.get<GraphList<DriveItem>>(`/drives/${driveId}/items/${itemId}/children`, {
      $top: '200',
    });
  } catch (err) {
    const e = err as { statusCode?: number; message?: string };
    console.log(`${indent}❌ list failed: ${e.statusCode ?? ''} ${e.message ?? ''}`);
    return;
  }
  for (const it of children.value ?? []) {
    if (it.folder) {
      console.log(`${indent}📁 ${it.name}/ (${it.folder.childCount ?? 0} items)`);
      if (depth < 3) await walk(graph, driveId, it.id, `${indent}   `, depth + 1);
    } else {
      const kind = kindOf(it.name ?? '');
      const icon =
        kind === 'recording' ? '🎥' : kind === 'transcript' ? '📝' : kind === 'document' ? '📄' : '•';
      console.log(`${indent}${icon} ${it.name} (${it.size ?? 0} bytes) [${kind}]`);
      found.push({ driveId, item: it, kind });
    }
  }
};

const main = async (): Promise<void> => {
  const channelFilter = (process.env['TEAMS_CHANNEL'] ?? 'jemu testing one').toLowerCase();

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
  await TeamsTokenModel.deleteMany({});
  const graph = new TeamsGraphClient(tokenService, env.teams.graphBaseUrl);

  const teams = await graph.getAllPages<GraphTeam>('/teams');
  for (const team of teams) {
    const channels = await graph.getAllPages<GraphChannel>(`/teams/${team.id}/channels`);
    for (const ch of channels) {
      if (channelFilter && !ch.displayName.toLowerCase().includes(channelFilter)) continue;
      console.log(`\n=== ${team.displayName} / ${ch.displayName} — files ===`);
      let folder: DriveItem;
      try {
        folder = await graph.get<DriveItem>(`/teams/${team.id}/channels/${ch.id}/filesFolder`);
      } catch (err) {
        const e = err as { statusCode?: number; message?: string };
        console.log(`  ❌ filesFolder: ${e.statusCode ?? ''} ${e.message ?? ''}`);
        continue;
      }
      const driveId = folder.parentReference?.driveId;
      if (!driveId) {
        console.log('  ❌ no driveId on filesFolder');
        continue;
      }
      await walk(graph, driveId, folder.id, '  ', 0);
    }
  }

  // Download-test: prove we can read the bytes of a document, a recording and a transcript.
  console.log('\n=== Download tests (proving access to the bytes) ===');
  for (const kind of ['document', 'recording', 'transcript']) {
    const hit = found.find((f) => f.kind === kind);
    if (!hit) {
      console.log(`  (no ${kind} found to test)`);
      continue;
    }
    try {
      const buf = await graph.getBinary(`/drives/${hit.driveId}/items/${hit.item.id}/content`);
      console.log(`  ✅ ${kind}: downloaded "${hit.item.name}" — ${buf.length} bytes`);
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      console.log(`  ❌ ${kind}: "${hit.item.name}" — ${e.statusCode ?? ''} ${e.message ?? ''}`);
    }
  }

  console.log(
    `\nSummary: ${found.filter((f) => f.kind === 'document').length} document(s), ${found.filter((f) => f.kind === 'recording').length} recording(s), ${found.filter((f) => f.kind === 'transcript').length} transcript file(s).`,
  );

  await mongoose.disconnect();
  process.exit(0);
};

main().catch((err) => {
  console.error('teams-channel-content failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
