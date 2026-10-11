import dns from 'dns';
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {}

import { connectDB } from '@db/connection';
import { env } from '@config/index';
import { Project } from '@db/models/project.model';
import { DocumentModel } from '@db/models/document.model';
import { ProposalModel } from '@db/models/proposal.model';
import { OutlookEmail } from '@db/models/outlook-email.model';
import { CallRecord } from '@db/models/call-record.model';
import { PendingChangeApprovalModel } from '@db/models/pending-change-approval.model';
import { Notification } from '@db/models/notification.model';
import { CloudLinkAsset } from '@db/models/cloud-link-asset.model';
import { ProjectParameter } from '@db/models/project-parameter.model';
import { TeamsMeeting } from '@db/models/teams-meeting.model';
import { TeamsMessage } from '@db/models/teams-message.model';
import { TeamsAiJob } from '@db/models/teams-ai-job.model';
import { TeamsTranscript } from '@db/models/teams-transcript.model';
import { TeamsProvisionOutbox } from '@db/models/teams-provision-outbox.model';
import { TeamsMonitoredChannel } from '@db/models/teams-monitored-channel.model';
import { TeamsProjectMember } from '@db/models/teams-project-member.model';
import { Sequence } from '@db/models/sequence.model';
import { ZohoLead } from '@db/models/zoho-lead.model';
import { ZohoLeadChange } from '@db/models/zoho-lead-change.model';
import { ZohoWebhookEvent } from '@db/models/zoho-webhook-event.model';
import { getDropboxAccessToken, listDropboxPath, deleteDropboxFileByPath } from '@shared/utils/dropbox';
import mongoose from 'mongoose';

async function main() {
  console.log('================================================================');
  console.log('🧹 GFS COMPLETE CLEANUP: Wiping DB Projects, Docs & Dropbox');
  console.log('================================================================');

  await connectDB();

  // 1. Wipe Database Collections
  console.log('\n--- 1. Wiping MongoDB Collections ---');
  
  const projectsRes = await Project.deleteMany({});
  console.log(`✓ Deleted Projects: ${projectsRes.deletedCount}`);

  const docsRes = await DocumentModel.deleteMany({});
  console.log(`✓ Deleted Documents: ${docsRes.deletedCount}`);

  const proposalsRes = await ProposalModel.deleteMany({});
  console.log(`✓ Deleted Proposals: ${proposalsRes.deletedCount}`);

  const emailsRes = await OutlookEmail.deleteMany({});
  console.log(`✓ Deleted Outlook Emails: ${emailsRes.deletedCount}`);

  const callsRes = await CallRecord.deleteMany({});
  console.log(`✓ Deleted Call Records: ${callsRes.deletedCount}`);

  const approvalsRes = await PendingChangeApprovalModel.deleteMany({});
  console.log(`✓ Deleted Pending Approvals: ${approvalsRes.deletedCount}`);

  const notifsRes = await Notification.deleteMany({});
  console.log(`✓ Deleted Notifications: ${notifsRes.deletedCount}`);

  const cloudLinksRes = await CloudLinkAsset.deleteMany({});
  console.log(`✓ Deleted Cloud Link Assets: ${cloudLinksRes.deletedCount}`);

  const paramsRes = await ProjectParameter.deleteMany({});
  console.log(`✓ Deleted Project Parameters: ${paramsRes.deletedCount}`);

  const teamsMeetRes = await TeamsMeeting.deleteMany({});
  console.log(`✓ Deleted Teams Meetings: ${teamsMeetRes.deletedCount}`);

  const teamsMsgRes = await TeamsMessage.deleteMany({});
  console.log(`✓ Deleted Teams Messages: ${teamsMsgRes.deletedCount}`);

  const teamsAiRes = await TeamsAiJob.deleteMany({});
  console.log(`✓ Deleted Teams AI Jobs: ${teamsAiRes.deletedCount}`);

  const teamsTransRes = await TeamsTranscript.deleteMany({});
  console.log(`✓ Deleted Teams Transcripts: ${teamsTransRes.deletedCount}`);

  const zohoLeadsRes = await ZohoLead.deleteMany({});
  console.log(`✓ Deleted Zoho Leads: ${zohoLeadsRes.deletedCount}`);

  const zohoChangesRes = await ZohoLeadChange.deleteMany({});
  console.log(`✓ Deleted Zoho Changes: ${zohoChangesRes.deletedCount}`);

  const zohoEventsRes = await ZohoWebhookEvent.deleteMany({});
  console.log(`✓ Deleted Zoho Events: ${zohoEventsRes.deletedCount}`);

  const teamsOutboxRes = await TeamsProvisionOutbox.deleteMany({});
  console.log(`✓ Deleted Teams Provision Outboxes: ${teamsOutboxRes.deletedCount}`);

  const teamsMonitoredRes = await TeamsMonitoredChannel.deleteMany({});
  console.log(`✓ Deleted Teams Monitored Channels: ${teamsMonitoredRes.deletedCount}`);

  const teamsMembersRes = await TeamsProjectMember.deleteMany({});
  console.log(`✓ Deleted Teams Project Members: ${teamsMembersRes.deletedCount}`);

  const seqRes = await Sequence.deleteMany({});
  console.log(`✓ Reset Project Sequences: ${seqRes.deletedCount}`);

  try {
    const cacheRes = await mongoose.connection.db!.collection('document_processing_cache').deleteMany({});
    console.log(`✓ Deleted Document Processing Cache: ${cacheRes.deletedCount}`);
  } catch {}

  console.log('✅ MongoDB Cleanup Complete. (User accounts & master templates preserved).');

  // 2. Wipe Dropbox Projects Folder
  console.log('\n--- 2. Wiping Dropbox Project Folders ---');
  try {
    const token = await getDropboxAccessToken(env.dropbox);
    const rootPath = (env.dropbox.rootPath || '/GFS-Projects').replace(/\/+$/, '').trim();
    console.log(`Connecting to Dropbox at root: ${rootPath}...`);

    const entries = await listDropboxPath(rootPath, token);
    console.log(`Found ${entries.length} items in ${rootPath}.`);

    let deletedCount = 0;
    for (const entry of entries) {
      try {
        console.log(`Deleting Dropbox folder/file: ${entry.path_display}...`);
        await deleteDropboxFileByPath(entry.path_display, token);
        deletedCount++;
      } catch (err: any) {
        console.warn(`Failed to delete ${entry.path_display}:`, err.message);
      }
    }
    console.log(`✅ Dropbox Cleanup Complete: Deleted ${deletedCount} project folders/files.`);
  } catch (err: any) {
    console.error('⚠️ Dropbox cleanup encountered an error:', err.message);
  }

  console.log('\n================================================================');
  console.log('🎉 ALL PROJECTS, DOCUMENTS, AND DROPBOX FOLDERS HAVE BEEN WIPED CLEAN!');
  console.log('================================================================');

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('Cleanup script failed:', err);
  process.exit(1);
});
