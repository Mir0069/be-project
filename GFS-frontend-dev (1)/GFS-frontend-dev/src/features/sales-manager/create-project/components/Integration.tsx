import { useState } from "react";
import { Phone } from "lucide-react";
import ZohoLeadSelectModal from "@/features/sales-manager/create-project/components/modals/ZohoLeadSelectModal";
import MailFilterModal from "./modals/MailFilterModal";
import TeamsFilterModal from "./modals/TeamsFilterModal";
import CallRecordUploadModal from "./modals/CallRecordUploadModal";

import ProjectIntegrationsPreview from "../components/ProjectIntegrationsPreview";

import { useCreateProject } from "../context/CreateProjectContext";


type Integration = "zoho" | "outlook" | "teams" | "calls";


const IntegrationModule = () => {

  const [openModal, setOpenModal] = useState<Integration | null>(null);
  const [zohoOpen, setZohoOpen] = useState(false);

  const { projectData, setProjectData } = useCreateProject();

  const handleIntegrationClick = (
    id: Integration
  ) => {

    switch (id) {

      case "zoho":
        setZohoOpen(true);
        break;

      case "outlook":
        setOpenModal("outlook");
        break;

      case "teams":
        setOpenModal("teams");
        break;

      case "calls":
        setOpenModal("calls");
        break;

    }

  };

  const handleContinue = () => {

    const zohoData =
      projectData.integrations.zoho.data;

    setProjectData(
      prev => ({

        ...prev,

        navigation: {

          ...prev.navigation,

          currentStep: 2,

          importedFlow: true

        },

        formData: zohoData
          ? {

            ...prev.formData,

            clientDetails: {

              ...prev.formData.clientDetails,

              ...zohoData.clientDetails

            },

            clientContact: {

              ...prev.formData.clientContact,

              ...zohoData.clientContact

            },

            projectDetails: {

              ...prev.formData.projectDetails,

              ...zohoData.projectDetails

            }

          }
          : prev.formData

      })
    );

  };

  const handleSkip = () => {

    setProjectData(
      prev => ({

        ...prev,

        navigation: {

          ...prev.navigation,

          currentStep: 2,

          importedFlow: false

        }

      })
    )

  }

  return (
    // <div className="bg-white rounded-lg px-5 py-3 pb-5 min-h-[460px] flex flex-col justify-between">

    <div className="bg-white rounded-lg px-5 py-3 pb-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-red-500">
          Integrations
        </h1>

        <p className="text-sm text-gray-500 mt-1">
          Connect to external sources to import project details, attachments and conversations.
        </p>

        <div className="grid grid-cols-2 gap-4 mt-8">
          {integrations.map((item: any) => (
            <IntegrationButton
              key={item.id}
              image={item.image}
              label={item.label}
              description={item.description}
              height={item.height}
              width={item.width}

              connected={
                item.id === "zoho"
                  ? projectData.integrations.zoho.integrated
                  : item.id === "outlook"
                    ? projectData.integrations.mails.integrated
                    : item.id === "teams"
                      ? projectData.integrations.teams.integrated
                      : projectData.integrations.transcripts.integrated
              }
              onClick={() =>
                handleIntegrationClick(item.id)
              }
            />
          ))}
        </div>

      </div>

      <div className="mt-8 mb-5">
        <ProjectIntegrationsPreview />
      </div>
      {/* Footer */}
      <div className="flex items-center justify-between px-4">

        {/* Skip */}
        <button
          className="
px-3 py-1 rounded-full
text-md
bg-transparent
border border-gray-500
text-gray-800
hover:cursor-pointer

hover:border-red-500
hover:text-red-500

disabled:text-gray-400
disabled:border-gray-500
disabled:cursor-not-allowed
disabled:hover:border-gray-500
disabled:hover:text-gray-400
"

          disabled={
            (
              projectData.integrations.zoho.integrated ||
              projectData.integrations.mails.integrated ||
              projectData.integrations.teams.integrated ||
              projectData.integrations.transcripts.integrated
            )
          }
          onClick={handleSkip}
        >
          Skip - Enter Manually
        </button>

        {/* Continue */}
        <button
          type="button"
          disabled={
            !(
              projectData.integrations.zoho.integrated ||
              projectData.integrations.mails.integrated ||
              projectData.integrations.teams.integrated ||
              projectData.integrations.transcripts.integrated
            )
          }
          onClick={
            handleContinue
          }
          className="
px-6
py-1
rounded-md
transition-colors
duration-200
hover:cursor-pointer
disabled:bg-gray-200
disabled:text-gray-400
disabled:cursor-not-allowed
bg-red-500
text-white
hover:bg-red-600
"
        >
          Continue
        </button>

      </div>

      {/* Zoho flow */}

      <ZohoLeadSelectModal
        open={zohoOpen}
        onClose={() =>
          setZohoOpen(false)}
      />

      <MailFilterModal
        open={openModal === "outlook"}
        onClose={() =>
          setOpenModal(null)
        }
      />

      <TeamsFilterModal
        open={openModal === "teams"}
        onClose={() =>
          setOpenModal(null)
        }
      />

      {/* Calls */}
      <CallRecordUploadModal
        open={openModal === "calls"}
        onClose={() =>
          setOpenModal(null)
        }
      />





    </div >
  );
};


type IntegrationButtonProps = {
  image: string;
  label: string;
  description: string;
  height: number;
  width: number;
  connected?: boolean;
  onClick: () => void;
};


const IntegrationButton: React.FC<IntegrationButtonProps> = ({
  image,
  label,
  description,
  height,
  width,
  connected = false,
  onClick,
}) => {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
  group
  w-full
  px-4
  py-3
  rounded-lg
  border-2
  text-left
  transition-all
  duration-200
  hover:cursor-pointer

  ${connected
          ? `
      bg-red-50
      border-red-500
      `
          : `
      bg-white
      border-gray-200
      hover:border-gray-300
      `
        }
`}
    >
      <div className="flex flex-col gap-2">

        <div className="flex items-center justify-between w-full pr-5">
          <div className="flex items-center gap-1 w-full">
            <div className="w-12 h-12 flex items-center justify-center shrink-0">

              {label === "Transcripts" ? (
                <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
                  <Phone
                    size={20}
                  />
                </div>
              ) : (
                <img
                  src={image}
                  alt={label}
                  style={{
                    width: `${width}px`,
                    height: `${height}px`,
                  }}
                  className="object-contain"
                />
              )}
            </div>

            <div className="text-base font-semibold text-gray-700 group-hover:text-red-500">
              {label}
            </div>

          </div>

          {
            connected && (
              <span className="text-xs text-red-500 font-medium px-2 py-1 border border-red-500 rounded-full">
                Imported
              </span>
            )
          }
        </div>

        <div className="
          text-[13px]
          text-gray-500
          leading-relaxed
          transition-colors
          duration-200
          line-clamp-2
          mt-1
          group-hover:text-red-500
        ">
          {description}
        </div>

      </div >
    </button >
  );
};



const integrations: {
  id: Integration;
  image: string;
  label: string;
  description: string;
  height: number;
  width: number;
}[] = [
    {
      id: "zoho",
      image: "/zoho.png",
      label: "Zoho",
      description: "Integrate Zoho CRM to import project leads.",
      height: 60,
      width: 60,
    },
    {
      id: "outlook",
      image: "/outlook.png",
      label: "Mail",
      description: "Import relevant emails and attachments into project.",
      height: 30,
      width: 30,
    },
    {
      id: "teams",
      image: "/teams.png",
      label: "Teams",
      description:
        "Integrate Teams for conversations, shared files, and meeting transcripts related to project.",
      height: 30,
      width: 30,
    },
    {
      id: "calls",
      image: "/call.png",
      label: "Transcripts",
      description:
        "Capture key information from customer calls by uploading transcripts.",
      height: 0,
      width: 0,
    },
  ];


export default IntegrationModule;
