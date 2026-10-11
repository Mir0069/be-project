// pages/estimator/workspace/mockData.ts
// All static data for the project workspace lives here.
// Each export has a typed shape — swap with React Query hooks later, components don't change.

export type ProjectDocumentType =
  | "pdf"
  | "docx"
  | "jpg"
  | "zip"
  | "txt"
  | "vtt"
  | "mp3"
  | "wav"
  | "m4a";

export type ProjectDocument = {
  id: string;
  fileName: string;
  fileType: ProjectDocumentType;
  uploadedAt: string; // ISO or human-friendly for now
  sizeBytes: number;
};

export type ProjectMeta = {
  id: string;
  title: string;
  systemTag: string;
};

export type AIInsightSummary = {
  title: string;
  generatedFromCount: number;
  paragraphs: string[];
  citationDocs: string[];
};

export type DimensionRow = {
  parameter: string;
  value: string;
  unit: string;
};

export type ChatAttachment = {
  fileName: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  attachments?: ChatAttachment[];
};

// ─────────────────────────────────────────────
// MOCK DATA
// ─────────────────────────────────────────────

export const projectMeta: ProjectMeta = {
  id: "PRJ-0042",
  title: "Miami Complex",
  systemTag: "Glass Bridge",
};

export const projectDocuments: ProjectDocument[] = [
  {
    id: "doc-1",
    fileName: "Structural_Plans.pdf",
    fileType: "pdf",
    uploadedAt: "Mar 24, 2026 10:15 AM",
    sizeBytes: 12 * 1024 * 1024,
  },
  {
    id: "doc-2",
    fileName: "Specs.docx",
    fileType: "docx",
    uploadedAt: "Mar 24, 2026 10:10 AM",
    sizeBytes: 4.3 * 1024 * 1024,
  },
  {
    id: "doc-3",
    fileName: "Dimensions.jpg",
    fileType: "jpg",
    uploadedAt: "Mar 24, 2026 10:00 AM",
    sizeBytes: 0.2 * 1024 * 1024,
  },
  {
    id: "doc-4",
    fileName: "CallTranscript_DanielHarper.txt",
    fileType: "txt",
    uploadedAt: "Mar 25, 2026 09:42 AM",
    sizeBytes: 85 * 1024,
  },
  {
    id: "doc-5",
    fileName: "ClientCall_Mar25.mp3",
    fileType: "mp3",
    uploadedAt: "Mar 25, 2026 09:40 AM",
    sizeBytes: 6.4 * 1024 * 1024,
  },
];

export const aiInsightSummary: AIInsightSummary = {
  title: "HighState Plaza GlassBrigde Project Summary",
  generatedFromCount: 3,
  paragraphs: [
    "The HighState Plaza GlassBridge project involves the installation of a structural glass flooring system connecting two commercial blocks within the plaza. The bridge is designed to support moderate to high pedestrian traffic while maintaining maximum transparency and aesthetic appeal. Based on the uploaded architectural drawings, the structure spans approximately 12 meters in length with a consistent width of 2.5 meters.",
    "The system appears to align with a modular framing solution, likely from the Series 2000 product family, suitable for elevated glass walkways. Preliminary analysis indicates the requirement for laminated, tempered glass panels with anti-slip coating for safety compliance. The supporting structure includes aluminum or steel framing with concealed fixings.",
    "Some key parameters such as exact load requirements, glass thickness confirmation, and finish specifications are either partially detected or missing and will require estimator validation before proceeding to configuration and pricing.",
  ],
  citationDocs: ["Specs.docx"],
};

export const dimensionsTable: DimensionRow[] = [
  { parameter: "Bridge length", value: "12.0", unit: "m" },
  { parameter: "Bridge width", value: "2.5", unit: "m" },
  { parameter: "Panel length", value: "1.2", unit: "m" },
  { parameter: "Panel length", value: "0.8", unit: "m" },
  { parameter: "Number of Panels", value: "30", unit: "---" },
];

export const chatMessages: ChatMessage[] = [
  {
    id: "m-1",
    role: "user",
    text: "Hi, I want you to begin with project summary based on the provided documents",
    attachments: [
      { fileName: "Specs.docx" },
      { fileName: "Structural_Plans.pdf" },
      { fileName: "Dimension.jpg" },
    ],
  },
  {
    id: "m-2",
    role: "assistant",
    text: "Sure, Here You Go!! I have provided detailed analysis of the project.",
  },
];

export const chatSourceOptions = [
  { value: "docs", label: "Project Docs" },
  { value: "outlook", label: "Outlook Mails" },
  { value: "teams", label: "Teams Chat" },
];

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(2) : mb.toFixed(0)} MB`;
};

// ─────────────────────────────────────────────
// PARAMETERS
// ─────────────────────────────────────────────

export type ParametersForm = {
  dimensions: { length: string; lengthUnit: string; width: string; widthUnit: string; quantity: string };
  systemConfig: { applicationType: string; systemType: string; location: string };
  glassSpec: { applicationType: string; thickness: string; surfaceTreatment: string };
  finishes: { frameFinish: string; glassTexture: string };
  structural: { supportStructure: string; shape: string; installationType: string };
};

export const parametersDefaults: ParametersForm = {
  dimensions: { length: "", lengthUnit: "", width: "", widthUnit: "", quantity: "" },
  systemConfig: { applicationType: "Interior Glass Floor", systemType: "Series 1000", location: "Interior" },
  glassSpec: { applicationType: "Laminated", thickness: "", surfaceTreatment: "Anti-slip Ceramic Frit" },
  finishes: { frameFinish: "Kynar 500 Black", glassTexture: "Smooth" },
  structural: { supportStructure: "Existing Steel", shape: "Rectangular", installationType: "Deck Mounted" },
};

export const paramOptions = {
  units: ["mm", "cm", "m", "in", "ft"],
  locations: ["Interior", "Exterior"],
  applicationTypes: ["Interior Glass Floor", "Glass Stair", "Stair Treads", "Walkable Skylight", "Glass Deck"],
  systemTypes: ["Series 1000", "Series 2000", "Series 3000", "EconoFrame", "Modular"],
  glassApplicationTypes: ["Laminated", "Tempered", "Triple Laminated", "Insulated (IGU)", "Non-Insulated"],
  surfaceTreatments: ["Anti-slip Ceramic Frit", "Dot Pattern", "Acid Etched", "Sandblasted"],
  frameFinishes: ["Kynar 500 Black", "Kynar Custom", "Anodized Aluminum", "Powder Coated", "Stainless Steel"],
  glassTextures: ["Smooth", "Anti-slip", "Patterned", "Frosted"],
  supportStructures: ["Existing Steel", "New Steel", "Concrete", "Timber", "Custom"],
  shapes: ["Rectangular", "Circular", "Triangular", "Custom"],
  installationTypes: ["Deck Mounted", "Recessed", "Pedestal Mounted", "Thermally Broken", "Non-Thermally Broken"],
};

// ─────────────────────────────────────────────
// BOM & PRICING
// ─────────────────────────────────────────────

export type BOMItem = {
  id: string;
  name: string;
  costPerUnit: number;
  isIncluded: string;
  reasoning: string;
};

export type BOMGroup = {
  name: string;
  items: BOMItem[];
};

export type BOMTotals = {
  subtotal: number;
  shipping: number;
  overhead: number;
  profit: number;
  total: number;
};

export const bomGroups: BOMGroup[] = [
  {
    name: "Glass System",
    items: [
      { id: "b-1", name: "Glass Panels", costPerUnit: 20.19, isIncluded: "Y", reasoning: "Primary load-bearing surface" },
      { id: "b-2", name: "IGU / Non-IGU variant", costPerUnit: 10.0, isIncluded: "N", reasoning: "Not required for interior application" },
    ],
  },
  {
    name: "Framing System",
    items: [
      { id: "b-3", name: "Series 1000 - Pedestal", costPerUnit: 11.11, isIncluded: "Y", reasoning: "Standard mounting system" },
      { id: "b-4", name: "Series 1000 - Beam", costPerUnit: 10.0, isIncluded: "N", reasoning: "Using pedestals instead of beams" },
      { id: "b-5", name: "Series 2000 - Pedestal", costPerUnit: 9, isIncluded: "Y", reasoning: "Secondary support elements" },
      { id: "b-6", name: "Series 2000 - With Plate", costPerUnit: 10.0, isIncluded: "Y", reasoning: "Required for corner junctions" },
    ],
  },
  {
    name: "Hardware",
    items: [
      { id: "b-7", name: "Fasteners", costPerUnit: 11.11, isIncluded: "Y", reasoning: "Essential installation hardware" },
      { id: "b-8", name: "Mounting Brackets", costPerUnit: 10.0, isIncluded: "Y", reasoning: "Secures frame to concrete deck" },
      { id: "b-9", name: "Custom Gasket", costPerUnit: 9, isIncluded: "N", reasoning: "Standard silicone seal used instead" },
    ],
  },
  {
    name: "Fabrication & Labor",
    items: [
      { id: "b-10", name: "Man Hours", costPerUnit: 11.11, isIncluded: "Y", reasoning: "Estimated installation time" },
      { id: "b-11", name: "Painting / Finishing", costPerUnit: 10.0, isIncluded: "Y", reasoning: "Custom Kynar 500 Black finish" },
      { id: "b-12", name: "Packaging", costPerUnit: 9, isIncluded: "Y", reasoning: "Protective crating for shipping" },
    ],
  },
];

export const bomTotals: BOMTotals = {
  subtotal: 8837.57,
  shipping: 58.8,
  overhead: 728.1,
  profit: 5123.47,
  total: 12467.76,
};

export const bomComponentOptions = ["Glass System", "Framing System", "Hardware", "Fabrication & Labor"];
export const bomSubComponentOptions: Record<string, string[]> = {
  "Glass System": ["Glass Panels", "IGU / Non-IGU variant"],
  "Framing System": ["Series 1000 - Pedestal", "Series 1000 - Beam", "Series 2000 - Pedestal", "Series 2000 - With Plate"],
  Hardware: ["Fasteners", "Mounting Brackets", "Custom Gasket"],
  "Fabrication & Labor": ["Man Hours", "Painting / Finishing", "Packaging"],
};

// ─────────────────────────────────────────────
// PROPOSAL
// ─────────────────────────────────────────────

export type ProposalDoc = {
  date: string;
  validUntil: string;
  company: { name: string; address: string; suite: string; cityZip: string };
  preparedFor: { client: string; attn: string; address: string; cityZip: string };
  projectDetails: { name: string; id: string; type: string };
  scopeIntro: string[];
  scopeBullets: string[];
};

export type ProposalRevision = {
  id: string;
  label: string;
  timestamp: string;
  notes: string;
  author: string;
};

export const proposalDoc: ProposalDoc = {
  date: "October 28, 2026",
  validUntil: "November 28, 2026",
  company: {
    name: "Glass Flooring Systems",
    address: "123 Industrial Pkwy",
    suite: "Suite 100",
    cityZip: "New York, NY 10001",
  },
  preparedFor: {
    client: "HighState Plaza Development Group",
    attn: "Attn: John Carter",
    address: "275 Madison Avenue",
    cityZip: "New York, NY 10016",
  },
  projectDetails: {
    name: "HighState Plaza Glass Bridge Project",
    id: "HSP-GB-2026-014",
    type: "Glass Bridge / Catwalk",
  },
  scopeIntro: [
    "Design, engineering, fabrication, and delivery of a custom structural glass bridge system connecting two commercial sections within HighState Plaza. The system is designed to support high pedestrian traffic while maintaining maximum transparency and architectural aesthetics.",
    "The scope includes structural framing, triple laminated anti-slip glass panels, and all necessary hardware and sealing components required for installation.",
  ],
  scopeBullets: [
    "Total Area: 1,200 sq ft",
    "Glass Specification: Triple Laminated Low-Iron (Anti-slip Ceramic Frit)",
    "System Type: Series 2000 Structural Glass System",
    "Support Structure: Thermally Broken Steel Frame (Kynar 500 Finish)",
    "Engineering Calculations: Included (Stamped Structural Review)",
  ],
};

export const proposalRevisions: ProposalRevision[] = [
  {
    id: "v-1",
    label: "Version_1",
    timestamp: "Today, 2:30pm",
    notes: "First draft generated",
    author: "John Doe",
  },
];

// ─────────────────────────────────────────────
// COMMUNICATIONS
// ─────────────────────────────────────────────

export type EmailMessage = {
  id: string;
  from: string;
  fromEmail: string;
  to: string;
  toEmail: string;
  cc?: string;
  subject: string;
  preview: string;
  body: string;
  timestamp: string;
  attachments?: { name: string; type: "doc" | "image" }[];
};

export const emails: EmailMessage[] = [
  {
    id: "e-1",
    from: "Daniel Harper",
    fromEmail: "daniel.harper@apexconst.com",
    to: "JohnDoe",
    toEmail: "john.doe@company.com",
    cc: "Operations Team",
    subject: "Glass Bridge Design Confirmation",
    preview: "Thanks for sharing the latest layout for the glass bridge connection between Towers A and B. The overall design looks great from our side, and we're happy with how the transparency and …",
    body: "Hi John,\n\nThanks for sharing the latest layout for the glass bridge connection between Towers A and B. The overall design looks great from our side, and we're happy with how the transparency and structural elements are coming together.\n\nBefore we proceed, could you confirm if the proposed glass specification (triple laminated with anti-slip coating) meets the load requirements for peak occupancy?\n\nAlso, please let us know if there are any updates required from our end regarding architectural drawings.\n\nBest regards,\nDaniel",
    timestamp: "Today, 10:45",
    attachments: [
      { name: "Glassbridgedoc1.pdf", type: "doc" },
      { name: "Glassbridgecad.jpg", type: "image" },
    ],
  },
  {
    id: "e-2",
    from: "Sarah Jenkins",
    fromEmail: "sarah.jenkins@apexconst.com",
    to: "JohnDoe",
    toEmail: "john.doe@company.com",
    subject: "Structural Review – Glass Bridge System",
    preview: "We've completed the structural analysis for the glass bridge system based on the latest parameters provided. The Series 2000 configuration with the specified glass thickness ……………",
    body: "We've completed the structural analysis for the glass bridge system based on the latest parameters provided.",
    timestamp: "Yesterday",
  },
  {
    id: "e-3",
    from: "Mark Ellison",
    fromEmail: "mark.ellison@apexconst.com",
    to: "JohnDoe",
    toEmail: "john.doe@company.com",
    subject: "Delivery Schedule – Glass Panels & Frame Components",
    preview: "We've reviewed the shipment plan for the glass panels and framing components for the Riverside Glass Bridge project. Based on current timelines, we can schedule delivery in two phases:…………",
    body: "We've reviewed the shipment plan for the glass panels and framing components.",
    timestamp: "Mar 22",
    attachments: [{ name: "DeliverySchedule.pdf", type: "doc" }],
  },
];

export type ChatThread = {
  id: string;
  name: string;
  lastMessage: string;
  lastTime: string;
  unread?: number;
};

export type ChatThreadMessage = {
  id: string;
  threadId: string;
  fromMe: boolean;
  text: string;
  timestamp: string;
};

export const chatThreads: ChatThread[] = [
  {
    id: "t-1",
    name: "Daniel Harper",
    lastMessage: "You: Can we finalize the bridge dimensions today?",
    lastTime: "Today, 2:45 pm",
    unread: 1,
  },
  {
    id: "t-2",
    name: "Riverside Project Team",
    lastMessage: "Daniel: Engineering approved the load calculations",
    lastTime: "Today, 9:35 am",
    unread: 3,
  },
  {
    id: "t-3",
    name: "Emily Ross",
    lastMessage: "Emily Ross - Yes, the engineering team confirmed",
    lastTime: "Today, 5:32 pm",
  },
  {
    id: "t-4",
    name: "Site Coordination Group",
    lastMessage: "Glass Fitting needs confirmation",
    lastTime: "Yesterday, 3:10pm",
  },
];

export const chatThreadMessages: ChatThreadMessage[] = [
  {
    id: "tm-1",
    threadId: "t-3",
    fromMe: true,
    text: "Hi Sarah, Just wanted to check if we finalized the dimensions for the glass bridge?",
    timestamp: "Yesterday, 10:20 am",
  },
  {
    id: "tm-2",
    threadId: "t-3",
    fromMe: false,
    text: "Hi John, yes we're currently working with 40 ft length and 30 ft width based on the latest drawings.",
    timestamp: "Yesterday, 11:32 am",
  },
  {
    id: "tm-3",
    threadId: "t-3",
    fromMe: true,
    text: "Got it. Does that include the updated support structure from engineering?",
    timestamp: "Yesterday, 2:32 pm",
  },
  {
    id: "tm-4",
    threadId: "t-3",
    fromMe: false,
    text: "Yes, the engineering team confirmed the Series 2000 system with a thermally broken support frame",
    timestamp: "Yesterday, 5:32 pm",
  },
];

export type CallRecording = {
  id: string;
  fileName: string;
};

export const callRecordings: CallRecording[] = [
  { id: "c-1", fileName: "CallRecordingwithDanielforarchitecturefeedback.txt" },
  { id: "c-2", fileName: "CallRecordingwithEmilyforphase2discussion.txt" },
  { id: "c-3", fileName: "CallRecordingwithMichealforpaneldiscussion.txt" },
  { id: "c-4", fileName: "CallRecordingwithEmilyfordimensions.txt" },
];

export type ProcessStep = {
  step: number;
  name: string;
  pendingDescription: string;
  completedDescription: string;
};

//  eariler 
// export const processSteps: ProcessStep[] = [

//   {
//     step: 1,
//     name: "Project Creation",
//     pendingDescription:
//       "Create project, assign estimator and consolidate data from Zoho, email, Teams and transcripts.",
//     completedDescription:
//       "Project created, estimator assigned and project data successfully consolidated.",
//   },

//   {
//     step: 2,
//     name: "Document Ingestion",
//     pendingDescription:
//       "Upload and validate project drawings, specifications and supporting documents.",
//     completedDescription:
//       "Project documents uploaded, validated and prepared for analysis.",
//   },

//   {
//     step: 3,
//     name: "AI Analysis",
//     pendingDescription:
//       "Analyze project documents and integrated data sources to extract project insights.",
//     completedDescription:
//       "AI analysis completed and project insights successfully extracted.",
//   },

//   {
//     step: 4,
//     name: "Parameter Setting",
//     pendingDescription:
//       "Review and configure project parameters generated from AI analysis.",
//     completedDescription:
//       "Project parameters reviewed, validated and finalized.",
//   },

//   {
//     step: 5,
//     name: "BOM & Pricing Generation",
//     pendingDescription:
//       "Generate bill of materials, quantities and preliminary pricing information.",
//     completedDescription:
//       "BOM and pricing calculations successfully generated.",
//   },

//   {
//     step: 6,
//     name: "Pricing Evaluation",
//     pendingDescription:
//       "Review pricing, apply discounts and adjust material costs if required.",
//     completedDescription:
//       "Pricing reviewed, validated and finalized for proposal generation.",
//   },

//   {
//     step: 7,
//     name: "Proposal Generation",
//     pendingDescription:
//       "Generate proposal draft based on approved project configuration and pricing.",
//     completedDescription:
//       "Proposal draft successfully generated.",
//   },

//   {
//     step: 8,
//     name: "Proposal Review",
//     pendingDescription:
//       "Review proposal content, pricing and assumptions before approval.",
//     completedDescription:
//       "Proposal review completed and feedback recorded.",
//   },

//   {
//     step: 9,
//     name: "Proposal Regeneration",
//     pendingDescription:
//       "Apply review feedback and regenerate the proposal.",
//     completedDescription:
//       "Proposal successfully regenerated with requested revisions.",
//   },

//   {
//     step: 10,
//     name: "Proposal Approval",
//     pendingDescription:
//       "Approve the final proposal before customer delivery.",
//     completedDescription:
//       "Proposal approved and ready for delivery.",
//   },

//   {
//     step: 11,
//     name: "Proposal Delivery",
//     pendingDescription:
//       "Send proposal via email or export proposal documents for delivery.",
//     completedDescription:
//       "Proposal successfully delivered or exported.",
//   },
// ];


export const processSteps: ProcessStep[] = [

  {
    step: 1,
    name: "Project Input",
    pendingDescription:
      "Collect project requirements, documents and client information from available sources.",
    completedDescription:
      "Project inputs successfully collected and validated.",
  },

  {
    step: 2,
    name: "Glass & System Selection",
    pendingDescription:
      "Identify the appropriate glass system and product category for the project.",
    completedDescription:
      "Glass system and product category selected.",
  },

  {
    step: 3,
    name: "Panel Layout & Quantity",
    pendingDescription:
      "Determine panel layout, dimensions and quantity requirements.",
    completedDescription:
      "Panel layouts and quantities calculated.",
  },

  {
    step: 4,
    name: "Glass Qty & Specs",
    pendingDescription:
      "Calculate glass quantities and define required specifications.",
    completedDescription:
      "Glass quantities and specifications finalized.",
  },

  {
    step: 5,
    name: "Framing Selection & Quantity",
    pendingDescription:
      "Select framing systems and calculate required quantities.",
    completedDescription:
      "Framing systems selected and quantities determined.",
  },

  {
    step: 6,
    name: "Hardware & Consumables",
    pendingDescription:
      "Identify hardware components and consumable material requirements.",
    completedDescription:
      "Hardware and consumable requirements calculated.",
  },

  {
    step: 7,
    name: "Labor & Packaging",
    pendingDescription:
      "Calculate labor effort, fabrication requirements and packaging costs.",
    completedDescription:
      "Labor and packaging costs successfully calculated.",
  },

  {
    step: 8,
    name: "Pricing",
    pendingDescription:
      "Generate project pricing based on material, labor and packaging costs.",
    completedDescription:
      "Project pricing successfully generated.",
  },

  {
    step: 9,
    name: "Outputs (Quote)",
    pendingDescription:
      "Generate quotation outputs, pricing sheets and supporting documents.",
    completedDescription:
      "Quotation outputs successfully generated.",
  },

  {
    step: 10,
    name: "Review & Approval",
    pendingDescription:
      "Review quotation details and obtain required approvals.",
    completedDescription:
      "Quotation reviewed and approved.",
  },

  {
    step: 11,
    name: "Send Proposal",
    pendingDescription:
      "Deliver approved proposal to the customer.",
    completedDescription:
      "Proposal successfully delivered to the customer.",
  },

];