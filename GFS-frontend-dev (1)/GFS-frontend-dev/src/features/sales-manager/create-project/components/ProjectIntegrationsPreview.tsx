import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  Mail,
  MessageSquare,
  PhoneCall,
} from "lucide-react";

import { useCreateProject } from "../context/CreateProjectContext";

const SectionCard = ({
  title,
  icon,
  children,
}: any) => (

  <section
    className="
      bg-white
      rounded-lg
      border border-gray-200
      p-5
    "
  >

    <div
      className="
        flex items-center gap-2
        mb-5
      "
    >

      <div className="text-red-500">
        {icon}
      </div>

      <h2
        className="
          text-lg
          font-semibold
          text-red-500
        "
      >
        {title}
      </h2>

    </div>

    {children}

  </section>

);



const MailsTab = ({
  data,
}: any) => (

  <SectionCard
    title="Mails"
    icon={<Mail size={16} />}
  >

    <ul className="space-y-3">

      {data.map((mail: any) => (

        <li
          key={mail.id}
          className="
            border border-gray-200
            rounded-md
            p-3
          "
        >

          <p
            className="
              text-sm
              font-medium
              text-gray-800
            "
          >
            {mail.subject}
          </p>

          <p
            className="
              text-sm
              text-gray-700
              mt-1
            "
          >
            {mail.preview}
          </p>

          <p
            className="
              text-xs
              text-gray-500
              mt-1
            "
          >
            {mail.sender}
          </p>

        </li>

      ))}

    </ul>

  </SectionCard>

);



const TeamsTab = ({
  data,
}: any) => (

  <SectionCard
    title="Teams"
    icon={<MessageSquare size={16} />}
  >

    <ul className="space-y-3">

      {data.map((thread: any) => (

        <li
          key={thread.id}
          className="
            border border-gray-200
            rounded-md
            p-3
          "
        >

          <div
            className="
              flex items-start justify-between
              gap-3
            "
          >

            <div>

              <p
                className="
                  text-sm
                  font-medium
                  text-gray-800
                "
              >
                {thread.title}
              </p>

              <p
                className="
                  text-xs
                  text-gray-500
                  mt-1
                "
              >
                {thread.date}
              </p>

            </div>

            <span
              className="
                text-xs
                px-2 py-0.5
                rounded-md
                bg-gray-100
                text-gray-600
              "
            >
              {thread.messages} msgs
            </span>

          </div>

        </li>

      ))}

    </ul>

  </SectionCard>

);



// const CallsTab = ({
//   data,
// }: any) => (

//   <SectionCard
//     title="Call Records"
//     icon={<PhoneCall size={16} />}
//   >

//     <ul className="space-y-3">

//       {data.map((call: any) => (

//         <li
//           key={call.id}
//           className="
//             border border-gray-200
//             rounded-md
//             p-3
//           "
//         >

//           <p
//             className="
//               text-sm
//               font-medium
//               text-gray-800
//             "
//           >
//             {call.name}
//           </p>

//           <p
//             className="
//               text-xs
//               text-gray-500
//               mt-1
//             "
//           >
//             {(call.size / 1024).toFixed(2)} KB
//           </p>

//         </li>

//       ))}

//     </ul>

//   </SectionCard>

// );


const CallsTab = ({
  data,
  onDelete,
}: any) => (

  <SectionCard
    title="Call Records"
    icon={<PhoneCall size={16} />}
  >

    {!data || data.length === 0 ? (

      <p
        className="
          text-sm
          text-gray-400
          italic
        "
      >
        No call transcripts available.
      </p>

    ) : (

      <ul className="space-y-3">

        {data.map((call: any) => (

          <li
            key={call.id}
            className="
              border border-gray-200
              rounded-md
              p-3
            "
          >

            <div className="flex items-start justify-between gap-4">

              <div>

                <p
                  className="
                    text-sm
                    font-medium
                    text-gray-800
                  "
                >
                  {call.name}
                </p>

                <p
                  className="
                    text-xs
                    text-gray-500
                    mt-1
                  "
                >
                  {(call.size / 1024).toFixed(2)} KB
                </p>

              </div>


              {/* DELETE */}

              <button
                type="button"
                onClick={() =>
                  onDelete(call.id)
                }
                className="
                  text-xs
                  px-3
                  py-1
                  rounded-md
                  border
                  border-red-200
                  text-red-500
                  hover:bg-red-50
                  transition
                "
              >
                Remove
              </button>

            </div>

          </li>

        ))}

      </ul>

    )}

  </SectionCard>

);


const ProjectIntegrationsPreview = () => {

  const { projectData, setProjectData } =
    useCreateProject();

  const integrations =
    projectData.integrations;


  const tabs =
    useMemo(() => {

      const items = [];

      if (
        integrations?.mails?.integrated
      ) {

        items.push({
          id: "Mails",
          label: "Mails",
          image: "/outlook.png",
          size: 20,
        });

      }

      if (
        integrations?.teams?.integrated
      ) {

        items.push({
          id: "Teams",
          label: "Teams",
          image: "/teams.png",
          size: 20,
        });

      }

      if (
        integrations?.transcripts?.integrated
      ) {

        items.push({
          id: "Call Records",
          label: "Call Records",
          image: "/call.png",
          size: 16,
        });

      }

      return items;

    }, [integrations]);


  const [activeTab, setActiveTab] =
    useState(
      tabs[0]?.id || ""
    );


  const handleDeleteTranscript = (
    transcriptId: string
  ) => {

    setProjectData(
      (prev) => ({

        ...prev,

        integrations: {

          ...prev.integrations,

          transcripts: {

            ...prev.integrations.transcripts,

            data:
              prev.integrations
                .transcripts
                .data
                .filter(
                  (item: any) =>
                    item.id !== transcriptId
                ),

          },

        },

      })
    );

  };

  useEffect(() => {

    if (
      tabs.length > 0 &&
      !tabs.find(
        tab => tab.id === activeTab
      )
    ) {

      setActiveTab(
        tabs[0].id
      );

    }

  }, [tabs]);





  if (
    tabs.length === 0
  ) return null;



  return (

    <div className="space-y-6">

      {/* Tabs */}

      <div
        className="
          relative
          flex items-center justify-center gap-24
          border-b border-gray-300
        "
      >

        {tabs.map((tab) => {

          const isActive =
            activeTab === tab.id;

          return (

            <button

              key={tab.id}

              type="button"

              onClick={() =>
                setActiveTab(tab.id)
              }

              className="
                relative
                flex items-center gap-2
                py-3
                text-sm
                transition-colors
                duration-300
                hover:cursor-pointer
              "
            >

              <img
                src={tab.image}

                alt={tab.label}

                style={{
                  width: `${tab.size}px`,
                  height: `${tab.size}px`,
                }}

                className={`
                  object-contain
                  transition-all
                  duration-300

                  ${!isActive
                    ? "opacity-60"
                    : "opacity-100"
                  }
                `}
              />

              <span
                className={`
                  transition-colors
                  duration-300
                  text-md

                  ${isActive
                    ? "text-red-500"
                    : "text-gray-700"
                  }
                `}
              >
                {tab.label}
              </span>

              {/* Underline */}
              <div
                className={`
                  absolute
                  bottom-0
                  left-[-6px]
                  right-[-6px]
                  h-[2px]
                  bg-red-500
                  transition-all
                  duration-300
                  ${isActive
                    ? "opacity-100 scale-x-100"
                    : "opacity-0 scale-x-0"
                  }
                `}
              />

            </button>

          );

        })}

      </div>


      {/* Content */}

      {activeTab ===
        "Mails" && (

          <MailsTab
            data={
              integrations
                ?.mails
                ?.data
            }
          />

        )}


      {activeTab ===
        "Teams" && (

          <TeamsTab
            data={
              integrations
                ?.teams
                ?.data
            }
          />

        )}


      {activeTab ===
        "Call Records" && (

          <CallsTab
            data={
              integrations
                ?.transcripts
                ?.data
            }

            onDelete={
              handleDeleteTranscript
            }
          />

        )}

    </div>

  );

};

export default ProjectIntegrationsPreview;