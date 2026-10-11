import React from 'react'
import IntegrationModule from '../components/Integration';
import ClientDetailsModule from '../components/ClientDetails';
import ClientContactModule from '../components/ClientContact';
import ProjectDetailsModule from '../components/ProjectDetails';
import DocumentsUploadModule from '../components/DocumentsUpload';
import AssignmentModule from '../components/Assignment';
import { useCreateProject } from '../context/CreateProjectContext';

const CreateProjectPage = () => {
  const steps = [
    { step: 1, name: "Integrations", completion: 0 },
    { step: 2, name: "Client Details", completion: 20 },
    { step: 3, name: "Client Contact", completion: 40 },
    { step: 4, name: "Project Details", completion: 60 },
    { step: 5, name: "Documents", completion: 80 },
    { step: 6, name: "Assignments", completion: 100 },
  ];

  const { projectData } = useCreateProject();

  const completedSteps = projectData.navigation.currentStep;

  return (
    <>
      <div className="border-l-3 border-red-500 px-4">
        <div className="text-2xl font-medium text-red-500 leading-[1.9rem]">Project Creation</div>
      </div>


      {/* <div className="flex items-center w-full mt-8 px-10 gap-6 h-[580px]"> */}
      <div className="flex w-full mt-8 px-10 gap-6 h-[580px] overflow-hidden">
        {/* <div className="w-[25%] h-[530px] relative flex flex-col items-center">

          <div
            className="
    absolute
    left-15.5
    top-6
    bottom-6
    w-[4px]
    bg-gray-300
    rounded-full
  "
          />

          <div
            className="
    absolute
    left-15.5
    top-6
    w-[4px]
    bg-red-500
    rounded-full
    transition-all
    duration-300
  "
            style={{
              height: `calc((100% - 48px) * ${(completedSteps - 1) / (steps.length - 1)})`
            }}
          />

          <div className="flex flex-col justify-between h-full z-10 mr-10">
            {steps.map((item: any) => {
              const completed = item.step <= completedSteps;

              return (
                <div
                  key={item.step}
                  className="flex items-center gap-4"
                >
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white text-lg font-bold shadow-xs
              ${completed ? "bg-red-500" : "bg-gray-400"} `}>
                    {item.step}
                  </div>
                  <div className={`font-medium text-md ${completed ? "text-red-500" : "text-gray-400"}`} >
                    {item.name}
                  </div>
                </div>
              );
            })}
          </div>
        </div> */}

        <div className="w-[25%] min-w-[240px] h-[530px] relative">
          {/* Line Container */}
          <div className="absolute left-9.5 top-9 bottom-4 w-[4px]">

            {/* Background Line */}
            <div className="w-full h-full bg-gray-300 rounded-full" />

            {/* Active Line */}
            <div
              className="
        absolute
        top-0
        left-0
        w-full
        bg-red-500
        rounded-full
        transition-all
        duration-300
      "
              style={{
                height: `${((completedSteps - 1) / (steps.length - 1)) * 100}%`,
              }}
            />
          </div>

          {/* Steps */}
          {/* <div className="flex flex-col justify-between h-full relative z-10"> */}
          <div className="flex flex-col justify-between h-full relative z-10 pl-4 pt-4">
            {steps.map((item: any) => {
              const completed = item.step <= completedSteps;

              return (
                <div
                  key={item.step}
                  className="flex items-center gap-4"
                >
                  <div
                    className={`
              w-12
              h-12
              min-w-12
              rounded-full
              flex
              items-center
              justify-center
              text-white
              text-lg
              font-bold
              shadow-xs
              transition-colors
              duration-300
              ${completed ? "bg-red-500" : "bg-gray-400"}
            `}
                  >
                    {item.step}
                  </div>

                  <div
                    className={`
              font-medium
              text-md
              transition-colors
              duration-300
              ${completed ? "text-red-500" : "text-gray-400"}
            `}
                  >
                    {item.name}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Project Creation Components */}
        {/* <div className="flex-1 h-full overflow-hidden"> */}
        <div className="flex-1 h-full min-h-0">
          {/* <div className="h-full flex items-center justify-center overflow-y-auto no-scrollbar"> */}
          <div
            className="
    h-full
    overflow-y-auto
    no-scrollbar
    pr-2
  "
          >
            {
              projectData.navigation.currentStep === 1 &&
              <IntegrationModule />
            }

            {
              projectData.navigation.currentStep === 2 &&
              <ClientDetailsModule />
            }

            {
              projectData.navigation.currentStep === 3 &&
              <ClientContactModule />
            }

            {
              projectData.navigation.currentStep === 4 &&
              <ProjectDetailsModule />
            }

            {
              projectData.navigation.currentStep === 5 &&
              <DocumentsUploadModule />
            }

            {
              projectData.navigation.currentStep === 6 &&
              <AssignmentModule />
            }
          </div>
        </div>

      </div>
    </>
  )
}

export default CreateProjectPage
