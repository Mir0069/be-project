// CreateProjectContext.tsx

import {
  createContext,
  useContext,
  useState,
  useEffect,
} from "react";

import type {
  ReactNode
} from "react";

import {
  ZOHO_PROJECTS
} from "../../data/zohoLead";

import {
  PROJECT_MAILS
} from "../../data/mail";

import {
  PROJECT_TEAMS
} from "../../data/teams";



/* ---------------- TYPES ---------------- */


export type ZohoProject =
  typeof ZOHO_PROJECTS[number];

export type MailType =
  typeof PROJECT_MAILS[number];

export type TeamType =
  typeof PROJECT_TEAMS[number];


type TranscriptFile = {
  id: string;

  name: string;

  size: number;

  type: string;

  uploadedAt: string;

  base64: string;
};

type UploadedDocument = {
  id: string;

  projectId: string;

  name: string;

  size: number;

  type: string;

  base64: string;

  uploadedAt: string;
};

type AssignedEstimator = {
  id: string;
  name: string;
  email: string;
};



/* ---------------- PROJECT STATE ---------------- */

export type ProjectState = {

  integrations: {

    zoho: {

      integrated: boolean;

      data: ZohoProject | null;

    };


    mails: {

      integrated: boolean;

      data: MailType[];

    };


    teams: {

      integrated: boolean;

      data: TeamType[];

    };


    transcripts: {

      integrated: boolean;

      data: TranscriptFile[];

    };

  };



  formData: {

    clientDetails: {

      firstName: string;
      lastName: string;
      companyName: string;
      website: string;
      annualRevenue: string;
      employees: string;

      leadSource: string;
      leadStatus: string;
      clientType: string;
      rating: string;
      industry: string;

    };


    clientContact: {

      primaryContact: string;
      email: string;
      primary_phone: string;
      designation: string;

      secondaryContact: string;
      secondary_phone: string;

      address: string;
      city: string;
      state: string;
      country: string;
      zipCode: string;

      projectSiteAddress: string;

    };


    projectDetails: {

      projectId: string;
      projectName: string;

      bidRecipient: string;

      projectInterest: string;

      estimatedBudget: string;

      expectedStartDate: string;

      expectedCompletionDate: string;

      bidDeadline: string;

      status: string;

      action: string;

      quoteNumber: string;

      personQuoting: string;

      projectType: string;

      priority: string;

      architect: string;

      homeowner: string;

    };



    documents:
    UploadedDocument[];

    assignments:
    AssignedEstimator[];

  };

  navigation: {

    currentStep: number;

    importedFlow: boolean;

  };

};



/* ---------------- CONTEXT TYPE ---------------- */


type ContextType = {

  projectData:
  ProjectState;

  setProjectData:
  React.Dispatch<
    React.SetStateAction<ProjectState>
  >;

};



/* ---------------- INITIAL STATE ---------------- */


export const initialState: ProjectState = {

  integrations: {

    zoho: {

      integrated: false,
      data: null

    },

    mails: {

      integrated: false,
      data: []

    },

    teams: {

      integrated: false,
      data: []

    },

    transcripts: {

      integrated: false,
      data: []

    }

  },



  formData: {

    clientDetails: {

      firstName: "",
      lastName: "",
      companyName: "",
      website: "",
      annualRevenue: "",
      employees: "",

      leadSource: "",
      leadStatus: "",
      clientType: "",
      rating: "",
      industry: ""
    },



    clientContact: {

      primaryContact: "",
      email: "",
      primary_phone: "",
      designation: "",

      secondaryContact: "",
      secondary_phone: "",

      address: "",
      city: "",
      state: "",
      country: "",
      zipCode: "",

      projectSiteAddress: ""

    },

    projectDetails: {

      projectId: "",
      projectName: "",

      bidRecipient: "",

      projectInterest: "",

      estimatedBudget: "",

      expectedStartDate: "",

      expectedCompletionDate: "",

      bidDeadline: "",

      status: "Not started",

      action: "Project Created",

      quoteNumber: "",

      personQuoting: "",

      projectType: "",

      priority: "",

      architect: "",

      homeowner: ""

    },

    documents: [],

    assignments: []

  },

  navigation: {
    currentStep: 1,
    importedFlow: false

  },
};



/* ---------------- CONTEXT ---------------- */


const CreateProjectContext =
  createContext<
    ContextType | undefined
  >(undefined);



export const CreateProjectProvider = ({

  children

}: {

  children: ReactNode

}) => {


  const [
    projectData,
    setProjectData
  ] = useState<ProjectState>(() => {

    const saved =
      localStorage.getItem(
        "create-project"
      );

    return saved
      ? JSON.parse(saved)
      : initialState;
  });

  useEffect(() => {

    localStorage.setItem(
      "create-project",
      JSON.stringify(projectData)
    );

  }, [projectData]);


  return (

    <CreateProjectContext.Provider

      value={{

        projectData,
        setProjectData

      }}

    >

      {children}

    </CreateProjectContext.Provider>

  );

};



export const useCreateProject = () => {

  const context =
    useContext(
      CreateProjectContext
    );

  if (!context) {

    throw new Error(
      "useCreateProject must be used inside CreateProjectProvider"
    );

  }

  return context;

};