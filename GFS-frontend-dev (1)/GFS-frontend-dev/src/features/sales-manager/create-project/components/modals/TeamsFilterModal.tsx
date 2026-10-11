// TeamsFilterModal.tsx

import { useMemo, useState } from "react";
import { X } from "lucide-react";

import teamsLogo from "/teams.png";

import { PROJECT_TEAMS } from "../../../data/teams";
import { useCreateProject } from "../../context/CreateProjectContext";
import { showToast } from "@/components/ui/toast";

const commonInputClass =
  `
w-full
rounded-md
border-2
border-gray-200
bg-gray-50
px-3
py-2
text-sm
text-gray-700
outline-none
focus:border-red-500
mt-1
`;

type Props = {
  open: boolean;
  onClose: () => void;
};

const TeamsFilterModal = ({
  open,
  onClose
}: Props) => {

  const [domain, setDomain] =
    useState("");

  const {
    setProjectData
  } = useCreateProject();


  const filteredTeams =
    useMemo(() => {

      if (
        !domain.trim()
      )
        return [];

      return PROJECT_TEAMS.filter(
        team =>
          team.participants.some(
            participant =>
              participant
                .toLowerCase()
                .includes(
                  domain
                    .toLowerCase()
                    .trim()
                )
          )
      );

    }, [
      domain
    ]);


  const handleImport = () => {

    if (!domain.trim()) {

      showToast(
        "error",
        "Please enter a company domain"
      );

      return;

    }


    if (
      filteredTeams.length === 0
    ) {

      showToast(
        "error",
        "No Teams conversations found for this domain"
      );

      return;
    }


    // setProjectData(
    //   prev=>({

    //     ...prev,

    //     integrations:{

    //       ...prev.integrations,

    //       teams:{

    //         integrated:true,

    //         data:
    //         filteredTeams

    //       }

    //     }

    //   })
    // );

    setProjectData(
      (prev) => ({

        ...prev,

        integrations: {

          ...prev.integrations,

          /*
            REPLACE OLD TEAMS DATA
          */

          teams: {

            integrated: true,

            data: filteredTeams,

          },

        },

      })
    );

    showToast(
      "success",
      `${filteredTeams.length}
      conversation${filteredTeams.length > 1
        ? "s"
        : ""
      } imported successfully`
    );

    setDomain("");

    onClose();

  };


  if (!open)
    return null;


  return (

    <div
      className="
      fixed
      inset-0
      bg-black/50
      z-50
      flex
      items-center
      justify-center
      px-4
    "
    >

      <div
        className="
        bg-white
        rounded-xl
        w-full
        max-w-[500px]
        max-h-[80vh]
        flex
        flex-col
        overflow-hidden
      "
      >

        {/* Header */}

        <div className="p-6 relative">

          <div className="flex items-center gap-3">

            <img
              src={teamsLogo}
              className="h-9"
            />

            <div>

              <h2
                className="
                font-semibold
                text-lg
              "
              >
                Import Chats From Teams
              </h2>

              <p
                className="
                text-sm
                text-gray-600
              "
              >
                Import client conversations and meeting discussions
              </p>

            </div>

            <button
              onClick={onClose}
              className="
              absolute
              top-5
              right-5
              p-2
              bg-red-500
              rounded-md
              text-white
              hover:bg-red-600
              hover:cursor-pointer
            "
            >
              <X size={18} />
            </button>

          </div>

        </div>


        {/* Body */}

        <div
          className="
          flex-1
          overflow-y-auto
          px-5
        "
        >

          <p
            className="
            text-md
            text-gray-800
            font-medium
            mt-2
            mb-5
          "
          >
            Enter the client's company domain to import all relevant Teams conversations and meeting transcripts.
          </p>

          <label
            className="
            text-sm
            font-medium
            text-red-500
            "
          >
            Company Domain
          </label>

          <input
            value={domain}
            onChange={(e: any) =>
              setDomain(
                e.target.value
              )
            }
            placeholder="abcconstruction.com"
            className={
              commonInputClass
            }
          />

        </div>


        {/* Footer */}

        <div className="p-5">

          <button
            disabled={!domain.trim()}
            onClick={
              handleImport
            }
            className="
            w-full
            py-1.5
            rounded-md
            bg-red-500
            text-white
            mt-2

            disabled:bg-gray-200
            disabled:text-gray-400
            disabled:cursor-not-allowed
            hover:cursor-pointer
            "
          >
            Confirm Import
          </button>

        </div>

      </div>

    </div>

  );

};

export default TeamsFilterModal;