---
mode: agent
description: test-pipeline doctor - check the scheduled pipeline is actually running
---

Act as **test-pipeline** and run `doctor`.

Run `node <pipelineDir>/runner/doctor.mjs --config pipeline.config.json` and interpret the result
for me.

This is read-only and is not sliced - one pass, one table.

After the table, tell me plainly:

1. Is the pipeline running right now, yes or no?
2. If anything is FAIL, what is the single next action?
3. Flag specially any environment that has **neither** a history record **nor** a logged skip - that
   means something is exiting before it can record either, which is the failure mode that hides
   indefinitely.
