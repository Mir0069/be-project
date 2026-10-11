import { Loader2 } from "lucide-react";

import type { TeamsMeetingSummary } from "@/shared/types/teams.types";

import { MeetingCard } from "./MeetingCard";

export const MeetingsList = ({
  meetings,
  isLoading,
}: {
  meetings?: TeamsMeetingSummary[];
  isLoading?: boolean;
}) => {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-400 py-4">
        <Loader2 size={16} className="animate-spin" /> Loading meetings…
      </div>
    );
  }

  if (!meetings || meetings.length === 0) {
    return <p className="text-sm text-gray-400 italic">No Teams meetings</p>;
  }

  return (
    <ul className="space-y-3">
      {meetings.map((meeting) => (
        <MeetingCard key={meeting.id} meeting={meeting} />
      ))}
    </ul>
  );
};

export default MeetingsList;
