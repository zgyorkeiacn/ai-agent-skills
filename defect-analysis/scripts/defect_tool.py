#!/usr/bin/env python3
"""
Deterministic helpers for the defect-analysis skill. Everything that must be exact lives
here; the narrative analysis is written by the assistant following references/*.md.

A port of the Defect Analyzer app's src/core (this skill lives in the app's skills/ folder):
same sheet formats, same validation, same Excel paste rules, same gap facts. The app's
test/skill-parity.test.ts runs this script and requires byte-identical output, so change
both together.

Subcommands
  fetch        --ids "..." --out bugs.json              ADO fetch (PAT from AZURE_DEVOPS_PAT)
  show         --data bugs.json --id N                  one ticket, compact, for reading
  read-tracker --file X.xlsx [--file Y.xlsx] --ids "..."|all [--sheet NAME] --out tracker.json
  build        --mode ado|excel --format tracker|bsc|both --data FILE --analyses A.json [...]
               [--poc NAME] --outdir DIR
  gap-input    --mode ado|excel --data FILE [--analyses A.json ...] --out gap-input.json
  gap-report   --input gap-input.json --report gaps.json --outdir DIR
  copy         --file F                                 put a file on the Windows clipboard

Output files are tab-separated (.tsv, CRLF, no header: paste under the sheet's header row)
and CSV (.csv, UTF-8 with BOM, header row). Credentials are never printed.
"""
import argparse
import base64
import csv
import datetime as dt
import io
import json
import math
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

# Windows consoles default to a legacy code page; ticket text is UTF-8.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# ── Vocabularies (identical to the app) ─────────────────────────────────────

RCA_VALUES = ["Coding error", "Design gap", "Requirement gap", "External code issue"]
AREA_VALUES = ["FE", "BE", "BE/FE"]
# The tracker's own spelling, including "Reuirement". Do not correct it: the sheet filters on it.
BUCKET_VALUES = ["Valid Miss", "Reuirement Unclarity", "Digital_External defect", "Downstream system",
                 "Environment Issue", "Limited Test Data", "Content Issue", "Configuration"]
GAP_CATEGORIES = ["Process", "Testing", "Coverage"]
PRIORITIES = ["High", "Medium", "Low"]
EFFORTS = ["S", "M", "L"]

TRACKER_HEADERS = [
    "PI", "Date", "Defect Id", "Area Path", "Corrected Area Path", "Iteration Path", "Environment", "POC",
    "Bug RCA Actual", "Bug RCA Updated", "Sub-RCA", "Priority", "Justification of missing defect", "Area (FE/BE)",
    "BDD Added (Yes / No / Na)", "Other Action Taken", "Has the analysis been shared with team",
    "Resolution of missing defect", "Mitigation Action", "Bucket", "Raised By",
]
BSC_HEADERS = [
    "ID", "Work Item Type", "Title", "Assigned To", "State", "Tags", "Area Path", "Iteration Path",
    "Root Cause Analysis", "Environment", "Raised By", "Defect Analysis", "Justification of defect leakage",
]
RCA_CHANGE_HEADERS = ["ID", "ADO says", "Verified", "Change", "Why"]
ACTION_HEADERS = ["Ref", "Priority", "Action", "Detail", "Addresses", "Owner", "Effort", "Success measure"]
GAP_CSV_HEADERS = ["Section", "Ref", "Category", "Priority", "Title", "Detail", "Evidence", "Addresses",
                   "Owner", "Effort", "Impact", "Success measure"]
HEADERS = {"tracker": TRACKER_HEADERS, "bsc": BSC_HEADERS, "rca": RCA_CHANGE_HEADERS,
           "actions": ACTION_HEADERS, "gaps": GAP_CSV_HEADERS}
TRACKER_ITERATION_COL = TRACKER_HEADERS.index("Iteration Path")
PLACEHOLDER = "-"  # Excel's paste drops empty columns and shifts the rest left

# ── Text helpers ────────────────────────────────────────────────────────────

_REDACT = re.compile(r"\b(pass(?:word|wd)?|pwd|pin|otac)\s*[:=-]\s*\S+", re.I)


def redact(s):
    return _REDACT.sub(r"\1: <redacted>", s)


def strip_html(h):
    s = re.sub(r"<[^>]+>", " ", str(h or ""))
    for a, b in (("&nbsp;", " "), ("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", '"'), ("&#39;", "'")):
        s = s.replace(a, b)
    return redact(re.sub(r"\s+", " ", s).strip())


def tidy(v):
    """One line per cell, no long dashes."""
    s = re.sub(r"[\t\r\n]+", " ", str(v if v is not None else ""))
    s = re.sub(r"\s*[\u2013\u2014]\s*", " - ", s)
    return re.sub(r" {2,}", " ", s).strip()


def or_dash(s):
    s = str(s if s is not None else "").strip()
    return s if s else PLACEHOLDER


def leaf(path):
    return str(path or "").split("\\")[-1]


def parse_ids(text):
    seen = []
    for m in re.finditer(r"(?<!\d)\d{6,8}(?!\d)", str(text or "")):
        if m.group(0) not in seen:
            seen.append(m.group(0))
    return seen


def pick(value, allowed, aliases=None):
    norm = lambda s: re.sub(r"[^a-z/]", "", str(s or "").lower())
    v = norm(value)
    for a in allowed:
        if norm(a) == v:
            return a
    return (aliases or {}).get(v)


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_text(path, text, bom=False):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8-sig" if bom else "utf-8", newline="") as f:
        f.write(text)

# ── PAT ─────────────────────────────────────────────────────────────────────


def get_pat():
    pat = os.environ.get("AZURE_DEVOPS_PAT", "")
    if not pat and sys.platform == "win32":
        # A user variable set after this process started is in the registry, not in os.environ.
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as k:
                pat = winreg.QueryValueEx(k, "AZURE_DEVOPS_PAT")[0]
        except OSError:
            pat = ""
    if not pat and os.path.exists(".env"):
        for line in open(".env", encoding="utf-8"):
            m = re.match(r"\s*AZURE_DEVOPS_PAT\s*=\s*(.+)", line)
            if m:
                pat = m.group(1).strip()
    if pat in ("", "demo-mode", "your-pat-here", "<pat>"):
        return ""
    return pat

# ── ADO fetch ───────────────────────────────────────────────────────────────

TRACKED = ["System.IterationPath", "System.AreaPath", "System.State", "System.AssignedTo",
           "VFDigitalAgile.RootCauseAnalysis", "Custom.RMSubRCA", "VFDigitalAgile.Environment"]
DROPPED = {"Microsoft.VSTS.TCM.SystemInfo"}  # holds test-account credentials on some tickets
NOISE = re.compile(r"^(System\.(Id|Rev|Watermark|CommentCount|BoardColumn|BoardColumnDone|BoardLane|AuthorizedAs|"
                   r"AuthorizedDate|RevisedDate|PersonId|AreaId|IterationId|NodeName|TeamProject|AreaLevel\d|"
                   r"IterationLevel\d|History|ChangedBy|ChangedDate)|Microsoft\.VSTS\.Common\.(StackRank|"
                   r"StateChangeDate|ActivatedDate|ActivatedBy|ValueArea)|WEF_.*|.*Kanban.*)$")


class AdoError(Exception):
    pass


def _get(url, pat):
    req = urllib.request.Request(url, headers={"Authorization": "Basic " + base64.b64encode(f":{pat}".encode()).decode()})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            if r.status == 203:
                raise AdoError("ADO rejected the PAT (expired, revoked or missing Work Items Read scope).")
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code == 401:
            raise AdoError("ADO rejected the PAT (expired, revoked or missing Work Items Read scope).")
        if e.code == 404:
            raise AdoError("Not found in ADO (wrong ID, or no access to it).")
        raise AdoError(f"ADO answered HTTP {e.code}.")


def _display(v):
    if isinstance(v, dict):
        return str(v.get("displayName") or json.dumps(v))
    return "(none)" if v is None else str(v)


def fetch_ticket(tid, org, project, pat):
    base = f"https://dev.azure.com/{org}/{project}/_apis/wit/workitems/{tid}"
    wi = _get(f"{base}?$expand=all&api-version=7.1", pat)
    try:
        comments = _get(f"{base}/comments?api-version=7.1-preview.3&$top=200", pat).get("comments", [])
    except AdoError:
        comments = []
    try:
        updates = _get(f"{base}/updates?api-version=7.1", pat).get("value", [])
    except AdoError:
        updates = []
    fields = {}
    for k, v in (wi.get("fields") or {}).items():
        if v is None or v == "" or k in DROPPED:
            continue
        fields[k] = v if isinstance(v, (int, float, bool)) else (_display(v) if isinstance(v, dict) else strip_html(v))
    history = []
    for u in updates:
        uf = u.get("fields") or {}
        for k in TRACKED:
            if k in uf:
                history.append({"date": str((uf.get("System.ChangedDate") or {}).get("newValue") or "")[:10], "field": k,
                                "from": _display(uf[k].get("oldValue")), "to": _display(uf[k].get("newValue"))})
    return {
        "id": tid,
        "fields": fields,
        "history": history,
        "relations": [f"{(r.get('attributes') or {}).get('name') or r.get('rel')} {str(r.get('url', '')).split('/')[-1]}"
                      for r in (wi.get("relations") or []) if not re.search(r"AttachedFile|ArtifactLink", r.get("rel", ""))],
        "comments": [{"by": _display(c.get("createdBy")), "at": str(c.get("createdDate") or "")[:16], "text": strip_html(c.get("text"))}
                     for c in reversed(comments)],
    }


def cmd_fetch(a):
    ids = parse_ids(a.ids)
    pat = get_pat()
    if not pat:
        sys.exit("No ADO PAT found: set AZURE_DEVOPS_PAT (user environment variable or .env).")
    out, errors = {}, {}

    def one(tid):
        try:
            out[tid] = fetch_ticket(tid, a.org, a.project, pat)
            print(f"[ado] {tid} fetched")
        except AdoError as e:
            errors[tid] = str(e)
            print(f"[ado] {tid} FAILED: {e}")

    with ThreadPoolExecutor(6) as pool:
        list(pool.map(one, ids))
    ordered = {tid: out[tid] for tid in ids if tid in out}
    write_text(a.out, json.dumps({"mode": "ado", "ids": ids, "tickets": ordered, "errors": errors}, ensure_ascii=False, indent=1))
    print(f"{len(ordered)}/{len(ids)} fetched -> {a.out}" + (f"; failed: {', '.join(errors)}" if errors else ""))


def compact_ticket(t, max_comment=2500):
    return {
        "id": t["id"],
        "fields": {k: v for k, v in t["fields"].items() if not NOISE.match(k)},
        "history": [f"{h['date']} {h['field'].split('.')[-1]}: {h['from']} -> {h['to']}" for h in t["history"]],
        "relations": t["relations"],
        "comments": [{**c, "text": c["text"][:max_comment] + (" [...]" if len(c["text"]) > max_comment else "")} for c in t["comments"]],
    }


def cmd_show(a):
    data = load_json(a.data)
    if data.get("mode") == "excel":
        print(json.dumps(data["rows"].get(a.id) or {"error": "not in this file"}, ensure_ascii=False, indent=1))
        return
    t = data["tickets"].get(a.id)
    print(json.dumps(compact_ticket(t) if t else {"error": data.get("errors", {}).get(a.id, "not fetched")}, ensure_ascii=False, indent=1))

# ── DefectTracker (21-column Excel) reader ──────────────────────────────────

def _norm(h):
    return re.sub(r"[^a-z0-9]", "", str(h or "").lower())


# canonical header -> (exact normalised names, prefixes)
TRACKER_ALIASES = {
    "PI": (["pi"], []),
    "Date": (["date"], []),
    "Defect Id": (["defectid", "bugid"], []),
    "Area Path": (["areapath"], []),
    "Corrected Area Path": (["correctedareapath"], []),
    "Iteration Path": (["iterationpath"], []),
    "Environment": (["environment"], []),
    "POC": (["poc"], []),
    "Bug RCA Actual": (["bugrcaactual"], []),
    "Bug RCA Updated": (["bugrcaupdated"], []),
    "Sub-RCA": (["subrca"], []),
    "Priority": (["priority"], []),
    "Justification of missing defect": ([], ["justificationofmissingdefec"]),
    "Area (FE/BE)": (["areafebe"], []),
    "BDD Added (Yes / No / Na)": ([], ["bddadded"]),
    "Other Action Taken": (["otheractiontaken"], []),
    "Has the analysis been shared with team": ([], ["hastheanalysisbeensharedwith"]),
    "Resolution of missing defect": ([], ["resolutionofmissingdefec"]),
    "Mitigation Action": (["mitigationaction"], []),
    "Bucket": (["bucket"], []),
    "Raised By": (["raisedby"], []),
    # Not part of the 21 columns; used for the BSC output when a workbook happens to have them.
    "Title": (["title"], []),
    "Assigned To": (["assignedto"], []),
    "State": (["state"], []),
    "Tags": (["tags"], []),
    "Work Item Type": (["workitemtype"], []),
}
# The headers that only the 21-column DefectTracker has; older layouts lack them.
REQUIRED_21 = ["Defect Id", "Corrected Area Path", "Bug RCA Actual", "Bug RCA Updated", "Sub-RCA",
               "Justification of missing defect", "Mitigation Action", "Bucket"]


def _map_headers(row):
    found = {}
    for idx, h in enumerate(row):
        n = _norm(h)
        if not n:
            continue
        for canon, (exact, prefixes) in TRACKER_ALIASES.items():
            if canon in found:
                continue
            if n in exact or any(n.startswith(p) for p in prefixes):
                found[canon] = idx
                break
    return found


def _cell(v):
    if v is None:
        return ""
    if isinstance(v, (dt.datetime, dt.date)):
        return f"{v.day}/{v.month}/{v.year}"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    s = str(v).strip()
    # "-" is the tracker's own empty-cell placeholder (Excel paste drops empty columns).
    return "" if s in ("-", "–", "—") else s


def cmd_read_tracker(a):
    import openpyxl
    wanted_all = a.ids.strip().lower() == "all"
    wanted = [] if wanted_all else parse_ids(a.ids)
    rows, sources, duplicates, rejected = {}, [], [], []
    for path in a.file:
        if not os.path.exists(path):
            rejected.append(f"{path}: file not found")
            continue
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
        best = None  # (score, sheet, header_row_index, mapping)
        for ws in wb.worksheets:
            if a.sheet and ws.title.strip() != a.sheet.strip():
                continue
            for i, row in enumerate(ws.iter_rows(min_row=1, max_row=6, values_only=True), start=1):
                m = _map_headers(row)
                if "Defect Id" in m:
                    score = sum(1 for c in REQUIRED_21 if c in m) * 10 + len(m)
                    if not best or score > best[0]:
                        best = (score, ws, i, m)
                    break
        if not best:
            rejected.append(f"{path}: no sheet with a 'Defect Id' header" + (f" named '{a.sheet}'" if a.sheet else ""))
            continue
        _, ws, header_row, m = best
        missing = [c for c in REQUIRED_21 if c not in m]
        if missing:
            rejected.append(f"{path} [{ws.title}]: not the 21-column DefectTracker (missing: {', '.join(missing)})")
            continue
        sources.append(f"{os.path.basename(path)} [{ws.title}]")
        for r in ws.iter_rows(min_row=header_row + 1, values_only=True):
            tid = parse_ids(_cell(r[m["Defect Id"]]) if m["Defect Id"] < len(r) else "")
            if not tid:
                continue
            tid = tid[0]
            if not wanted_all and tid not in wanted:
                continue
            rec = {canon: _cell(r[idx]) if idx < len(r) else "" for canon, idx in m.items()}
            rec["_source"] = f"{os.path.basename(path)} [{ws.title}]"
            if tid in rows:
                duplicates.append(tid)
                # Keep the more complete row.
                if sum(1 for v in rec.values() if v) <= sum(1 for v in rows[tid].values() if v):
                    continue
            rows[tid] = rec
    ids = list(rows) if wanted_all else [t for t in wanted if t in rows]
    result = {"mode": "excel", "sources": sources, "ids": ids, "rows": {t: rows[t] for t in ids},
              "missing": [t for t in wanted if t not in rows], "duplicates": sorted(set(duplicates)), "rejected": rejected}
    write_text(a.out, json.dumps(result, ensure_ascii=False, indent=1))
    print(f"read {len(ids)} row(s) from {', '.join(sources) or 'no usable file'} -> {a.out}")
    if result["missing"]:
        print(f"not found: {' '.join(result['missing'])}")
    if result["duplicates"]:
        print(f"in more than one place (kept the most complete row): {' '.join(result['duplicates'])}")
    for r in rejected:
        print(f"REJECTED {r}")
    if not ids:
        sys.exit(1)

# ── Analyses validation ─────────────────────────────────────────────────────

ADO_TEXT = ["rcaReason", "justification", "otherAction", "resolution", "mitigation", "defectAnalysis", "leakage"]
ADO_REQUIRED = ["justification", "resolution", "mitigation", "defectAnalysis", "leakage"]


def load_analyses(paths):
    """Accepts files and wildcard patterns; PowerShell does not expand wildcards for native programs."""
    import glob
    files = []
    for p in paths or []:
        matched = sorted(glob.glob(p)) if any(ch in p for ch in "*?[") else [p]
        if not matched:
            sys.exit(f"No analysis files match {p}")
        files += [m for m in matched if m not in files]
    entries = []
    for p in files:
        d = load_json(p)
        entries += d.get("tickets", d) if isinstance(d, dict) else d
    return entries


def validate_ado(entries, ids):
    analyses, problems = {}, {}
    for e in entries:
        m = re.search(r"\d{6,8}", str(e.get("id", "")))
        if not m or m.group(0) not in ids:
            continue
        tid = m.group(0)
        rca = pick(e.get("rca"), RCA_VALUES, {"codedefect": "Coding error"})
        area = pick(e.get("area"), AREA_VALUES, {"febe": "BE/FE"})
        bucket = pick(e.get("bucket"), BUCKET_VALUES, {"requirementunclarity": "Reuirement Unclarity"})
        text = {k: tidy(e.get(k)) for k in ADO_TEXT}
        missing = ([] if rca else [f"rca \"{e.get('rca')}\""]) + ([] if area else [f"area \"{e.get('area')}\""]) + \
                  ([] if bucket else [f"bucket \"{e.get('bucket')}\""]) + [f"{k} empty" for k in ADO_REQUIRED if not text[k]]
        if missing:
            problems[tid] = "unusable: " + ", ".join(missing)
            continue
        analyses[tid] = {"id": tid, "rca": rca, "area": area, "bucket": bucket, **text}
    for tid in ids:
        if tid not in analyses and tid not in problems:
            problems[tid] = "no analysis"
    return analyses, problems


def validate_excel(entries, ids):
    analyses, problems = {}, {}
    for e in entries:
        m = re.search(r"\d{6,8}", str(e.get("id", "")))
        if not m or m.group(0) not in ids:
            continue
        tid = m.group(0)
        da, lk = tidy(e.get("defectAnalysis")), tidy(e.get("leakage"))
        if not da or not lk:
            problems[tid] = "defectAnalysis or leakage empty"
            continue
        analyses[tid] = {"id": tid, "defectAnalysis": da, "leakage": lk}
    for tid in ids:
        if tid not in analyses and tid not in problems:
            problems[tid] = "no derived analysis"
    return analyses, problems

# ── Rows ────────────────────────────────────────────────────────────────────


def _f(t, k):
    v = t["fields"].get(k)
    return "" if v is None else str(v)


def _raised(t, field):
    for h in t["history"]:
        if h["field"] == field:
            return h["to"] if h["to"] != "(none)" else _f(t, field)
    return _f(t, field)


def raised_by(created_by):
    name, _, org = str(created_by or "").partition(",")
    org = re.sub(r"\s+", " ", re.sub(r"[()]", "", org)).strip()
    return f"{name.strip()} ({org})" if org else (name.strip() or PLACEHOLDER)


def uk_date(iso):
    try:
        d = dt.datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        return f"{d.day}/{d.month}/{d.year}"
    except ValueError:
        return PLACEHOLDER


def tracker_row(t, a, poc):
    iteration = _raised(t, "System.IterationPath")
    pi = re.search(r"PI\s*(\d+)", iteration, re.I)
    return [
        f"PI{pi.group(1)}" if pi else PLACEHOLDER, uk_date(_f(t, "System.CreatedDate")), t["id"],
        or_dash(leaf(_raised(t, "System.AreaPath"))), or_dash(_f(t, "System.AreaPath")), or_dash(leaf(iteration)),
        or_dash(_f(t, "VFDigitalAgile.Environment")), or_dash(poc), or_dash(_f(t, "VFDigitalAgile.RootCauseAnalysis")),
        a["rca"], or_dash(_f(t, "Custom.RMSubRCA")), or_dash(_f(t, "Microsoft.VSTS.Common.Priority")),
        or_dash(a["justification"]), a["area"], PLACEHOLDER, or_dash(a["otherAction"]), PLACEHOLDER,
        or_dash(a["resolution"]), or_dash(a["mitigation"]), a["bucket"], raised_by(_f(t, "System.CreatedBy")),
    ]


def bsc_row_ado(t, a):
    return [
        t["id"], or_dash(_f(t, "System.WorkItemType")), or_dash(_f(t, "System.Title")), or_dash(_f(t, "System.AssignedTo")),
        or_dash(_f(t, "System.State")), or_dash(_f(t, "System.Tags")), or_dash(_f(t, "System.AreaPath")),
        or_dash(_f(t, "System.IterationPath")), a["rca"], or_dash(_f(t, "VFDigitalAgile.Environment")),
        or_dash(_f(t, "System.CreatedBy")),  # Bugs have no "Raised By" field in ADO; it is Created By
        or_dash(a["defectAnalysis"]), or_dash(a["leakage"]),
    ]


def full_iteration(pi, iteration):
    """
    The DefectTracker keeps the last segment of the raised iteration; the BSC Tracker shows the
    full ADO path. Rebuilt with the team's convention, Digital\\Digital X\\PI <n>[\\<sprint>]:
    '42.5' -> ...\\PI 42\\42.5, 'PI 43 Planning Week' -> ...\\PI 43\\PI 43 Planning Week,
    'PI 40' -> ...\\PI 40. Anything else is returned as it is.
    """
    it = str(iteration or "").strip()
    if not it or "\\" in it:
        return it
    if re.fullmatch(r"(PI\s*)?\d+", it, re.I):  # PI-level: 'PI 40', or a bare 40 in older sheets
        return f"Digital\\Digital X\\PI {re.search(r'\d+', it).group(0)}"
    n = re.match(r"(\d+)\.\d+$", it) or re.match(r"PI\s*(\d+)\b", it, re.I) or re.search(r"(\d+)", str(pi or ""))
    return f"Digital\\Digital X\\PI {n.group(1)}\\{it}" if n else it


def bsc_row_excel(r, a):
    return [
        a["id"], or_dash(r.get("Work Item Type") or "Bug"), or_dash(r.get("Title")), or_dash(r.get("Assigned To")),
        or_dash(r.get("State")), or_dash(r.get("Tags")), or_dash(r.get("Corrected Area Path") or r.get("Area Path")),
        or_dash(full_iteration(r.get("PI"), r.get("Iteration Path"))),
        or_dash(r.get("Bug RCA Updated") or r.get("Bug RCA Actual")), or_dash(r.get("Environment")),
        or_dash(r.get("Raised By")), or_dash(a["defectAnalysis"]), or_dash(a["leakage"]),
    ]


def rca_changes(ids, tickets, analyses):
    out = []
    for tid in ids:
        if tid not in tickets or tid not in analyses:
            continue
        ado = _f(tickets[tid], "VFDigitalAgile.RootCauseAnalysis") or "(empty)"
        a = analyses[tid]
        if ado == a["rca"]:
            continue
        wording = ado == "Code Defect" and a["rca"] == "Coding error"
        out.append([tid, ado, a["rca"], "Wording only" if wording else "Changed",
                    "Same cause, tracker wording" if wording else (a["rcaReason"] or PLACEHOLDER)])
    return out

# ── TSV / CSV ───────────────────────────────────────────────────────────────

_NUM = re.compile(r"^\d+(\.\d+)?$")


def _clean(v):
    return re.sub(r" {2,}", " ", re.sub(r"[\t\r\n]+", " ", str(v))).strip()


def to_tsv(sheet, rows, header=False):
    text_col = TRACKER_ITERATION_COL if sheet == "tracker" else -1
    body = ["\t".join(("'" + c if i == text_col and _NUM.match(c) else c) for i, c in enumerate(map(_clean, r))) for r in rows]
    return "\r\n".join(([("\t".join(HEADERS[sheet]))] if header else []) + body)


def to_csv(sheet, rows):
    text_col = TRACKER_ITERATION_COL if sheet == "tracker" else -1
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\r\n", quoting=csv.QUOTE_MINIMAL)
    w.writerow(HEADERS[sheet])
    for r in rows:
        # In a CSV an apostrophe would show; ="42.5" displays as the text 42.5.
        w.writerow([f'="{c}"' if i == text_col and _NUM.match(c) else c for i, c in enumerate(map(_clean, r))])
    return buf.getvalue()


def emit(outdir, name, sheet, rows):
    write_text(os.path.join(outdir, f"{name}.tsv"), to_tsv(sheet, rows))
    write_text(os.path.join(outdir, f"{name}.csv"), to_csv(sheet, rows), bom=True)
    print(f"{name}: {len(rows)} row(s) -> {os.path.join(outdir, name)}.tsv / .csv")


def cmd_build(a):
    data = load_json(a.data)
    entries = load_analyses(a.analyses)
    problems = []
    if a.mode == "ado":
        ids = [t for t in data["ids"] if t in data["tickets"]]
        analyses, bad = validate_ado(entries, ids)
        ready = [t for t in ids if t in analyses]
        if a.format in ("tracker", "both"):
            emit(a.outdir, "defecttracker-21-columns", "tracker", [tracker_row(data["tickets"][t], analyses[t], a.poc) for t in ready])
        if a.format in ("bsc", "both"):
            emit(a.outdir, "bsc-tracker-13-columns", "bsc", [bsc_row_ado(data["tickets"][t], analyses[t]) for t in ready])
        changes = rca_changes(ready, data["tickets"], analyses)
        write_text(os.path.join(a.outdir, "rca-changes.tsv"), to_tsv("rca", changes, header=True))
        print(f"rca-changes: {len(changes)} row(s) ({sum(1 for c in changes if c[3] == 'Changed')} changed, "
              f"{sum(1 for c in changes if c[3] != 'Changed')} wording only)")
        for tid, err in data.get("errors", {}).items():
            problems.append(f"{tid}: ADO: {err}")
    else:
        ids = data["ids"]
        analyses, bad = validate_excel(entries, ids)
        ready = [t for t in ids if t in analyses]
        emit(a.outdir, "bsc-tracker-13-columns", "bsc", [bsc_row_excel(data["rows"][t], analyses[t]) for t in ready])
    problems += [f"{t}: {p}" for t, p in bad.items()]
    write_text(os.path.join(a.outdir, "validated-analyses.json"), json.dumps(analyses, ensure_ascii=False, indent=1))
    print(f"built {len(ready)}/{len(ids)}")
    for p in problems:
        print(f"PROBLEM {p}")
    sys.exit(1 if problems else 0)

# ── Gap analysis ────────────────────────────────────────────────────────────


def _tally(xs):
    out = {}
    for x in xs:
        out[x] = out.get(x, 0) + 1
    return dict(sorted(out.items(), key=lambda kv: -kv[1]))


def _is_prod(env):
    return bool(re.search(r"prod1|live|production", env or "", re.I)) and not re.search(r"prodsup", env or "", re.I)


def gap_input_ado(data, analyses):
    ids = [t for t in data["ids"] if t in data["tickets"] and t in analyses]
    T = data["tickets"]
    days = []
    for t in ids:
        try:
            c = dt.datetime.fromisoformat(_f(T[t], "System.CreatedDate").replace("Z", "+00:00"))
            x = dt.datetime.fromisoformat(_f(T[t], "Microsoft.VSTS.Common.ClosedDate").replace("Z", "+00:00"))
            d = (x - c).total_seconds() / 86400
            if d >= 0:
                days.append(d)
        except ValueError:
            pass
    days.sort()
    services = [s.strip() for t in ids for s in re.split(r"[;,]", _f(T[t], "Custom.AffectedService")) if s.strip() and s.strip() != "N/A"]

    def moved(t):
        first = next((h for h in T[t]["history"] if h["field"] == "System.AreaPath"), None)
        return bool(first and first["to"] != "(none)" and first["to"] != _f(T[t], "System.AreaPath"))

    facts = {
        "total": len(ids),
        "production": [t for t in ids if _is_prod(_f(T[t], "VFDigitalAgile.Environment"))],
        "stMissYes": [t for t in ids if re.search(r"ST Miss\s*=\s*Yes", _f(T[t], "Custom.Assetslink"), re.I)],
        "misrouted": [t for t in ids if moved(t)],
        # Round half up on fractional days, as the app's Math.round does (Python's round() is banker's).
        "medianDaysToClose": math.floor(days[len(days) // 2] + 0.5) if days else None,
        "byRca": _tally(analyses[t]["rca"] for t in ids),
        "byBucket": _tally(analyses[t]["bucket"] for t in ids),
        "byArea": _tally(analyses[t]["area"] for t in ids),
        "byEnvironment": _tally(_f(T[t], "VFDigitalAgile.Environment") or "not recorded" for t in ids),
        "byTestPhase": _tally(_f(T[t], "Custom.BUG_TestPhase") or "not recorded" for t in ids),
        "topServices": list(_tally(services).items())[:8],
    }
    items = []
    for t in ids:
        x, an = T[t], analyses[t]
        first = next((h for h in x["history"] if h["field"] == "System.AreaPath"), None)
        st = re.search(r"ST Miss\s*=\s*(Yes|No)", _f(x, "Custom.Assetslink"), re.I)
        items.append({
            "id": t, "title": _f(x, "System.Title"), "environment": _f(x, "VFDigitalAgile.Environment"),
            "testPhase": _f(x, "Custom.BUG_TestPhase"), "foundBy": _f(x, "VFDigitalAgile.FoundBy"), "tags": _f(x, "System.Tags"),
            "affectedService": _f(x, "Custom.AffectedService"), "severity": _f(x, "Microsoft.VSTS.Common.Severity"),
            "stMiss": st.group(1) if st else "",
            "raisedAgainst": first["to"] if first and first["to"] != _f(x, "System.AreaPath") else "",
            "created": _f(x, "System.CreatedDate")[:10], "closed": _f(x, "Microsoft.VSTS.Common.ClosedDate")[:10],
            **{k: an[k] for k in ("rca", "area", "bucket", "defectAnalysis", "leakage", "resolution", "mitigation", "otherAction")},
        })
    return ids, facts, items


def gap_input_excel(data, analyses):
    # As in the app: once narratives exist, only the rows that have one take part.
    ids = [t for t in data["ids"] if not analyses or t in analyses]
    R = data["rows"]
    get = lambda t, k: (R[t].get(k) or "").strip()

    def moved(t):
        raised, now = get(t, "Area Path"), leaf(get(t, "Corrected Area Path"))
        return bool(raised and now and leaf(raised) != now)

    facts = {
        "total": len(ids),
        "production": [t for t in ids if _is_prod(get(t, "Environment"))],
        "misrouted": [t for t in ids if moved(t)],
        "byRca": _tally(get(t, "Bug RCA Updated") or get(t, "Bug RCA Actual") or "not recorded" for t in ids),
        "bySubRca": _tally(get(t, "Sub-RCA") or "not recorded" for t in ids),
        "byBucket": _tally(get(t, "Bucket") or "not recorded" for t in ids),
        "byArea": _tally(get(t, "Area (FE/BE)") or "not recorded" for t in ids),
        "byEnvironment": _tally(get(t, "Environment") or "not recorded" for t in ids),
        "byPi": _tally(get(t, "PI") or "not recorded" for t in ids),
        "byTeam": list(_tally(leaf(get(t, "Corrected Area Path")) or "not recorded" for t in ids).items())[:8],
    }
    items = [{
        "id": t, "pi": get(t, "PI"), "iteration": get(t, "Iteration Path"), "environment": get(t, "Environment"),
        "raisedAgainst": get(t, "Area Path") if moved(t) else "", "team": leaf(get(t, "Corrected Area Path")),
        "rcaActual": get(t, "Bug RCA Actual"), "rca": get(t, "Bug RCA Updated"), "subRca": get(t, "Sub-RCA"),
        "area": get(t, "Area (FE/BE)"), "bucket": get(t, "Bucket"), "priority": get(t, "Priority"),
        "justification": get(t, "Justification of missing defect"), "otherAction": get(t, "Other Action Taken"),
        "resolution": get(t, "Resolution of missing defect"), "mitigation": get(t, "Mitigation Action"),
        "bddAdded": get(t, "BDD Added (Yes / No / Na)"),
        **({"defectAnalysis": analyses[t]["defectAnalysis"], "leakage": analyses[t]["leakage"]} if t in analyses else {}),
    } for t in ids]
    return ids, facts, items


def cmd_gap_input(a):
    data = load_json(a.data)
    entries = load_analyses(a.analyses)
    if a.mode == "ado":
        ids0 = [t for t in data["ids"] if t in data["tickets"]]
        analyses, _ = validate_ado(entries, ids0)
        ids, facts, items = gap_input_ado(data, analyses)
    else:
        analyses, _ = validate_excel(entries, data["ids"]) if entries else ({}, {})
        ids, facts, items = gap_input_excel(data, analyses)
    if len(ids) < 2:
        sys.exit("A gap analysis needs at least two analysed bugs.")
    write_text(a.out, json.dumps({"mode": a.mode, "ids": ids, "facts": facts, "items": items}, ensure_ascii=False, indent=1))
    print(f"gap input for {len(ids)} bug(s) -> {a.out}")
    for line in fact_lines(facts):
        print(f"  {line}")


def _verb(n, one, many):
    return f"{n} {one if n == 1 else many}"


def _counts(m):
    return ", ".join(f"{k} {v}" for k, v in m.items())


def fact_lines(f):
    n, out = f["total"], []
    pct = lambda x: f"{round(100 * x / n) if n else 0}%"
    out.append(f"{len(f['production'])} of {n} ({pct(len(f['production']))}) {'was' if len(f['production']) == 1 else 'were'} found in production.")
    if "stMissYes" in f:
        out.append(f"{_verb(len(f['stMissYes']), 'is', 'are')} recorded as ST Miss = Yes (should have been caught in story testing).")
    out.append(f"{_verb(len(f['misrouted']), 'was', 'were')} first raised against another team before reaching the owning team.")
    if "medianDaysToClose" in f:
        out.append(f"Median time from raised to closed: {f['medianDaysToClose']} days." if f["medianDaysToClose"] is not None else "Time to close: not recorded.")
    out.append(f"Root cause: {_counts(f['byRca'])}.")
    if "bySubRca" in f:
        out.append(f"Sub-RCA: {_counts(f['bySubRca'])}.")
    out.append(f"Bucket: {_counts(f['byBucket'])}.")
    out.append(f"Layer: {_counts(f['byArea'])}.")
    out.append(f"Found in: {_counts(f['byEnvironment'])}.")
    if f.get("byPi"):
        out.append(f"PI: {_counts(f['byPi'])}.")
    if f.get("topServices"):
        out.append("Most affected services: " + ", ".join(f"{s} ({c})" for s, c in f["topServices"]) + ".")
    if f.get("byTeam"):
        out.append("Owning teams: " + ", ".join(f"{s} ({c})" for s, c in f["byTeam"]) + ".")
    return out


def validate_gaps(d, ids):
    problems, gaps, actions, ref_map = [], [], [], {}
    known = set(ids)
    for g in d.get("gaps") or []:
        cat = next((c for c in GAP_CATEGORIES if c.lower() == str(g.get("category", "")).strip().lower()), None)
        ev = []
        for e in g.get("evidence") or []:
            m = re.search(r"\d{6,8}", str(e))
            if m and m.group(0) in known and m.group(0) not in ev:
                ev.append(m.group(0))
        title = tidy(g.get("title"))
        if not cat or not title or not ev:
            problems.append(f"Dropped gap \"{title or g.get('ref')}\": " + ("unknown category" if not cat else "no evidence from this run" if not ev else "no title"))
            continue
        ref = f"G{len(gaps) + 1}"
        ref_map[str(g.get("ref", "")).strip().upper()] = ref
        gaps.append({"ref": ref, "category": cat, "title": title, "detail": tidy(g.get("detail")), "evidence": ev, "impact": tidy(g.get("impact"))})
    for x in d.get("actions") or []:
        title = tidy(x.get("title"))
        if not title:
            continue
        addr = []
        for r in x.get("addresses") or []:
            mapped = ref_map.get(str(r).strip().upper())
            if mapped and mapped not in addr:
                addr.append(mapped)
        if not addr:
            problems.append(f"Action \"{title}\" does not point at a known gap")
        actions.append({
            "ref": f"A{len(actions) + 1}",
            "priority": next((p for p in PRIORITIES if p.lower() == str(x.get("priority", "")).lower()), "Medium"),
            "title": title, "detail": tidy(x.get("detail")), "addresses": addr,
            "owner": tidy(x.get("owner")) or "Delivery lead",
            "effort": next((e for e in EFFORTS if e.lower() == str(x.get("effort", "")).lower()), "M"),
            "measure": tidy(x.get("measure")),
        })
    for g in gaps:
        if not any(g["ref"] in x["addresses"] for x in actions):
            problems.append(f"{g['ref']} \"{g['title']}\" has no action")
    return {"summary": tidy(d.get("summary")), "gaps": gaps, "actions": actions}, problems


def gap_report_text(r, facts, generated):
    out = [f"Defect gap analysis: {facts['total']} bugs ({generated})", "", "Summary", r["summary"], "", "Facts"]
    out += [f"- {l}" for l in fact_lines(facts)]
    for cat in GAP_CATEGORIES:
        gs = [g for g in r["gaps"] if g["category"] == cat]
        if not gs:
            continue
        out += ["", f"{cat} gaps"]
        for g in gs:
            out += [f"{g['ref']}. {g['title']}", f"   {g['detail']}", f"   Impact: {g['impact']}", f"   Seen in: {', '.join(g['evidence'])}"]
    out += ["", "Enhancement opportunities (improvement actions)"]
    for x in r["actions"]:
        out += [f"{x['ref']} [{x['priority']}] {x['title']}", f"   {x['detail']}",
                f"   Owner: {x['owner']}. Effort: {x['effort']}. Addresses: {', '.join(x['addresses']) or '-'}.",
                f"   Success measure: {x['measure']}"]
    return "\r\n".join(out)


def cmd_gap_report(a):
    gi = load_json(a.input)
    report, problems = validate_gaps(load_json(a.report), gi["ids"])
    if not report["gaps"]:
        sys.exit("No usable gaps: " + "; ".join(problems))
    generated = dt.date.today().isoformat()
    write_text(os.path.join(a.outdir, "gap-report.txt"), gap_report_text(report, gi["facts"], generated))
    actions = [[x["ref"], x["priority"], x["title"], x["detail"], ", ".join(x["addresses"]) or "-", x["owner"], x["effort"], x["measure"] or "-"] for x in report["actions"]]
    write_text(os.path.join(a.outdir, "gap-actions.tsv"), to_tsv("actions", actions, header=True))
    rows = [["Gap", g["ref"], g["category"], "", g["title"], g["detail"], " ".join(g["evidence"]), "", "", "", g["impact"], ""] for g in report["gaps"]] + \
           [["Action", x["ref"], "", x["priority"], x["title"], x["detail"], "", " ".join(x["addresses"]), x["owner"], x["effort"], "", x["measure"]] for x in report["actions"]]
    write_text(os.path.join(a.outdir, "gap-analysis.csv"), to_csv("gaps", rows), bom=True)
    print(f"{len(report['gaps'])} gap(s), {len(report['actions'])} action(s) -> {a.outdir}\\gap-report.txt, gap-actions.tsv, gap-analysis.csv")
    for p in problems:
        print(f"NOTE {p}")


def cmd_copy(a):
    if sys.platform == "darwin":
        with open(a.file, encoding="utf-8") as f:
            text = f.read()
        # pbcopy decodes its input with the locale; force UTF-8 so names with accents survive.
        subprocess.run(["pbcopy"], input=text.encode("utf-8"), env={**os.environ, "LANG": "en_US.UTF-8"}, check=True)
    elif sys.platform == "win32":
        path = os.path.abspath(a.file).replace("'", "''")  # PowerShell single-quoted literal
        subprocess.run(["powershell", "-NoProfile", "-Command", f"Get-Content -Raw -Encoding UTF8 -LiteralPath '{path}' | Set-Clipboard"], check=True)
    else:
        sys.exit("copy works on Windows and macOS only; open the file instead.")
    print(f"copied {a.file} to the clipboard")

# ── CLI ─────────────────────────────────────────────────────────────────────


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("fetch"); s.add_argument("--ids", required=True); s.add_argument("--out", required=True)
    s.add_argument("--org", default="vfuk-digital"); s.add_argument("--project", default="Digital"); s.set_defaults(fn=cmd_fetch)
    s = sub.add_parser("show"); s.add_argument("--data", required=True); s.add_argument("--id", required=True); s.set_defaults(fn=cmd_show)
    s = sub.add_parser("read-tracker"); s.add_argument("--file", action="append", required=True); s.add_argument("--ids", required=True)
    s.add_argument("--sheet"); s.add_argument("--out", required=True); s.set_defaults(fn=cmd_read_tracker)
    s = sub.add_parser("build"); s.add_argument("--mode", choices=["ado", "excel"], required=True)
    s.add_argument("--format", choices=["tracker", "bsc", "both"], default="both"); s.add_argument("--data", required=True)
    s.add_argument("--analyses", nargs="+", required=True); s.add_argument("--poc", default=""); s.add_argument("--outdir", required=True)
    s.set_defaults(fn=cmd_build)
    s = sub.add_parser("gap-input"); s.add_argument("--mode", choices=["ado", "excel"], required=True); s.add_argument("--data", required=True)
    s.add_argument("--analyses", nargs="*"); s.add_argument("--out", required=True); s.set_defaults(fn=cmd_gap_input)
    s = sub.add_parser("gap-report"); s.add_argument("--input", required=True); s.add_argument("--report", required=True)
    s.add_argument("--outdir", required=True); s.set_defaults(fn=cmd_gap_report)
    s = sub.add_parser("copy"); s.add_argument("--file", required=True); s.set_defaults(fn=cmd_copy)
    a = p.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
