// Seam used by ZohoSyncService to fire off Teams workspace provisioning after a
// project is created (Zoho-first / mail-first). The implementation lives in the
// teams feature (TeamsProvisioningService); this port keeps the zoho feature
// decoupled from it and lets tests inject a fake. Mirrors IProjectCreatedNotifier.
export interface ProvisionTeamsRequest {
  projectId: string;
  projectName: string;
}

export interface IProjectTeamsProvisioner {
  // Must be non-blocking and must never throw into the caller — a provisioning
  // problem can never slow or break project creation.
  provisionForProject(input: ProvisionTeamsRequest): Promise<void>;
}
