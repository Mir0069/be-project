// utils/project-activities.ts

import { getStoredProjects }
from "./project-storage";

import type {
  DashboardActivity
} from "@/features/sales-manager/data/mockData";



const formatActivityDate =
  (
    dateString: string
  ) => {

    const date =
      new Date(dateString);

    const now =
      new Date();

    const diffMs =
      now.getTime() -
      date.getTime();

    const diffHours =
      Math.floor(
        diffMs /
        (1000 * 60 * 60)
      );

    const diffDays =
      Math.floor(
        diffHours / 24
      );


    /* WITHIN 24 HOURS */

    if (diffHours < 24) {

      if (diffHours <= 1) {
        return "1 hour ago";
      }

      return `${diffHours} hours ago`;

    }


    /* YESTERDAY */

    if (diffDays === 1) {

      return `Yesterday, ${date.toLocaleTimeString(
        [],
        {
          hour: "numeric",
          minute: "2-digit"
        }
      )}`;

    }


    /* DEFAULT */

    return date.toLocaleDateString(
      [],
      {
        month: "numeric",
        day: "numeric",
        year: "numeric"
      }
    );

  };



export const getLocalStorageActivities =
  (): DashboardActivity[] => {

    const projects =
      getStoredProjects();


    return projects.map(
      (project: any) => {

        const details =
          project.formData
            ?.projectDetails;


        const source =
          project.source ||
          "created";


        return {

          id:
            project.id,


          projectName:
            details?.projectName,


          projectCode:
            details?.projectId,


          action:

            source === "draft"

              ? "Saved Draft"

              : (

                details?.action

                ||

                "Project Created"

              ),


          status:

            details?.status

            ||

            (
              source === "draft"
                ? "Pending"
                : "Not started"
            ),


          date:
            formatActivityDate(
              project.updatedAt ||
              project.createdAt
            )

        };

      }

    );

  };