import { hasAnyRole } from "@/shared/lib/roleAccess";
import type { UserRole } from "@/shared/types/auth.types";
import type { CallDirectoryUser } from "@/services/teams-call";

export const TEAMS_CALL_URL = "https://teams.microsoft.com/l/call/0/0";

// Teams caps a group call at 20 people, caller included.
export const MAX_CALLEES = 19;

// Head of Division inherits both roles, so it passes this check too.
const CALLER_ROLES: readonly UserRole[] = ["ESTIMATOR", "SALES_MANAGER"];

// Mirrors the roles /users/estimators allows; an estimator asking for it gets a 403.
const ESTIMATOR_DIRECTORY_ROLES: readonly UserRole[] = ["SALES_MANAGER", "SYSTEM_ADMIN", "SUPER_ADMIN"];

export interface CallContact {
  id: string;
  name: string;
  email: string;
}

export interface CallGroup {
  key: "project" | "salesManagers" | "estimators" | "headsOfDivision";
  label: string;
  contacts: CallContact[];
}

export interface AssignedPerson {
  id: string;
  name?: string | null;
  email?: string | null;
}

export const canStartTeamsCall = (role: string | null | undefined): boolean =>
  hasAnyRole(role, CALLER_ROLES);

export const canListEstimators = (role: string | null | undefined): boolean =>
  hasAnyRole(role, ESTIMATOR_DIRECTORY_ROLES);

export const buildTeamsCallLink = (emails: readonly string[]): string =>
  `${TEAMS_CALL_URL}?users=${emails.map((email) => encodeURIComponent(email)).join(",")}&withVideo=true`;

const byName = (a: CallContact, b: CallContact) => a.name.localeCompare(b.name);

const fromDirectory = (user: CallDirectoryUser): CallContact => ({
  id: user.id,
  name: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.email,
  email: user.email,
});

const fromAssigned = (person: AssignedPerson): CallContact => ({
  id: person.id,
  name: person.name?.trim() || person.email || "",
  email: person.email ?? "",
});

// Earlier groups win on duplicates, so an estimator on the project stays under "On this project".
export const buildCallGroups = (
  assigned: readonly AssignedPerson[],
  directory: readonly CallDirectoryUser[],
  selfId?: string,
): CallGroup[] => {
  const seen = new Set<string>(selfId ? [selfId] : []);
  const take = (contacts: CallContact[]): CallContact[] => {
    const fresh: CallContact[] = [];
    for (const contact of contacts) {
      if (!contact.email || seen.has(contact.id)) continue;
      seen.add(contact.id);
      fresh.push(contact);
    }
    return fresh.sort(byName);
  };
  const withRole = (role: UserRole) => directory.filter((u) => u.role === role).map(fromDirectory);

  const groups: CallGroup[] = [
    { key: "project", label: "On this project", contacts: take(assigned.map(fromAssigned)) },
    { key: "salesManagers", label: "Sales Managers", contacts: take(withRole("SALES_MANAGER")) },
    { key: "estimators", label: "Estimators", contacts: take(withRole("ESTIMATOR")) },
    { key: "headsOfDivision", label: "Heads of Division", contacts: take(withRole("HEAD_OF_DIVISION")) },
  ];
  return groups.filter((group) => group.contacts.length > 0);
};

export const filterCallGroups = (groups: readonly CallGroup[], query: string): readonly CallGroup[] => {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  const matches = (c: CallContact) => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q);
  return groups
    .map((group) => ({ ...group, contacts: group.contacts.filter(matches) }))
    .filter((group) => group.contacts.length > 0);
};
