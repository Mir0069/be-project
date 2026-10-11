import { STATIC_PROJECTS } from "@/shared/data/projects-data";



const LOCAL_STORAGE_KEY =
  "projects";



const formatRelativeDate =
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
        month: "short",
        day: "2-digit",
        year: "numeric"
      }
    );

  };



const getLocalStorageProjects = () => {

  try {

    const projects = [];

    for (let i = 0; i < localStorage.length; i++) {

      const key = localStorage.key(i);

      if (key?.startsWith("project_")) {

        const projectData =
          localStorage.getItem(key);

        if (projectData) {

          projects.push(
            JSON.parse(projectData)
          );

        }

      }

    }

    return projects;

  }

  catch {

    return [];

  }

};



export const getEstimatorProjectsList =
  () => {

    const localProjects =
      getLocalStorageProjects();


    /*
      ONLY STATIC + CREATED
      EXCLUDE DRAFT
    */

    const mergedProjects = [

      // ...STATIC_PROJECTS,

      ...localProjects.filter(
        (project: any) =>
          project?.source === "created"
      )

    ];


    /*
      DEDUPLICATE USING PROJECT ID
    */

    const uniqueProjects =
      Array.from(

        new Map(

          mergedProjects.map(
            (project: any) => [

              project?.formData
                ?.projectDetails
                ?.projectId,

              project

            ]
          )

        ).values()

      );


    return uniqueProjects.map(
      (project: any) => {

        const details =
          project?.formData
            ?.projectDetails;

        const client =
          project?.formData
            ?.clientDetails;

        return {

          id:
            project?.id,

          projectName:
            details?.projectName,

          projectId:
            details?.projectId,

          customer:
            client?.companyName,

          poc:
            `${client?.firstName || ""}
             ${client?.lastName || ""}`
              .trim(),

          status:
            details?.status,

          action:
            details?.action,

          lastUpdate:
            formatRelativeDate(
              project?.updatedAt ||
              project?.createdAt
            ),

          assignments:
            project?.formData?.assignments || [],

          dueDate:
            details?.expectedCompletionDate
              ? new Date(
                details.expectedCompletionDate
              ).toLocaleDateString(
                "en-US",
                {
                  month: "short",
                  day: "2-digit",
                  year: "numeric"
                }
              )
              : "-",

          bidDate:
            details?.bidDeadline
              ? new Date(
                details.bidDeadline
              ).toLocaleDateString(
                "en-US",
                {
                  month: "short",
                  day: "2-digit",
                  year: "numeric"
                }
              )
              : "-"

        };

      }

    );

  };

