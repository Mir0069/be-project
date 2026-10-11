import { RotateCcw } from "lucide-react";
import type { ProposalRevision } from "@/shared/types/proposalStage.types";

interface RevisionInfoProps {
  revisionCount?: number;
  latestRevision?: ProposalRevision;
}

export const RevisionInfo = ({ revisionCount, latestRevision }: RevisionInfoProps) => {
  if (!revisionCount || revisionCount === 0) return null;

  return (
    <div className="flex items-start gap-2 text-sm">
      <RotateCcw size={16} className="mt-0.5 shrink-0 text-amber-500" />
      <div>
        <p className="font-medium text-amber-700">
          Revision #{revisionCount}
          {latestRevision?.reason ? (
            <>
              {" — "}
              <span className="italic">“{latestRevision.reason}”</span>
            </>
          ) : null}
        </p>
        {latestRevision ? (
          <p className="text-xs text-gray-500">
            Revised by {latestRevision.revisedBy} ·{" "}
            {new Date(latestRevision.revisedAt).toLocaleString()}
          </p>
        ) : null}
      </div>
    </div>
  );
};
