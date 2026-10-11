// pages/SalesManagerDashboard.tsx

import {
  ExternalLink,
  Filter,
  Folder
} from "lucide-react";

import StatusBadge
  from "@/features/sales-manager/projects/components/StatusBadge";

import {
  recentActivities
} from "@/features/sales-manager/data/mockData";

import {
  getLocalStorageActivities
} from "@/utils/project-activities";
import { useNavigate } from "react-router-dom";


const SalesManagerDashboard = () => {

  const navigate = useNavigate();

  // const localStorageActivities = getLocalStorageActivities();
  const localStorageActivities = [] as any[];


  const allActivities = [

    ...localStorageActivities,

    // ...recentActivities

  ].filter(
    (
      activity,
      index,
      self
    ) => {

      return (
        index ===
        self.findIndex(
          item =>

            item.projectCode ===
            activity.projectCode

            &&

            item.action ===
            activity.action
        )
      );

    }
  );

  const ACTIVITY_ROUTE_MAP: Record<string, string> = {

    "Project Created":
      "documents",

    "Proposal Review":
      "proposal",

    "AI Analysis":
      "ai-insight",

    "Set Parameter":
      "parameters",

    "BOM & Pricing":
      "bom",

  };


  return (

    <div className="space-y-6">

      <div className="border-l-3 border-red-500 px-4">

        <div className="
          text-2xl
          font-medium
          text-red-500
          leading-[1.9rem]
        ">
          Dashboard
        </div>

      </div>



      <section className="
        bg-white
        rounded-lg
        border border-gray-200
        p-5
      ">

        <div className="
          flex items-center justify-between
          mb-4
        ">

          <h2 className="
            text-lg
            font-semibold
            text-red-500
          ">
            Recent Activities
          </h2>

          <button
            type="button"
            aria-label="Filter"
            className="
              w-8 h-8
              flex items-center justify-center
              rounded-md
              bg-red-500
              text-white
              hover:bg-black
              transition
            "
          >

            <Filter size={16} />

          </button>

        </div>



        <div className="overflow-x-auto">

          <table className="w-full text-sm">

            <thead>

              <tr className="
                text-xs
                uppercase
                tracking-wide
                text-gray-500
                border-b border-gray-200
              ">

                <th className="
                  text-left py-3
                  font-semibold
                ">
                  Project
                </th>

                <th className="
                  text-left py-3
                  font-semibold
                ">
                  Activity
                </th>

                <th className="
                  text-left py-3
                  font-semibold
                ">
                  Status
                </th>

                <th className="
                  text-left py-3
                  font-semibold
                ">
                  Updated
                </th>

                <th className="
                  text-left py-3
                  font-semibold
                ">
                  Visit
                </th>

              </tr>

            </thead>



            <tbody>

              {allActivities.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="
                      py-8
                      text-center
                      text-gray-500
                      italic
                    "
                  >
                    No recent activities found.
                  </td>
                </tr>
              ) : (
                allActivities.map(
                  (row) => (

                    <tr
                      key={row.id}
                      className="
                        border-b border-gray-100
                        last:border-0
                      "
                    >

                      {/* PROJECT */}

                      <td className="py-3">

                        <div className="
                          flex items-center gap-2
                        ">

                          <Folder
                            size={18}
                            className="text-gray-700"
                          />

                          <div>

                            <p className="
                              text-sm
                              font-medium
                              text-gray-800
                            ">

                              {row.projectName}

                            </p>

                            <p className="
                              text-xs
                              text-gray-500
                            ">

                              Project:
                              {" "}
                              {row.projectCode}

                            </p>

                          </div>

                        </div>

                      </td>


                      {/* ACTIVITY */}

                      <td className="
                        py-3
                        text-gray-700
                      ">

                        {row.action}

                      </td>



                      {/* STATUS */}

                      <td className="py-3">

                        <StatusBadge
                          status={row.status}
                        />

                      </td>



                      {/* DATE */}

                      <td className="
                        py-3
                        text-gray-600
                      ">

                        {row.date}

                      </td>



                      {/* VISIT */}

                      <td className="py-3">

                        {/* <button
                          type="button"
                          className="
                            text-gray-500
                            hover:text-red-500
                            transition
                            hover:cursor-pointer
                          "
                        >

                          <ExternalLink
                            size={16}
                          />

                        </button> */}

                        <button
                          type="button"
                          onClick={() => {

                            const route =
                              ACTIVITY_ROUTE_MAP[
                              row.action
                              ] || "dashboard";

                            navigate(
                              `/projects/${row.projectCode}/${route}`
                            );

                          }}
                          className="
      text-gray-500
      hover:text-red-500
      transition
      hover:cursor-pointer
    "
                        >

                          <ExternalLink
                            size={16}
                          />

                        </button>
                      </td>

                    </tr>

                  )
                )
              )}

            </tbody>

          </table>

        </div>

      </section>

    </div>

  );

};

export default SalesManagerDashboard;
