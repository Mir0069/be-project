// export const formatLastActivity = (
//   date: Date
// ) => {

//   const now =
//     new Date();

//   const diffMs =
//     now.getTime() -
//     date.getTime();

//   const diffMinutes =
//     Math.floor(
//       diffMs / (1000 * 60)
//     );

//   const diffHours =
//     Math.floor(
//       diffMs / (1000 * 60 * 60)
//     );

//   const diffDays =
//     Math.floor(
//       diffMs /
//       (1000 * 60 * 60 * 24)
//     );

//   if (diffMinutes < 60) {

//     return `${diffMinutes} minutes ago`;

//   }

//   if (diffHours < 24) {

//     return `${diffHours} hours ago`;

//   }

//   if (diffDays === 1) {

//     return `Yesterday, ${date.toLocaleTimeString(
//       [],
//       {
//         hour: "numeric",
//         minute: "2-digit",
//       }
//     )}`;

//   }

//   return date.toLocaleString(
//     "en-GB",
//     {
//       day: "numeric",
//       month: "numeric",
//       year: "numeric",
//       hour: "numeric",
//       minute: "2-digit",
//     }
//   );
// };

import type { KanbanStatus } from "@/features/kanban/types/kanban.types";

export const formatLastActivity = (date: Date, status: KanbanStatus) => {
  const now = new Date();

  const diffMs = now.getTime() - date.getTime();

  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  /* ACTIVE */

  if (status === "active") {
    if (diffHours < 24) {
      return `${diffHours} hours ago`;
    }

    return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
  }

  /* WAITING */

  if (status === "waiting") {
    return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
  }

  /* STALLED / COMPLETED */

  return date.toLocaleString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",

    hour: "numeric",
    minute: "2-digit",

    hour12: true,
  });
};
