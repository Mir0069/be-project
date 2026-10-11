import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';

import { env } from '@config/index';
import { connectDB } from '@db/connection';
import { TeamsTokenModel } from '@db/models/teams-token.model';
import { MongooseTeamsTokenRepository } from '@repositories/mongoose/teams-token.repository';
import { TeamsTokenService } from '@features/teams/teams-token.service';
import { TeamsGraphClient } from '@features/teams/teams.graph-client';
import { TeamsFilesService } from '@features/teams/teams-files.service';
import { LoggingDocumentIngestionPort } from '@features/teams/document-ingestion.port';
import type {
  GraphTeam,
  GraphChannel,
  GraphChannelMessage,
  GraphList,
} from '@features/teams/teams.types';

const sanitize = (segment: string): string =>
  segment.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'unnamed';

const main = async (): Promise<void> => {
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
  const port = new LoggingDocumentIngestionPort();
  const filesService = new TeamsFilesService(graph, port, true);

  const outRoot = path.join(process.cwd(), 'temp', 'teams-downloads');
  await fs.promises.mkdir(outRoot, { recursive: true });
  console.log(`\nSaving downloaded files under: ${outRoot}\n`);

  const teams = await graph.getAllPages<GraphTeam>('/teams');
  let saved = 0;

  for (const team of teams) {
    const channels = await graph.getAllPages<GraphChannel>(`/teams/${team.id}/channels`);
    for (const ch of channels) {
      const res = await graph.get<GraphList<GraphChannelMessage>>(
        `/teams/${team.id}/channels/${ch.id}/messages`,
        { $top: '20' },
      );
      for (const m of res.value ?? []) {
        for (const att of m.attachments ?? []) {
          if (att.contentType !== 'reference' || !att.contentUrl) continue;

          const file = await filesService.download(att.contentUrl, att.name);

          const dir = path.join(outRoot, sanitize(team.displayName), sanitize(ch.displayName));
          await fs.promises.mkdir(dir, { recursive: true });
          const outPath = path.join(dir, sanitize(file.originalName));
          await fs.promises.writeFile(outPath, file.buffer);

          console.log(`Saved: ${outPath}`);
          console.log(`       (${file.buffer.length.toLocaleString()} bytes, ${file.mimeType})`);

          // Also exercise the hand-off to the pipeline stub, just to log it.
          await port.upload(
            { userId: 'verify-script' },
            {
              projectId: 'VERIFY-PROJECT',
              file,
              uploadedBy: 'verify-script',
              documentType: 'other',
            },
          );

          saved += 1;
        }
      }
    }
  }

  console.log(`\nDone. ${saved} file(s) saved to disk.`);
  await mongoose.disconnect();
  process.exit(0);
};

main().catch((err) => {
  console.error('verify failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
