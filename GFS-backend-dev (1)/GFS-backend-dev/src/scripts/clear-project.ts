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
import { ZohoLead } from '@db/models/zoho-lead.model';
import { ZohoLeadChange } from '@db/models/zoho-lead-change.model';
import { ZohoWebhookEvent } from '@db/models/zoho-webhook-event.model';
import { getDropboxAccessToken, deleteDropboxFileByPath, listDropboxPath } from '@shared/utils/dropbox';
import { AzureContentAddressedBlobStorage } from '@features/document-ingestion/document-ingestion.service';
import mongoose from 'mongoose';

/**
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/scripts/clear-project.ts <search_term_or_project_id>
 * Example:
 *   npx ts-node -r tsconfig-paths/register src/scripts/clear-project.ts "Jane Street"
 */
async function main() {
  const searchTerm = process.argv[2] || 'Jane';

  console.log('================================================================');
  console.log(`🧹 TARGETED PROJECT CLEANUP (Query: "${searchTerm}")`);
  console.log('================================================================');

  await connectDB();

  const isObjectId = mongoose.Types.ObjectId.isValid(searchTerm);
  const filter: any = {
    $or: [
      { projectName: { $regex: new RegExp(searchTerm, 'i') } },
      { jobAddress: { $regex: new RegExp(searchTerm, 'i') } },
      { 'address.street': { $regex: new RegExp(searchTerm, 'i') } },
      { referenceNumber: { $regex: new RegExp(searchTerm, 'i') } },
    ],
  };

  if (isObjectId) {
    filter.$or.push({ _id: new mongoose.Types.ObjectId(searchTerm) });
  }

  const matchingProjects = await Project.find(filter).lean();

  console.log(`Found ${matchingProjects.length} project(s) matching "${searchTerm}".`);
  for (const p of matchingProjects) {
    console.log(` - ID: ${p._id} | Ref: ${p.referenceNumber} | Name: ${p.projectName} | Dropbox: ${p.dropboxFolderPath}`);
  }

  const objIds = matchingProjects.map((p) => p._id);
  const targetProjectIds = matchingProjects.map((p) => String(p._id));
  const zohoLeadIds = matchingProjects.map((p) => p.zohoLeadId).filter((id): id is string => Boolean(id));

  if (matchingProjects.length > 0) {
    // 1. Delete documents from Azure Blob Storage if possible
    console.log('\n--- 1. Cleaning Azure Blob Storage Documents ---');
    try {
      const docs = await DocumentModel.find({ projectId: { $in: objIds } }).lean();
      console.log(`Found ${docs.length} documents linked to matching projects.`);

      if (process.env['AZURE_STORAGE_CONNECTION_STRING'] && docs.length > 0) {
        const storage = new AzureContentAddressedBlobStorage({
          connectionString: process.env['AZURE_STORAGE_CONNECTION_STRING'],
          containerName: process.env['AZURE_STORAGE_CONTAINER_NAME'] || 'documents',
        });

        let blobDeleteCount = 0;
        for (const doc of docs) {
          if (doc.storageKey) {
            try {
              await storage.delete(doc.storageKey);
              blobDeleteCount++;
            } catch (e: any) {
              console.warn(`Could not delete blob ${doc.storageKey}:`, e?.message || e);
            }
          }
        }
        console.log(`✓ Deleted ${blobDeleteCount} blob(s) from Azure Storage.`);
      }
    } catch (err: any) {
      console.warn('⚠️ Blob storage cleanup warning:', err?.message || err);
    }

    // 2. Delete MongoDB collections data
    console.log('\n--- 2. Wiping MongoDB Records for Target Projects ---');

    const docsRes = await DocumentModel.deleteMany({ projectId: { $in: objIds } });
    console.log(`✓ Deleted Documents: ${docsRes.deletedCount}`);

    const proposalsRes = await ProposalModel.deleteMany({ projectId: { $in: objIds } });
    console.log(`✓ Deleted Proposals: ${proposalsRes.deletedCount}`);

    const emailsRes = await OutlookEmail.deleteMany({ projectId: { $in: objIds } });
    console.log(`✓ Deleted Outlook Emails: ${emailsRes.deletedCount}`);

    const callsRes = await CallRecord.deleteMany({ projectId: { $in: objIds } });
    console.log(`✓ Deleted Call Records: ${callsRes.deletedCount}`);

    const approvalsRes = await PendingChangeApprovalModel.deleteMany({ projectId: { $in: targetProjectIds } });
    console.log(`✓ Deleted Pending Approvals: ${approvalsRes.deletedCount}`);

    const notifsRes = await Notification.deleteMany({ projectId: { $in: objIds } });
    console.log(`✓ Deleted Notifications: ${notifsRes.deletedCount}`);

    const cloudLinksRes = await CloudLinkAsset.deleteMany({ projectId: { $in: objIds } });
    console.log(`✓ Deleted Cloud Link Assets: ${cloudLinksRes.deletedCount}`);

    const paramsRes = await ProjectParameter.deleteMany({ projectId: { $in: objIds } });
    console.log(`✓ Deleted Project Parameters: ${paramsRes.deletedCount}`);

    const teamsMeetRes = await TeamsMeeting.deleteMany({ projectId: { $in: objIds } });
    console.log(`✓ Deleted Teams Meetings: ${teamsMeetRes.deletedCount}`);

    const teamsMsgRes = await TeamsMessage.deleteMany({ projectId: { $in: objIds } });
    console.log(`✓ Deleted Teams Messages: ${teamsMsgRes.deletedCount}`);

    const teamsAiRes = await TeamsAiJob.deleteMany({ projectId: { $in: objIds } });
    console.log(`✓ Deleted Teams AI Jobs: ${teamsAiRes.deletedCount}`);

    const teamsTransRes = await TeamsTranscript.deleteMany({ projectId: { $in: objIds } });
    console.log(`✓ Deleted Teams Transcripts: ${teamsTransRes.deletedCount}`);

    const teamsOutboxRes = await TeamsProvisionOutbox.deleteMany({ projectId: { $in: objIds } });
    console.log(`✓ Deleted Teams Provision Outbox: ${teamsOutboxRes.deletedCount}`);

    const teamsMonitoredRes = await TeamsMonitoredChannel.deleteMany({
      $or: [
        { projectId: { $in: objIds } },
        { projectIds: { $in: objIds } },
      ],
    });
    console.log(`✓ Deleted Teams Monitored Channels: ${teamsMonitoredRes.deletedCount}`);

    if (zohoLeadIds.length > 0) {
      const zohoLeadsRes = await ZohoLead.deleteMany({ id: { $in: zohoLeadIds } });
      console.log(`✓ Deleted Zoho Leads: ${zohoLeadsRes.deletedCount}`);

      const zohoChangesRes = await ZohoLeadChange.deleteMany({ leadId: { $in: zohoLeadIds } });
      console.log(`✓ Deleted Zoho Changes: ${zohoChangesRes.deletedCount}`);

      const zohoEventsRes = await ZohoWebhookEvent.deleteMany({ 'data.id': { $in: zohoLeadIds } });
      console.log(`✓ Deleted Zoho Events: ${zohoEventsRes.deletedCount}`);
    }

    const projectsRes = await Project.deleteMany({ _id: { $in: objIds } });
    console.log(`✓ Deleted Projects: ${projectsRes.deletedCount}`);
  }

  // 3. Delete Dropbox Project Folders
  console.log('\n--- 3. Checking Dropbox Project Folders ---');
  try {
    const token = await getDropboxAccessToken(env.dropbox);
    const rootPath = (env.dropbox.rootPath || '/GFS-Projects').replace(/\/+$/, '').trim();
    const entries = await listDropboxPath(rootPath, token);
    
    const matchedFolders = entries.filter((e) => e.path_display && new RegExp(searchTerm, 'i').test(e.path_display));
    console.log(`Found ${matchedFolders.length} matching Dropbox folder(s) by name for "${searchTerm}".`);

    const explicitFolders = matchingProjects
      .map((p) => p.dropboxFolderPath)
      .filter((p): p is string => Boolean(p));

    const allFolderPaths = Array.from(
      new Set([...matchedFolders.map((f) => f.path_display), ...explicitFolders])
    ).filter((p): p is string => Boolean(p));

    for (const folderPath of allFolderPaths) {
      try {
        console.log(`Deleting Dropbox folder: ${folderPath}...`);
        await deleteDropboxFileByPath(folderPath, token);
        console.log(`✓ Deleted Dropbox folder: ${folderPath}`);
      } catch (err: any) {
        console.warn(`Failed to delete Dropbox folder "${folderPath}":`, err?.message || err);
      }
    }
  } catch (err: any) {
    console.warn('⚠️ Dropbox cleanup error:', err?.message || err);
  }

  console.log('\n================================================================');
  console.log(`🎉 Cleanup for "${searchTerm}" completed successfully!`);
  console.log('================================================================');

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('Cleanup script failed:', err);
  process.exit(1);
});
