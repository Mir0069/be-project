import { Form } from "@/components/ui/Form";
import { useCreateProject } from "../context/CreateProjectContext";

const commonInputClass =
  "w-full rounded-md border-2 border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 placeholder:text-gray-600 outline-none focus:border-red-500 focus:border-2 focus:bg-white transition";

const selectTriggerClass = `
w-full rounded-md border-2 border-gray-200 bg-gray-50 px-3 py-2
flex items-center justify-between text-sm
outline-none hover:border-red-500
`;

const ClientDetailsModule = () => {

  const {
    projectData,
    setProjectData
  } = useCreateProject();

  const hasZohoIntegration =
    projectData.navigation.importedFlow;

  const clientData =
    projectData.formData.clientDetails;

  const handleChange = (
    field: keyof typeof projectData.formData.clientDetails,
    value: string
  ) => {

    setProjectData(
      prev => ({

        ...prev,

        formData: {

          ...prev.formData,

          clientDetails: {

            ...prev.formData.clientDetails,

            [field]: value

          }

        }

      })
    );

  };


  const handleContinue = () => {

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


  const handleBack = () => {

    setProjectData(
      prev => ({

        ...prev,

        navigation: {

          ...prev.navigation,

          currentStep: 1

        }

      })
    );

  };


  // const isDisabled =

  //   !clientData.firstName ||
  //   !clientData.lastName ||
  //   !clientData.companyName;

  const isDisabled =

    !clientData.companyName?.trim() ||
    !clientData.firstName?.trim() ||
    !clientData.lastName?.trim() ||
    !clientData.website?.trim();

  return (

    <div className="bg-white rounded-lg px-5 py-4 w-full h-full flex flex-col">

      {/* Header */}

      <div className="shrink-0 mb-8 flex items-center justify-between">

        <div>

          <h1 className="text-2xl font-semibold text-red-500">
            Client Details
          </h1>

          <p className="text-sm text-gray-500 mt-1">

            {
              hasZohoIntegration
                ? "Validate or edit imported Zoho client details."
                : "Fill necessary client details."
            }

          </p>

        </div>

        {
          hasZohoIntegration && (

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

          )
        }

      </div>


      {/* Scrollable form */}

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

          {/* Client Name */}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            <div>

              <label className="block text-xs font-medium text-red-500 mb-1.5">
                First Name *
              </label>

              <Form.Input
                name="firstName"
                value={clientData.firstName}
                onChange={(e: any) =>
                  handleChange(
                    "firstName",
                    e.target.value
                  )
                }
                placeholder="Meyvil"
                inputClassName={commonInputClass}
              />

            </div>

            <div>

              <label className="block text-xs font-medium text-red-500 mb-1.5">
                Last Name *
              </label>

              <Form.Input
                name="lastName"
                value={clientData.lastName}
                onChange={(e: any) =>
                  handleChange(
                    "lastName",
                    e.target.value
                  )
                }
                placeholder="Doe"
                inputClassName={commonInputClass}
              />

            </div>

          </div>


          {/* Company + Website */}

          <div className="grid grid-cols-1 md:grid-rows-2 gap-4">

            <Form.Input
              label="Company Name *"
              name="companyName"
              value={clientData.companyName}
              onChange={(e: any) =>
                handleChange(
                  "companyName",
                  e.target.value
                )
              }
              placeholder="ABC Construction Pvt Ltd"
              labelClassName="block text-xs font-medium text-red-500 mb-1.5"
              inputClassName={commonInputClass}
            />

            <Form.Input
              label="Website"
              name="website"
              value={clientData.website}
              onChange={(e: any) =>
                handleChange(
                  "website",
                  e.target.value
                )
              }
              placeholder="www.abcconstruction.com"
              labelClassName="block text-xs font-medium text-red-500 mb-1.5"
              inputClassName={commonInputClass}
            />

          </div>


          {/* Lead Info */}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            <Form.Input
              label="Lead Source"
              name="leadSource"

              value={
                clientData.leadSource
              }

              onChange={(e: any) =>
                handleChange(
                  "leadSource",
                  e.target.value
                )
              }

              placeholder="Website"

              labelClassName="
block text-xs font-medium text-red-500 mb-1.5
"

              inputClassName={
                commonInputClass
              }
            />

            <Form.CustomSelect

              label="Lead Status"

              value={
                clientData.leadStatus
              }

              options={[
                { label: "New", value: "new" },
                { label: "Contacted", value: "contacted" },
                { label: "Qualified", value: "qualified" },
                { label: "Unqualified", value: "unqualified" },
              ]}

              onChange={(e: any) =>

                handleChange(
                  "leadStatus",
                  e.target.value
                )

              }

              labelClassName="block text-xs font-medium text-red-500 mb-1.5"

              triggerClassName={
                selectTriggerClass
              }

              dropdownClassName="bg-white border-gray-300"

              placeholder="Select Lead Status"
            />

          </div>


          {/* Client Type */}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 
            <Form.CustomSelect

              label="Client Type"

              value={
                clientData.clientType
              }

              options={[
                {
                  label: "Commercial",
                  value: "commercial",
                },
                {
                  label: "Residential",
                  value: "residential",
                },
                {
                  label: "Government",
                  value: "government",
                },
                {
                  label: "Industrial",
                  value: "industrial",
                }
              ]}

              onChange={(e: any) =>

                handleChange(
                  "clientType",
                  e.target.value
                )

              }

              labelClassName="block text-xs font-medium text-red-500 mb-1.5"

              triggerClassName={
                selectTriggerClass
              }

              placeholder="Select Client Type"
            /> */}

            <Form.CustomSelect

              label="Rating"

              value={
                clientData.rating
              }

              options={[
                {
                  label: "Hot",
                  value: "hot"
                },
                // {
                //   label: "Warm",
                //   value: "warm"
                // },
                {
                  label: "Cold",
                  value: "cold"
                }
              ]}

              onChange={(e: any) =>

                handleChange(
                  "rating",
                  e.target.value
                )

              }

              labelClassName="block text-xs font-medium text-red-500 mb-1.5"

              triggerClassName={selectTriggerClass}

              dropdownClassName="bg-white border-gray-300"

              placeholder="Select Rating"
            />

          </div>


          {/* Rating

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            <Form.CustomSelect

              label="Rating"

              value={
                clientData.rating
              }

              options={[
                {
                  label: "Hot",
                  value: "hot"
                },
                {
                  label: "Warm",
                  value: "warm"
                },
                {
                  label: "Cold",
                  value: "cold"
                }
              ]}

              onChange={(e: any) =>

                handleChange(
                  "rating",
                  e.target.value
                )

              }

              labelClassName="block text-xs font-medium text-red-500 mb-1.5"

              triggerClassName={selectTriggerClass}

              dropdownClassName="bg-white border-gray-300"

              placeholder="Select Rating"
            />

            <Form.Input
              label="Industry"
              name="industry"

              value={
                clientData.industry
              }

              onChange={(e: any) =>
                handleChange(
                  "industry",
                  e.target.value
                )
              }

              placeholder="Commercial Construction"

              labelClassName="block text-xs font-medium text-red-500 mb-1.5"

              inputClassName={
                commonInputClass
              }
            />
          </div> */}


          {/* Revenue */}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            <Form.Input
              label="Annual Revenue"
              name="annualRevenue"
              value={clientData.annualRevenue}
              onChange={(e: any) =>
                handleChange(
                  "annualRevenue",
                  e.target.value
                )
              }
              placeholder="$12,000,000"
              labelClassName="block text-xs font-medium text-red-500 mb-1.5"
              inputClassName={commonInputClass}
            />

            <Form.Input
              label="No. of Employees"
              name="employees"
              value={clientData.employees}
              onChange={(e: any) =>
                handleChange(
                  "employees",
                  e.target.value
                )
              }
              placeholder="85"
              labelClassName="block text-xs font-medium text-red-500 mb-1.5"
              inputClassName={commonInputClass}
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
      border border-gray-500
      text-gray-800
      hover:border hover:border-red-500
      hover:text-red-500
      hover:cursor-pointer
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

export default ClientDetailsModule;