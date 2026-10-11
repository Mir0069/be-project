// import { useState } from "react";

// import { useNavigate } from "react-router-dom";

// import {
//   ExternalLink,
//   Filter,
//   Folder,
// } from "lucide-react";

// import StatusBadge from "@/features/estimator/components/StatusBadge";

// import { myTasks } from "@/features/estimator/data/estimator-task.data";

// import { recentActivities } from "@/features/estimator/data/estimator-recent-activities.data";
// import { useAuth } from "@/context/AuthContext";

// import type { UserRole } from "@/shared/types/auth.types";

// const EstimatorDashboard = () => {
//   const { user } = useAuth();
//   const email = user?.email
//   const role = user?.role;

//   console.log(email, role);

//   const isAssignedToCurrentUser = (
//     item: any
//   ) => {

//     const assignedUsers =
//       item?.assignments || [];

//     return assignedUsers.some(
//       (assignedUser: any) =>
//         assignedUser?.email?.toLowerCase() ===
//         email?.toLowerCase()
//     );

//   };



//   const filteredTasks =

//     role === "SYSTEM_ADMIN"

//       ? myTasks

//       : myTasks.filter(
//         (task: any) =>
//           isAssignedToCurrentUser(task)
//       );

//   const filteredActivities =

//     role === "SYSTEM_ADMIN"

//       ? recentActivities

//       : recentActivities.filter(
//         (activity: any) =>
//           isAssignedToCurrentUser(activity)
//       );


//   const navigate =
//     useNavigate();

//   const [checkedTasks, setCheckedTasks] =
//     useState<Record<string, boolean>>({});


//   const toggleTask = (
//     id: string
//   ) => {

//     setCheckedTasks((prev) => ({
//       ...prev,
//       [id]: !prev[id],
//     }));

//   };


//   /* =========================================
//       TASK NAVIGATION
//      ========================================= */

//   const getTaskNavigationPath = (
//     task: any
//   ) => {

//     const projectId =
//       task.projectCode;

//     const title =
//       task.title?.toLowerCase();


//     /* PROPOSAL */

//     if (
//       title?.includes("proposal")
//     ) {

//       return `/projects/${projectId}/proposal`;

//     }


//     /* DOCUMENT INGESTION */

//     if (
//       title?.includes("ingest")
//     ) {

//       return `/projects/${projectId}/documents`;

//     }


//     /* PARAMETERS */

//     if (
//       title?.includes("parameter")
//     ) {

//       return `/projects/${projectId}/parameters`;

//     }


//     /* BOM */

//     if (
//       title?.includes("bom")
//     ) {

//       return `/projects/${projectId}/bom`;

//     }


//     /* DEFAULT */

//     return `/projects/${projectId}/ai-insight`;

//   };


//   const handleTaskOpen = (
//     task: any
//   ) => {

//     const path =
//       getTaskNavigationPath(task);

//     navigate(path);

//   };


//   /* =========================================
//       RECENT ACTIVITY NAVIGATION
//      ========================================= */

//   const getActivityNavigationPath = (
//     activity: any
//   ) => {

//     const projectId =
//       activity.projectCode;

//     const action =
//       activity.action?.toLowerCase();


//     /* AI ANALYSIS */

//     if (
//       action?.includes("ai")
//     ) {

//       return `/projects/${projectId}/ai-insight`;

//     }


//     /* PROPOSAL */

//     if (
//       action?.includes("proposal")
//     ) {

//       return `/projects/${projectId}/proposal`;

//     }


//     /* BOM */

//     if (
//       action?.includes("bom")
//     ) {

//       return `/projects/${projectId}/bom`;

//     }


//     /* DOCUMENTS */

//     if (
//       action?.includes("document")
//     ) {

//       return `/projects/${projectId}/documents`;

//     }


//     /* DEFAULT */

//     return `/projects/${projectId}`;

//   };


//   const handleActivityOpen = (
//     activity: any
//   ) => {

//     const path =
//       getActivityNavigationPath(
//         activity
//       );

//     navigate(path);

//   };


//   return (

//     <div className="space-y-8">

//       {/* HEADER */}

//       <div className="border-l-3 border-red-500 px-4">

//         <div className="text-2xl font-medium text-red-500 leading-[1.9rem]">
//           Dashboard
//         </div>

//         <div className="text-md text-gray-500 mt-2">
//           Track assigned projects, manage pending tasks and monitor
//           project activities from a centralized workspace.
//         </div>

//       </div>


//       {/* =========================================
//           MY TASKS
//          ========================================= */}

//       <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">

//         <div className="flex items-center justify-between mb-4">

//           <h2 className="text-lg font-semibold text-red-500">
//             My Tasks
//           </h2>

//           <button
//             type="button"
//             className="text-sm text-gray-700 hover:text-gray-900 hover:underline"
//           >
//             View all
//           </button>

//         </div>


//         <ul className="divide-y divide-gray-100">

//           {filteredTasks.map((task) => (

//             <li
//               key={task.id}
//               className="flex items-center justify-between py-3"
//             >

//               <label className="flex items-start gap-3 cursor-pointer">

//                 <input
//                   type="checkbox"
//                   checked={!!checkedTasks[task.id]}
//                   onChange={() => toggleTask(task.id)}
//                   className="mt-1 w-4 h-4 accent-red-500"
//                 />

//                 <div>

//                   <p
//                     className={`text-sm font-semibold text-black ${checkedTasks[task.id]
//                       ? "line-through opacity-60 text-red-500"
//                       : ""
//                       }`}
//                   >
//                     {task.title}
//                   </p>

//                   <div className="flex items-center gap-2 mt-2">
//                     <div className="text-sm text-gray-700">
//                       Project: {task.projectName}
//                     </div>
//                     <div className="text-xs text-gray-700 px-3 py-0.5 bg-gray-200 rounded-md">
//                       {task.projectCode}
//                     </div>
//                   </div>
//                 </div>

//               </label>


//               <div className="flex items-center gap-2">

//                 <button
//                   type="button"
//                   onClick={() => handleTaskOpen(task)}
//                   className="px-4 py-1 text-sm border border-gray-300 rounded-md text-gray-700 hover:border-red-500 hover:text-red-500 transition"
//                 >
//                   Open
//                 </button>

//               </div>

//             </li>

//           ))}

//         </ul>

//       </section>


//       {/* =========================================
//           RECENT ACTIVITIES
//          ========================================= */}

//       <section className="bg-white rounded-lg border border-gray-200 p-5">

//         <div className="flex items-center justify-between mb-4">

//           <h2 className="text-lg font-semibold text-red-500">
//             Recent Activities
//           </h2>

//           <button
//             type="button"
//             aria-label="Filter"
//             className="w-8 h-8 flex items-center justify-center rounded-md bg-red-500 text-white hover:bg-red-600 transition"
//           >
//             <Filter size={16} />
//           </button>

//         </div>


//         <div className="overflow-x-auto">

//           <table className="w-full text-sm">

//             <thead>

//               <tr className="text-xs uppercase tracking-wide text-gray-500 border-b border-gray-200">

//                 <th className="text-left py-3 font-semibold">
//                   Project
//                 </th>

//                 <th className="text-left py-3 font-semibold">
//                   Action
//                 </th>

//                 <th className="text-left py-3 font-semibold">
//                   Status
//                 </th>

//                 <th className="text-left py-3 font-semibold">
//                   Updated
//                 </th>

//                 <th className="text-left py-3 font-semibold">
//                   Visit
//                 </th>

//               </tr>

//             </thead>


//             <tbody>

//               {filteredActivities.map((row) => (

//                 <tr
//                   key={row.id}
//                   className="border-b border-gray-100 last:border-0"
//                 >

//                   {/* PROJECT */}

//                   <td className="py-3">

//                     <div className="flex items-center gap-2">

//                       <Folder
//                         size={18}
//                         className="text-gray-700"
//                       />

//                       <div>

//                         <p className="text-sm font-medium text-gray-800">
//                           {row.projectName}
//                         </p>

//                         <p className="text-xs text-gray-500">
//                           Project: {row.projectCode}
//                         </p>

//                       </div>

//                     </div>

//                   </td>


//                   {/* ACTION */}

//                   <td className="py-3 text-gray-700">
//                     {row.action}
//                   </td>


//                   {/* STATUS */}

//                   <td className="py-3">

//                     <StatusBadge
//                       status={row.status}
//                     />

//                   </td>


//                   {/* UPDATED */}

//                   <td className="py-3 text-gray-600 whitespace-nowrap">

//                     {row.date}

//                   </td>


//                   {/* VISIT */}

//                   <td className="py-3">

//                     <button
//                       type="button"
//                       onClick={() => handleActivityOpen(row)}
//                       className="text-gray-500 hover:text-red-500 transition"
//                     >
//                       <ExternalLink size={18} />
//                     </button>

//                   </td>

//                 </tr>

//               ))}

//             </tbody>

//           </table>

//         </div>

//       </section>

//     </div>

//   );

// };

// export default EstimatorDashboard;


import { useState } from "react";

import { useNavigate } from "react-router-dom";

import {
  ExternalLink,
  Filter,
  Folder,
} from "lucide-react";

import StatusBadge from "@/features/estimator/components/StatusBadge";

import { myTasks } from "@/features/estimator/data/estimator-task.data";

import { recentActivities } from "@/features/estimator/data/estimator-recent-activities.data";

import { useAuth } from "@/context/AuthContext";


const EstimatorDashboard = () => {

  const { user } = useAuth();

  const email = user?.email;

  const role = user?.role;

  const navigate =
    useNavigate();

  const [checkedTasks, setCheckedTasks] =
    useState<Record<string, boolean>>({});


  const isAssignedToCurrentUser = (
    item: any
  ) => {

    const assignedUsers =
      item?.assignments || [];

    return assignedUsers.some(
      (assignedUser: any) =>
        assignedUser?.email?.toLowerCase() ===
        email?.toLowerCase()
    );

  };


  const filteredTasks =

    role === "SYSTEM_ADMIN"

      ? myTasks

      : myTasks.filter(
        (task: any) =>
          isAssignedToCurrentUser(task)
      );


  const filteredActivities =

    role === "SYSTEM_ADMIN"

      ? recentActivities

      : recentActivities.filter(
        (activity: any) =>
          isAssignedToCurrentUser(activity)
      );


  const toggleTask = (
    id: string
  ) => {

    setCheckedTasks((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));

  };


  /* =========================================
      TASK NAVIGATION
     ========================================= */

  const getTaskNavigationPath = (
    task: any
  ) => {

    const projectId =
      task.projectCode;

    const title =
      task.title?.toLowerCase();


    /* PROPOSAL */

    if (
      title?.includes("proposal")
    ) {

      return `/projects/${projectId}/proposal`;

    }


    /* DOCUMENT INGESTION */

    if (
      title?.includes("ingest")
    ) {

      return `/projects/${projectId}/documents`;

    }


    /* PARAMETERS */

    if (
      title?.includes("parameter")
    ) {

      return `/projects/${projectId}/parameters`;

    }


    /* BOM */

    if (
      title?.includes("bom")
    ) {

      return `/projects/${projectId}/bom`;

    }


    /* DEFAULT */

    return `/projects/${projectId}/ai-insight`;

  };


  const handleTaskOpen = (
    task: any
  ) => {

    const path =
      getTaskNavigationPath(task);

    navigate(path);

  };


  /* =========================================
      RECENT ACTIVITY NAVIGATION
     ========================================= */

  const getActivityNavigationPath = (
    activity: any
  ) => {

    const projectId =
      activity.projectCode;

    const action =
      activity.action?.toLowerCase();


    /* AI ANALYSIS */

    if (
      action?.includes("ai")
    ) {

      return `/projects/${projectId}/ai-insight`;

    }


    /* PROPOSAL */

    if (
      action?.includes("proposal")
    ) {

      return `/projects/${projectId}/proposal`;

    }


    /* BOM */

    if (
      action?.includes("bom")
    ) {

      return `/projects/${projectId}/bom`;

    }


    /* DOCUMENTS */

    if (
      action?.includes("document")
    ) {

      return `/projects/${projectId}/documents`;

    }


    /* DEFAULT */

    return `/projects/${projectId}`;

  };


  const handleActivityOpen = (
    activity: any
  ) => {

    const path =
      getActivityNavigationPath(
        activity
      );

    navigate(path);

  };


  return (

    <div className="space-y-8">

      {/* HEADER */}

      <div className="border-l-3 border-red-500 px-4">

        <div className="text-2xl font-medium text-red-500 leading-[1.9rem]">
          Dashboard
        </div>

      </div>


      {/* =========================================
          MY TASKS
         ========================================= */}

      <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">

        <div className="flex items-center justify-between mb-4">

          <h2 className="text-lg font-semibold text-red-500">
            My Tasks
          </h2>

          <button
            type="button"
            className="text-sm text-gray-700 hover:text-gray-900 hover:underline"
          >
            View all
          </button>

        </div>


        {
          filteredTasks.length === 0 ? (

            <div className="
              py-10
              text-center
              text-red-500
              font-semibold
            ">

              No Tasks Available

            </div>

          ) : (

            <ul className="divide-y divide-gray-100">

              {filteredTasks.map((task) => (

                <li
                  key={task.id}
                  className="flex items-center justify-between py-3"
                >

                  <label className="flex items-start gap-3 cursor-pointer">

                    <input
                      type="checkbox"
                      checked={!!checkedTasks[task.id]}
                      onChange={() => toggleTask(task.id)}
                      className="mt-1 w-4 h-4 accent-red-500"
                    />

                    <div>

                      <p
                        className={`text-sm font-semibold text-black ${
                          checkedTasks[task.id]
                            ? "line-through opacity-60 text-red-500"
                            : ""
                        }`}
                      >
                        {task.title}
                      </p>

                      <div className="flex items-center gap-2 mt-2">

                        <div className="text-sm text-gray-700">
                          Project: {task.projectName}
                        </div>

                        <div className="text-xs text-gray-700 px-3 py-0.5 bg-gray-200 rounded-md">
                          {task.projectCode}
                        </div>

                      </div>

                    </div>

                  </label>


                  <div className="flex items-center gap-2">

                    <button
                      type="button"
                      onClick={() => handleTaskOpen(task)}
                      className="px-4 py-1 text-sm border border-gray-300 rounded-md text-gray-700 hover:border-red-500 hover:text-red-500 transition"
                    >
                      Open
                    </button>

                  </div>

                </li>

              ))}

            </ul>

          )
        }

      </section>


      {/* =========================================
          RECENT ACTIVITIES
         ========================================= */}

      <section className="bg-white rounded-lg border border-gray-200 p-5">

        <div className="flex items-center justify-between mb-4">

          <h2 className="text-lg font-semibold text-red-500">
            Recent Activities
          </h2>

          <button
            type="button"
            aria-label="Filter"
            className="w-8 h-8 flex items-center justify-center rounded-md bg-red-500 text-white hover:bg-red-600 transition"
          >
            <Filter size={16} />
          </button>

        </div>


        {
          filteredActivities.length === 0 ? (

            <div className="
              py-10
              text-center
              text-red-500
              font-semibold
            ">

              No Recent Activities

            </div>

          ) : (

            <div className="overflow-x-auto">

              <table className="w-full text-sm">

                <thead>

                  <tr className="text-xs uppercase tracking-wide text-gray-500 border-b border-gray-200">

                    <th className="text-left py-3 font-semibold">
                      Project
                    </th>

                    <th className="text-left py-3 font-semibold">
                      Action
                    </th>

                    <th className="text-left py-3 font-semibold">
                      Status
                    </th>

                    <th className="text-left py-3 font-semibold">
                      Updated
                    </th>

                    <th className="text-left py-3 font-semibold">
                      Visit
                    </th>

                  </tr>

                </thead>


                <tbody>

                  {filteredActivities.map((row) => (

                    <tr
                      key={row.id}
                      className="border-b border-gray-100 last:border-0"
                    >

                      {/* PROJECT */}

                      <td className="py-3">

                        <div className="flex items-center gap-2">

                          <Folder
                            size={18}
                            className="text-gray-700"
                          />

                          <div>

                            <p className="text-sm font-medium text-gray-800">
                              {row.projectName}
                            </p>

                            <p className="text-xs text-gray-500">
                              Project: {row.projectCode}
                            </p>

                          </div>

                        </div>

                      </td>


                      {/* ACTION */}

                      <td className="py-3 text-gray-700">
                        {row.action}
                      </td>


                      {/* STATUS */}

                      <td className="py-3">

                        <StatusBadge
                          status={row.status}
                        />

                      </td>


                      {/* UPDATED */}

                      <td className="py-3 text-gray-600 whitespace-nowrap">

                        {row.date}

                      </td>


                      {/* VISIT */}

                      <td className="py-3">

                        <button
                          type="button"
                          onClick={() => handleActivityOpen(row)}
                          className="text-gray-500 hover:text-red-500 transition"
                        >
                          <ExternalLink size={18} />
                        </button>

                      </td>

                    </tr>

                  ))}

                </tbody>

              </table>

            </div>

          )
        }

      </section>

    </div>

  );

};

export default EstimatorDashboard;
