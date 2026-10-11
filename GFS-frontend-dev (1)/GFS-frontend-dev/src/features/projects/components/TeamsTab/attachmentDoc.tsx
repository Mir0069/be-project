import { createContext, useContext, useMemo, type ReactNode } from "react";

import { useDocuments } from "@/features/projects/query/documentsQuery";

/** Resolves a Teams message attachment to its ingested document id (so the
 *  chip can open the same inline preview as the Documents tab). */
type Resolver = (messageId: string, fileName?: string | null) => string | undefined;

const AttachmentDocContext = createContext<Resolver>(() => undefined);

export const useAttachmentDoc = () => useContext(AttachmentDocContext);

/** Loads the project's documents once and exposes a (messageId, name) lookup to
 *  every attachment chip below. Teams docs carry metadata.messageId + originalName. */
export const AttachmentDocProvider = ({
  projectId,
  children,
}: {
  projectId?: string;
  children: ReactNode;
}) => {
  const { data: docs } = useDocuments(projectId);

  const resolve = useMemo<Resolver>(() => {
    const map = new Map<string, string>();
    for (const d of docs ?? []) {
      const messageId = d.metadata?.messageId;
      if (typeof messageId === "string") map.set(`${messageId}::${d.originalName}`, d.id);
    }
    return (messageId, fileName) =>
      fileName ? map.get(`${messageId}::${fileName}`) : undefined;
  }, [docs]);

  return <AttachmentDocContext.Provider value={resolve}>{children}</AttachmentDocContext.Provider>;
};
