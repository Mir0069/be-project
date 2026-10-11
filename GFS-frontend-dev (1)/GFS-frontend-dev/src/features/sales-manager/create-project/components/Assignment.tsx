import { useEffect, useState } from "react";
import {
  Plus,
  Minus,
  X,
  ArrowRight
} from "lucide-react";

import { useCreateProject, initialState } from "../context/CreateProjectContext";
import { useEstimators } from "../query/show-estimator.query";

import type {
  Estimator
} from "@/services/show-estimator";
import { showToast } from "@/components/ui/toast";
import { useNavigate } from "react-router-dom";
import { createProject } from "@/services/projects";
import { uploadDocument } from "@/services/documents";

const avatarClass =
  "w-9 h-9 text-sm rounded-full bg-red-500 flex items-center justify-center text-white font-medium";

const getInitials = (
  name: string
) =>
  name
    .split(" ")
    .map((n) => n[0])
    .join("");

type ProjectAction =
  | "Project Created"
  | "Saved Draft";

type ProjectStatus =
  | "Not started"
  | "Pending";

const AssignmentModule = () => {

  const navigate = useNavigate();


  const [
    showSelector,
    setShowSelector
  ] = useState(false);

  const [
    selectedOptions,
    setSelectedOptions
  ] = useState<string[]>([]);

  const [
    assignedEstimators,
    setAssignedEstimators
  ] = useState<Estimator[]>([]);

  const {
    projectData,
    setProjectData
  } = useCreateProject();

  const {
    data: estimators = [],
    isLoading
  } = useEstimators();



  useEffect(() => {

    if (
      projectData.formData.assignments
        ?.length
    ) {

      setAssignedEstimators(
        projectData.formData.assignments
      );

    }

  }, []);


  const toggleSelection = (
    estimator: string
  ) => {

    setSelectedOptions(
      prev =>

        prev.includes(
          estimator
        )

          ? prev.filter(
            item =>
              item !== estimator
          )

          : [
            ...prev,
            estimator
          ]
    );

  };


  const assignProject =
    () => {

      const selectedEstimators =
        estimators.filter(
          estimator =>

            selectedOptions.includes(
              estimator.name
            )
        );


      const merged =
        [
          ...assignedEstimators,
          ...selectedEstimators
        ].filter(

          (
            estimator,
            index,
            self
          ) =>

            index ===
            self.findIndex(
              e =>
                e.id ===
                estimator.id
            )

        );


      setAssignedEstimators(
        merged
      );


      /* save into global state/localstorage */

      setProjectData(
        prev => ({

          ...prev,

          formData: {

            ...prev.formData,

            assignments:
              merged

          }

        })
      );


      setSelectedOptions(
        []
      );

      setShowSelector(
        false
      );

    };


  const removeEstimator =
    (
      id: string
    ) => {

      const updated =

        assignedEstimators.filter(

          item =>
            item.id !== id
        );

      setAssignedEstimators(
        updated
      );


      setProjectData(
        prev => ({

          ...prev,

          formData: {

            ...prev.formData,

            assignments:
              updated

          }

        })
      );

    };


  const cancelSelection =
    () => {

      setSelectedOptions(
        []
      );

      setShowSelector(
        false
      );

    };


  const resetProjectFlow = () => {

    localStorage.removeItem(
      "projectTranscripts"
    );

    setProjectData(initialState);

  };

  const buildProjectPayload = (

    source: "created" | "draft",

    action: ProjectAction,

    status: ProjectStatus

  ) => {

    return {

      source,

      integrations: {

        mails:
          projectData.integrations.mails,

        teams:
          projectData.integrations.teams,

        transcripts:
          projectData.integrations.transcripts

      },

      formData: {

        clientDetails:
          projectData.formData.clientDetails,

        clientContact:
          projectData.formData.clientContact,

        projectDetails: {

          ...projectData.formData.projectDetails,

          status,

          action

        },

        documents:
          projectData.formData.documents,

        assignments:
          projectData.formData.assignments

      },

      createdAt:
        new Date().toISOString()

    };

  };

  const handleCreateProject = async () => {
    const projectId = projectData.formData.projectDetails.projectId;

    if (!projectId) return;

    try {
      const pd: any = projectData.formData.projectDetails;
      const createdProject = await createProject({
        projectName: pd.projectName,
        projectType: pd.projectType,
        dueDate: pd.expectedDate,
        projectAddress: `${projectData.formData.clientDetails.companyName} address`, // mock
        customerName: projectData.formData.clientDetails.companyName,
        poc: projectData.formData.clientContact.primaryContact,
        contactPhone: projectData.formData.clientContact.primary_phone,
        contactEmail: projectData.formData.clientContact.email,
        contactAddress: "",
        architect: pd.architect,
        homeowner: pd.homeowner,
        drafter: pd.drafter,
        projectNotes: pd.projectNotes,
        zohoLeadId: projectData.integrations.zoho.data?.id || null,
        importedSources: [], // Add logic to figure out sources if needed
        assignedEstimatorIds: projectData.formData.assignments.map(a => a.id),
      });

      // --- DOCUMENT UPLOAD LOGIC ---
      const newProjectId = createdProject.id;
      const docs = projectData.formData.documents || [];
      
      if (docs.length > 0) {
        
        const uploadPromises = docs.map(async (doc) => {
          if (!doc.base64) return;
          try {
            const base64Data = doc.base64.includes("base64,") ? doc.base64.split("base64,")[1] : doc.base64;
            const binaryString = window.atob(base64Data);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            const fileBlob = new Blob([bytes], { type: doc.type });
            const file = new File([fileBlob], doc.name, { type: doc.type });
            
            await uploadDocument({
              projectId: newProjectId,
              file,
              documentType: "other"
            });
          } catch (e) {
            console.error(`Failed to upload document ${doc.name}:`, e);
          }
        });

        await Promise.all(uploadPromises);
      }

      showToast("success", "Project Created Successfully");
      resetProjectFlow();

      setTimeout(() => {
        navigate("/sales-manager");
      }, 1200);
    } catch (err) {
      showToast("error", "Failed to create project");
      console.error(err);
    }
  };

  // const handleSaveDraft = () => {

  //   const projectId =

  //     projectData
  //       .formData
  //       .projectDetails
  //       .projectId;


  //   if (!projectId)
  //     return;


  //   const draftPayload =

  //     buildProjectPayload(

  //       "draft",

  //       "Saved Draft",

  //       "Pending"

  //     );


  //   localStorage.setItem(

  //     `saved_draft_${projectId}`,

  //     JSON.stringify(
  //       draftPayload
  //     )

  //   );

  //   showToast(
  //     "success",
  //     "Draft Saved Successfully"
  //   );

  //   resetProjectFlow();
  // };


  const handleBack =
    () => {

      setProjectData(
        prev => ({

          ...prev,

          navigation: {

            ...prev.navigation,

            currentStep: 5

          }

        })
      );

    };


  const canSubmit = assignedEstimators.length > 0;
  return (

    <div className="bg-white rounded-xl w-[90%] h-[480px] flex flex-col px-6 py-4">

      {/* HEADER */}

      <div className="shrink-0 border-b border-gray-300 pb-4">

        <h1 className="text-2xl font-semibold text-red-500">

          Assignments

        </h1>

        <p className="text-sm text-gray-500 mt-1">

          Assign project to estimators

        </p>

      </div>


      {/* BODY */}

      <div className="flex-1 min-h-0">


        {assignedEstimators.length === 0 ? (

          <div className="flex flex-col items-center justify-center h-full">

            <p className="text-gray-600 text-center text-md mb-4 max-w-[530px]">

              Assign the project to one or more estimators so they can begin working on estimation and proposal creation.

            </p>

            {!showSelector && (

              <button

                onClick={() =>
                  setShowSelector(true)
                }

                className="
px-6 py-2
rounded-sm
bg-red-500
text-white
text-sm
font-medium
hover:bg-red-600
flex items-center gap-2
"
              >

                <Plus size={18} />

                Assign Project

              </button>

            )}

          </div>

        ) : (

          <div className="h-full">

            <div className="flex flex-col pt-5">

              <div className="flex items-center justify-between">

                <p className="text-red-500 text-md">

                  The project is assigned to

                </p>

                <button

                  onClick={() =>
                    setShowSelector(true)
                  }

                  className="
px-6 py-1.5
rounded-sm
bg-red-500
text-white
text-sm
font-medium
hover:bg-red-600
flex items-center gap-2
"
                >

                  <Plus size={16} />

                  Assign

                </button>

              </div>


              <div
                className="
flex flex-col
gap-3
mt-8
max-h-[280px]
overflow-y-auto
pr-2
no-scrollbar
"
              >

                {assignedEstimators.map(

                  estimator => (

                    <div

                      key={estimator.id}

                      className="
border
border-gray-300
rounded-lg
px-4 py-3 pr-5
flex items-center
justify-between
"

                    >

                      <div className="flex items-center gap-4">

                        <div className={avatarClass}>

                          {getInitials(
                            estimator.name
                          )}

                        </div>

                        <div>

                          <p className="font-medium text-red-500">

                            {estimator.name}

                          </p>

                          <p className="text-sm text-gray-500">

                            {estimator.email}

                          </p>

                        </div>

                      </div>

                      <button

                        onClick={() =>
                          removeEstimator(
                            estimator.id
                          )
                        }

                      >

                        <Minus
                          size={22}
                          className="text-red-500"
                        />

                      </button>

                    </div>

                  )

                )}

              </div>

            </div>

          </div>

        )}

      </div>


      {/* MODAL */}

      {showSelector && (

        <div
          className="
fixed inset-0
bg-black/40
z-50
flex items-center justify-center
"
        >

          <div
            className="
bg-white
w-[560px]
rounded-xl
shadow-xl
p-6
relative
"
          >

            <button

              onClick={
                cancelSelection
              }

              className="
absolute
top-5
right-5
bg-red-500
text-white
rounded-md
p-1
"

            >

              <X size={18} />

            </button>


            <h2 className="text-xl font-semibold text-red-500">

              Estimator Assignment

            </h2>

            <p className="text-sm text-gray-500 mt-1">

              Select estimators from the following list

            </p>


            <div
              className="
mt-6
max-h-[280px]
overflow-y-auto
space-y-3
no-scrollbar
"
            >

              {isLoading ? (

                <div className="py-10 text-center text-gray-500">

                  Loading estimators...

                </div>

              ) : (

                estimators.map(
                  estimator => (

                    <div

                      key={estimator.id}

                      className={`
border-2 rounded-lg
px-4 py-4
flex items-center justify-between
${selectedOptions.includes(
                        estimator.name
                      )
                          ? "border-red-500 bg-red-50"
                          : "border-gray-300"}
`}

                    >

                      <div className="flex items-center gap-4">

                        <div className={avatarClass}>

                          {getInitials(
                            estimator.name
                          )}

                        </div>

                        <div>

                          <p className="font-medium text-gray-800">

                            {estimator.name}

                          </p>

                          <p className="text-sm text-gray-500">

                            {estimator.email}

                          </p>

                        </div>

                      </div>

                      <input

                        type="checkbox"

                        checked={
                          selectedOptions.includes(
                            estimator.name
                          )
                        }

                        onChange={() =>
                          toggleSelection(
                            estimator.name
                          )
                        }

                        className="
w-4 h-4
accent-red-500
cursor-pointer
"

                      />

                    </div>

                  )
                )

              )}

            </div>


            <div className="mt-8">

              <button

                disabled={
                  selectedOptions.length === 0
                }

                onClick={
                  assignProject
                }

                className={`w-full px-8 py-2 rounded-md

${selectedOptions.length > 0

                    ? "bg-red-500 text-white"

                    : "bg-gray-200 text-gray-400"

                  }

`}

              >

                Assign Estimators

              </button>

            </div>

          </div>

        </div>

      )}


      {/* Footer */}

      <div className="shrink-0 flex items-center justify-between px-4 pt-4">


        <button
          type="button"
          onClick={handleBack}
          className="
      px-5 py-0.5 rounded-full
      text-md
      bg-transparent
      border border-gray-500
      text-gray-800
      hover:border hover:border-red-500
      hover:text-red-500
      hover:cursor-pointer
    "
        >
          Back
        </button>


        <div className="flex items-center gap-6">

          {/* <button
            type="button"
            onClick={handleSaveDraft}
            disabled={!canSubmit}
            className="
      px-7 py-1
      rounded-md
      flex items-center justify-center gap-3
      transition
      disabled:bg-gray-200
      disabled:text-gray-400
      disabled:cursor-not-allowed
      bg-red-500
      text-white
      hover:bg-red-600
      hover:cursor-pointer
    "
          >

            <Plus
              size={18}
              className="mt-0.5"
            />

            Save Draft

          </button> */}


          <button
            type="button"
            onClick={handleCreateProject}
            disabled={!canSubmit}
            className="
      px-7 py-1
      rounded-md
      flex items-center justify-center gap-3
      transition
      disabled:bg-gray-200
      disabled:text-gray-400
      disabled:cursor-not-allowed
      bg-red-500
      text-white
      hover:bg-red-600
      hover:cursor-pointer
    "
          >

            Create Project

            <ArrowRight
              size={18}
              className="mt-0.5"
            />

          </button>

        </div>
      </div>

    </div>

  );

};

export default AssignmentModule;