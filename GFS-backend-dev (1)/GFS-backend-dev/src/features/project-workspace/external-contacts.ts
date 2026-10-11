import { env } from '@config/index';
import type { IProjectExternalContact } from '@db/models/project.model';
import type { IOutlookEmailParticipants } from '@repositories/interfaces/i-outlook-email.repository';
import type { IProjectRepository } from '@repositories/interfaces/i-project.repository';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeEmailAddress = (raw: string): string | null => {
  const angleAddress = raw.match(/<([^<>]+)>/)?.[1];
  const email = (angleAddress ?? raw).trim().toLowerCase();
  return EMAIL_PATTERN.test(email) ? email : null;
};

const isInternalEmail = (email: string): boolean => {
  const domain = email.split('@')[1] ?? '';
  return env.outlook.internalEmailDomains.some(
    (internalDomain) => domain === internalDomain || domain.endsWith(`.${internalDomain}`),
  );
};

const addContact = (
  contacts: Map<string, IProjectExternalContact>,
  rawAddress: string | null | undefined,
  source: IProjectExternalContact['sources'][number],
  receivedAt: Date,
  name?: string | null,
) => {
  if (!rawAddress) return;
  const email = normalizeEmailAddress(rawAddress);
  if (!email || isInternalEmail(email)) return;

  const existing = contacts.get(email);
  if (!existing) {
    contacts.set(email, {
      email,
      name: name?.trim() || null,
      sources: [source],
      firstSeenAt: receivedAt,
      lastSeenAt: receivedAt,
    });
    return;
  }

  if (!existing.sources.includes(source)) existing.sources.push(source);
  if (!existing.name && name?.trim()) existing.name = name.trim();
  if (receivedAt < existing.firstSeenAt) existing.firstSeenAt = receivedAt;
  if (receivedAt > existing.lastSeenAt) existing.lastSeenAt = receivedAt;
};

export const collectExternalContacts = (
  emails: IOutlookEmailParticipants[],
): IProjectExternalContact[] => {
  const contacts = new Map<string, IProjectExternalContact>();

  for (const email of emails) {
    addContact(contacts, email.fromAddress, 'FROM', email.receivedDateTime, email.fromName);
    email.toRecipients.forEach((address) => addContact(contacts, address, 'TO', email.receivedDateTime));
    email.ccRecipients.forEach((address) => addContact(contacts, address, 'CC', email.receivedDateTime));
  }

  return [...contacts.values()].sort((a, b) => a.email.localeCompare(b.email));
};

export const mergeExternalContacts = (
  existing: IProjectExternalContact[] = [],
  incoming: IProjectExternalContact[] = [],
): IProjectExternalContact[] => {
  const contacts = new Map<string, IProjectExternalContact>();
  const validDate = (value: Date | string, fallback: Date): Date => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? fallback : date;
  };

  const addExisting = (contact: IProjectExternalContact) => {
    const receivedAt = validDate(contact.lastSeenAt, new Date());
    const firstSeenAt = validDate(contact.firstSeenAt, receivedAt);
    addContact(
      contacts,
      contact.email,
      contact.sources[0] ?? 'FROM',
      receivedAt,
      contact.name,
    );
    const normalized = contacts.get(normalizeEmailAddress(contact.email) ?? '');
    if (normalized && !Number.isNaN(firstSeenAt.getTime())) normalized.firstSeenAt = firstSeenAt;
    contact.sources.slice(1).forEach((source) => {
      if (normalized && !normalized.sources.includes(source)) normalized.sources.push(source);
    });
  };

  existing.forEach(addExisting);
  incoming.forEach((contact) => {
    contact.sources.forEach((source) => addContact(
      contacts,
      contact.email,
      source,
      new Date(contact.lastSeenAt),
      contact.name,
    ));
    const normalized = contacts.get(normalizeEmailAddress(contact.email) ?? '');
    const firstSeenAt = validDate(contact.firstSeenAt, normalized?.firstSeenAt ?? new Date());
    if (normalized && firstSeenAt < normalized.firstSeenAt) {
      normalized.firstSeenAt = firstSeenAt;
    }
  });

  return [...contacts.values()].sort((a, b) => a.email.localeCompare(b.email));
};

const comparableDate = (value: Date | string): string | null => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const contactsComparable = (contacts: IProjectExternalContact[]): string => JSON.stringify(
  contacts
    .map((contact) => ({
      email: contact.email,
      name: contact.name ?? null,
      sources: [...contact.sources].sort(),
      firstSeenAt: comparableDate(contact.firstSeenAt),
      lastSeenAt: comparableDate(contact.lastSeenAt),
    }))
    .sort((a, b) => a.email.localeCompare(b.email)),
);

/**
 * Rebuilds the normalized project snapshot from linked Outlook participants,
 * while merging it with the existing snapshot so older contacts are retained.
 * This is intentionally idempotent and safe to call after every link event.
 */
export const refreshExternalContactsForProject = async (
  projectId: string,
  projectRepository: IProjectRepository,
  outlookEmailRepository: { listParticipantsByProjectId(projectId: string): Promise<IOutlookEmailParticipants[]> },
): Promise<IProjectExternalContact[]> => {
  const project = await projectRepository.findById(projectId);
  if (!project) return [];

  const linkedEmails = await outlookEmailRepository.listParticipantsByProjectId(project.id);
  const contacts = mergeExternalContacts(
    project.externalContacts ?? [],
    collectExternalContacts(linkedEmails),
  );
  const previousContacts = project.externalContacts ?? [];

  if (contactsComparable(contacts) !== contactsComparable(previousContacts)) {
    if (projectRepository.updateExternalContacts) {
      await projectRepository.updateExternalContacts(project.id, contacts);
    } else {
      // Test/fallback repositories may not expose the timestamp-preserving
      // method yet; retain compatibility with the existing repository contract.
      await projectRepository.updateById(project.id, { externalContacts: contacts });
    }
  }

  return contacts;
};
