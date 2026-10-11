import type {
  ApiProject,
  ApiProjectAddress,
} from "@/services/project-workspace";

const cleanPart = (value?: string | null): string | null => {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
};

export const formatProjectAddress = (
  jobAddress?: string | null,
  address?: ApiProjectAddress | null,
): string | null => {
  const canonicalAddress = cleanPart(jobAddress);
  if (canonicalAddress) return canonicalAddress;

  if (!address) return null;

  const parts = [
    address.street,
    address.city,
    address.state,
    address.zipcode,
    address.country,
  ]
    .map(cleanPart)
    .filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(", ") : null;
};

export const getProjectIdentity = (
  project: Pick<ApiProject, "jobAddress" | "address" | "projectName">,
): string =>
  formatProjectAddress(project.jobAddress, project.address) ??
  cleanPart(project.projectName) ??
  "Project";
