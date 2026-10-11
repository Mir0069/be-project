import { useState } from "react";
import { ReviseStageModal } from "./ReviseStageModal";

interface ReviseStageButtonProps {
  projectId: string;
  stage: number;
  stageName?: string;
  onRevised?: () => void | Promise<unknown>;
  onRevisionStateChange?: (inProgress: boolean) => void;
  className?: string;
  label?: string;
}

const DEFAULT_CLASSES =
  "inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-6 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50";

export const ReviseStageButton = ({
  projectId,
  stage,
  stageName,
  onRevised,
  onRevisionStateChange,
  className,
  label = "Revise Stage",
}: ReviseStageButtonProps) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className ?? DEFAULT_CLASSES}
      >
        {label}
      </button>
      {open && (
        <ReviseStageModal
          open={open}
          onClose={() => setOpen(false)}
          projectId={projectId}
          stage={stage}
          stageName={stageName}
          onRevised={onRevised}
          onRevisionStateChange={onRevisionStateChange}
        />
      )}
    </>
  );
};
