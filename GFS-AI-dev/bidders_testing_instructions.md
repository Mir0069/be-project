# Step-by-Step Backend Testing Manual: Multiple Bidders & AI Classifier

This document outlines how to execute backend integration tests for the merged features (`zh/feat/bidders` and `zh/feat/classifier-improvement`) directly using terminal commands, API requests, and MongoDB queries.

---

## 1. Prerequisites & Setup

Ensure both backend and AI services are running on your test environment:
* **GFS-backend URL:** `http://localhost:5000` (or your test server domain)
* **GFS-AI URL:** `http://localhost:8000`

---

## 2. Test Case 1: Ingesting a Multi-Bidder Project

This tests the entry point where the AI sends the parsed email results (with multiple bidders) to the backend webhook.

### Step 1: Fire the Webhook Request
Run the following `curl` command to simulate the webhook payload sent by GFS-AI when an email is ingested:

```bash
curl -X POST http://localhost:5000/api/v1/proposals/webhooks/sb-msg-test-multibidder-001/ai-stage-result \
  -H "Content-Type: application/json" \
  -d '{
    "correlationId": "sb-msg-test-multibidder-001",
    "action": "CREATE",
    "proposed": {
      "isProject": true,
      "customerName": "Mike Peterson",
      "companyName": "XYZ Builders",
      "company": "XYZ Builders",
      "projectName": "456 Oak Avenue, Los Angeles, CA",
      "projectType": "NEW_ESTIMATE",
      "summary": "- Customer Info: Mike Peterson from XYZ Builders\n- Location: 456 Oak Avenue\n- Scope: 3 panels of walk-on IGU glass\n- Sender Email: mike@xyzbuilders.com",
      "reasoning": "New bid request for 456 Oak Avenue.",
      "confidence": 95,
      "address": "456 Oak Avenue, Los Angeles, CA",
      "jobAddress": "456 Oak Avenue, Los Angeles, CA",
      "groupId": "40cadd8414bd2405",
      "isCompetitiveBid": true,
      "allBidders": [
        { "email": "mike@xyzbuilders.com", "company": "XYZ Builders", "isPrimary": true },
        { "email": "tom@epsilonbuilds.com", "company": "Epsilon Builds", "isPrimary": false },
        { "email": "sarah@deltacontracting.com", "company": "Delta Contracting", "isPrimary": false }
      ],
      "primaryBidderEmail": "mike@xyzbuilders.com"
    }
  }'
```

### Step 2: Expected API Response
The backend will return a `200 OK` indicating the proposal draft was created:
```json
{
  "success": true,
  "message": "AI classification webhook result processed successfully.",
  "data": {
    "correlationId": "sb-msg-test-multibidder-001",
    "draftsCreated": 1
  }
}
```

---

## 3. Test Case 2: Approving Draft & Splitting Bidders

When the estimator approves the draft, the backend splits the multiple bidders into separate linked projects.

### Step 1: Approve the Project Ingestion
Trigger the draft approval request (simulate clicking "Approve" in the MailFirst screen):

```bash
curl -X POST http://localhost:5000/api/v1/proposals/drafts/sb-msg-test-multibidder-001/approve \
  -H "Content-Type: application/json"
```

### Step 2: Verify Projects in MongoDB
Open your MongoDB shell (`mongosh` or Compass) and query the database:

```javascript
// Switch to your database
use gfs_local_omkar;

// Query the newly created competitive projects
db.projects.find({ groupId: "40cadd8414bd2405" }).pretty();
```

**Expected Database Results:**
* **Three distinct project records** should exist for `456 Oak Avenue`.
* The `isCompetitiveBid` flag must be `true` for all three.
* The `groupId` must be `"40cadd8414bd2405"`.
* Each project's `relatedProjectIds` array must contain the `ObjectId`s of the other two projects.

---

## 4. Test Case 3: Fetching Related Competing Projects

This verifies the new API endpoint used by the frontend to link competing bids.

### Step 1: Fetch Project ID
Find the `_id` of the primary bidder project (`XYZ Builders`) from the MongoDB query above. Let's assume it is `6a6cacaabf82185315d43f6e`.

### Step 2: Call the Related Projects Endpoint
Run this GET request:

```bash
curl -X GET http://localhost:5000/api/v1/projects/6a6cacaabf82185315d43f6e/related
```

### Step 3: Expected API Response
It should return the other two competing bidders (`Epsilon Builds` and `Delta Contracting`):
```json
{
  "success": true,
  "data": [
    {
      "id": "6a6cacb0bf82185315d43f7f",
      "projectName": "456 Oak Avenue, Los Angeles, CA",
      "companyName": "Epsilon Builds",
      "email": "tom@epsilonbuilds.com"
    },
    {
      "id": "6a6cacb5bf82185315d43f80",
      "projectName": "456 Oak Avenue, Los Angeles, CA",
      "companyName": "Delta Contracting",
      "email": "sarah@deltacontracting.com"
    }
  ]
}
```

---

## 5. Test Case 4: Running Stage 2 Rules Calculation

Verify that the backend can invoke the FastAPI rules calculation pipeline.

### Step 1: Fire the Stage 2 Trigger
Send the request payload to initiate the Glass Selection stage:

```bash
curl -X POST http://localhost:5000/api/v1/projects/6a6cacaabf82185315d43f6e/stages/2/calculate \
  -H "Content-Type: application/json"
```

### Step 2: Expected API Response
The backend forwards this to GFS-AI, receives the result, and updates MongoDB:
```json
{
  "success": true,
  "message": "Stage 2 calculations completed.",
  "data": {
    "glass_code": "GLASS_WITH_IGU",
    "confidence": "HIGH",
    "reasoning": "Exterior location is walkable; IGU glass type matches walkability limits and climate exposure."
  }
}
```

---

## 6. Test Case 5: Verification of AI Classifier & Structured Summaries

This tests the new address classification (distinguishing between Installation vs. Billing addresses) and verifies the detailed formatted email summary output.

### Step 1: Simulate Ingesting Distinct Addresses
Send a POST request with two different addresses in the email body:

```bash
curl -X POST http://localhost:5000/api/v1/proposals/webhooks/sb-msg-test-summary-001/ai-stage-result \
  -H "Content-Type: application/json" \
  -d '{
    "correlationId": "sb-msg-test-summary-001",
    "action": "CREATE",
    "proposed": {
      "isProject": true,
      "customerName": "Victor Vance",
      "companyName": "Hoboken Glass Co",
      "company": "Hoboken Glass Co",
      "projectName": "New GFS Quote Request",
      "projectType": "NEW_ESTIMATE",
      "summary": "- Customer Info: Victor Vance from Hoboken Glass Co\n- Location: 1500 Clinton Ave, Hoboken, NJ\n- Scope: Glass floor panels\n- Attachments: none\n- Sender Name: Victor Vance\n- Sender Email: victor@hobokenglass.com\n- Company Name: Hoboken Glass Co",
      "reasoning": "Standard pricing request for a residential glass floor.",
      "confidence": 90,
      "address": "1500 Clinton Ave, Hoboken, NJ",
      "jobAddress": "1500 Clinton Ave, Hoboken, NJ",
      "isCompetitiveBid": false,
      "allAddresses": [
        { "address": "1500 Clinton Ave, Hoboken, NJ", "type": "INSTALLATION" },
        { "address": "400 Wall Street, New York, NY", "type": "BILLING" }
      ]
    }
  }'
```

### Step 2: Query the Saved Draft in MongoDB
Check the draft document in MongoDB:

```javascript
db.outlook_emails.findOne({ correlationId: "sb-msg-test-summary-001" });
```

**Expected Results to Audit:**
1. **Summary Verification:** The `summary` string must contain all key details and end with the exact fields:
   * `Sender Name: Victor Vance`
   * `Sender Email: victor@hobokenglass.com`
   * `Company Name: Hoboken Glass Co`
2. **Address Classification:** Under the saved email address arrays, verify that `1500 Clinton Ave` is saved with tag type `INSTALLATION` and `400 Wall Street` is saved with tag type `BILLING`.

