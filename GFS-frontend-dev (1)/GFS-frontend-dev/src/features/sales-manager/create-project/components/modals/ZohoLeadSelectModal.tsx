// import { useState } from "react";
// import {
//   X,
//   Folder,
//   File,
//   FolderArchive,
// } from "lucide-react";

// import zohoLogo from "@assets/zoho_logo.png";

// import {
//   ZOHO_PROJECTS,
//   type ZohoProject,
// } from "../../../data/zohoLead";

// import { useCreateProject } from "../../context/CreateProjectContext";

// type Props = {
//   open: boolean;
//   onClose: () => void;
// };

// const ZohoLeadSelectModal = ({
//   open,
//   onClose,
// }: Props) => {

//   const [
//     selectedLead,
//     setSelectedLead,
//   ] = useState<ZohoProject | null>(
//     null
//   );

//   const {
//     setProjectData,
//   } = useCreateProject();

//   if (!open) return null;

//   const handleSelect = (
//     project: ZohoProject
//   ) => {

//     // toggle select/unselect
//     if (
//       selectedLead?.id ===
//       project.id
//     ) {
//       setSelectedLead(null);
//       return;
//     }

//     setSelectedLead(project);
//   };

//   // const handleImport = () => {

//   //   if (!selectedLead)
//   //     return;

//   //   setProjectData((prev: any) => ({
//   //     ...prev,

//   //     integrations: {
//   //       ...prev.integrations,

//   //       zoho: {
//   //         integrated: true,
//   //         data: selectedLead,
//   //       },
//   //     },

//   //     formData: {
//   //       ...prev.formData,

//   //       clientDetails:
//   //         selectedLead.clientDetails,

//   //       clientContact:
//   //         selectedLead.clientContact,

//   //       projectDetails:
//   //         selectedLead.projectDetails,
//   //     },
//   //   }));

//   //   onClose();
//   // };


//   const handleImport = () => {

//     if (!selectedLead)
//       return;

//     setProjectData((prev: any) => ({

//       ...prev,


//       /* ========================================
//           RESET + REPLACE ZOHO
//          ======================================== */

//       integrations: {

//         ...prev.integrations,

//         zoho: {

//           integrated: true,

//           data: {
//             ...selectedLead,
//           },

//         },

//       },


//       /* ========================================
//           REPLACE IMPORTED FORM DATA
//          ======================================== */

//       formData: {

//         ...prev.formData,

//         clientDetails: {
//           ...selectedLead.clientDetails,
//         },

//         clientContact: {
//           ...selectedLead.clientContact,

//         },

//         projectDetails: {

//           ...selectedLead.projectDetails,

//           /*
//             PRESERVE EXISTING STATUS
//           */

//           status:
//             prev.formData.projectDetails.status ||

//             "Not started",

//           action:
//             prev.formData.projectDetails.action ||

//             "Project Created",

//         },

//       },

//     }));


//     onClose();

//   };

//   return (

//     <div
//       className="
//       fixed inset-0
//       z-50
//       flex items-center
//       justify-center
//       bg-black/50
//       px-4
//     "
//     >

//       <div
//         className="
//         bg-white
//         rounded-lg
//         shadow-xl
//         w-full
//         max-w-lg
//         p-6
//         relative
//       "
//       >

//         {/* Close */}

//         <button
//           type="button"
//           onClick={onClose}
//           aria-label="Close"
//           className="
//           absolute
//           top-5
//           right-5
//           w-7
//           h-7
//           flex
//           items-center
//           justify-center
//           rounded-md
//           bg-red-500
//           text-white
//           hover:bg-red-600
//           hover:cursor-pointer
//           transition
//         "
//         >
//           <X size={16} />
//         </button>

//         {/* Header */}

//         <div className="mb-5 flex items-start gap-3">

//           <img
//             src={zohoLogo}
//             alt="Zoho"
//             className="h-9 w-auto"
//           />

//           <div>

//             <h3
//               className="
//               text-lg
//               font-semibold
//               text-gray-800
//             "
//             >
//               Import Lead From Zoho
//             </h3>

//             <p
//               className="
//               text-sm
//               text-gray-500
//             "
//             >
//               Choose a project
//             </p>

//           </div>

//         </div>

//         {/* Projects */}

//         <div
//           className="
//           space-y-2
//           max-h-[350px]
//           overflow-y-auto
//           no-scrollbar
//         "
//         >

//           {ZOHO_PROJECTS.map(
//             (project: any) => {

//               const isSelected =
//                 selectedLead?.id ===
//                 project.id;

//               const disableOthers =
//                 selectedLead &&
//                 selectedLead.id !==
//                 project.id;

//               return (

//                 <div
//                   key={project.id}
//                   className={`
//                   border-2
//                   border-gray-200
//                   rounded-md
//                   px-2 py-3
//                   transition

//                   ${isSelected
//                       ? `
//                       border-red-500
//                       border-2
//                       bg-red-50
//                     `
//                       : `
//                       border-gray-200
//                     `
//                     }

//                   ${disableOthers
//                       ? `
//                       opacity-50
//                       pointer-events-none
//                     `
//                       : ""
//                     }
//                 `}
//                 >

//                   <div
//                     className="
//                     flex
//                     items-center
//                     justify-between
//                     gap-3
//                     px-3
//                     py-1
//                   "
//                   >

//                     <div
//                       className="
//                       flex
//                       items-center
//                       gap-3
//                       min-w-0
//                     "
//                     >

//                       {/* Folder */}

//                       <div
//                         className="
//                         shrink-0
//                       "
//                       >
//                         <Folder
//                           size={22}
//                           className="
//                           text-red-500
//                         "
//                         />
//                       </div>

//                       <div className="min-w-0">

//                         <p
//                           className="
//                           text-md
//                           font-medium
//                           text-gray-800
//                           truncate
//                         "
//                         >
//                           {
//                             project
//                               .clientDetails
//                               .firstName
//                           }{" "}

//                           {
//                             project
//                               .clientDetails
//                               .lastName
//                           }
//                         </p>

//                         <p
//                           className="
//                           text-xs
//                           text-gray-500
//                           truncate
//                         "
//                         >
//                           {
//                             project
//                               .clientDetails
//                               .companyName
//                           }
//                         </p>

//                       </div>

//                     </div>

//                     {/* Select */}

//                     <button
//                       type="button"
//                       onClick={() =>
//                         handleSelect(
//                           project
//                         )
//                       }
//                       className={`
//                         px-4
//                         py-1
//                         text-xs
//                         rounded-full
//                         border
//                         transition
//                         hover:cursor-pointer

//                         ${isSelected
//                           ? `
//                           border-red-500
//                           text-red-500
//                           bg-white
//                         `
//                           : `
//                           border-gray-300
//                           text-gray-700
//                           hover:border-red-500
//                           hover:text-red-500
//                         `
//                         }
//                       `}
//                     >
//                       {isSelected
//                         ? "Selected"
//                         : "Select"}
//                     </button>

//                   </div>

//                 </div>

//               );
//             }
//           )}

//         </div>

//         {/* Footer */}


//         <button
//           disabled={!selectedLead}
//           onClick={
//             handleImport
//           }
//           className="
//             px-5
//             py-2
//             rounded-md
//             w-full
//             mt-5
//             text-sm
//             bg-red-500
//             text-white
//             hover:bg-red-600

//             disabled:bg-gray-200
//             disabled:text-gray-400
//             disabled:cursor-not-allowed
//           "
//         >
//           Confirm Import
//         </button>

//       </div>

//     </div>

//   );
// };

// export default ZohoLeadSelectModal;


// ZohoLeadSelectModal.tsx

import { useEffect, useState } from "react";

import {
  X,
  Folder,
} from "lucide-react";

import zohoLogo from "@assets/zoho_logo.png";

import {
  ZOHO_PROJECTS,
  type ZohoProject,
} from "../../../data/zohoLead";

import { useCreateProject } from "../../context/CreateProjectContext";
import { showToast } from "@/components/ui/toast";

type Props = {
  open: boolean;
  onClose: () => void;
};

const ZohoLeadSelectModal = ({
  open,
  onClose,
}: Props) => {

  const [
    selectedLead,
    setSelectedLead,
  ] = useState<ZohoProject | null>(
    null
  );

  const {
    projectData,
    setProjectData,
  } = useCreateProject();


  /* ========================================
      PRESELECT IMPORTED LEAD
     ======================================== */

  useEffect(() => {

    const selectedLeadId =
      projectData
        ?.integrations
        ?.zoho
        ?.data?.id;

    if (!selectedLeadId)
      return;

    const existingLead =
      ZOHO_PROJECTS.find(
        (lead: any) =>
          lead.id === selectedLeadId
      );

    if (existingLead) {
      setSelectedLead(existingLead);
    }

  }, [
    projectData?.integrations?.zoho?.data?.id
  ]);


  if (!open)
    return null;


  /* ========================================
      SELECT / UNSELECT
     ======================================== */

  const handleSelect = (
    project: ZohoProject
  ) => {

    /*
      TOGGLE SELECT / UNSELECT
    */

    if (
      selectedLead?.id ===
      project.id
    ) {

      setSelectedLead(null);

      return;

    }

    setSelectedLead(project);

  };


  /* ========================================
      IMPORT LEAD
     ======================================== */

  const handleImport = () => {

    if (!selectedLead)
      return;

    setProjectData((prev: any) => ({

      ...prev,


      /* ========================================
          RESET + REPLACE ZOHO
         ======================================== */

      integrations: {

        ...prev.integrations,

        zoho: {

          integrated: true,

          // // // selectedLeadId: selectedLead.id,

          data: {
            ...selectedLead,
          },

        },

      },


      /* ========================================
          REPLACE IMPORTED FORM DATA
         ======================================== */

      formData: {

        ...prev.formData,

        clientDetails: {

          ...selectedLead.clientDetails,

        },

        clientContact: {

          ...selectedLead.clientContact,

        },

        projectDetails: {

          ...selectedLead.projectDetails,

          /*
            PRESERVE EXISTING STATUS
          */

          status:

            prev.formData
              .projectDetails
              .status ||

            "Not started",

          action:

            prev.formData
              .projectDetails
              .action ||

            "Project Created",

        },

      },

    }));


    showToast(
      "success",
      "Project details imported successfully from Zoho"
    );

    onClose();
  };


  return (

    <div
      className="
      fixed inset-0
      z-50
      flex items-center
      justify-center
      bg-black/50
      px-4
    "
    >

      <div
        className="
        bg-white
        rounded-lg
        shadow-xl
        w-full
        max-w-lg
        p-6
        relative
      "
      >

        {/* CLOSE */}

        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="
          absolute
          top-5
          right-5
          w-7
          h-7
          flex
          items-center
          justify-center
          rounded-md
          bg-red-500
          text-white
          hover:bg-red-600
          hover:cursor-pointer
          transition
        "
        >
          <X size={16} />
        </button>


        {/* HEADER */}

        <div className="mb-5 flex items-start gap-3">

          <img
            src={zohoLogo}
            alt="Zoho"
            className="h-9 w-auto"
          />

          <div>

            <h3
              className="
              text-lg
              font-semibold
              text-gray-800
            "
            >
              Import Lead From Zoho
            </h3>

            <p
              className="
              text-sm
              text-gray-500
            "
            >
              Choose a project
            </p>

          </div>

        </div>


        {/* PROJECTS */}

        <div
          className="
          space-y-2
          max-h-[350px]
          overflow-y-auto
          no-scrollbar
        "
        >

          {ZOHO_PROJECTS.map(
            (project: any) => {

              const isSelected =
                selectedLead?.id ===
                project.id;

              const disableOthers =
                selectedLead &&
                selectedLead.id !==
                project.id;

              return (

                <div
                  key={project.id}
                  className={`
                  border-2
                  rounded-md
                  px-2 py-3
                  transition

                  ${isSelected
                      ? `
                      border-red-500
                      bg-red-50
                    `
                      : `
                      border-gray-200
                    `
                    }

                  ${disableOthers
                      ? `
                      opacity-50
                      pointer-events-none
                    `
                      : ""
                    }
                `}
                >

                  <div
                    className="
                    flex
                    items-center
                    justify-between
                    gap-3
                    px-3
                    py-1
                  "
                  >

                    <div
                      className="
                      flex
                      items-center
                      gap-3
                      min-w-0
                    "
                    >

                      {/* ICON */}

                      <div className="shrink-0">

                        <Folder
                          size={22}
                          className="
                          text-red-500
                        "
                        />

                      </div>


                      {/* INFO */}

                      <div className="min-w-0">

                        <p
                          className="
                          text-md
                          font-medium
                          text-gray-800
                          truncate
                        "
                        >

                          {
                            project
                              .clientDetails
                              .firstName
                          }{" "}

                          {
                            project
                              .clientDetails
                              .lastName
                          }

                        </p>

                        <p
                          className="
                          text-xs
                          text-gray-500
                          truncate
                        "
                        >

                          {
                            project
                              .clientDetails
                              .companyName
                          }

                        </p>

                      </div>

                    </div>


                    {/* SELECT BUTTON */}

                    <button
                      type="button"
                      onClick={() =>
                        handleSelect(project)
                      }
                      className={`
                        px-4
                        py-1
                        text-xs
                        rounded-full
                        border
                        transition
                        hover:cursor-pointer

                        ${isSelected
                          ? `
                          border-red-500
                          text-red-500
                          bg-white
                        `
                          : `
                          border-gray-300
                          text-gray-700
                          hover:border-red-500
                          hover:text-red-500
                        `
                        }
                      `}
                    >

                      {isSelected
                        ? "Selected"
                        : "Select"}

                    </button>

                  </div>

                </div>

              );

            }
          )}

        </div>


        {/* FOOTER */}

        <button
          disabled={!selectedLead}
          onClick={handleImport}
          className="
            px-5
            py-2
            rounded-md
            w-full
            mt-5
            text-sm
            bg-red-500
            text-white
            hover:bg-red-600

            disabled:bg-gray-200
            disabled:text-gray-400
            disabled:cursor-not-allowed
          "
        >
          Confirm Import
        </button>

      </div>

    </div>

  );

};

export default ZohoLeadSelectModal;