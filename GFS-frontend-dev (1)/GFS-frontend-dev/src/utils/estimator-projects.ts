import { STATIC_PROJECTS } from "@/shared/data/projects-data";

export const getEstimatorProjects = () => {
  try {
    const localProjects = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);

      if (key?.startsWith("project_")) {
        const projectData = localStorage.getItem(key);

        if (projectData) {
          localProjects.push(JSON.parse(projectData));
        }
      }
    }

    const filteredLocalProjects = localProjects.filter(
      (project: any) => project?.source === "created",
    );

    return [
      // ...STATIC_PROJECTS, 
      ...filteredLocalProjects];
  } catch {
    return [...STATIC_PROJECTS];
    // return []
  }
};
