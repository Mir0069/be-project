// pages/estimator/workspace/tabs/communications/CallRecords.tsx

import { useState } from "react";
import { useParams } from "react-router-dom";
import { FileText, Play, Search, X, Loader2, Copy, Check, Download, PhoneCall } from "lucide-react";
import { useProjectCalls } from "@/features/comms/query/commsQuery";
import type { CallRecord } from "@/shared/types/comms.types";
import RowMenu from "@/features/estimator/workspace/pages/components/RowMenu";
import { callRecordings } from "@/features/estimator/workspace/mockData";

const isMongoId = (id: string) => /^[a-f\d]{24}$/i.test(id);

const CallRecords = () => {
  const { projectId } = useParams();
  const [search, setSearch] = useState("");
  const [activeCall, setActiveCall] = useState<CallRecord | null>(null);

  const isApiProject = !!projectId && isMongoId(projectId);

  // Hook will only query if isApiProject is true
  const { data: apiRecords, isLoading, isError } = useProjectCalls(
    isApiProject ? projectId : undefined
  );

  // Fallback to mock data if it's a static project
  const records: CallRecord[] = isApiProject
    ? (apiRecords ?? [])
    : (callRecordings ?? []).map((c) => ({
      id: c.id,
      title: c.fileName.replace(".txt", ""),
      participants: ["Daniel Harper", "Estimator"],
      date: "May 14, 2026 03:30 PM",
      durationMinutes: 15,
      hasTranscript: true,
      customerName: c.fileName.includes("Daniel") ? "Daniel Harper" : c.fileName.includes("Emily") ? "Emily" : "Michael",
      summaryText: `This is a simulated transcript for "${c.fileName}".\n\nThe call discussed the design review, dimensions, specifications, and frame requirements for the GFS project layout. The team confirmed Series 2000 system with thermally broken support structure. Details on anodized finish and structural spans were also reviewed to prepare the final Bill of Materials.`,
      transcriptFileName: c.fileName,
    }));

  const filtered = records.filter(
    (c) =>
      (c.title || "").toLowerCase().includes(search.toLowerCase()) ||
      (c.customerName || "").toLowerCase().includes(search.toLowerCase()) ||
      (c.summaryText || "").toLowerCase().includes(search.toLowerCase()) ||
      (c.transcriptFileName || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4 h-full flex flex-col">
      <header>
        <h2 className="text-base font-semibold text-gray-800">
          Communications Hub - Call Records
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          Listen back and review transcripts of all your project calls
        </p>
      </header>

      {/* Search Bar */}
      <div className="relative max-w-3xl shrink-0">
        <Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search Call Records by caller name, file name or transcript text..."
          className="w-full bg-white border border-gray-200 rounded-md pl-9 pr-3 py-2 text-sm outline-none focus:border-red-500 transition"
        />
      </div>

      {/* Content Area */}
      <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-gray-400">
            <Loader2 size={24} className="animate-spin text-red-500" />
            <span className="text-sm">Loading call records...</span>
          </div>
        ) : isError ? (
          <div className="max-w-3xl bg-red-50 border border-red-200 rounded-md p-4 text-center">
            <p className="text-sm text-red-600 font-medium">
              Couldn't load call records from backend.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="max-w-3xl bg-white border border-gray-200 rounded-md py-16 px-4 flex flex-col items-center justify-center text-center">
            <PhoneCall size={28} className="text-gray-300 mb-3" />
            <p className="text-sm text-gray-500 font-medium">No call records found.</p>
            <p className="text-xs text-gray-400 mt-1">Try refining your search query or check back later.</p>
          </div>
        ) : (
          <ul className="space-y-3 max-w-3xl pb-6">
            {filtered.map((c) => {
              const fileName = c.transcriptFileName || `${c.title || "Call"}.txt`;
              const displayName = c.customerName ? `Call with ${c.customerName}` : fileName;

              return (
                <li
                  key={c.id}
                  onClick={() => setActiveCall(c)}
                  className="bg-white border border-gray-200 rounded-md p-3.5 flex items-center gap-4 hover:border-red-300 hover:shadow-sm cursor-pointer transition"
                >
                  <div className="w-9 h-9 rounded bg-red-50 flex items-center justify-center shrink-0 text-red-500">
                    <FileText size={16} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">
                      {displayName}
                    </p>
                    <div className="flex items-center gap-3 mt-1.5">
                      <span className="text-xs text-gray-400">
                        {c.date || (c.callDate ? new Date(c.callDate).toLocaleDateString() : "")}
                      </span>
                      {c.summaryText && (
                        <span className="text-[10px] bg-green-50 text-green-700 px-1.5 py-0.5 rounded font-medium">
                          Transcript ready
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    aria-label="View Transcript"
                    className="w-8 h-8 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 transition shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveCall(c);
                    }}
                  >
                    <Play size={14} fill="currentColor" className="text-gray-600" />
                  </button>

                  <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                    <RowMenu />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Transcript Detail Modal */}
      {activeCall && (
        <CallTranscriptModal call={activeCall} onClose={() => setActiveCall(null)} />
      )}
    </div>
  );
};

interface CallTranscriptModalProps {
  call: CallRecord;
  onClose: () => void;
}

const CallTranscriptModal = ({ call, onClose }: CallTranscriptModalProps) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!call.summaryText) return;
    try {
      await navigator.clipboard.writeText(call.summaryText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy transcript: ", err);
    }
  };

  const displayName = call.customerName ? `Call with ${call.customerName}` : call.transcriptFileName || "Call Record";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs px-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl p-6 relative max-h-[85vh] flex flex-col animate-in fade-in duration-200">
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition"
        >
          <X size={20} />
        </button>

        {/* Modal Header */}
        <div className="border-b border-gray-100 pb-4 mb-4 shrink-0 pr-8">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-red-500 bg-red-50 px-2 py-0.5 rounded">
              Transcript
            </span>
            <span className="text-xs text-gray-500">
              {call.date || (call.callDate ? new Date(call.callDate).toLocaleDateString() : "")}
            </span>
          </div>
          <h3 className="text-lg font-bold text-gray-900 truncate">
            {displayName}
          </h3>
        </div>

        {/* Modal Body */}
        <div className="flex-1 min-h-0 overflow-y-auto pr-1">
          {call.summaryText ? (
            <div className="bg-gray-50 border border-gray-100 rounded-lg p-4 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
              {call.summaryText}
            </div>
          ) : (
            <p className="text-sm text-gray-400 italic py-6 text-center">
              No transcript text is available for this call.
            </p>
          )}
        </div>

        {/* Modal Footer */}
        <div className="mt-6 border-t border-gray-100 pt-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            {/* {call.transcriptFileUrl && (
              <a
                href={call.transcriptFileUrl}
                download
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-gray-600 hover:text-red-500 bg-gray-50 border border-gray-200 px-3 py-2 rounded-md font-medium transition"
              >
                <Download size={14} />
                Download Original Audio
              </a>
            )} */}
          </div>
          <div className="flex items-center gap-3">
            {call.summaryText && (
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 text-xs bg-gray-50 hover:bg-gray-100 text-gray-700 border border-gray-200 px-3 py-2 rounded-md font-medium transition"
              >
                {copied ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
                {copied ? "Copied!" : "Copy Text"}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="text-xs bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 rounded-md font-medium transition"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CallRecords;
