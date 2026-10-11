
import { apiClient } from "@/shared/api/client";
import type { ZohoLead, ZohoNote } from "@/shared/types/zoho.types";


const MOCK_LEADS: any[] = [
  {
    id: "zl-1",
    firstName: "Meyvil",
    lastName: "Doe",
    company: "Cyprus Construction",
    title: "Project Director",
    email: "meyvil.doe@cyprus-construction.com",
    secondaryEmail: "meyvil.doe@gmail.com",
    phone: "(415) 555-0182",
    mobile: "(415) 555-7723",
    fax: "(415) 555-0190",
    website: "https://cyprus-construction.com",
    skypeId: "meyvil.doe",
    twitter: "@meyvilcyprus",
    address: "240 Baker Street, San Antonio, TX 78205",
    leadSource: "Website",
    leadStatus: "New",
    industry: "Commercial Construction",
    annualRevenue: "$12,000,000",
    noOfEmployees: "85",
    rating: "Hot",
    emailOptOut: false,
    projectInterest: "Glass Bridge",
    estimatedBudget: "$250,000 - $400,000",
    description:
      "Looking to add a pedestrian glass bridge connecting two office towers in their downtown campus. Timeline: Q3 2026.",
    notes: [
      {
        id: "n-1-1",
        author: "Sales Manager",
        content:
          "Met Meyvil at the AEC Expo. Strong interest in a 40m span. Asked us to send specs for laminated structural glass.",
        createdDate: "May 12, 2026 03:39 PM",
      },
      {
        id: "n-1-2",
        author: "Sales Manager",
        content:
          "Follow-up call: confirmed budget range. Decision-maker is the architect, copy them on the proposal.",
        createdDate: "May 14, 2026 11:10 AM",
      },
    ],
    visitSummary: {
      firstPageVisited: "/glass-bridges",
      mostRecentVisit: "May 15, 2026 09:22 AM",
      averageTimeSpentMinutes: "4.2",
      numberOfChats: "1",
      firstVisit: "Apr 30, 2026 02:15 PM",
      referrer: "Google Search",
      visitorScore: "78",
      daysVisited: "6",
      browser: "Chrome / macOS",
    },
    emails: [
      {
        id: "e-1-1",
        subject: "[Inbound] Specs request — glass bridge",
        date: "May 14, 2026 04:30 PM",
        source: "IMAP",
        sentBy: "meyvil.doe@cyprus-construction.com",
        status: "Sent",
      },
      {
        id: "e-1-2",
        subject: "Re: Pricing tier for laminated structural glass",
        date: "May 13, 2026 10:02 AM",
        source: "IMAP",
        sentBy: "sales@gfs.com",
        status: "Sent",
      },
    ],
    createdBy: "Sales Manager",
    createdDate: "2026-05-12",
    modifiedBy: "Sales Manager",
    modifiedDate: "2026-05-15",
    owner: "Sales Manager",
  },
  {
    id: "zl-2",
    firstName: "Jane",
    lastName: "Smith",
    company: "Apex Builders",
    title: "Lead Architect",
    email: "j.smith@apexbuilders.com",
    secondaryEmail: "",
    phone: "(212) 555-0144",
    mobile: "(212) 555-9921",
    fax: "",
    website: "https://apexbuilders.com",
    skypeId: "",
    twitter: "@apexbuilds",
    address: "1100 Madison Ave, New York, NY 10028",
    leadSource: "Referral",
    leadStatus: "Qualified",
    industry: "Architecture",
    annualRevenue: "$8,500,000",
    noOfEmployees: "42",
    rating: "Warm",
    emailOptOut: false,
    projectInterest: "Glass Flooring",
    estimatedBudget: "$150,000 - $220,000",
    description:
      "Luxury penthouse glass flooring overlay for a Madison Ave residence. Client wants frosted edge detailing.",
    notes: [
      {
        id: "n-2-1",
        author: "Sales Manager",
        content:
          "Referred by Hartwell Architects. Jane handles all spec sourcing for residential builds.",
        createdDate: "Apr 28, 2026 09:45 AM",
      },
    ],
    visitSummary: {
      firstPageVisited: "/portfolio/residential",
      mostRecentVisit: "May 13, 2026 06:48 PM",
      averageTimeSpentMinutes: "6.8",
      numberOfChats: "2",
      firstVisit: "Apr 22, 2026 11:00 AM",
      referrer: "Referral · Hartwell Architects",
      visitorScore: "85",
      daysVisited: "9",
      browser: "Safari / iOS",
    },
    emails: [
      {
        id: "e-2-1",
        subject: "Frosted-edge sample request",
        date: "May 10, 2026 02:14 PM",
        source: "IMAP",
        sentBy: "j.smith@apexbuilders.com",
        status: "Sent",
      },
      {
        id: "e-2-2",
        subject: "Re: Lead times for custom etching",
        date: "May 09, 2026 09:30 AM",
        source: "IMAP",
        sentBy: "sales@gfs.com",
        status: "Sent",
      },
      {
        id: "e-2-3",
        subject: "Initial intro — Apex Builders ↔ GFS",
        date: "Apr 28, 2026 10:00 AM",
        source: "IMAP",
        sentBy: "sales@gfs.com",
        status: "Sent",
      },
    ],
    createdBy: "Sales Manager",
    createdDate: "2026-04-28",
    modifiedBy: "Sales Manager",
    modifiedDate: "2026-05-14",
    owner: "Sales Manager",
  },
  {
    id: "zl-3",
    firstName: "Robert",
    lastName: "Chen",
    company: "SkyBridge LLC",
    title: "Operations Manager",
    email: "robert.chen@skybridge-llc.com",
    secondaryEmail: "rchen.contact@gmail.com",
    phone: "(303) 555-0167",
    mobile: "(303) 555-4488",
    fax: "",
    website: "https://skybridge-llc.com",
    skypeId: "robert.chen.sky",
    twitter: "",
    address: "780 Pine Crest Rd, Denver, CO 80202",
    leadSource: "Trade Show",
    leadStatus: "Contacted",
    industry: "Hospitality",
    annualRevenue: "$5,200,000",
    noOfEmployees: "120",
    rating: "Warm",
    emailOptOut: false,
    projectInterest: "Glass Stairs",
    estimatedBudget: "$80,000 - $120,000",
    description:
      "Boutique hotel renovation — wants a centerpiece floating glass staircase in the lobby.",
    notes: [
      {
        id: "n-3-1",
        author: "Sales Manager",
        content:
          "Met at GlassExpo Denver. Robert is comparing 3 vendors; deciding factor is install timeline.",
        createdDate: "May 02, 2026 04:20 PM",
      },
      {
        id: "n-3-2",
        author: "Sales Manager",
        content:
          "Sent product catalog + 2 reference projects. Waiting on architect's structural review.",
        createdDate: "May 09, 2026 11:45 AM",
      },
    ],
    visitSummary: {
      firstPageVisited: "/glass-stairs",
      mostRecentVisit: "May 10, 2026 08:12 AM",
      averageTimeSpentMinutes: "3.1",
      numberOfChats: "0",
      firstVisit: "May 02, 2026 04:30 PM",
      referrer: "Trade Show · GlassExpo Denver",
      visitorScore: "62",
      daysVisited: "4",
      browser: "Edge / Windows",
    },
    emails: [
      {
        id: "e-3-1",
        subject: "Catalog + reference projects",
        date: "May 03, 2026 09:15 AM",
        source: "IMAP",
        sentBy: "sales@gfs.com",
        status: "Sent",
      },
      {
        id: "e-3-2",
        subject: "Re: Install timeline question",
        date: "May 09, 2026 01:20 PM",
        source: "IMAP",
        sentBy: "robert.chen@skybridge-llc.com",
        status: "Sent",
      },
    ],
    createdBy: "Sales Manager",
    createdDate: "2026-05-02",
    modifiedBy: "Sales Manager",
    modifiedDate: "2026-05-10",
    owner: "Sales Manager",
  },
  {
    id: "zl-4",
    firstName: "Maria",
    lastName: "Garcia",
    company: "Mountain View Resorts",
    title: "Development Lead",
    email: "maria.garcia@mvresorts.com",
    secondaryEmail: "",
    phone: "(720) 555-0192",
    mobile: "(720) 555-3311",
    fax: "(720) 555-0193",
    website: "https://mvresorts.com",
    skypeId: "",
    twitter: "@mvresorts",
    address: "55 Summit Ridge, Aspen, CO 81611",
    leadSource: "Website",
    leadStatus: "New",
    industry: "Hospitality",
    annualRevenue: "$22,000,000",
    noOfEmployees: "210",
    rating: "Hot",
    emailOptOut: false,
    projectInterest: "Custom",
    estimatedBudget: "$500,000+",
    description:
      "Mountainside spa expansion: glass-floored observation deck and a glass walkway connecting suites.",
    notes: [
      {
        id: "n-4-1",
        author: "Sales Manager",
        content:
          "High-value lead — Maria oversees a $20M expansion. Custom panels + structural engineering required.",
        createdDate: "May 14, 2026 02:30 PM",
      },
    ],
    visitSummary: {
      firstPageVisited: "/custom-projects",
      mostRecentVisit: "May 15, 2026 07:40 AM",
      averageTimeSpentMinutes: "9.4",
      numberOfChats: "3",
      firstVisit: "May 14, 2026 12:00 PM",
      referrer: "Google Ads",
      visitorScore: "91",
      daysVisited: "2",
      browser: "Chrome / Windows",
    },
    emails: [
      {
        id: "e-4-1",
        subject: "Site visit availability — Aspen project",
        date: "May 14, 2026 04:00 PM",
        source: "IMAP",
        sentBy: "maria.garcia@mvresorts.com",
        status: "Sent",
      },
    ],
    createdBy: "Sales Manager",
    createdDate: "2026-05-14",
    modifiedBy: "Sales Manager",
    modifiedDate: "2026-05-15",
    owner: "Sales Manager",
  },
  {
    id: "zl-5",
    firstName: "David",
    lastName: "Lee",
    company: "Innovate Partners",
    title: "VP Real Estate",
    email: "david.lee@innovatepartners.com",
    secondaryEmail: "d.lee.personal@gmail.com",
    phone: "(415) 555-0173",
    mobile: "(415) 555-8866",
    fax: "",
    website: "https://innovatepartners.com",
    skypeId: "david.lee.ip",
    twitter: "@davidlee_ip",
    address: "2200 Market St, San Francisco, CA 94114",
    leadSource: "Cold Call",
    leadStatus: "Qualified",
    industry: "Tech / Commercial",
    annualRevenue: "$45,000,000",
    noOfEmployees: "600",
    rating: "Hot",
    emailOptOut: false,
    projectInterest: "Glass Flooring",
    estimatedBudget: "$300,000 - $450,000",
    description:
      "HQ retrofit on Market St — wants reinforced glass walkways between floors as a brand statement.",
    notes: [
      {
        id: "n-5-1",
        author: "Sales Manager",
        content:
          "Cold outreach landed. David is open to a discovery call. Mentioned a 6-month timeline.",
        createdDate: "Apr 20, 2026 11:00 AM",
      },
      {
        id: "n-5-2",
        author: "Sales Manager",
        content:
          "Discovery call done. They've already eliminated 2 vendors on load-bearing concerns. We're a frontrunner.",
        createdDate: "May 05, 2026 03:15 PM",
      },
      {
        id: "n-5-3",
        author: "Sales Manager",
        content:
          "Sent preliminary structural specs + safety compliance docs. Awaiting feedback from their engineer.",
        createdDate: "May 12, 2026 09:30 AM",
      },
    ],
    visitSummary: {
      firstPageVisited: "/glass-flooring",
      mostRecentVisit: "May 13, 2026 05:20 PM",
      averageTimeSpentMinutes: "7.3",
      numberOfChats: "2",
      firstVisit: "Apr 18, 2026 09:00 AM",
      referrer: "Direct",
      visitorScore: "88",
      daysVisited: "11",
      browser: "Chrome / macOS",
    },
    emails: [
      {
        id: "e-5-1",
        subject: "Preliminary specs + compliance docs",
        date: "May 12, 2026 09:45 AM",
        source: "IMAP",
        sentBy: "sales@gfs.com",
        status: "Sent",
      },
      {
        id: "e-5-2",
        subject: "Re: Discovery call notes",
        date: "May 05, 2026 04:00 PM",
        source: "IMAP",
        sentBy: "david.lee@innovatepartners.com",
        status: "Sent",
      },
      {
        id: "e-5-3",
        subject: "Intro — GFS structural glass solutions",
        date: "Apr 20, 2026 11:15 AM",
        source: "IMAP",
        sentBy: "sales@gfs.com",
        status: "Sent",
      },
    ],
    createdBy: "Sales Manager",
    createdDate: "2026-04-20",
    modifiedBy: "Sales Manager",
    modifiedDate: "2026-05-13",
    owner: "Sales Manager",
  },
];

const simulate = <T>(value: T) =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value), 200));
// --- END MOCK DATA ----------------------------------------------------------

export const fetchZohoLeads = async (): Promise<ZohoLead[]> => {

  return simulate(MOCK_LEADS);
};

export const fetchZohoLeadById = async (
  id: string
): Promise<ZohoLead | null> => {

  return simulate(MOCK_LEADS.find((l) => l.id === id) ?? null);
};

export const fetchZohoLeadNotes = async (
  zohoLeadId: string
): Promise<ZohoNote[]> => {
  const { data } = await apiClient.get<{ success: boolean; data: { notes: ZohoNote[] } }>(
    `/zoho/leads/${zohoLeadId}/notes`
  );
  return data.data?.notes ?? [];
};
