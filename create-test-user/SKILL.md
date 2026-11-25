---
name: create-test-user
description: 'Creates working Vodafone UK test users end to end with the AE Test Data Generator: a real order through the DAL purchase journey, the Siebel check, Cavendish dispatch, the IDAM password reset and the subscription check. Asks for the user type (SIMO or Device + SIMO are proven), the environment, and the plan and device (random but checked for stock and compatibility, or picked from the live lists), confirms, runs it in the background (20 to 40 minutes), reports progress and hands back the user''s details ready to copy. Also lists created users, manages the ICCID pool and explains failed runs.'
argument-hint: '"create" | "users" | "status" | "iccid" | "check" | no-arg (create)'
user-invocable: true
---

# create-test-user (`/create-test-user`)

Creates test users with the **AE Test Data Generator**, through its headless runner `tdg`. The runner uses the same engine and the same data folder as the desktop app, so users created here appear in the app's "Created users" list, and the app and this skill share one ICCID pool.

Every creation is a **real order** on a test environment and can use a scarce ICCID, so nothing is created without the user's explicit yes (see Rules).

## Modes

| Argument | What to do |
|---|---|
| no argument, `create` | The full creation flow below. |
| `users` | Run `tdg users`. Offer `tdg user <name> --copy` for any of them. |
| `status` | Run `tdg status` (latest run) and report it. If it is still running, offer to follow it (step C6). |
| `iccid` | Run `tdg iccid status`. To add serials, take them from the user and run `tdg iccid add <serials>`. |
| `check` | Run `tdg check --env qc2` (or the env the user names) and explain each line. |

## Running in GitHub Copilot

The same skill runs in VS Code Copilot Chat (agent mode). Where these steps say AskUserQuestion, ask in chat and wait for the answer. Run commands in the terminal.

---

## Step 0 - Find the runner

The command to run is stored in `<skill-dir>/config.json` as `{"tdg": "<command>"}`, where `<skill-dir>` is the folder holding this SKILL.md. Below, `tdg` means that command.

If there is no config, find the runner in this order, and save the first that works:

1. **Windows, packaged app:** `C:\Tools\AE Test Data Generator-win32-x64\tdg.cmd`. Also try `<skill-dir>\..\..\tdg.cmd`, in case the skill is still inside the unzipped app folder.
2. **Mac, packaged app:** if `/Applications/AE Test Data Generator.app` exists, the command is:

   ```
   ELECTRON_RUN_AS_NODE=1 "/Applications/AE Test Data Generator.app/Contents/MacOS/AE Test Data Generator" "/Applications/AE Test Data Generator.app/Contents/Resources/app/out/cli/tdg.mjs"
   ```

3. **From source:** `node "<repo>/apps/desktop/out/cli/tdg.mjs"`, if the user works from the repository.
4. Otherwise, ask the user where they unzipped the app.

Check it with `tdg help`. On Windows, call the `.cmd` from PowerShell as `& "<path>\tdg.cmd" <arguments>`, quoting the path.

---

## The creation flow

### C1. Check the setup

Run `tdg check --env qc2` and act on each FAIL:

- **Connectivity:** the environments are not reachable. Tell the user to connect to the non-prod environments through the official bastion access first, then stop. Nothing else works without it.
- **ADO PAT not set:** users will be created but will not be able to log in, because the IDAM password reset needs it. The user sets it themselves, never through this chat: either in the desktop app's **Azure DevOps PAT** panel, or by running `tdg pat set` in their own terminal and pasting it at the hidden prompt. It needs **Build: read & execute**.
- **ICCID pool empty:** SIMO users cannot be dispatched, so they will not reach OIM. Ask the user for their serials (19 or 20 digits each; they are not secret) and run `tdg iccid add <serials>`. Device + SIMO does not need serials: a handset order is dispatched as an eSIM.
- **Payment browser:** the card step needs Microsoft Edge or Google Chrome. Tell the user to install one.

### C2. Ask what to create

Ask with AskUserQuestion:

1. **Which user type?**
   - *SIMO, consumer* (proven end to end)
   - *Device + SIMO, consumer* (proven end to end)
   - *Something else*: run `tdg types` and offer the list, saying plainly that these are implemented but not yet proven end to end.
2. **Which environment?** Run `tdg envs` and offer:
   - *qc2* (Recommended): the only environment proven end to end.
   - *prodsup*: full; the final login check has not been re-run end to end there.
   - *int1*: int1 cannot create orders, so the order is placed on qc2. They share one directory, so the user works on int1.
   - If the user wants another, check `tdg envs`. An environment that cannot order and has no stand-in (for example qc5) cannot be used: say why, and ask again.

### C3. Plan and device

Ask: **random but valid, or pick from the live list?**

- **Random:** leave them out. The tool picks an in-stock device and a plan that device can actually be sold with, so the order cannot fail on an invalid combination.
- **Pick, SIMO:** run `tdg catalog plans --env <env>`, show the list and let the user choose.
- **Pick, Device + SIMO:**
  1. Run `tdg catalog devices --env <env>` and let the user choose a device.
  2. Run `tdg device-plans --env <env> --device <deviceId>`. Offer those plans, or "a random compatible plan".

The lists are cached for a week. Add `--refresh` if the user suspects they are out of date.

### C4. Confirm

Say exactly what will happen, then wait for a clear yes:

> This creates a real **<type>** order on **<order env>** (usable on **<chosen env>**), with plan **<plan or "random valid">** and device **<device or "random in-stock">**. It uses one ICCID from the pool (<n> left; SIMO only), and takes about 20 to 40 minutes. Go ahead?

### C5. Start

```
tdg start --type <type> --env <env> [--plan <planId>] [--device <deviceId>]
```

It returns at once with the run folder. The run carries on by itself, even if this chat is closed; `/create-test-user status` picks it up later.

### C6. Follow it

Repeat `tdg wait --run "<run folder>" --max 540` until the state is no longer "running". Each call returns within 9 minutes, under the command time limits. After each call, give the user one short line: steps done, the step now running, and the checks so far.

What the long waits are:
- **verify-siebel** polls until the order reaches Siebel: anything from 1 to 10 minutes is normal.
- **dispatch-cavendish** waits for the order to become dispatchable, then dispatches it.
- **ado-reset-password** first waits about 9 minutes for the subscription to settle, then resets the password.
- **verify-gca** polls until the account shows the subscription.

### C7. Report

- **"USABLE test user":** show the user block exactly as printed, in a code block, so it can be copied as it is. Offer `tdg user <username> --copy` to put it on the clipboard.
- **"NOT fully usable":** say which check did not confirm (the Checks line) and why (the warnings), and what fixes it:
  - *Dispatch skipped, no ICCID:* add serials (C1), then create a new user.
  - *IDAM reset skipped, no PAT:* set the PAT (C1), then create a new user.
  - *Siebel not confirmed:* the order never reached Siebel in 10 minutes. That is an environment problem; try again later, or on qc2.
- **FAILED:** run `tdg failure --run "<run folder>"`. It shows the failing step with its request and response (credentials already removed). Explain it in plain words:
  - A **5xx** answer (for example 500 `SYS_ERR_DEF`) is the environment failing, not the request. Suggest trying again later, or another capable environment.
  - A **4xx** answer usually means the chosen plan or device is not valid now. Suggest a random valid one.
  - A connection error means the environments are not reachable (C1).

---

## Rules

- **Nothing is created without a yes.** Never run `tdg start` or `tdg create` against a real environment without the user's explicit confirmation in this conversation (C4). For demonstrations use `--env mock`, the built-in mock with no real systems behind it.
- **Never handle the PAT.** Never ask for it in chat, never print it, never write it to a file. The user sets it in the app or with `tdg pat set`.
- **One user per confirmation.** For several users, confirm the number and start them one after another, not in parallel: each takes a serial and puts load on the environment.
- **Do not edit the data files by hand.** The pool, the user list and the settings are shared with the desktop app; always go through `tdg`.
- **Serials are spent once dispatched.** Only run `tdg iccid release` for a serial that was certainly never dispatched.
- **Prefer the proven types**, SIMO and Device + SIMO for consumers. Say so when the user picks another.
- **No em or en dashes** in anything you write.
