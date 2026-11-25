---
name: find-test-data
description: 'Finds Vodafone UK test data on a test environment with the AE Data Browser: the airtime (SIMO) plans and the device catalogue with their catalogue ids, the postcodes that hold broadband test addresses (sweeping exact or partial postcodes), and for any address whether broadband is serviceable, which technology (FTTP, SOGEA, FTTC) and speed, and every plan id and router sold there. Read-only. Answers from stored results when they are under a week old and says how old they are; refreshes on request. Use when someone needs a plan id, a device id, a working HBB postcode or address, or an address with a given technology.'
argument-hint: 'what you need, e.g. "an FTTP address on qc2" | "plans" | "devices" | "postcodes" | "stored" | "check"'
user-invocable: true
---

# find-test-data (`/find-test-data`)

Finds test data with the **AE Data Browser**, through its headless runner `aedb`. The runner uses the same code and the same stored results as the desktop app, so a list fetched here shows up in the app straight away, and the other way round.

Everything `aedb` does is a **read**: it never creates, changes or orders anything. No confirmation is needed before a lookup. The only thing to watch is load: a big postcode sweep puts hundreds of requests on a shared environment (see Rules).

## Modes

Work out what the user needs from what they wrote. If it is unclear, ask one short question.

| They want | Go to |
|---|---|
| A plan, plan ids, "SIMO plans" | P. Plans |
| A device, a handset id, "iPhones", "Samsung" | D. Devices |
| A broadband postcode or address, "HBB data", "an FTTP address", "is X serviceable" | B. Broadband |
| `stored` | Run `aedb stored` and summarise: what is stored per environment, and what is over a week old. |
| `check` | Run `aedb check --env <env>` and explain each line. |

**Environment:** use the one the user names. If they name none, use **qc2** and say so in the answer.

## Running in GitHub Copilot

The same skill runs in VS Code Copilot Chat (agent mode). Where these steps say AskUserQuestion, ask in chat and wait for the answer. Run commands in the terminal.

---

## Step 0 - Find the runner

The command to run is stored in `<skill-dir>/config.json` as `{"aedb": "<command>"}`, where `<skill-dir>` is the folder holding this SKILL.md. Below, `aedb` means that command.

If there is no config, find the runner in this order, and save the first that works:

1. **Windows, packaged app:** `C:\Tools\AE Data Browser-win32-x64\aedb.cmd`. Also try `<skill-dir>\..\..\aedb.cmd`, in case the skill is still inside the unzipped app folder.
2. **Mac, packaged app:** if `/Applications/AE Data Browser.app` exists, the command is:

   ```
   ELECTRON_RUN_AS_NODE=1 "/Applications/AE Data Browser.app/Contents/MacOS/AE Data Browser" "/Applications/AE Data Browser.app/Contents/Resources/app/out/cli/aedb.mjs"
   ```

3. **From source:** `node "<repo>/apps/data-browser/out/cli/aedb.mjs"`, if the user works from the repository.
4. Otherwise, ask the user where they unzipped the app.

Check it with `aedb help`. On Windows, call the `.cmd` from PowerShell as `& "<path>\aedb.cmd" <arguments>`, quoting the path.

---

## Reading the output

- Use `--json` whenever you will pick from or reason over a list; the text tables cut long names.
- The **stored result note goes to stderr**, for example `Stored plans on qc2, fetched 14 Oct 2026, 09:13 (2 days ago).` Always tell the user how old the answer is.
- If stderr says **`WARNING: these results are more than a week old`**, say so and offer to refresh. If the user agrees, or asked for fresh data, run the same command again with `--refresh`.
- A command that fails prints one plain sentence. Pass it on as it is, then act on it:
  - **"Cannot reach <env>"**: the user must connect to the non-prod environments through the official bastion access first. Stop until they have.
  - **"<env> is not serving the airtime plans right now ... (reference ...)"**: an environment fault (int1 and qc5 have it). Offer the same lookup on qc2, and give them the reference id for the environment's support team.
  - **"The environment's service failed ... HTTP 5xx"**: the environment is failing. Suggest trying again in a few minutes.

---

## P. Plans

1. `aedb plans --env <env> --json`, adding `--search "<words>"` when the user named something ("unlimited", "24", "100GB"). Every search word must appear in the row.
2. Answer with a short table: **plan id**, name, monthly gross price, term. If the list is long, show the ones that best fit the request and say how many there are in total.

## D. Devices

1. `aedb devices --env <env> --json`, adding `--os IOS` or `--os ANDROID` when the user said iPhone/Apple or Android, and `--search "<words>"` for a make, model or storage ("samsung s24", "iphone 16 pro", "256").
2. Answer with **device id**, name, upfront gross price, term.

## B. Broadband

Broadband test data has two layers: **postcodes** that hold addresses on this environment, then **what is sold at each address**. Which postcodes hold addresses differs per environment and changes over time, so a postcode that worked last month may not now.

### B1. Postcodes with test data

- If the user gave postcodes, use them. If they gave none, offer the known test postcodes first: `PE6 6AW, IG10 1PT, PE6 0PA, MK5 7FG, CB3 0QA, CB3 0PQ, MK5 7EG, SW8 5FR, CT6 8LX`.
- Check what is stored first: `aedb stored --env <env>`. A stored sweep under a week old that covers the user's postcodes can answer straight away (`aedb discover` always runs a new sweep).
- Run `aedb discover --env <env> --postcodes "<list>" --json`.
- A **sector** (`PE6 6`, an outcode plus one digit) expands to **576 postcodes** and takes about 5 minutes. Before sweeping more than one sector, or more than about 200 postcodes, tell the user how many lookups that is and how long, and ask whether to go ahead.
- Read `withData` (postcodes with addresses, each with a sample) and `failed`. A failed postcode is **not** "no data": the environment did not answer. Offer to sweep the failed ones again.

### B2. Addresses

`aedb addresses --env <env> --postcode "<postcode>" --json` lists the addresses with their **address ids**.

### B3. What is sold at an address

`aedb availability --env <env> --postcode "<postcode>" --address <id>[,<id>] --json`, or `--all` for every address of the postcode. Without either, only the first address is checked.

- Each address takes a few seconds. For more than about 20 addresses, say how many and ask first.
- In the JSON, `results[]` has one entry per address: `result.serviceable`, and `result.tiers[]` with each `technology`, `provider`, `maxSpeedMb` and its `plans[]` (`planId`, `name`, `monthlyGross`, `routerId`). `lines[]` is the same flattened to one row per plan, which is what `--search` filters (`--search "fttp 900"`).
- `serviceable: false` is a real answer: no broadband can be sold there. An `error` such as "No Service Line received from TIL" means that address's test data is broken: say so and try the next address.

### B4. "Find me an address with <technology or speed>"

1. B1 on the candidate postcodes, to get the ones with data.
2. For each postcode with data, in turn: B3 with `--all --search "<technology>"` (for example `--search fttp`, or `--search "sogea"`). Stop as soon as one gives what the user asked for.
3. Answer with the **postcode**, the **address** and its **address id**, the technology and speed, and the matching **plan ids** with their router ids. Say how many addresses you checked.

If none of the candidates has it, say which postcodes and how many addresses you checked, and offer a sector sweep (B1) to find more postcodes.

---

## Rules

- **Read-only, always.** `aedb` only reads; do not try to create, order or change anything with it.
- **Mind the load.** Keep `--concurrency` at the default 2: the gateway sheds load above that, and lookups start failing. Ask before sweeping more than about 200 postcodes or checking more than about 20 addresses.
- **Always give the age** of a stored answer, and offer `--refresh` when it is over a week old.
- **Ids are the answer.** Whatever the user asked for, end with the catalogue ids they need (plan ids, device ids, address ids, router ids), in a code block when there are several, so they can be copied.
- **Do not edit `results.json` by hand.** It is shared with the desktop app; always go through `aedb`.
- **No em or en dashes** in anything you write.
