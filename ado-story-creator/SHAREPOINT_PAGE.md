# ADO Story Creator — AI-Powered Work Item Generation

**What it does:** Turn a specification document, a plan, or a Word file into a complete set of Azure DevOps User Stories — with Acceptance Criteria, story points, sprint assignments, and Epic/Feature structure — in minutes, without writing a single line of code.

---

## Who is this for?

| Role | How it helps |
|------|-------------|
| **Product Owner** | Convert a BRD or requirements doc into a ready-to-refine backlog in one step |
| **Business Analyst** | Paste your spec and get structured User Stories with Given/When/Then ACs already drafted |
| **Scrum Master** | Distribute stories across sprints automatically, respecting team velocity and dependencies |
| **Delivery Lead** | Create a consistent, traceable Epic → Feature → Story → Task hierarchy from any input |

---

## What gets created for you

- **Epics, Features, User Stories, and Tasks** — fully linked in ADO hierarchy
- **Acceptance Criteria** — at least 2 positive + 1 negative per story, in the dedicated AC field
- **Story points** on the Fibonacci scale (1, 2, 3, 5, 8, 13)
- **Sprint assignments** — stories distributed across real PI sprints based on your team's velocity
- **Discipline tags** — backend / frontend / fullstack, so sprint capacity can be tracked by skill
- **Swimlane placement** — stories land directly in your chosen lane (e.g. Sprint Goal)
- **Ready for Development** state — stories appear in the right board column immediately

> **Nothing is created without your approval.** You always see a preview of every story before anything goes into ADO.

---

## Three ways to use it

### From a specification or design document

Best for: Requirements docs, Low-Level Designs, BRDs, Word files, Excel specs.

The tool reads your document and runs a four-step analysis:

1. Identifies Epics and Features from your document structure
2. Writes User Stories ("As a [role], I want [goal], so that [benefit]") for each Feature
3. Drafts Acceptance Criteria and implementation Tasks
4. Maps dependencies between stories (e.g. backend API must exist before frontend can call it)

Supported formats: **.docx** (Word), **.xlsx** (Excel), **.md** (Markdown), **.txt**, Gherkin **.feature** files

---

### From a plan or task document

Best for: Plan-on-a-page, sprint planning notes, phase breakdowns, meeting minutes with action items.

Each section or phase in your document becomes a User Story. If your document has dates, they become the start and end dates on the ADO stories.

---

### From a git branch (for technical teams)

Best for: Creating retrospective stories for work already done on a branch, or generating stories from a developer's draft implementation.

The tool reads only the code changes on the branch — not the full codebase — and groups them into meaningful story candidates.

---

## Sprint planning built in

After reviewing the story preview, you can choose to distribute stories across sprints before creating them.

You provide:
- **Which sprint to start from** (e.g. PI 42, Sprint 42.4)
- **Team velocity** — how many story points the backend, frontend, and testing teams can handle per sprint

The tool then:
1. Groups related stories together (features, paired front/back-end work, dependencies)
2. Sorts them so dependent stories land in later sprints than the stories they depend on
3. Fills each sprint to capacity, rolling into the next sprint when full
4. Lists any stories that do not fit as "Overflow" so you can decide what to do with them

**Example sprint plan preview:**

```
Sprint 42.4  (13 Aug – 26 Aug)   Backend: 15/20   Frontend: 12/15   Testing: 8/10
  Implement auth token endpoint          [backend   3 pts]
  Add login form component               [frontend  2 pts]

Sprint 42.5  (27 Aug – 9 Sep)    Backend: 5/20    Frontend: 0/15    Testing: 5/10
  Implement session refresh flow         [fullstack 5 pts]

Overflow — no sprint with sufficient capacity:
  Rewrite entire auth layer (13 pts) — consider splitting
```

---

## Before you start — one-time setup

You need a **Personal Access Token (PAT)** from Azure DevOps. This is done once; after that, the tool remembers it.

**Steps:**

1. Go to [https://dev.azure.com/vfuk-digital](https://dev.azure.com/vfuk-digital)
2. Click your **profile picture** (top-right) → **Personal access tokens**
3. Click **New Token**
4. Name it (e.g. "Story Creator"), choose an expiry
5. Under **Scopes → Work Items**, tick **Read & Write**
6. Click **Create** — copy the token immediately (shown only once)
7. Ask your team's developer to add it to your environment, or add `AZURE_DEVOPS_PAT=<token>` to a `.env` file in your work folder

---

## How to run it

Open Claude Code (the AI assistant in VS Code or the terminal) and type:

```
/ado-story-creator
```

Claude will ask for:
- Your ADO organisation and project name
- Your team's area path
- The starting sprint (iteration path)
- Your board URL (paste it from your browser)
- The folder containing your document or code

It will resolve most of these automatically if your team has set up environment variables. Ask your developer if you are not sure.

---

## What the preview looks like

Before anything is created, you see a table like this:

```
Drafted 2 Epics, 5 Features, 14 Stories, 42 Tasks

EPIC 1: Customer Onboarding                        [21 pts total]
  FEATURE 1.1: Registration flow
    #1  [backend   3pts]  Implement account creation API    Ready  Sprint 42.4
    #2  [frontend  2pts]  Build registration form           Ready  Sprint 42.4   needs #1
  FEATURE 1.2: Email verification
    #3  [fullstack 5pts]  Add email verification step       Ready  Sprint 42.5

Swimlane: Sprint Goal  |  Target column: Ready for Development
Dependencies: 3 inferred
```

You then choose:

```
a) Create all now
b) Assign to sprints first, then create
c) Select specific stories by number
d) Cancel
```

Choose **Cancel** at any time — nothing is created until you confirm.

---

## Acceptance Criteria quality standard

Every story created by this tool meets the following standard:

- **At least 2 positive ACs** — what the feature does when it works correctly
- **At least 1 negative AC** — what happens when input is wrong, a service is unavailable, or a limit is reached
- All written in **Given/When/Then** format — every AC, without exception
- Placed in the **dedicated Acceptance Criteria field** in ADO — not buried in the description

The Given/When/Then structure:
- **Given** the starting state or precondition
- **When** the action or event occurs
- **Then** the observable, testable outcome

Examples:

> **Given** the user submits valid registration details, **When** the form is submitted, **Then** an account is created and a confirmation email is sent within 30 seconds.
>
> *Negative:* **Given** the email address is already registered, **When** the registration form is submitted, **Then** the system displays "An account with this email already exists" and does not create a duplicate account.

---

## Story points guide

| Points | What it means for your team |
|--------|------------------------------|
| 1 | Tiny — a config change, a text update |
| 2 | Small — clear spec, straightforward change |
| 3 | Typical — a few connected pieces of work |
| 5 | Larger — cross-team or multi-layer change |
| 8 | Complex — security-critical or many unknowns |
| 13 | Very large — should probably be split |

---

## Frequently asked questions

**Do I need to know how to code?**
No. You need Claude Code installed (your IT team or a developer can do this), and a PAT token set up once. After that, you type `/ado-story-creator` and answer a few plain-English questions.

**Can I edit the stories after they are created?**
Yes. The tool creates a solid first draft. You refine the ACs and points in your normal refinement session with the team.

**What if my document is very long?**
The tool automatically summarises long documents before analysing them. It keeps all the important headings and requirement statements.

**Will it overwrite my existing stories?**
No. It only creates new work items. Existing stories in ADO are never modified.

**Can I create stories for just part of my document?**
Yes — in the preview step, choose **c) Select stories by number** and type the ones you want (e.g. `1,3,5`).

**The tool said a field is "Required" — what do I do?**
It fixes this automatically by looking at existing stories in your team's area to find the right value. If it needs your input, it will show you the options.

**My Word document has tables and diagrams — will those be read?**
Text in tables is extracted. Images and diagrams are skipped, but any text around them is used. For best results, ensure key requirements are written as text, not only in images.

---

## Tips for better results

- **Use clear section headings** — each heading tends to become an Epic or Feature. "3.1 User Registration" produces better results than a plain paragraph.
- **Write requirements, not solutions** — "The system shall send a confirmation email within 30 seconds" is better than "Use SendGrid to send emails".
- **Include user roles** — writing "As a customer service agent" helps the tool write proper user story statements.
- **List dependencies explicitly** — if you know Section B cannot start until Section A is complete, say so in the document. The tool will respect it.
- **Review the Acceptance Criteria** — treat the generated ACs as a starting point and adjust them in your refinement session.

---

## Getting help

Contact your **Automation Engineering team** or ask in the team channel.

The full technical guide is available at: `c:\newgit\skills\ado-story-creator\USER_GUIDE.md`

---

*Powered by Claude Code and the ADO Story Creator skill — Vodafone UK Digital, Automation Engineering*
