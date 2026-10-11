import { Form } from "@/components/ui/Form";
import { useCreateProject } from "../context/CreateProjectContext";
import { useAuth } from "@/context/AuthContext";
import { useEffect } from "react";

const commonInputClass =
  "w-full rounded-md border-2 border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 placeholder:text-gray-600 outline-none focus:border-red-500 focus:border-2 focus:bg-white transition";

const selectTriggerClass = `
w-full rounded-md border-2 border-gray-200 bg-gray-50 px-3 py-2
flex items-center justify-between text-sm
outline-none hover:border-red-500
`;

const ProjectDetailsModule = () => {

  const {
    projectData,
    setProjectData
  } = useCreateProject();

  const { user } = useAuth();

  const hasZohoIntegration =
    projectData.integrations.zoho.integrated;

  const data =
    projectData.formData.projectDetails;

  const company =
    projectData.formData.clientDetails.companyName;

  console.log(company);

  const handleChange = (
    field: keyof typeof data,
    value: string
  ) => {

    setProjectData(prev => ({

      ...prev,

      formData: {

        ...prev.formData,

        projectDetails: {

          ...prev.formData.projectDetails,

          [field]: value

        }

      }

    }));

  };

  const handleContinue = () => {

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

  const handleBack = () => {

    setProjectData(
      prev => ({

        ...prev,

        navigation: {

          ...prev.navigation,

          currentStep: 3

        }

      })
    );

  };


  const isDisabled =

    !data.projectId?.trim() ||
    !data.projectName?.trim() ||
    !data.bidRecipient?.trim() ||
    !data.bidDeadline?.trim() ||
    !data.expectedCompletionDate?.trim() ||
    !data.estimatedBudget?.trim();
  useEffect(() => {

    if (
      company &&
      !data.bidRecipient
    ) {

      handleChange(
        "bidRecipient",
        company
      );

    }

  }, [company]);

  

  return (

    <div className="bg-white rounded-lg px-5 py-4 w-full h-full flex flex-col">

      {/* Header */}

      <div className="shrink-0 mb-8 flex items-center justify-between">

        <div>

          <h1 className="text-2xl font-semibold text-red-500">
            Project Details
          </h1>

          <p className="text-sm text-gray-500 mt-1">

            {
              hasZohoIntegration
                ? "Validate or Edit Zoho extracted project details."
                : "Fill necessary project details."
            }

          </p>

        </div>

        {hasZohoIntegration && (

          <div className="flex items-center gap-2">

            <img
              src="/zoho.png"
              alt="Zoho"
              width={65}
              height={65}
              className="object-contain"
            />

            <div className="text-xs text-gray-500">
              Imported from Zoho
            </div>

          </div>

        )}

      </div>


      <div className="flex-1 min-h-0">

        <Form.Wrapper
          className="
          h-full
          overflow-y-auto
          pr-2
          space-y-6
          no-scrollbar
        "
        >

          <Form.Input
            label="Project Id"
            name="projectId"
            value={data.projectId}
            onChange={(e: any) => handleChange("projectId", e.target.value)}
            placeholder="PRJ-xxxx"
            inputClassName={commonInputClass}
            labelClassName="block text-xs font-medium text-red-500 mb-1.5"
          />



          <Form.Input
            label="Project Name"
            name="projectName"
            value={data.projectName}
            onChange={(e: any) => handleChange("projectName", e.target.value)}
            placeholder="Miami Glass Bridge"
            inputClassName={commonInputClass}
            labelClassName="block text-xs font-medium text-red-500 mb-1.5"
          />



          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            <Form.Input
              label="Quote #"
              name="quoteNumber"
              value={data.quoteNumber}
              onChange={(e: any) => handleChange("quoteNumber", e.target.value)}
              placeholder="QT-10024"
              inputClassName={commonInputClass}
              labelClassName="block text-xs font-medium text-red-500 mb-1.5"
            />


            <Form.Input
              label="Who is the Bid Going To?"
              name="bidRecipient"
              value={data.bidRecipient || company}
              onChange={(e: any) => handleChange("bidRecipient", e.target.value)}
              placeholder="ABC Construction"
              inputClassName={commonInputClass}
              labelClassName="block text-xs font-medium text-red-500 mb-1.5"
            />

          </div>



          <Form.Input
            label="Person Quoting"
            name="personQuoting"
            value={
              data.personQuoting ||
              `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim()
            }
            onChange={(e: any) =>
              handleChange(
                "personQuoting",
                e.target.value
              )
            }
            placeholder="Sales Manager"
            inputClassName={commonInputClass}
            labelClassName="block text-xs font-medium text-red-500 mb-1.5"
          />



          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            <Form.CustomSelect
              label="Project Interest"
              value={data.projectInterest}
              options={[
                { label: "Glass Bridge", value: "glass-bridge" },
                { label: "Glass Staircase", value: "glass-staircase" },
                { label: "Glass Flooring", value: "glass-flooring" },
                { label: "Custom Project", value: "custom" }
              ]}
              onChange={(e: any) =>
                handleChange(
                  "projectInterest",
                  e.target.value
                )
              }
              triggerClassName={selectTriggerClass}
              placeholder="Select Project Interest"
              labelClassName="block text-xs font-medium text-red-500 mb-1.5"
            />


            <Form.Input
              label="Estimated Budget"
              name="estimatedBudget"
              value={data.estimatedBudget}
              onChange={(e: any) => handleChange("estimatedBudget", e.target.value)}
              placeholder="$250,000-$400,000"
              inputClassName={commonInputClass}
              labelClassName="block text-xs font-medium text-red-500 mb-1.5"
            />

          </div>




          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            <Form.CustomSelect
              label="Project Type"
              value={data.projectType}
              options={[
                { label: "New Estimate", value: "NEW_ESTIMATE" },
                { label: "Re-Quote", value: "RE_QUOTE" },
                { label: "Variation", value: "VARIATION" }
              ]}
              onChange={(e: any) =>
                handleChange(
                  "projectType",
                  e.target.value
                )
              }
              triggerClassName={selectTriggerClass}
              placeholder="Select Project Type"
              labelClassName="block text-xs font-medium text-red-500 mb-1.5"
            />


            <Form.CustomSelect
              label="Priority"
              value={data.priority}
              options={[
                { label: "Low", value: "low" },
                { label: "Medium", value: "medium" },
                { label: "High", value: "high" },
                { label: "Critical", value: "critical" }
              ]}
              onChange={(e: any) =>
                handleChange(
                  "priority",
                  e.target.value
                )
              }
              triggerClassName={selectTriggerClass}
              placeholder="Select Priority"
              labelClassName="block text-xs font-medium text-red-500 mb-1.5"
            />

          </div>




          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            <Form.Date
              label="Expected Start Date"
              name="expectedStartDate"
              value={data.expectedStartDate}
              onChange={(e: any) =>
                handleChange(
                  "expectedStartDate",
                  e.target.value
                )
              }
              inputClassName={commonInputClass}
            />


            <Form.Date
              label="Expected Completion Date"
              name="expectedCompletionDate"
              value={data.expectedCompletionDate}
              onChange={(e: any) =>
                handleChange(
                  "expectedCompletionDate",
                  e.target.value
                )
              }
              inputClassName={commonInputClass}
            />

          </div>



          <Form.Date
            label="Bid Deadline"
            name="bidDeadline"
            value={data.bidDeadline}
            onChange={(e: any) =>
              handleChange(
                "bidDeadline",
                e.target.value
              )
            }
            inputClassName={commonInputClass}
          />



          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            <Form.Input
              label="Architect"
              name="architect"
              value={data.architect}
              onChange={(e: any) => handleChange("architect", e.target.value)}
              placeholder="John Architects Inc."
              inputClassName={commonInputClass}
              labelClassName="block text-xs font-medium text-red-500 mb-1.5"
            />


            <Form.Input
              label="Homeowner"
              name="homeowner"
              value={data.homeowner}
              onChange={(e: any) => handleChange("homeowner", e.target.value)}
              placeholder="John Doe"
              inputClassName={commonInputClass}
              labelClassName="block text-xs font-medium text-red-500 mb-1.5"
            />

          </div>

        </Form.Wrapper>

      </div>

      {/* Footer */}

      <div className="shrink-0 flex items-center justify-between px-4 pt-4">

        <button
          type="button"
          onClick={handleBack}
          className="
      px-5 py-0.5 rounded-full
      text-md
      bg-transparent
      hover:cursor-pointer
      border border-gray-500
      text-gray-800
      hover:border hover:border-red-500
      hover:text-red-500
    "
        >
          Back
        </button>

        {/* <button
          type="button"
          onClick={handleContinue}
          className="
          px-8 py-1
          rounded-md
          bg-red-500
          text-white
          hover:bg-red-600
          hover:cursor-pointer
          "
        >
          Continue
        </button> */}

        <button
          type="button"
          disabled={isDisabled}
          onClick={handleContinue}
          className="
    px-8
    py-1
    rounded-md
    transition-colors
    duration-200

    bg-red-500
    text-white
    hover:bg-red-600
    hover:cursor-pointer

    disabled:bg-gray-200
    disabled:text-gray-400
    disabled:cursor-not-allowed
  "
        >
          Continue
        </button>
      </div>

    </div>

  );

};

export default ProjectDetailsModule;
