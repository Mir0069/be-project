import { Form } from "@/components/ui/Form";
import { useCreateProject } from "../context/CreateProjectContext";

const commonInputClass =
  "w-full rounded-md border-2 border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 placeholder:text-gray-600 outline-none focus:border-red-500 focus:border-2 focus:bg-white transition";

const selectTriggerClass = `
w-full rounded-md border-2 border-gray-200 bg-gray-50 px-3 py-2
flex items-center justify-between text-sm
outline-none hover:border-red-500
`;

const ClientContactModule = () => {

  const {
    projectData,
    setProjectData
  } = useCreateProject();

  const hasZohoIntegration =
    projectData.integrations.zoho.integrated;

  const contactData =
    projectData.formData.clientContact;


  const handleChange = (
    field: keyof typeof contactData,
    value: string
  ) => {

    setProjectData(prev => ({

      ...prev,

      formData: {

        ...prev.formData,

        clientContact: {

          ...prev.formData.clientContact,

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

          currentStep: 4

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

          currentStep: 2

        }

      })
    );

  };

  const isDisabled =

    !contactData.address?.trim() ||
    !contactData.city?.trim() ||
    !contactData.country?.trim() ||
    !contactData.designation?.trim() ||
    !contactData.email?.trim() ||
    !contactData.primaryContact?.trim() ||
    !contactData.primary_phone?.trim() ||
    !contactData.secondaryContact?.trim() ||
    !contactData.secondary_phone?.trim() ||
    !contactData.state?.trim() ||
    !contactData.zipCode?.trim();

  return (

    <div className="bg-white rounded-lg px-5 py-4 w-full h-full flex flex-col">

      {/* Header */}

      <div className="shrink-0 mb-8 flex items-center justify-between">

        <div>

          <h1 className="text-2xl font-semibold text-red-500">
            Client Contact
          </h1>

          <p className="text-sm text-gray-500 mt-1">

            {hasZohoIntegration ? (
              <>
                Validate or Edit Zoho extracted client contact details.
              </>
            ) : (
              "Fill necessary information of client contact."
            )}

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


      {/* Form */}

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

          <div className="mb-3">

            <h3 className="text-red-500 text-lg font-semibold">
              Contact Information
            </h3>

          </div>


          {/* Primary contact */}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            <Form.Input
              label="Primary Contact Name"
              name="primaryContact"

              value={contactData.primaryContact}

              onChange={(e: any) =>
                handleChange(
                  "primaryContact",
                  e.target.value
                )
              }

              placeholder="John Doe"
              labelClassName="block text-xs font-medium text-red-500 mb-1.5"
              inputClassName={commonInputClass}
            />


            <Form.Input
              label="Email"
              name="email"

              value={contactData.email}

              onChange={(e: any) =>
                handleChange(
                  "email",
                  e.target.value
                )
              }

              type="email"
              placeholder="john@company.com"
              labelClassName="block text-xs font-medium text-red-500 mb-1.5"
              inputClassName={commonInputClass}
            />

          </div>


          {/* Phone + designation */}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            <Form.Input
              label="Phone"
              name="primary_phone"

              value={contactData.primary_phone}

              onChange={(e: any) =>
                handleChange(
                  "primary_phone",
                  e.target.value
                )
              }

              type="tel"
              placeholder="+1 234 567 890"
              labelClassName="block text-xs font-medium text-red-500 mb-1.5"
              inputClassName={commonInputClass}
            />


            <Form.Input
              label="Designation"
              name="designation"

              value={contactData.designation}

              onChange={(e: any) =>
                handleChange(
                  "designation",
                  e.target.value
                )
              }

              placeholder="Project Manager"
              labelClassName="block text-xs font-medium text-red-500 mb-1.5"
              inputClassName={commonInputClass}
            />

          </div>


          {/* Secondary */}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            <Form.Input
              label="Secondary Contact"
              name="secondaryContact"

              value={contactData.secondaryContact}

              onChange={(e: any) =>
                handleChange(
                  "secondaryContact",
                  e.target.value
                )
              }

              placeholder="Jane Doe"
              labelClassName="block text-xs font-medium text-red-500 mb-1.5"
              inputClassName={commonInputClass}
            />


            <Form.Input
              label="Phone"
              name="secondary_phone"

              value={contactData.secondary_phone}

              onChange={(e: any) =>
                handleChange(
                  "secondary_phone",
                  e.target.value
                )
              }

              type="tel"
              placeholder="+1 234 567 890"
              labelClassName="block text-xs font-medium text-red-500 mb-1.5"
              inputClassName={commonInputClass}
            />

          </div>


          <div className="mt-8 mb-3">

            <h3 className="text-red-500 text-lg font-semibold">
              Address Information
            </h3>

          </div>


          {/* Address */}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            <Form.Input
              label="Address"
              name="address"

              value={contactData.address}

              onChange={(e: any) =>
                handleChange(
                  "address",
                  e.target.value
                )
              }

              placeholder="240 Baker Street"
              labelClassName="block text-xs font-medium text-red-500 mb-1.5"
              inputClassName={commonInputClass}
            />


            <Form.Input
              label="City"
              name="city"

              value={contactData.city}

              onChange={(e: any) =>
                handleChange(
                  "city",
                  e.target.value
                )
              }

              placeholder="San Antonio"
              labelClassName="block text-xs font-medium text-red-500 mb-1.5"
              inputClassName={commonInputClass}
            />

          </div>


          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            <Form.Input
              label="State"
              name="state"

              value={contactData.state}

              onChange={(e: any) =>
                handleChange(
                  "state",
                  e.target.value
                )
              }

              placeholder="Texas"
              labelClassName="block text-xs font-medium text-red-500 mb-1.5"
              inputClassName={commonInputClass}
            />


            <Form.Input
              label="Country"
              name="country"

              value={contactData.country}

              onChange={(e: any) =>
                handleChange(
                  "country",
                  e.target.value
                )
              }

              placeholder="United States"
              labelClassName="block text-xs font-medium text-red-500 mb-1.5"
              inputClassName={commonInputClass}
            />

          </div>


          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            <Form.Input
              label="Zip Code"
              name="zipCode"

              value={contactData.zipCode}

              onChange={(e: any) =>
                handleChange(
                  "zipCode",
                  e.target.value
                )
              }

              placeholder="78205"
              labelClassName="block text-xs font-medium text-red-500 mb-1.5"
              inputClassName={commonInputClass}
            />

          </div>


          <div className="grid grid-cols-1 gap-4">

            <Form.Textarea
              label="Project Site Address"
              name="projectSiteAddress"

              value={contactData.projectSiteAddress}

              onChange={(e: any) =>
                handleChange(
                  "projectSiteAddress",
                  e.target.value
                )
              }

              rows={3}
              placeholder="Enter project site address..."
              labelClassName="block text-xs font-medium text-red-500 mb-1.5"
              textareaClassName={commonInputClass}
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

export default ClientContactModule;