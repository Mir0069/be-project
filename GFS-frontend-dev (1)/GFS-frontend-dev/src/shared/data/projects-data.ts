export const STATIC_PROJECTS = [
  {
    id: "project_PRJ-0112",

    createdAt: "2026-05-27T17:15:00Z",

    source: "static",

    formData: {
      projectDetails: {
        projectId: "PRJ-0112",

        projectName: "Seattle Crystal Tower",

        bidRecipient: "NorthEdge Infrastructure",

        status: "Completed",

        action: "Proposal Sent/Submitted",

        projectInterest: "glass-flooring",

        estimatedBudget: "$420,000 - $680,000",

        expectedStartDate: "2026-07-12",

        expectedCompletionDate: "2027-01-18",

        bidDeadline: "2026-06-20",

        priority: "medium",

        projectType: "commercial",
      },

      clientDetails: {
        firstName: "Olivia",

        lastName: "Turner",

        companyName: "NorthEdge Infrastructure",

        website: "www.northedgeinfra.com",

        annualRevenue: "$31,000,000",

        employees: "126",

        clientType: "commercial",

        industry: "Infrastructure",

        leadStatus: "qualified",
      },

      clientContact: {
        primaryContact: "Olivia Turner",

        email: "olivia@northedgeinfra.com",

        primary_phone: "+1 206 555 2211",

        designation: "Operations Director",

        address: "420 Pine Street",

        city: "Seattle",

        state: "Washington",

        country: "United States",

        zipCode: "98101",

        projectSiteAddress: "Downtown Seattle",
      },

      assignments: [
        {
          id: "6a17fd4bc1f021fcdad59f3e",
          name: "Dan Doe",
          email: "dan@gfs.com",
        },

        {
          id: "6a17fd4cc1f021fcdad59f41",
          name: "Chris Doe",
          email: "chris@gfs.com",
        },

        {
          id: "6a17fd4cc1f021fcdad59f40",
          name: "Aaron Doe",
          email: "aaron@gfs.com",
        },
      ],

      documents: [
        {
          id: "doc-001",

          projectId: "PRJ-0112",

          name: "tower-flooring-layout.pdf",

          type: "application/pdf",

          size: 248000,

          uploadedAt: "2026-05-27T17:13:09.007Z",

          base64: "/static/documents/tower-flooring-layout.pdf",
        },

        {
          id: "doc-002",

          projectId: "PRJ-0112",

          name: "engineering-notes.docx",

          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",

          size: 128000,

          uploadedAt: "2026-05-27T17:13:09.007Z",

          base64: "/static/documents/engineering-notes.docx",
        },
      ],
    },

    integrations: {
      mails: {
        integrated: true,

        data: [
          {
            id: "MAIL-001",

            projectId: "PRJ-0112",

            subject: "Seattle tower flooring revisions",

            sender: "olivia@northedgeinfra.com",

            receivers: ["sales@gfs.com"],

            preview: "Please review updated flooring revisions.",

            attachments: ["flooring-v2.pdf"],

            date: "2026-05-15",
          },
        ],
      },

      teams: {
        integrated: true,

        data: [
          {
            id: "TEAM-001",

            projectId: "PRJ-0112",

            title: "Seattle Tower Planning",

            participants: ["sales@gfs.com", "estimations@gfs.com"],

            messages: 52,

            hasTranscript: true,

            date: "2026-05-18",
          },
        ],
      },

      transcripts: {
        integrated: true,

        data: [
          {
            id: "trans-001",

            name: "tower-planning-call.txt",

            type: "text/plain",

            size: 1200,

            uploadedAt: "2026-05-18T09:30:00Z",

            base64: "/static/transcripts/tower-planning-call.txt",
          },
        ],
      },
    },
  },

  /* =========================================================
      PROJECT 2
     ========================================================= */

  {
    id: "project_PRJ-0088",

    createdAt: "2026-06-03T11:10:00Z",

    source: "static",

    formData: {
      projectDetails: {
        projectId: "PRJ-0088",

        projectName: "New York Skyline Staircase",

        bidRecipient: "Empire Structures LLC",

        projectInterest: "glass-staircase",

        status: "In-progress",

        action: "Draft Proposal",

        estimatedBudget: "$180,000 - $300,000",

        expectedStartDate: "2026-07-10",

        expectedCompletionDate: "2026-12-20",

        bidDeadline: "2026-06-25",

        priority: "medium",

        projectType: "commercial",
      },

      clientDetails: {
        firstName: "Robert",

        lastName: "Miller",

        companyName: "Empire Structures LLC",

        website: "www.empirestructures.com",

        annualRevenue: "$8,500,000",

        employees: "54",

        clientType: "commercial",

        industry: "Architecture",

        leadStatus: "qualified",
      },

      clientContact: {
        primaryContact: "Robert Miller",

        email: "robert@empirestructures.com",

        primary_phone: "+1 646 555 8221",

        designation: "Senior Architect",

        address: "100 Madison Avenue",

        city: "New York",

        state: "New York",

        country: "United States",

        zipCode: "10010",

        projectSiteAddress: "Downtown Manhattan",
      },

      assignments: [
        {
          id: "6a17fd4bc1f021fcdad59f3f",
          name: "David Doe",
          email: "david@gfs.com",
        },

        {
          id: "6a17fd4cc1f021fcdad59f41",
          name: "Chris Doe",
          email: "chris@gfs.com",
        },
      ],

      documents: [
        {
          id: "doc-101",

          projectId: "PRJ-0088",

          name: "staircase-design.pdf",

          type: "application/pdf",

          size: 320000,

          uploadedAt: "2026-06-03T10:00:00Z",

          base64: "/static/documents/staircase-design.pdf",
        },
      ],
    },

    integrations: {
      mails: {
        integrated: true,

        data: [
          {
            id: "MAIL-101",

            projectId: "PRJ-0088",

            subject: "Initial staircase concept",

            sender: "robert@empirestructures.com",

            receivers: ["sales@gfs.com"],

            preview: "Attached staircase references.",

            attachments: ["staircase-concept.pdf"],

            date: "2026-06-01",
          },

          {
            id: "MAIL-102",

            projectId: "PRJ-0088",

            subject: "Architectural revisions",

            sender: "design@empirestructures.com",

            receivers: ["engineering@gfs.com"],

            preview: "Updated revisions attached.",

            attachments: ["revision-v2.pdf"],

            date: "2026-06-02",
          },
        ],
      },

      teams: {
        integrated: false,

        data: [],
      },

      transcripts: {
        integrated: false,

        data: [],
      },
    },
  },

  /* =========================================================
      PROJECT 3
     ========================================================= */

  {
    id: "project_PRJ-0095",

    createdAt: "2026-06-18T09:20:00Z",

    source: "static",

    formData: {
      projectDetails: {
        projectId: "PRJ-0095",

        projectName: "Luxury Residential Glass Villa",

        bidRecipient: "Elite Luxury Homes",

        projectInterest: "custom",

        estimatedBudget: "$750,000 - $1,200,000",

        expectedStartDate: "2026-09-05",

        expectedCompletionDate: "2027-05-15",

        bidDeadline: "2026-08-20",

        status: "In-progress",

        action: "Draft Proposal",

        priority: "high",

        projectType: "residential",
      },

      clientDetails: {
        firstName: "Sophia",

        lastName: "Reynolds",

        companyName: "Elite Luxury Homes",

        website: "www.eliteluxuryhomes.com",

        annualRevenue: "$22,000,000",

        employees: "140",

        clientType: "residential",

        industry: "Luxury Real Estate",

        leadStatus: "contacted",
      },

      clientContact: {
        primaryContact: "Sophia Reynolds",

        email: "sophia@eliteluxuryhomes.com",

        primary_phone: "+1 310 555 9201",

        designation: "Director",

        address: "880 Sunset Blvd",

        city: "Los Angeles",

        state: "California",

        country: "United States",

        zipCode: "90028",

        projectSiteAddress: "Beverly Hills",
      },

      assignments: [
        {
          id: "6a17fd4cc1f021fcdad59f40",
          name: "Aaron Doe",
          email: "aaron@gfs.com",
        },
        {
          id: "6a17fd4bc1f021fcdad59f3e",
          name: "Dan Doe",
          email: "dan@gfs.com",
        },
      ],

      documents: [
        {
          id: "doc-301",

          projectId: "PRJ-0095",

          name: "villa-rendering.jpg",

          type: "image/jpeg",

          size: 680000,

          uploadedAt: "2026-06-18T09:10:00Z",

          base64: "/static/documents/villa-rendering.jpeg",
        },

        {
          id: "doc-302",

          projectId: "PRJ-0095",

          name: "villa-blueprint.jpg",

          type: "image/jpg",

          size: 880000,

          uploadedAt: "2026-06-18T09:15:00Z",

          base64: "/static/documents/villa-blueprint.jpg",
        },
      ],
    },

    integrations: {
      mails: {
        integrated: true,

        data: [
          {
            id: "MAIL-301",

            projectId: "PRJ-0095",

            subject: "Villa glass elevation drawings",

            sender: "sophia@eliteluxuryhomes.com",

            receivers: ["sales@gfs.com"],

            preview: "Sharing elevation drawings for review.",

            attachments: ["villa-elevation.pdf"],

            date: "2026-06-16",
          },

          {
            id: "MAIL-302",

            projectId: "PRJ-0095",

            subject: "Updated budget sheet",

            sender: "finance@eliteluxuryhomes.com",

            receivers: ["accounts@gfs.com"],

            preview: "Budget sheet attached.",

            attachments: ["budget.xlsx"],

            date: "2026-06-17",
          },

          {
            id: "MAIL-303",

            projectId: "PRJ-0095",

            subject: "Site visit schedule",

            sender: "operations@eliteluxuryhomes.com",

            receivers: ["sales@gfs.com"],

            preview: "Scheduling site walkthrough.",

            attachments: [],

            date: "2026-06-18",
          },

          {
            id: "MAIL-304",

            projectId: "PRJ-0095",

            subject: "Glass supplier approvals",

            sender: "procurement@eliteluxuryhomes.com",

            receivers: ["engineering@gfs.com"],

            preview: "Approved supplier list attached.",

            attachments: ["suppliers.pdf"],

            date: "2026-06-19",
          },
        ],
      },

      teams: {
        integrated: true,

        data: [
          {
            id: "TEAM-301",

            projectId: "PRJ-0095",

            title: "Luxury Villa Planning",

            participants: ["sales@gfs.com", "engineering@gfs.com"],

            messages: 67,

            hasTranscript: true,

            date: "2026-06-18",
          },

          {
            id: "TEAM-302",

            projectId: "PRJ-0095",

            title: "Supplier Coordination",

            participants: ["procurement@eliteluxuryhomes.com"],

            messages: 29,

            hasTranscript: false,

            date: "2026-06-19",
          },

          {
            id: "TEAM-303",

            projectId: "PRJ-0095",

            title: "Budget Approval Discussion",

            participants: ["finance@eliteluxuryhomes.com"],

            messages: 48,

            hasTranscript: true,

            date: "2026-06-21",
          },
        ],
      },

      transcripts: {
        integrated: true,

        data: [
          {
            id: "trans-301",

            name: "villa-kickoff-call.txt",

            type: "text/plain",

            size: 1800,

            uploadedAt: "2026-06-18T14:20:00Z",

            base64: "/static/transcripts/villa-kickoff-call.txt",
          },
          {
            id: "trans-302",

            name: "supplier-discussion.txt",

            type: "text/plain",

            size: 2200,

            uploadedAt: "2026-06-21T11:15:00Z",

            base64: "/static/transcripts/supplier-discussion.txt",
          },
        ],
      },
    },
  },
  /* =========================================================
      PROJECT 4
     ========================================================= */
  {
    id: "project_PRJ-0144",
    createdAt: "2026-06-12T14:22:00Z",
    source: "static",
    formData: {
      projectDetails: {
        projectId: "PRJ-0144",
        projectName: "Miami Canopy Promenade",
        bidRecipient: "Apex Coast Development",
        status: "In-progress",
        action: "Requirements",
        projectInterest: "custom",
        estimatedBudget: "$290,000 - $410,000",
        expectedStartDate: "2026-08-01",
        expectedCompletionDate: "2026-11-15",
        bidDeadline: "2026-07-05",
        priority: "medium",
        projectType: "commercial",
      },
      clientDetails: {
        firstName: "Marcus",
        lastName: "Vance",
        companyName: "Apex Coast Development",
        website: "://apexcoastdev.com",
        annualRevenue: "$14,200,000",
        employees: "68",
        clientType: "commercial",
        industry: "Real Estate Development",
        leadStatus: "qualified",
      },
      clientContact: {
        primaryContact: "Marcus Vance",
        email: "mvance@apexcoastdev.com",
        primary_phone: "+1 305 555 9012",
        designation: "Project Coordinator",
        address: "800 Brickell Ave",
        city: "Miami",
        state: "Florida",
        country: "United States",
        zipCode: "33131",
        projectSiteAddress: "Biscayne Bay Walkway",
      },
      assignments: [
        {
          id: "6a17fd4bc1f021fcdad59f3e",
          name: "Dan Doe",
          email: "dan@gfs.com",
        },
      ],
      documents: [
        {
          id: "doc-144",
          projectId: "PRJ-0144",
          name: "canopy-site-elevation.pdf",
          type: "application/pdf",
          size: 412000,
          uploadedAt: "2026-06-12T14:19:30Z",
          base64: "/static/documents/canopy-site-elevation.pdf",
        },
      ],
    },
    integrations: {
      mails: {
        integrated: true,
        data: [
          {
            id: "MAIL-144",
            projectId: "PRJ-0144",
            subject: "Canopy Scope of Work",
            sender: "mvance@apexcoastdev.com",
            receivers: ["sales@gfs.com"],
            preview:
              "Please see initial specifications and wind load expectations.",
            attachments: ["spec-sheet.docx"],
            date: "2026-06-12",
          },
        ],
      },
      teams: {
        integrated: false,
        data: [],
      },
      transcripts: {
        integrated: false,
        data: [],
      },
    },
  },

  /* =========================================================
      PROJECT 5
     ========================================================= */
  {
    id: "project_PRJ-0150",
    createdAt: "2026-06-15T09:05:00Z",
    source: "static",
    formData: {
      projectDetails: {
        projectId: "PRJ-0150",
        projectName: "Chicago Balustrade Plaza",
        bidRecipient: "Windy City Builders Corp",
        status: "In-progress",
        action: "Review Proposal & Approval",
        projectInterest: "glass-flooring",
        estimatedBudget: "$510,000 - $720,000",
        expectedStartDate: "2026-10-01",
        expectedCompletionDate: "2027-03-30",
        bidDeadline: "2026-06-28",
        priority: "high",
        projectType: "commercial",
      },
      clientDetails: {
        firstName: "Elena",
        lastName: "Rostova",
        companyName: "Windy City Builders Corp",
        website: "://windycitybuilders.com",
        annualRevenue: "$45,000,000",
        employees: "210",
        clientType: "commercial",
        industry: "General Contracting",
        leadStatus: "qualified",
      },
      clientContact: {
        primaryContact: "Elena Rostova",
        email: "e.rostova@windycitybuilders.com",
        primary_phone: "+1 312 555 4433",
        designation: "Chief Estimator",
        address: "233 S Wacker Dr",
        city: "Chicago",
        state: "Illinois",
        country: "United States",
        zipCode: "60606",
        projectSiteAddress: "Michigan Avenue Plaza",
      },
      assignments: [
        {
          id: "6a17fd4cc1f021fcdad59f41",
          name: "Chris Doe",
          email: "chris@gfs.com",
        },
        {
          id: "6a17fd4cc1f021fcdad59f40",
          name: "Aaron Doe",
          email: "aaron@gfs.com",
        },
      ],
      documents: [
        {
          id: "doc-151",
          projectId: "PRJ-0150",
          name: "plaza-structural-glass.pdf",
          type: "application/pdf",
          size: 1024000,
          uploadedAt: "2026-06-15T08:55:00Z",
          base64: "/static/documents/plaza-structural-glass.pdf",
        },
      ],
    },
    integrations: {
      mails: {
        integrated: true,
        data: [
          {
            id: "MAIL-151",
            projectId: "PRJ-0150",
            subject: "Urgent: Final review numbers needed",
            sender: "e.rostova@windycitybuilders.com",
            receivers: ["chris@gfs.com"],
            preview: "Need total structural hardware markup by tomorrow.",
            attachments: [],
            date: "2026-06-16",
          },
        ],
      },
      teams: {
        integrated: true,
        data: [
          {
            id: "TEAM-150",
            projectId: "PRJ-0150",
            title: "Chicago Plaza Costing Sync",
            participants: ["chris@gfs.com", "aaron@gfs.com"],
            messages: 14,
            hasTranscript: true,
            date: "2026-06-17",
          },
        ],
      },
      transcripts: {
        integrated: true,
        data: [
          {
            id: "trans-150",
            name: "plaza-costing-transcript.txt",
            type: "text/plain",
            size: 3400,
            uploadedAt: "2026-06-17T11:00:00Z",
            base64: "/static/transcripts/plaza-costing-transcript.txt",
          },
        ],
      },
    },
  },

  /* =========================================================
      PROJECT 6
     ========================================================= */
  {
    id: "project_PRJ-0072",
    createdAt: "2026-05-10T11:40:00Z",
    source: "static",
    formData: {
      projectDetails: {
        projectId: "PRJ-0072",
        projectName: "Austin Tech Campus Staircase",
        bidRecipient: "Silicon Spaces Architecture",
        status: "In-progress",
        action: "Resubmit Proposal",
        projectInterest: "glass-staircase",
        estimatedBudget: "$210,000 - $340,000",
        expectedStartDate: "2026-09-01",
        expectedCompletionDate: "2026-11-30",
        bidDeadline: "2026-06-22",
        priority: "low",
        projectType: "commercial",
      },
      clientDetails: {
        firstName: "Sarah",
        lastName: "Conner",
        companyName: "Silicon Spaces Architecture",
        website: "://siliconspaces.com",
        annualRevenue: "$6,800,000",
        employees: "32",
        clientType: "commercial",
        industry: "Architecture",
        leadStatus: "qualified",
      },
      clientContact: {
        primaryContact: "Sarah Conner",
        email: "sconner@siliconspaces.com",
        primary_phone: "+1 512 555 7889",
        designation: "Lead Interior Designer",
        address: "501 Congress Ave",
        city: "Austin",
        state: "Texas",
        country: "United States",
        zipCode: "78701",
        projectSiteAddress: "North Austin Tech Ridge",
      },
      assignments: [
        {
          id: "6a17fd4bc1f021fcdad59f3f",
          name: "David Doe",
          email: "david@gfs.com",
        },
      ],
      documents: [
        {
          id: "doc-072",
          projectId: "PRJ-0072",
          name: "staircase-tread-details.pdf",
          type: "application/pdf",
          size: 589000,
          uploadedAt: "2026-05-10T11:35:00Z",
          base64: "/static/documents/staircase-tread-details.pdf",
        },
      ],
    },
    integrations: {
      mails: {
        integrated: true,
        data: [
          {
            id: "MAIL-072",
            projectId: "PRJ-0072",
            subject: "Rejected: Glass thicknesses updates required",
            sender: "sconner@siliconspaces.com",
            receivers: ["sales@gfs.com"],
            preview:
              "Engineering rejected the 12mm treads, please upgrade to laminated 19mm.",
            attachments: ["engineering-rejection.pdf"],
            date: "2026-06-14",
          },
        ],
      },
      teams: {
        integrated: false,
        data: [],
      },
      transcripts: {
        integrated: false,
        data: [],
      },
    },
  },
];
