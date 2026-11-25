# ADO Story Creator — User Guide

> **Who is this for?** Product Owners, Business Analysts, Scrum Masters, and anyone who
> needs to create Azure DevOps User Stories without writing code or calling APIs manually.

---

## What does this tool do?

The ADO Story Creator is a Claude Code skill that reads your work — a specification document,
a design file, a plan, or code changes on a branch — and **automatically drafts Azure DevOps
User Stories** for you. It then creates them directly in ADO with a single confirmation click.

What it creates for you:
- **User Stories** with titles, descriptions, and Acceptance Criteria already filled in
- **Epics and Features** (when working from a specification document)
- **Tasks** under each story (for detailed implementation work)
- **Story points** on the Fibonacci scale (1, 2, 3, 5, 8, 13)
- **Sprint assignments** — stories distributed across real PI sprints based on capacity
- **Swimlane placement** — stories land in the swimlane you choose (e.g. Sprint Goal)
- **ADO links** — Epics contain Features, Features contain Stories, Stories contain Tasks

You always see a **preview** of everything before anything is created. Nothing goes into ADO
without your approval.

---

## Before you start — one-time setup

You need a **Personal Access Token (PAT)** from Azure DevOps. This is a password that lets
the tool write to ADO on your behalf. You only need to set this up once.

### How to create a PAT

1. Go to [https://dev.azure.com/vfuk-digital](https://dev.azure.com/vfuk-digital)
2. Click your **profile picture** in the top-right corner
3. Click **Personal access tokens**
4. Click **New Token**
5. Give it a name (e.g. "Story Creator"), set the expiry you prefer
6. Under **Scopes**, find **Work Items** and tick **Read & Write**
7. Click **Create** and **copy the token immediately** (you cannot see it again)

### Where to save your PAT

Open a terminal (or ask a developer to do this once) and run:

```
# PowerShell
$env:AZURE_DEVOPS_PAT = "paste-your-token-here"
```

Or create a file called `.env` in your work folder and add one line:
```
AZURE_DEVOPS_PAT=paste-your-token-here
```

---

## How to run it

Open Claude Code (the IDE extension or the terminal app) and type:

```
/ado-story-creator
```

Or if you already know the folder:

```
/ado-story-creator C:\my-project\specs
```

Claude will ask you a few questions (if it does not already know the answers from your
environment), then get to work.

---

## What it asks you for

| Question | What to enter | Example |
|----------|---------------|---------|
| ADO organisation | The part of your ADO URL after `dev.azure.com/` | `vfuk-digital` |
| ADO project | The project name inside that org | `Digital` |
| Area path | The team path where stories should be created | `Digital\Intensive Care` |
| Starting iteration | The sprint to begin assigning stories from | `Digital\Digital X\PI 42\42.4` |
| Board URL | Your team's board URL (paste from the browser) | `https://dev.azure.com/vfuk-digital/Digital/_boards/board/t/Intensive%20Care/Stories` |
| Target folder | The folder containing your spec / the git repo | `C:\Projects\my-feature` |

**Tip:** If you always use the same team and project, ask a developer to set these as
environment variables once. Then you will never be asked again.

---

## The three ways it works

### 1. From a specification or design document (LLD mode)

**Use this when:** you have a Requirements document, a Low-Level Design, a Business
Requirements Document, or any document that describes *what* a system should do.

**What happens:**
1. Claude reads your document and identifies the major areas of work (Epics and Features)
2. For each Feature, it writes User Stories in the standard format: *"As a [role], I want [goal], so that [benefit]"*
3. It assigns story points, identifies which stories need backend vs frontend work, and detects which stories depend on others
4. It shows you a full preview of the entire hierarchy (Epics → Features → Stories → Tasks)
5. You can optionally ask it to distribute stories across sprints based on team capacity
6. After you confirm, everything is created in ADO in a single operation

**Supported file types:** `.docx` (Word), `.xlsx` (Excel), `.md` (Markdown), `.txt`, `.pdf` (coming soon)

---

### 2. From a plan or task document (Document mode)

**Use this when:** you have a plan-on-a-page, a sprint planning document, a task breakdown,
or a set of Gherkin feature files — anything that lists *what needs to be done*.

**What happens:**
1. Claude reads the documents in your folder
2. It groups sections and phases into User Stories (one story per phase or major task group)
3. If your document has dates, those become the start/end dates on the ADO stories
4. You review a preview table, then confirm

**Best for:** converting a plan-on-a-page or a set of meeting notes directly into ADO stories.

---

### 3. From a git branch (Git mode)

**Use this when:** a developer has done work on a branch and you want to create User Stories
that reflect what was actually built — useful for retrospective story creation or for
ensuring the ADO backlog matches delivered code.

**What happens:**
1. Claude looks at the code changes on the branch (not the full codebase — only what changed)
2. It groups related changes into story candidates
3. You review and confirm before anything is created

**Note:** Git mode requires the target folder to be a code repository with a non-main branch checked out.

---

## Sprint planning

After the preview, you can choose option **b) Assign to sprints first, then create**.

Claude will ask for:
- **Starting sprint** — which PI sprint to begin filling (default: the one you specified)
- **Backend velocity** — how many story points the backend team can handle per sprint (e.g. 20)
- **Frontend velocity** — how many points the frontend team can handle per sprint (e.g. 15)
- **Testing velocity** — how many points the testing team can handle per sprint (e.g. 10)

Claude will then:
1. Group related stories together (pairs, dependencies, same feature)
2. Sort them by dependency order — things that need to happen first go to earlier sprints
3. Fill sprints from the earliest available, respecting velocity limits
4. Show you the sprint plan with capacity numbers before creating anything

**Stories that do not fit** any sprint are listed as "Overflow" — you will see them and can
decide whether to split them or create them without a sprint assignment.

---

## Swimlane selection

After you provide the board URL, Claude fetches the swimlanes on your board and asks which
one to use. The default suggestion is **Sprint Goal** (if it exists on your board).

New stories are also placed in the **Ready for Development** column automatically.

---

## Acceptance Criteria

Every story created by this tool includes:
- At least **2 positive acceptance criteria** — what the feature should do when it works correctly
- At least **1 negative acceptance criterion** — what happens when something goes wrong, a limit is reached, or input is invalid

All ACs are written in **Given/When/Then** format:
- **Given** the starting state or precondition
- **When** the action or event occurs
- **Then** the observable, testable outcome

The ACs go into the dedicated **Acceptance Criteria** field in ADO (not buried in the description), so they appear correctly in your sprint view and Definition of Done checklists.

---

## Story Points

Stories are assigned points on the **Fibonacci scale**: 1, 2, 3, 5, 8, or 13.

| Points | What it means |
|--------|---------------|
| 1 | Tiny change — a config update, a label |
| 2 | Small addition, clear spec, straightforward |
| 3 | Typical feature — a few connected changes |
| 5 | More complex — cross-team or multiple layers |
| 8 | Large, security-critical, or many unknowns |
| 13 | Very large — almost certainly needs splitting |

---

## What you see before anything is created

The tool always shows a **preview** like this before touching ADO:

```
Drafted 2 Epics, 5 Features, 14 Stories, 42 Tasks

EPIC 1: Auth and Identity Layer                          [8 pts total]
  FEATURE 1.1: Token issuance
    #1  [backend  3pts]  Implement auth token endpoint   Ready  Sprint 42.4
    #2  [frontend 2pts]  Add login form component        Ready  Sprint 42.4   needs #1
  ...

ADO target: vfuk-digital/Digital | Area: Digital\Intensive Care
Swimlane: Sprint Goal | Target column: Ready for Development
```

Then it asks:
```
Create 14 User Stories (+ 2 Epics, 5 Features, 42 Tasks)?
  a) Create all now
  b) Assign to sprints first, then create
  c) Select stories by number (e.g. 1,3,5)
  d) Cancel
```

Choose **d) Cancel** at any time to stop without creating anything.

---

## After creation

Once done, you get a report listing every item created with its ADO ID and link:

```
Created in vfuk-digital/Digital:

EPIC #4630608: Auth and Identity Layer
  FEATURE #4631001: Token issuance
    #4630609  [backend  3pts]  Implement auth token endpoint     https://dev.azure.com/...
    #4630610  [frontend 2pts]  Add login form component          https://dev.azure.com/...

Sprint assignments:
  Sprint 42.4: #4630609, #4630610
  Sprint 42.5: #4630611
```

Click any link to open the story in ADO.

---

## Common questions

**Q: I do not have a spec document. Can I still use it?**
Yes — create a simple Word or Markdown document listing the phases of work with bullet points
for what each phase covers. The tool will turn each section into a story.

**Q: Can I edit the stories after they are created?**
Yes. The tool creates a first draft. You should review and refine the Acceptance Criteria,
adjust story points in your refinement session, and add any team-specific details.

**Q: The tool said "Required field missing". What do I do?**
The tool usually fixes this automatically by looking at existing stories in your area to find
the correct value. If it asks you to choose, pick the option that applies to your team (usually
"Technology" for technical stories, "Business" for business-facing ones).

**Q: Can I create stories for just one part of my spec?**
Yes — when the preview appears, choose **c) Select stories by number** and type the numbers
you want (e.g. `1,3,5`).

**Q: What if a story is too big?**
The tool will warn you if it assigns 13 points to a story and suggest splitting it. If a story
does not fit into any sprint during sprint planning, it will appear in the "Overflow" list.
You can still create it (without a sprint assignment) by choosing option **a) Create all** after
the sprint plan review.

**Q: Will it overwrite existing stories?**
No. The tool only creates new items. It never modifies existing ADO work items (unless you
specifically run it to patch acceptance criteria, which is a separate operation).

**Q: The board URL — where do I find it?**
Open your ADO board in a browser. The URL in the address bar is exactly what you need.
Example: `https://dev.azure.com/vfuk-digital/Digital/_boards/board/t/Intensive%20Care/Stories`

**Q: Does it work with Word documents (.docx)?**
Yes. The first time you use it with a `.docx` file, it will take a few extra seconds to
install a helper library automatically. Subsequent runs are instant.

---

## Tips for better results

- **Be descriptive in your spec.** The more context in your document, the better the generated stories. A heading like "User Authentication" produces a weaker story than "JWT-based authentication with 15-minute token expiry and refresh flow".
- **Use section headings.** Each top-level heading tends to become an Epic or Feature. Sub-headings become stories. The tool respects your document structure.
- **Include acceptance criteria in your spec.** If your document already lists "must", "shall", or "given/when/then" statements, the tool will use them verbatim and only fill gaps.
- **Mention roles.** Writing "As a customer service agent" in your spec helps the tool write proper user story statements.
- **Review before confirming.** The preview is your quality gate. Check that the epic groupings make sense for your team's way of working.

---

## Glossary

| Term | Meaning |
|------|---------|
| Epic | A large body of work, usually spanning multiple sprints. Groups Features. |
| Feature | A functional area within an Epic. Groups User Stories. |
| User Story | A unit of work deliverable in one sprint. Written from the user's perspective. |
| Task | A specific implementation step within a User Story. |
| Acceptance Criteria (AC) | The conditions that must be true for a story to be "done". |
| Story Points | A relative measure of effort (1=tiny, 13=huge). Not hours. |
| Swimlane | A horizontal lane on the ADO board (e.g. Sprint Goal, Bugs, Technical Excellence). |
| Iteration Path | The sprint the story is assigned to (e.g. `Digital\Digital X\PI 42\42.4`). |
| PAT | Personal Access Token — a secure password for the ADO API. |
| LLD | Low-Level Design — a technical specification document. |
| PI | Programme Increment — a planning period, usually 10–12 weeks, containing 5–6 two-week sprints. |

---

*Last updated: 2026-08-14. Maintained by the Automation Engineering team.*
