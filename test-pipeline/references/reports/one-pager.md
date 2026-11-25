# Daily one-pager

`reports/one-pager-<env>.html` - one per environment, one page per day, newest first.

## What you see

Per day: a headline stating what share of failures were the platform rather than the tests, five
KPIs, an hour-by-hour band showing when the day ran best, a ranked bar chart of causes in plain
English, and the biggest causes written out in full.

## Two rules it follows

1. **Nothing is collapsible.** If it is worth including it is worth showing.
2. **No raw signatures in the prose.** A signature is a grouping key, not an explanation.

Explanations come from `knowledge.yaml` where the team has recorded one - those are marked
**known** and can carry a suggested fix. Everything else is derived from the signature grammar:
deliberately plain rather than clever, because a confident wrong sentence on a page like this costs
far more than an honest vague one.

## When to reach for it

Sending a status update, or when someone asks "how is it going" and wants one page rather than a
tour of the data. It is the only report written for a reader who will not open a stack trace.

## The timing band

Hours are only called out as best when there is enough evidence - at least three hours of data and a
rate above 60%. A "best window" stamped on a day where nothing worked is worse than no advice, so on
a bad day it says plainly that the timing tells you nothing.
