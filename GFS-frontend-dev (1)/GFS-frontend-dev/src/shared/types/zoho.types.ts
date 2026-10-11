export type ZohoLeadStatus =
  | "New"
  | "Contacted"
  | "Qualified"
  | "Unqualified";


export type ZohoLead={
  id:string;
  firstName:string;
  lastName:string;
  companyName:string;
  leadStatus:ZohoLeadStatus;
  [key: string]: any;

/* CLIENT DETAILS */

clientDetails:{

firstName:string;
lastName:string;

companyName:string;

website:string;

annualRevenue:string;

employees:string;

};


/* CLIENT CONTACT */

clientContact:{

primaryContact:string;

email:string;

primary_phone:string;

designation:string;

secondaryContact:string;

secondary_phone:string;

address:string;

city:string;

state:string;

country:string;

zipCode:string;

};


/* PROJECT DETAILS */

projectDetails:{

projectId:string;

projectName:string;

bidRecipient:string;

projectInterest:string;

estimatedBudget:string;

expectedStartDate:string;

expectedCompletionDate:string;

bidDeadline:string;

};

};
export type ZohoLeadRating = string;

export type ZohoNote = {
  id: string | null;
  title: string | null;
  content: string | null;
  author: string | null;
  createdTime: string | null;
};
