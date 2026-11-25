/**
 * Shared HTML chrome for every report.
 *
 * One place for the page shell, the palette and the escaping, so four reports cannot drift into
 * four slightly different visual languages - and so rebranding is one config edit rather than a
 * hunt through four files.
 *
 * The palette arrives from config.branding. Defaults are deliberately neutral: a distributed skill
 * that ships one company's colours makes every other adopter's reports look like a mistake.
 */

export function esc(t) {
  return String(t ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Strip a test-file path down to something readable in a narrow column. */
export function shortName(file) {
  return String(file ?? '')
    .replace(/\.(spec|test)\.(ts|js|mjs|tsx|py|java)$/i, '')
    .replace(/^(?:src|tests?|e2e)[\\/]/i, '');
}

export function pct(n, d) {
  if (!d) return null;
  return Math.round((n / d) * 100);
}

/** Consistent good/mixed/bad banding, so a colour means the same thing in every report. */
export function band(rate) {
  if (rate === null || rate === undefined) return 'na';
  if (rate >= 80) return 'ok';
  if (rate >= 50) return 'warn';
  return 'bad';
}

function palette(branding = {}) {
  const p = branding.palette ?? {};
  return {
    accent: p.accent ?? '#2563eb',
    ok: p.ok ?? '#16a34a',
    warn: p.warn ?? '#d97706',
    bad: p.bad ?? '#dc2626',
    ink: p.ink ?? '#1f2937',
  };
}

export function css(branding = {}) {
  const c = palette(branding);
  return `
:root{--accent:${c.accent};--ok:${c.ok};--warn:${c.warn};--bad:${c.bad};--ink:${c.ink};
  --line:#e5e7eb;--muted:#6b7280;--bg:#ffffff;--soft:#f9fafb}
*{box-sizing:border-box}
body{margin:0;padding:32px;background:var(--bg);color:var(--ink);
  font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
h1{font-size:26px;margin:0 0 4px;font-weight:650}
h1 em{font-style:normal;color:var(--accent)}
h2{font-size:18px;margin:32px 0 10px;font-weight:600}
h3{font-size:15px;margin:20px 0 8px;font-weight:600}
.sub{color:var(--muted);margin:0 0 24px;font-size:13px}
table{border-collapse:collapse;width:100%;font-size:13px;margin:8px 0 20px}
th,td{border:1px solid var(--line);padding:6px 9px;text-align:left;vertical-align:top}
th{background:var(--soft);font-weight:600;white-space:nowrap}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.ok{color:var(--ok)} .warn{color:var(--warn)} .bad{color:var(--bad)} .na{color:var(--muted)}
td.ok{background:#f0fdf4} td.warn{background:#fffbeb} td.bad{background:#fef2f2} td.na{background:var(--soft)}
.pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:600;
  border:1px solid currentColor}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
.muted{color:var(--muted)}
.small{font-size:12px}
.kpis{display:flex;gap:14px;flex-wrap:wrap;margin:18px 0 26px}
.kpi{border:1px solid var(--line);border-radius:10px;padding:12px 16px;min-width:130px;background:var(--soft)}
.kpi .v{font-size:24px;font-weight:650;line-height:1.1}
.kpi .l{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-top:3px}
.bar{height:8px;border-radius:4px;background:var(--line);overflow:hidden;min-width:70px}
.bar>i{display:block;height:100%}
details{border:1px solid var(--line);border-radius:8px;padding:8px 12px;margin:6px 0;background:var(--bg)}
summary{cursor:pointer;font-weight:600;list-style:none}
summary::-webkit-details-marker{display:none}
summary::before{content:"\\25B8";display:inline-block;width:1em;color:var(--muted)}
details[open]>summary::before{content:"\\25BE"}
.note{border-left:3px solid var(--accent);background:var(--soft);padding:10px 14px;margin:14px 0;
  border-radius:0 6px 6px 0;font-size:13px}
footer{margin-top:40px;padding-top:14px;border-top:1px solid var(--line);
  color:var(--muted);font-size:12px}
@media print{body{padding:12mm}details{break-inside:avoid}details[open] summary::before{content:""}}
`;
}

/**
 * Wrap body content in the standard page.
 * `env` is always taken from the run record by the caller and printed in the subtitle - a report
 * must name the environment it actually describes, never a constant compiled into the template.
 */
export function page({ title, h1, subtitle, body, branding = {}, generatedAt = new Date() }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>${css(branding)}</style>
</head><body>
<h1>${h1}</h1>
<p class="sub">${subtitle}</p>
${body}
<footer>${esc(branding.title ?? 'test-pipeline')}${branding.subtitle ? ' &middot; ' + esc(branding.subtitle) : ''}
 &middot; generated ${esc(generatedAt.toISOString().replace('T', ' ').slice(0, 16))}Z</footer>
</body></html>`;
}

/** A labelled proportion bar, used wherever a share is shown. */
export function barHtml(rate, colourVar) {
  if (rate === null) return '<span class="na small">n/a</span>';
  const v = `var(--${colourVar ?? band(rate)})`;
  return `<span class="bar" title="${rate}%"><i style="width:${rate}%;background:${v}"></i></span>`;
}

export function kpi(value, label, cls = '') {
  return `<div class="kpi"><div class="v ${cls}">${esc(value)}</div><div class="l">${esc(label)}</div></div>`;
}
