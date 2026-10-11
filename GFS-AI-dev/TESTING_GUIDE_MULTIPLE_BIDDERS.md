# Testing Guide: Multiple Bidders & Competitive Bidding Detection (Separate Project IDs)

## Overview
This guide covers testing the multiple bidders feature where **each bidder gets a separate project ID**. Projects are linked together via `groupId` and `relatedProjectIds` to indicate they're bidding on the same address.

## Architecture Changes
- **Each bidder = separate project**: When AI detects multiple bidders, each gets their own project with unique `projectId`
- **Project linking**: Projects at same address share a `groupId` (hash of normalized address)
- **Related projects**: Each project has `relatedProjectIds` array pointing to other projects at same address
- **Competitive bidding flag**: `isCompetitiveBid` indicates project is part of competitive bidding

## Prerequisites
- GFS-AI service running
- GFS-backend service running
- Azure Service Bus configured
- MongoDB database accessible
- Test email account with monitored mailbox

---

## Test 1: AI Classifier - Single Bidder (Baseline)

### Objective
Verify that the AI correctly extracts bidder information when there's only one bidder (normal case).

### Steps

1. **Send a test email** with a single bidder:
   ```
   Subject: Quote Request - 123 Main Street
   From: john@abcconstruction.com
   To: sales@gfs.com
   
   Hi,
   
   We are requesting a quote for glass floor systems at 123 Main Street, San Francisco, CA.
   
   Please see attached drawings.
   
   Thanks,
   John Smith
   ABC Construction
   ```

2. **Wait for AI processing** (Service Bus listener will process)

3. **Check the classifier output** by looking at logs or webhook payload:
   ```json
   {
     "classification": "NEW_PROJECT",
     "proposed": {
       "groupId": "a1b2c3d4e5f6g7h8",
       "isCompetitiveBid": false,
       "allBidders": null
     }
   }
   ```

4. **Expected Result**:
   - `groupId` is generated (hash of address)
   - `isCompetitiveBid` is `false`
   - `allBidders` is `null` (single bidder)

---

## Test 2: AI Classifier - Multiple Bidders (Competitive Bidding)

### Objective
Verify that the AI detects multiple bidders and sends all bidder information for separate project creation.

### Steps

1. **Send a test email** with multiple bidders mentioned:
   ```
   Subject: Competitive Bid - 456 Oak Avenue
   From: mike@xyzbuilders.com
   To: sales@gfs.com
   CC: john@abcconstruction.com
   
   Hi,
   
   We are bidding on the glass floor project at 456 Oak Avenue, Los Angeles, CA.
   ABC Construction is also bidding on this project.
   
   Please provide pricing for the attached specifications.
   
   Thanks,
   Mike Johnson
   XYZ Builders
   ```

2. **Wait for AI processing**

3. **Check the classifier output**:
   ```json
   {
     "classification": "NEW_PROJECT",
     "proposed": {
       "groupId": "b2c3d4e5f6g7h8i9",
       "isCompetitiveBid": true,
       "allBidders": [
         {
           "email": "mike@xyzbuilders.com",
           "company": "XYZ Builders",
           "isPrimary": true
         },
         {
           "email": "john@abcconstruction.com",
           "company": "ABC Construction",
           "isPrimary": false
         }
       ],
       "primaryBidderEmail": "mike@xyzbuilders.com"
     }
   }
   ```

4. **Expected Result**:
   - `groupId` is generated (same for all bidders at this address)
   - `isCompetitiveBid` is `true`
   - `allBidders` array contains all detected bidders
   - `primaryBidderEmail` set to sender

---

## Test 3: Graph Matcher - Same Address, Different Company

### Objective
Verify that the graph matcher detects competitive bidding when same address appears with different email domains.

### Steps

1. **Create a test project** in the backend:
   ```bash
   POST /api/v1/projects
   {
     "projectName": "123 Main Street Project",
     "projectAddress": "123 Main Street, San Francisco, CA",
     "client": {
       "customerEmail": "john@abcconstruction.com",
       "company": "ABC Construction"
     }
   }
   ```

2. **Send an email** from a different company at the same address:
   ```
   Subject: New Quote Request
   From: mike@xyzbuilders.com
   To: sales@gfs.com
   
   We need a quote for 123 Main Street, San Francisco, CA.
   
   Thanks,
   Mike Johnson
   XYZ Builders
   ```

3. **Wait for AI processing**

4. **Check the graph matcher logs** for competitive bidding detection:
   ```
   Competitive bidding: same address, different company (xyzbuilders.com vs abcconstruction.com)
   ```

5. **Expected Result**:
   - Graph matcher detects same address with different domains
   - Match score set to 85% (indicating related but different bidder)
   - Classification should be `NEW_PROJECT` (different company)
   - `groupId` should match existing project's groupId

---

## Test 4: Backend - Single Project Creation (Non-Competitive)

### Objective
Verify that the backend correctly creates a single project when there's no competitive bidding.

### Steps

1. **Approve a draft** that has `isCompetitiveBid: false`:
   ```bash
   POST /api/v1/mail-first/drafts/:emailId/approve
   ```

2. **Check the created project**:
   ```bash
   GET /api/v1/projects/:projectId
   ```

3. **Verify the response**:
   ```json
   {
     "id": "...",
     "projectName": "123 Main Street",
     "groupId": "a1b2c3d4e5f6g7h8",
     "isCompetitiveBid": false,
     "relatedProjectIds": null
   }
   ```

4. **Expected Result**:
   - Single project created
   - `groupId` is set
   - `isCompetitiveBid` is `false`
   - `relatedProjectIds` is `null`

---

## Test 5: Backend - Multiple Project Creation (Competitive Bidding)

### Objective
Verify that the backend creates separate projects for each bidder when competitive bidding is detected.

### Steps

1. **Approve a draft** that has `isCompetitiveBid: true` and `allBidders`:
   ```bash
   POST /api/v1/mail-first/drafts/:emailId/approve
   ```

2. **Check the response**:
   ```json
   {
     "zohoLeadId": "...",
     "projectId": "...",
     "alreadyProcessed": false,
     "allProjectIds": ["project1_id", "project2_id"]
   }
   ```

3. **Verify each project**:
   ```bash
   GET /api/v1/projects/project1_id
   ```
   ```json
   {
     "id": "project1_id",
     "projectName": "456 Oak Avenue",
     "customerEmail": "mike@xyzbuilders.com",
     "company": "XYZ Builders",
     "groupId": "b2c3d4e5f6g7h8i9",
     "isCompetitiveBid": true,
     "relatedProjectIds": ["project2_id"]
   }
   ```

   ```bash
   GET /api/v1/projects/project2_id
   ```
   ```json
   {
     "id": "project2_id",
     "projectName": "456 Oak Avenue",
     "customerEmail": "john@abcconstruction.com",
     "company": "ABC Construction",
     "groupId": "b2c3d4e5f6g7h8i9",
     "isCompetitiveBid": true,
     "relatedProjectIds": ["project1_id"]
   }
   ```

4. **Expected Result**:
   - **Two separate projects created** (one per bidder)
   - Both projects have **same `groupId`**
   - Both have `isCompetitiveBid: true`
   - `relatedProjectIds` points to each other
   - Each project has its own `customerEmail` and `company`

---

## Test 6: Related Projects API

### Objective
Verify the API endpoint to fetch related projects works correctly.

### Steps

1. **Get related projects** for a competitive bid project:
   ```bash
   GET /api/v1/projects/:projectId/related
   ```

2. **Verify the response**:
   ```json
   {
     "success": true,
     "data": [
       {
         "id": "project2_id",
         "projectName": "456 Oak Avenue",
         "customerEmail": "john@abcconstruction.com",
         "company": "ABC Construction"
       }
     ]
   }
   ```

3. **Expected Result**:
   - Returns array of related projects
   - Each related project has same `groupId`
   - Does not include the project itself

---

## Test 7: End-to-End - Competitive Bidding Flow

### Objective
Test the complete flow from email ingestion to multiple project creation.

### Steps

1. **Send email with competitive bidding context**:
   ```
   Subject: Bid for 789 Pine Road
   From: sarah@deltacontracting.com
   To: sales@gfs.com
   CC: tom@epsilonbuilds.com
   
   We are submitting a bid for the glass floor at 789 Pine Road, Seattle, WA.
   Epsilon Builds is also competing for this project.
   
   Attached are our specifications.
   
   Regards,
   Sarah Lee
   Delta Contracting
   ```

2. **Monitor AI logs**:
   - Pass 1: Extracts 2 bidders, sets `isCompetitiveBid: true`
   - Graph matcher: Checks for existing projects at same address
   - Pass 2: Classifies as `NEW_PROJECT`

3. **Check webhook payload sent to backend**:
   ```json
   {
     "action": "CREATE",
     "proposed": {
       "projectName": "789 Pine Road, Seattle, WA",
       "groupId": "c3d4e5f6g7h8i9j0",
       "isCompetitiveBid": true,
       "allBidders": [
         { "email": "sarah@deltacontracting.com", "company": "Delta Contracting", "isPrimary": true },
         { "email": "tom@epsilonbuilds.com", "company": "Epsilon Builds", "isPrimary": false }
       ],
       "primaryBidderEmail": "sarah@deltacontracting.com"
     }
   }
   ```

4. **Approve the draft** in the UI

5. **Verify two projects created**:
   ```bash
   GET /api/v1/projects?groupId=c3d4e5f6g7h8i9j0
   ```
   - Should return 2 projects
   - Both have same `groupId`
   - Both have `isCompetitiveBid: true`
   - Each has different `customerEmail`

6. **Expected Result**:
   - Complete flow works end-to-end
   - Two separate projects created
   - Projects correctly linked via `groupId` and `relatedProjectIds`
   - Documents linked to primary bidder's project only

---

## Test 8: Database Verification

### Objective
Verify MongoDB stores project linking data correctly.

### Steps

1. **Connect to MongoDB**:
   ```bash
   mongosh "mongodb://localhost:27017/gfs"
   ```

2. **Query projects by groupId**:
   ```javascript
   db.projects.find({ groupId: "b2c3d4e5f6g7h8i9" })
   ```

3. **Verify document structure**:
   ```javascript
   {
     "_id": ObjectId("..."),
     "referenceNumber": "GFS-2026-1001",
     "projectName": "456 Oak Avenue",
     "customerEmail": "mike@xyzbuilders.com",
     "company": "XYZ Builders",
     "groupId": "b2c3d4e5f6g7h8i9",
     "isCompetitiveBid": true,
     "relatedProjectIds": [ObjectId("...")]
   }
   ```

4. **Expected Result**:
   - Document structure matches schema
   - `groupId` indexed for fast lookup
   - `relatedProjectIds` contains ObjectIds
   - Index on `groupId` works correctly

---

## Test 9: Edge Cases

### Test 9.1: Same Company, Different Person

**Steps**:
1. Send email from `jane@abcconstruction.com` when project exists with `john@abcconstruction.com`
2. Expected: Graph matcher should match as same company (same domain = same bidder, not competitive)

### Test 9.2: Three or More Bidders

**Steps**:
1. Send email with 3+ bidders mentioned
2. Expected: Creates 3+ separate projects, all linked via `groupId` and `relatedProjectIds`

### Test 9.3: No Address in Email

**Steps**:
1. Send email with bidders mentioned but no address
2. Expected: `groupId` is `null`, no competitive bidding detection

### Test 9.4: Same Address, Same Company (Follow-up)

**Steps**:
1. Send follow-up email from same company at same address
2. Expected: Should match to existing project (EXISTING_PROJECT), not create new project

---

## Test 10: Performance Testing

### Objective
Ensure the changes don't negatively impact performance.

### Steps

1. **Send 50 test emails** with various bidder scenarios
2. **Monitor processing time** for each email
3. **Check project creation time** for competitive bids (creates multiple projects)
4. **Expected**: Processing time remains under 10 seconds per email (including multiple project creation)

---

## Troubleshooting

### Issue: Only one project created for competitive bid

**Check**:
- AI webhook payload has `isCompetitiveBid: true`
- `allBidders` array has multiple entries
- Backend `approveCompetitiveBid` method is called
- Zoho lead creation succeeds for all bidders

### Issue: Projects not linked via groupId

**Check**:
- `groupId` is generated by AI (hash of address)
- Backend passes `groupId` to project creation
- MongoDB stores `groupId` correctly
- `relatedProjectIds` array is populated after all projects created

### Issue: Documents linked to wrong project

**Check**:
- Only primary bidder's project should get documents
- `primaryBidderEmail` is correctly identified
- Document linking logic in `approveCompetitiveBid` checks `isPrimary` flag

### Issue: Graph matcher not detecting competitive bidding

**Check**:
- `graph_matcher.py` has the domain comparison logic
- Email domains are different (case-insensitive)
- Address normalization works correctly
- Project data in graph has email addresses

---

## Rollback Plan

If issues occur:

1. **AI Rollback**:
   - Revert `classifier/prompt.py` to remove bidder extraction
   - Revert `classifier/classifier.py` webhook payload changes
   - Revert `classifier/graph_matcher.py` competitive bidding logic

2. **Backend Rollback**:
   - Remove `groupId`, `isCompetitiveBid`, `relatedProjectIds` from `project.model.ts`
   - Remove competitive bidding logic from `mail-first.service.ts`
   - Remove `allBidders` fields from `outlook-email.model.ts`
   - Revert `zoho-sync.service.ts` and `zoho-project.service.ts`

3. **Database Rollback**:
   ```javascript
   db.projects.updateMany(
     {},
     { $unset: { groupId: 1, isCompetitiveBid: 1, relatedProjectIds: 1 } }
   )
   ```

---

## Success Criteria

The implementation is successful when:

- ✅ AI extracts all bidders from email content
- ✅ AI detects competitive bidding (same address, different company)
- ✅ Webhook payload includes `groupId`, `isCompetitiveBid`, `allBidders`
- ✅ Backend creates **separate project for each bidder**
- ✅ Projects linked via `groupId` and `relatedProjectIds`
- ✅ API endpoint returns related projects
- ✅ End-to-end flow works correctly
- ✅ No performance degradation
- ✅ Edge cases handled properly
