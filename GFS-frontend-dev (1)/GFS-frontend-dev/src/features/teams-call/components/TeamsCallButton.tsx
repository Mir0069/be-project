import { useState } from "react";
import { Video } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { canStartTeamsCall, type AssignedPerson } from "@/features/teams-call/utils/teamsCall";
import { TeamsCallDialog } from "./TeamsCallDialog";

const NO_ONE: readonly AssignedPerson[] = [];

interface TeamsCallButtonProps {
  assigned?: readonly AssignedPerson[];
}

export const TeamsCallButton = ({ assigned = NO_ONE }: TeamsCallButtonProps) => {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  if (!canStartTeamsCall(user?.role)) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-semibold text-red-600 bg-white border border-red-200 rounded-lg hover:bg-red-50 transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30"
      >
        <Video size={16} />
        Discuss on Teams
      </button>
      {open && (
        <TeamsCallDialog
          assigned={assigned}
          selfId={user?.id}
          callerRole={user?.role}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
};
