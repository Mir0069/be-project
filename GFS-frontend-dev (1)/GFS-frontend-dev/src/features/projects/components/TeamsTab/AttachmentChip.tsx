import { Paperclip, Loader2 } from "lucide-react";

import type { TeamsAttachment } from "@/shared/types/teams.types";
import { usePreviewDocument } from "@/features/projects/query/documentsQuery";

import { useAttachmentDoc } from "./attachmentDoc";
import { openDocumentPreview } from "@/shared/lib/filePreview";

const CHIP = "inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-md";

export const AttachmentChip = ({
  attachment,
  messageId,
}: {
  attachment: TeamsAttachment;
  messageId?: string;
}) => {
  const resolve = useAttachmentDoc();
  const documentId = messageId ? resolve(messageId, attachment.name) : undefined;
  const previewMutation = usePreviewDocument();

  const inner = (
    <>
      {previewMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Paperclip size={12} />}
      <span className="truncate max-w-[180px]">{attachment.name || "attachment"}</span>
      {attachment.downloaded && (
        <span title="Saved to Documents" className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
      )}
    </>
  );

  // Ingested document → open the same inline preview as the Documents tab.
  if (documentId) {
    const view = () => {
      openDocumentPreview(documentId, attachment.name || "attachment");
    };
    return (
      <button type="button" onClick={view} className={`${CHIP} hover:bg-gray-200`} title="View file">
        {inner}
      </button>
    );
  }

  // Not ingested yet → fall back to the source link if any.
  return attachment.contentUrl ? (
    <a
      href={attachment.contentUrl}
      target="_blank"
      rel="noreferrer"
      className={`${CHIP} hover:bg-gray-200`}
    >
      {inner}
    </a>
  ) : (
    <span className={CHIP}>{inner}</span>
  );
};

export default AttachmentChip;
