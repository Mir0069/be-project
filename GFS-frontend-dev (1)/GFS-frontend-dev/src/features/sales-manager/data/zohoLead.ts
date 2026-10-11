// Zoholead.ts

export const ZOHO_PROJECTS = [

  {
    id: "ZOHO-001",

    clientDetails: {
      firstName: "Emily",
      lastName: "Watson",
      companyName: "ABC Construction Pvt Ltd",
      website: "www.abcconstruction.com",
      annualRevenue: "$12,500,000",
      employees: "85",
    },

    clientContact: {
      primaryContact: "Emily Watson",
      email: "emily.watson@abcconstruction.com",
      primary_phone: "+1 210 555 8452",
      designation: "Project Manager",

      secondaryContact: "John Carter",
      secondary_phone: "+1 210 555 2241",

      address: "240 Baker Street",
      city: "San Antonio",
      state: "Texas",
      country: "United States",
      zipCode: "78205",
    },

    projectDetails: {
      projectId: "PRJ-0042",
      projectName: "Miami Glass Bridge",
      bidRecipient: "ABC Construction Pvt Ltd",

      projectInterest: "glass-bridge",
      estimatedBudget: "$250,000 - $400,000",

      expectedStartDate: "2026-06-15",
      expectedCompletionDate: "2026-11-30",
      bidDeadline: "2026-06-01",
    }
  },

  {
    id: "ZOHO-002",

    clientDetails: {
      firstName: "Michael",
      lastName: "Brown",
      companyName: "Skyline Developers",
      website: "www.skylinedev.com",
      annualRevenue: "$45,000,000",
      employees: "210",
    },

    clientContact: {
      primaryContact: "Michael Brown",
      email: "michael@skylinedev.com",
      primary_phone: "+1 312 555 9088",
      designation: "Construction Head",

      secondaryContact: "Sarah Williams",
      secondary_phone: "+1 312 555 9900",

      address: "890 Lake Shore Drive",
      city: "Chicago",
      state: "Illinois",
      country: "United States",
      zipCode: "60601",
    },

    projectDetails: {
      projectId: "PRJ-0067",
      projectName: "Chicago Skywalk Staircase",
      bidRecipient: "Skyline Developers",

      projectInterest: "glass-staircase",
      estimatedBudget: "$180,000 - $300,000",

      expectedStartDate: "2026-07-10",
      expectedCompletionDate: "2026-10-15",
      bidDeadline: "2026-06-25",
    }
  },

  {
    id: "ZOHO-003",

    clientDetails: {
      firstName: "Sophia",
      lastName: "Martinez",
      companyName: "Urban Living Group",
      website: "www.urbanlivinggrp.com",
      annualRevenue: "$28,000,000",
      employees: "145",
    },

    clientContact: {
      primaryContact: "Sophia Martinez",
      email: "sophia@urbanlivinggrp.com",
      primary_phone: "+1 415 555 8800",
      designation: "Design Director",

      secondaryContact: "Daniel Green",
      secondary_phone: "+1 415 555 7772",

      address: "155 Market Street",
      city: "San Francisco",
      state: "California",
      country: "United States",
      zipCode: "94103",
    },

    projectDetails: {
      projectId: "PRJ-0073",
      projectName: "San Francisco Glass Flooring",
      bidRecipient: "Urban Living Group",

      projectInterest: "glass-flooring",
      estimatedBudget: "$320,000 - $550,000",

      expectedStartDate: "2026-08-01",
      expectedCompletionDate: "2027-01-25",
      bidDeadline: "2026-07-10",
    }
  },

  {
    id: "ZOHO-004",

    clientDetails: {
      firstName: "James",
      lastName: "Anderson",
      companyName: "Elite Luxury Homes",
      website: "www.eliteluxuryhomes.com",
      annualRevenue: "$20,000,000",
      employees: "96",
    },

    clientContact: {
      primaryContact: "James Anderson",
      email: "james@eliteluxuryhomes.com",
      primary_phone: "+1 305 555 8845",
      designation: "Lead Architect",

      secondaryContact: "Emma Davis",
      secondary_phone: "+1 305 555 7712",

      address: "77 Palm Avenue",
      city: "Miami",
      state: "Florida",
      country: "United States",
      zipCode: "33101",
    },

    projectDetails: {
      projectId: "PRJ-0095",
      projectName: "Luxury Residential Glass Villa",
      bidRecipient: "Elite Luxury Homes",

      projectInterest: "custom",
      estimatedBudget: "$750,000 - $1,200,000",

      expectedStartDate: "2026-09-05",
      expectedCompletionDate: "2027-05-15",
      bidDeadline: "2026-08-20",
    }
  }

];


export type ZohoProject =
  typeof ZOHO_PROJECTS[number];