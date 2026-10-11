import { STATIC_PROJECTS }
  from "@/shared/data/projects-data";



const normalizeProject =
  (project: any) => {

    if (
      !project?.formData?.projectDetails
    ) {

      return project;

    }


    const source =

      project.source ||

      "created";


    const defaultAction =

      source === "draft"

        ? "Saved Draft"

        : "Project Created";


    const defaultStatus =

      source === "draft"

        ? "Pending"

        : "Not started";


    return {

      ...project,

      source,

      formData: {

        ...project.formData,

        projectDetails: {

          ...project.formData
            .projectDetails,


          status:

            project.formData
              .projectDetails
              .status

            ||

            defaultStatus,


          action:

            project.formData
              .projectDetails
              .action

            ||

            defaultAction

        }

      }

    };

  };



export const getStoredProjects =
  () => {

    const projects = [];


    for (

      let i = 0;

      i < localStorage.length;

      i++

    ) {

      const key =
        localStorage.key(i);


      if (!key)
        continue;


      const isProjectKey =

        key.startsWith(
          "project_"
        )

        ||

        key.startsWith(
          "saved_draft_"
        );


      if (isProjectKey) {

        const project =

          localStorage.getItem(
            key
          );


        if (project) {

          projects.push(

            normalizeProject(

              JSON.parse(project)

            )

          );

        }

      }

    }

    return projects;

  };



// export const getAllProjects =
//   () => {

//     return [

//       ...STATIC_PROJECTS.map(
//         normalizeProject
//       ),

//       ...getStoredProjects()

//     ];

//   };


export const getProjectById =
  (
    projectId: string
  ) => {

    const projects =
      getAllProjects();

    return projects.find(
      (project: any) =>

        project
          ?.formData
          ?.projectDetails
          ?.projectId ===

        projectId
    );

  };

export const getAllProjects = () => {

  const allProjects = [
    // ...STATIC_PROJECTS.map(
    //   normalizeProject
    // ),

    ...getStoredProjects()

  ];


  const uniqueProjects =
    allProjects.filter(
      (
        project,
        index,
        self
      ) => {

        const currentProjectId =
          project?.formData
            ?.projectDetails
            ?.projectId;


        return (
          index ===
          self.findIndex(
            item =>

              item?.formData
                ?.projectDetails
                ?.projectId ===

              currentProjectId
          )
        );

      }
    );

  return uniqueProjects;

};