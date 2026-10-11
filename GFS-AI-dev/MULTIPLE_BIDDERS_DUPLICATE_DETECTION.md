# Multiple Bidders & Duplicate Detection Implementation Guide

## Current State Analysis

### Multiple Bidders Support
**Status**: NOT IMPLEMENTED

**Findings**:
- No schema fields for tracking multiple bidders
- Project model has single `customerEmail` field (not array)
- No UI or API endpoints for bidder management
- Only reference found: test document with example email `customer@bidders.com`

### Duplicate Detection
**Current Implementation**:

**Backend (GFS-backend)**:
- Unique `referenceNumber` generated via sequence (e.g., "GFS-2026-1001")
- MongoDB ObjectId for `_id` (automatically unique)
- `zohoLeadId` unique constraint
- No address-based duplicate prevention

**AI (GFS-AI)**:
- Graph-based matching in `classifier/graph_matcher.py`
- Matches on: quote number (exact/fuzzy), address (80% threshold), email (exact), project name (75%)
- AI decides NEW vs EXISTING based on email context
- No explicit time-based or status-based logic

**Gap**: Same address months later relies on AI context interpretation, not explicit rules.

---

## Implementation Plan

### Part 1: Multiple Bidders Support

#### Backend Changes

**1. Update Project Model** (`src/db/models/project.model.ts`)

```typescript
export interface IProject extends Document {
    // ... existing fields ...
    
    // NEW: Multiple bidders support
    bidders?: IBidder[] | null;
    isMultiBidder?: boolean;
    primaryBidderEmail?: string | null;
}

export interface IBidder {
    bidderEmail: string;
    bidderName?: string | null;
    bidderCompany?: string | null;
    bidderPhone?: string | null;
    isPrimary?: boolean;
    addedAt: Date;
    addedBy?: mongoose.Types.ObjectId | null; // User who added
}
```

**2. Update Project Schema**:

```typescript
const BidderSchema = new Schema<IBidder>({
    bidderEmail: { type: String, required: true },
    bidderName: { type: String, default: null },
    bidderCompany: { type: String, default: null },
    bidderPhone: { type: String, default: null },
    isPrimary: { type: Boolean, default: false },
    addedAt: { type: Date, default: Date.now },
    addedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
}, { _id: false });

const ProjectSchema = new Schema<IProject>({
    // ... existing fields ...
    bidders: { type: [BidderSchema], default: null },
    isMultiBidder: { type: Boolean, default: false },
    primaryBidderEmail: { type: String, default: null },
});
```

**3. Add API Endpoints** (`src/features/projects/projects.controller.ts`)

```typescript
// Add bidder to project
@Post(':id/bidders')
async addBidder(@Param('id') id: string, @Body() bidder: IBidder) {
    return this.projectsService.addBidder(id, bidder);
}

// Remove bidder
@Delete(':id/bidders/:bidderEmail')
async removeBidder(@Param('id') id: string, @Param('bidderEmail') bidderEmail: string) {
    return this.projectsService.removeBidder(id, bidderEmail);
}

// Set primary bidder
@Patch(':id/bidders/:bidderEmail/primary')
async setPrimaryBidder(@Param('id') id: string, @Param('bidderEmail') bidderEmail: string) {
    return this.projectsService.setPrimaryBidder(id, bidderEmail);
}

// Get all bidders for project
@Get(':id/bidders')
async getBidders(@Param('id') id: string) {
    return this.projectsService.getBidders(id);
}
```

**4. Service Methods** (`src/features/projects/projects.service.ts`)

```typescript
async addBidder(projectId: string, bidder: IBidder) {
    const project = await this.projectRepository.findById(projectId);
    if (!project) throw new AppError('Project not found', 404);

    // Check if bidder already exists
    if (project.bidders?.some(b => b.bidderEmail === bidder.bidderEmail)) {
        throw new AppError('Bidder already exists', 400);
    }

    // Initialize bidders array if needed
    if (!project.bidders) project.bidders = [];

    // Add new bidder
    project.bidders.push(bidder);

    // If first bidder, set as primary
    if (project.bidders.length === 1) {
        project.isMultiBidder = false;
        project.primaryBidderEmail = bidder.bidderEmail;
    } else {
        project.isMultiBidder = true;
    }

    return await this.projectRepository.updateById(projectId, {
        bidders: project.bidders,
        isMultiBidder: project.isMultiBidder,
        primaryBidderEmail: project.primaryBidderEmail,
    });
}

async removeBidder(projectId: string, bidderEmail: string) {
    const project = await this.projectRepository.findById(projectId);
    if (!project) throw new AppError('Project not found', 404);

    project.bidders = project.bidders?.filter(b => b.bidderEmail !== bidderEmail);

    // Update primary if needed
    if (project.primaryBidderEmail === bidderEmail) {
        project.primaryBidderEmail = project.bidders?.[0]?.bidderEmail || null;
    }

    // Update multi-bidder flag
    project.isMultiBidder = (project.bidders?.length || 0) > 1;

    return await this.projectRepository.updateById(projectId, {
        bidders: project.bidders,
        isMultiBidder: project.isMultiBidder,
        primaryBidderEmail: project.primaryBidderEmail,
    });
}
```

#### AI Changes

**1. Update Classifier** (`classifier/classifier.py`)

Add detection of multiple bidders in Pass 1:

```python
# In build_pass1_system_prompt() - add to extraction instructions
"""
If the email mentions multiple bidders, contractors, or companies competing for the same project:
- Extract ALL bidder emails mentioned
- Extract ALL bidder company names
- Set isMultiBidder to true
- Identify which bidder is the primary sender
"""

# In Pass 1 result structure
{
    "isProjectRelevant": true,
    "extractedSignals": {
        "senderEmail": "contractor1@company.com",
        "bidders": [
            {"email": "contractor1@company.com", "company": "ABC Construction", "isPrimary": true},
            {"email": "contractor2@company.com", "company": "XYZ Builders", "isPrimary": false}
        ],
        "isMultiBidder": true
    }
}
```

**2. Update Webhook Payload** (`classifier/classifier.py`)

```python
def build_classifier_webhook_payload(...):
    # ... existing code ...
    
    ai_signals = classification_result.get("ai_signals") or {}
    bidders = ai_signals.get("bidders", [])
    is_multi_bidder = ai_signals.get("isMultiBidder", False)
    
    if action == "CREATE":
        payload_data = {
            "correlationId": correlation_id,
            "action": action,
            "proposed": {
                # ... existing fields ...
                "bidders": bidders,
                "isMultiBidder": is_multi_bidder,
                "primaryBidderEmail": bidders[0]["email"] if bidders else sender
            }
        }
```

**3. Update Schema** (`listener/extraction_schema.py`)

```python
class BidderEntry(BaseModel):
    email: str
    name: Optional[str] = None
    company: Optional[str] = None
    isPrimary: bool = False

class Stage0Payload(BaseModel):
    subject: Optional[str] = None
    sender: Optional[str] = None
    documents: List[DocumentEntry]
    bidders: Optional[List[BidderEntry]] = None
    isMultiBidder: Optional[bool] = False
```

---

### Part 2: Enhanced Duplicate Detection (Same Address, Different Time)

#### Backend Changes

**1. Add Project Status/Time Fields** (`src/db/models/project.model.ts`)

```typescript
export interface IProject extends Document {
    // ... existing fields ...
    
    // NEW: For duplicate detection
    completedAt?: Date | null;
    archivedAt?: Date | null;
    lastActivityAt?: Date | null;
    relatedProjectIds?: mongoose.Types.ObjectId[] | null; // Projects at same address
}
```

**2. Add Duplicate Detection Service** (`src/features/projects/duplicate-detection.service.ts`)

```typescript
export class DuplicateDetectionService {
    constructor(
        private readonly projectRepository: IProjectRepository,
    ) {}

    async findPotentialDuplicates(
        jobAddress: string,
        customerEmail?: string,
        excludeProjectId?: string
    ): Promise<IDomainProject[]> {
        const normalizedAddress = this.normalizeAddress(jobAddress);
        
        // Find projects with similar address (fuzzy match)
        const similarProjects = await this.projectRepository.findByAddressFuzzy(
            normalizedAddress,
            excludeProjectId
        );

        // Filter by status and time
        const recentProjects = similarProjects.filter(p => {
            const daysSinceLastActivity = this.daysSince(p.lastActivityAt || p.updatedAt);
            
            // If completed/archived more than 90 days ago, treat as new project
            if (p.status === ProjectStatus.ADMIN_PACKAGING && daysSinceLastActivity > 90) {
                return false;
            }
            
            // If archived more than 180 days ago, treat as new project
            if (p.archivedAt && this.daysSince(p.archivedAt) > 180) {
                return false;
            }
            
            return true;
        });

        return recentProjects;
    }

    async markAsRelated(projectId: string, relatedProjectId: string) {
        await this.projectRepository.addRelatedProject(projectId, relatedProjectId);
        await this.projectRepository.addRelatedProject(relatedProjectId, projectId);
    }

    private normalizeAddress(address: string): string {
        // Remove punctuation, lowercase, standardize format
        return address
            .toLowerCase()
            .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
    }

    private daysSince(date: Date): number {
        const now = new Date();
        const diff = now.getTime() - date.getTime();
        return Math.floor(diff / (1000 * 60 * 60 * 24));
    }
}
```

**3. Add Repository Method** (`src/repositories/mongoose/project.repository.ts`)

```typescript
async findByAddressFuzzy(normalizedAddress: string, excludeId?: string): Promise<IDomainProject[]> {
    const query: any = {
        jobAddress: { $regex: normalizedAddress, $options: 'i' },
        isActive: true,
    };

    if (excludeId) {
        query._id = { $ne: new mongoose.Types.ObjectId(excludeId) };
    }

    return await Project.find(query).lean();
}

async addRelatedProject(projectId: string, relatedProjectId: string): Promise<void> {
    await Project.findByIdAndUpdate(
        projectId,
        { $addToSet: { relatedProjectIds: new mongoose.Types.ObjectId(relatedProjectId) } }
    );
}
```

**4. Integrate into Project Creation** (`src/features/project-creation/project-creation.service.ts`)

```typescript
public async create(input: CreateProjectInput, options: ProjectCreationOptions): Promise<IDomainProject> {
    // ... existing validation ...

    // Check for potential duplicates
    if (input.projectAddress) {
        const duplicates = await this.duplicateDetectionService.findPotentialDuplicates(
            input.projectAddress,
            input.client?.customerEmail
        );

        if (duplicates.length > 0) {
            // Option 1: Return warning with duplicate info
            throw new AppError(
                `Potential duplicate found: ${duplicates.map(d => d.referenceNumber).join(', ')}`,
                409
            );

            // Option 2: Auto-link and continue
            // await this.duplicateDetectionService.markAsRelated(newProject.id, duplicates[0].id);
        }
    }

    // ... continue with creation ...
}
```

#### AI Changes

**1. Enhance Graph Matcher** (`classifier/graph_matcher.py`)

```python
def find_candidates(
    graph: nx.DiGraph,
    signals: Dict[str, Any],
    max_candidates: int = 5,
) -> List[Dict[str, Any]]:
    # ... existing code ...

    for node_id, node_data in graph.nodes(data=True):
        if node_data.get("type") != "Project":
            continue

        # ... existing matching logic ...

        # NEW: Check project status and last activity
        proj_status = node_data.get("status", "")
        last_activity = node_data.get("lastActivityAt", "")
        
        # If project is completed/archived and old, lower match score
        if proj_status in ["ADMIN_PACKAGING", "ARCHIVED"]:
            if last_activity:
                days_old = (datetime.now() - parse_date(last_activity)).days
                if days_old > 90:
                    max_score = max(max_score * 0.5, 0)  # Reduce score by 50%
        
        # If any fields matched, add this project as a candidate
        if matched_fields:
            candidates.append({
                # ... existing fields ...
                "status": proj_status,
                "lastActivityAt": last_activity,
                "isOldCompleted": proj_status in ["ADMIN_PACKAGING", "ARCHIVED"] and days_old > 90,
            })
```

**2. Update AI Prompt** (`classifier/prompt.py`)

Add to Pass 2 system prompt:

```python
def build_pass2_system_prompt(candidates):
    base_prompt = """
    You are a GFS email classifier. Determine if this email is for a NEW project or should LINK to an EXISTING project.
    
    IMPORTANT: Consider project status and timing:
    - If the matched project is COMPLETED or ARCHIVED and more than 90 days old, treat as NEW_PROJECT
    - If the email mentions "new project", "new quote", or "new bid" for the same address, treat as NEW_PROJECT
    - If the email mentions "revision", "update", "change order", or "follow-up", treat as EXISTING_PROJECT
    - If the sender email domain is different from the existing project's customer domain, likely NEW_PROJECT
    """
    
    # Add candidate status info to prompt
    for candidate in candidates:
        if candidate.get("isOldCompleted"):
            base_prompt += f"\n- Project {candidate['projectId']} is OLD COMPLETED ({candidate['lastActivityAt']}) - likely NEW_PROJECT"
    
    return base_prompt
```

**3. Update Backend API for AI Context** (`src/features/project-workspace/project-workspace.service.ts`)

```typescript
async getAIContext(): Promise<any[]> {
    const projects = await this.projectRepository.findActive();
    
    return projects.map(p => ({
        projectId: p.id,
        projectName: p.projectName,
        customerName: p.customerName,
        customerEmail: p.customerEmail,
        jobAddress: p.jobAddress,
        referenceNumber: p.referenceNumber,
        status: p.status,
        lastActivityAt: p.lastActivityAt || p.updatedAt,
        completedAt: p.completedAt,
        archivedAt: p.archivedAt,
    }));
}
```

---

### Part 3: Email/Domain-Based Implementation

#### Strategy

**1. Domain-Based Bidding Detection**

**Backend** (`src/features/projects/bidding-detection.service.ts`):

```typescript
export class BiddingDetectionService {
    async detectCompetitiveBidding(projectId: string): Promise<IBidder[]> {
        const project = await this.projectRepository.findById(projectId);
        if (!project) return [];

        const bidderEmails = project.bidders?.map(b => b.bidderEmail) || [project.customerEmail];
        
        // Extract domains
        const domains = bidderEmails.map(email => email.split('@')[1].toLowerCase());
        
        // Check if multiple unique domains (indicates different companies)
        const uniqueDomains = [...new Set(domains)];
        
        if (uniqueDomains.length > 1) {
            // Multiple companies bidding
            return project.bidders || [{
                bidderEmail: project.customerEmail,
                bidderCompany: project.company,
                isPrimary: true,
                addedAt: new Date(),
            }];
        }
        
        return [];
    }

    async findProjectsByBidderDomain(domain: string): Promise<IDomainProject[]> {
        // Find all projects where any bidder has this domain
        return await this.projectRepository.findByBidderDomain(domain);
    }
}
```

**2. Email-Based Project Grouping**

**Backend** (`src/repositories/mongoose/project.repository.ts`):

```typescript
async findByBidderDomain(domain: string): Promise<IDomainProject[]> {
    return await Project.find({
        $or: [
            { customerEmail: { $regex: `@${domain}$`, $options: 'i' } },
            { 'bidders.bidderEmail': { $regex: `@${domain}$`, $options: 'i' } },
        ],
        isActive: true,
    }).lean();
}

async findByEmailDomainGrouping(domain: string): Promise<{[key: string]: IDomainProject[]}> {
    const projects = await this.findByBidderDomain(domain);
    
    // Group by address
    const grouped: {[key: string]: IDomainProject[]} = {};
    
    for (const project of projects) {
        const addressKey = this.normalizeAddress(project.jobAddress || '');
        if (!grouped[addressKey]) {
            grouped[addressKey] = [];
        }
        grouped[addressKey].push(project);
    }
    
    return grouped;
}
```

**3. AI Email Domain Analysis**

**AI** (`classifier/graph_matcher.py`):

```python
def find_candidates(
    graph: nx.DiGraph,
    signals: Dict[str, Any],
    max_candidates: int = 5,
) -> List[Dict[str, Any]]:
    # ... existing code ...

    # NEW: Domain-based analysis
    sender_domain = signals.get("sender_domain", "")
    
    for node_id, node_data in graph.nodes(data=True):
        if node_data.get("type") != "Project":
            continue

        # ... existing matching ...

        # NEW: Domain match (different domain = likely new project)
        proj_email = node_data.get("email", "")
        if proj_email and sender_domain:
            proj_domain = proj_email.split("@")[-1] if "@" in proj_email else ""
            
            if proj_domain and proj_domain != sender_domain:
                # Different domain - reduce match score unless same address
                if max_score < 90:  # Only reduce if not already strong match
                    matched_fields.append(f"Different domain: {sender_domain} vs {proj_domain}")
                    max_score = max(max_score * 0.7, 0)  # Reduce by 30%
        
        # If any fields matched, add this project as a candidate
        if matched_fields:
            candidates.append({
                # ... existing fields ...
                "domainMatch": proj_domain == sender_domain,
            })
```

**4. Update AI Prompt for Domain Logic** (`classifier/prompt.py`):

```python
def build_pass2_system_prompt(candidates):
    base_prompt = """
    You are a GFS email classifier. Determine if this email is for a NEW project or should LINK to an EXISTING project.
    
    DOMAIN ANALYSIS:
    - If sender email domain is DIFFERENT from existing project's customer domain, likely NEW_PROJECT
    - Exception: If same address and high confidence address match, may be EXISTING_PROJECT (different contact at same company)
    - If sender domain is general (gmail.com, yahoo.com, etc.), rely more on address and quote number
    
    EMAIL CONTEXT CLUES:
    - "new project", "new quote", "new bid" → NEW_PROJECT
    - "revision", "update", "change order", "follow-up" → EXISTING_PROJECT
    - "same address", "same location" but different company → NEW_PROJECT (competitive bidding)
    """
    
    return base_prompt
```

---

## Implementation Priority

### Phase 1: Foundation (High Priority)
1. **Backend**: Add `bidders` array to Project model
2. **Backend**: Add duplicate detection service with time/status logic
3. **Backend**: Add `lastActivityAt`, `completedAt`, `archivedAt` fields
4. **AI**: Update classifier to detect multiple bidders in Pass 1
5. **AI**: Update webhook payload to include bidders

### Phase 2: Enhanced Detection (Medium Priority)
1. **Backend**: Add API endpoints for bidder management
2. **Backend**: Implement domain-based project grouping
3. **AI**: Enhance graph matcher with status/time scoring
4. **AI**: Update prompts with domain analysis instructions

### Phase 3: UI Integration (Lower Priority)
1. **Frontend**: Add bidder management UI
2. **Frontend**: Show duplicate warnings during project creation
3. **Frontend**: Display related projects on project detail page

---

## Testing Strategy

### Unit Tests
```typescript
// Duplicate detection
describe('DuplicateDetectionService', () => {
    it('should not flag completed projects older than 90 days', async () => {
        const oldProject = await createProject({
            status: ProjectStatus.ADMIN_PACKAGING,
            completedAt: new Date('2024-01-01'),
        });
        
        const duplicates = await service.findPotentialDuplicates('123 Main St');
        expect(duplicates).toHaveLength(0);
    });
    
    it('should flag recent projects at same address', async () => {
        const recentProject = await createProject({
            status: ProjectStatus.ESTIMATOR_DRAFTING,
            lastActivityAt: new Date(),
        });
        
        const duplicates = await service.findPotentialDuplicates('123 Main St');
        expect(duplicates).toHaveLength(1);
    });
});

// Bidding detection
describe('BiddingDetectionService', () => {
    it('should detect multiple bidders from different domains', async () => {
        const project = await createProject({
            bidders: [
                { bidderEmail: 'contractor1@abc.com' },
                { bidderEmail: 'contractor2@xyz.com' },
            ],
        });
        
        const bidders = await service.detectCompetitiveBidding(project.id);
        expect(bidders).toHaveLength(2);
    });
});
```

### Integration Tests
```typescript
describe('Project Creation with Duplicate Detection', () => {
    it('should warn when creating project at same address as recent project', async () => {
        await createProject({ jobAddress: '123 Main St' });
        
        await expect(
            service.create({ projectAddress: '123 Main St' }, {})
        ).rejects.toThrow('Potential duplicate');
    });
    
    it('should allow project at same address if old project is completed', async () => {
        await createProject({
            jobAddress: '123 Main St',
            status: ProjectStatus.ADMIN_PACKAGING,
            completedAt: new Date('2024-01-01'),
        });
        
        const newProject = await service.create(
            { projectAddress: '123 Main St' },
            {}
        );
        expect(newProject).toBeDefined();
    });
});
```

---

## Summary

**Multiple Bidders**:
- Add `bidders[]` array to Project model
- AI detects multiple bidders in email content
- Backend provides CRUD endpoints for bidder management
- Domain-based detection identifies competitive bidding

**Duplicate Detection**:
- Backend uses time/status logic (90-day rule for completed projects)
- AI enhances graph matcher with status scoring
- Email domain analysis reduces false positives
- Related project tracking for same address

**Email/Domain-Based**:
- Primary key for distinguishing new vs existing
- Different domain = likely new project (unless strong address match)
- Same domain + same address = likely existing project
- General domains (gmail, yahoo) rely more on address matching
