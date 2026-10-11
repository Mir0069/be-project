import { Captions, Download, Eye } from "lucide-react";
import { openStagedBlobInWindow } from "@/shared/lib/filePreview";

import type { TeamsMeetingTranscript } from "@/shared/types/teams.types";

export const TranscriptViewer = ({
  transcript,
  subject,
}: {
  transcript: TeamsMeetingTranscript | null;
  subject?: string | null;
}) => {
  if (!transcript || !transcript.vtt) {
    return <p className="text-sm text-gray-400 italic">No transcript available.</p>;
  }

  const fileName = `${(subject || "meeting").trim().replace(/[^\w.-]+/g, "_")}-transcript.vtt`;

  const withBlobUrl = (fn: (url: string) => void) => {
    const url = URL.createObjectURL(new Blob([transcript.vtt], { type: "text/vtt" }));
    fn(url);
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const view = async () => {
    const previewWindow = window.open("", "_blank");
    if (!previewWindow) return;
    await openStagedBlobInWindow(
      new Blob([transcript.vtt], { type: "text/vtt" }),
      previewWindow,
      fileName,
    );
  };
  const download = () =>
    withBlobUrl((url) => {
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
    });

  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase text-gray-500">Transcript</p>
      <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Captions size={18} className="shrink-0 text-indigo-500" />
          <span className="truncate text-sm text-gray-700">{fileName}</span>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-gray-500">
          <button type="button" onClick={view} title="View transcript" className="hover:text-gray-800">
            <Eye size={16} />
          </button>
          <button type="button" onClick={download} title="Download .vtt" className="hover:text-gray-800">
            <Download size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default TranscriptViewer;
