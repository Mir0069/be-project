export interface IDomainMonitoredMailbox {
  id: string;
  userId: string;
  displayName: string;
  folderId: string;
  projectId?: string | null;
  deltaLink?: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICreateMonitoredMailboxFields {
  userId: string;
  displayName: string;
  folderId?: string | null;
  projectId?: string | null;
}

export interface IOutlookMonitoredMailboxRepository {
  listActive(): Promise<IDomainMonitoredMailbox[]>;
  findById(id: string): Promise<IDomainMonitoredMailbox | null>;
  findByMailbox(userId: string, folderId: string): Promise<IDomainMonitoredMailbox | null>;
  // Insert a new monitored mailbox, or reactivate/refresh one that was
  // previously removed (the (userId, folderId) pair is unique).
  upsert(fields: ICreateMonitoredMailboxFields): Promise<IDomainMonitoredMailbox>;
  updateDeltaLink(id: string, deltaLink: string | null): Promise<void>;
  deactivate(id: string): Promise<IDomainMonitoredMailbox | null>;
}
