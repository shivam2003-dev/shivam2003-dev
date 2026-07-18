import { mkdirSync, writeFileSync } from "node:fs";

const login = process.env.GITHUB_LOGIN || "shivam2003-dev";
const token = process.env.GITHUB_TOKEN;

if (!token) {
  throw new Error("GITHUB_TOKEN is required to refresh profile activity assets.");
}

const query = `
  query($login: String!) {
    user(login: $login) {
      contributionsCollection {
        startedAt
        endedAt
        totalCommitContributions
        totalIssueContributions
        totalPullRequestContributions
        restrictedContributionsCount
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              date
              contributionCount
            }
          }
        }
      }
    }
  }
`;

const response = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "shivam2003-dev-profile-telemetry",
  },
  body: JSON.stringify({ query, variables: { login } }),
});

if (!response.ok) {
  throw new Error(`GitHub GraphQL request failed: ${response.status} ${response.statusText}`);
}

const payload = await response.json();
if (payload.errors?.length) {
  throw new Error(payload.errors.map((error) => error.message).join("; "));
}

const collection = payload.data?.user?.contributionsCollection;
if (!collection) {
  throw new Error(`No contribution data returned for ${login}.`);
}

const weeks = collection.contributionCalendar.weeks;
const days = weeks.flatMap((week) => week.contributionDays);
const firstDate = days[0]?.date;
const lastDate = days.at(-1)?.date;
const latestActive = [...days].reverse().find((day) => day.contributionCount > 0)?.date;
const refreshed = lastDate;

const number = (value) => new Intl.NumberFormat("en-US").format(value);
const dateLabel = (date) => new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
}).format(new Date(`${date}T00:00:00Z`)).toUpperCase();
const monthLabel = (date) => new Intl.DateTimeFormat("en-GB", {
  month: "short",
  timeZone: "UTC",
}).format(new Date(`${date}T00:00:00Z`)).toUpperCase();
const xml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

function level(count) {
  if (count === 0) return 0;
  if (count < 5) return 1;
  if (count < 15) return 2;
  if (count < 30) return 3;
  return 4;
}

function monthMarkers(cell, gap, startX) {
  let previous = "";
  const markers = [];
  weeks.forEach((week, index) => {
    const visibleDay = week.contributionDays.find((day) => day.date.slice(5, 7) !== previous) || week.contributionDays[0];
    const month = visibleDay?.date.slice(5, 7);
    if (month && month !== previous) {
      if (markers.length && index - markers.at(-1).index < 3) markers.pop();
      markers.push({ index, svg: `<text x="${startX + index * (cell + gap)}" class="muted mono month">${monthLabel(visibleDay.date)}</text>` });
      previous = month;
    }
  });
  return markers.map((marker) => marker.svg).join("\n");
}

function heatmap({ cell, gap, startX, startY, radius }) {
  return weeks.map((week, weekIndex) => week.contributionDays.map((day, dayIndex) => {
    const x = startX + weekIndex * (cell + gap);
    const y = startY + dayIndex * (cell + gap);
    const latest = day.date === latestActive ? " latest" : "";
    return `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="${radius}" class="level-${level(day.contributionCount)}${latest}"><title>${xml(day.date)}: ${day.contributionCount} contributions</title></rect>`;
  }).join("\n")).join("\n");
}

const stats = [
  [number(collection.contributionCalendar.totalContributions), "GITHUB ACTIVITY", "LAST 12 MONTHS"],
  [number(collection.totalCommitContributions), "COMMIT CONTRIBUTIONS", "LAST 12 MONTHS"],
  [number(collection.totalPullRequestContributions), "PULL REQUESTS", "LAST 12 MONTHS"],
  [number(collection.totalIssueContributions), "ISSUES", "LAST 12 MONTHS"],
];

const sharedStyle = `
  text { font-family: Arial, Helvetica, sans-serif; }
  .mono { font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; }
  .bg { fill: #080A0C; }
  .panel { fill: #101316; }
  .ink { fill: #F3F0E8; }
  .muted { fill: #89939D; }
  .faint { stroke: #30363C; }
  .grid-line { stroke: #1A2025; }
  .signal { fill: #B8F34A; }
  .signal-stroke { stroke: #B8F34A; }
  .level-0 { fill: #1A2025; }
  .level-1 { fill: #314520; }
  .level-2 { fill: #577C28; }
  .level-3 { fill: #82B535; }
  .level-4 { fill: #B8F34A; }
  .scan { animation: scan 9s ease-in-out infinite; }
  .latest { animation: latest 2.6s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
  @keyframes scan { 0%, 8% { transform: translateX(-34px); opacity: 0; } 16% { opacity: .5; } 76% { opacity: .16; } 86%, 100% { transform: translateX(var(--scan-distance)); opacity: 0; } }
  @keyframes latest { 50% { opacity: .58; transform: scale(.78); } }
  @media (prefers-color-scheme: light) {
    .bg { fill: #F3F0E8; }
    .panel { fill: #E8E3D8; }
    .ink { fill: #111315; }
    .muted { fill: #5F6870; }
    .faint { stroke: #C8C0B1; }
    .grid-line { stroke: #DDD7CB; }
    .signal { fill: #456600; }
    .signal-stroke { stroke: #456600; }
    .level-0 { fill: #DDD7CB; }
    .level-1 { fill: #CDE6A9; }
    .level-2 { fill: #94BE58; }
    .level-3 { fill: #668D24; }
    .level-4 { fill: #456600; }
  }
  @media (prefers-reduced-motion: reduce) { .scan, .latest { animation: none !important; } }
`;

function desktopSvg() {
  const cardWidth = 259;
  const gap = 18;
  const statCards = stats.map(([value, label, note], index) => {
    const x = 54 + index * (cardWidth + gap);
    return `<g transform="translate(${x} 84)">
      <rect width="${cardWidth}" height="118" rx="18" class="panel" stroke="#30363C" />
      <text x="18" y="51" class="ink" font-size="36" font-weight="700" letter-spacing="-1">${xml(value)}</text>
      <text x="18" y="79" class="signal mono" font-size="11" font-weight="700" letter-spacing="1.2">${xml(label)}</text>
      <text x="18" y="99" class="muted mono" font-size="9" letter-spacing="1">${xml(note)}</text>
    </g>`;
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="460" viewBox="0 0 1200 460" role="img" aria-labelledby="title desc">
  <title id="title">GitHub build signal for ${xml(login)}</title>
  <desc id="desc">${number(collection.contributionCalendar.totalContributions)} GitHub contributions, ${number(collection.totalCommitContributions)} commit contributions, ${number(collection.totalPullRequestContributions)} pull requests, and ${number(collection.totalIssueContributions)} issues from ${xml(firstDate)} through ${xml(lastDate)}.</desc>
  <defs>
    <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" class="grid-line" /></pattern>
    <clipPath id="frame"><rect width="1200" height="460" rx="28" /></clipPath>
    <style>${sharedStyle}
      .month { font-size: 9px; letter-spacing: .8px; }
      .scan { --scan-distance: 988px; }
    </style>
  </defs>
  <rect width="1200" height="460" rx="28" class="bg" />
  <g clip-path="url(#frame)"><rect width="1200" height="460" fill="url(#grid)" opacity=".42" /><circle cx="1040" cy="38" r="150" fill="#B8F34A" opacity=".045" /></g>
  <text x="54" y="43" class="muted mono" font-size="12" font-weight="700" letter-spacing="2.2">FIELD MANUAL 04 / BUILD SIGNAL</text>
  <circle cx="1128" cy="39" r="4" class="signal" />
  <text x="1114" y="43" text-anchor="end" class="signal mono" font-size="11" font-weight="700" letter-spacing="1.2">LIVE SNAPSHOT</text>
  <line x1="54" y1="65" x2="1146" y2="65" class="faint" />
  ${statCards}
  <text x="54" y="244" class="ink mono" font-size="12" font-weight="700" letter-spacing="1.6">CONTRIBUTION MAP / 12 MONTHS</text>
  <text x="1146" y="244" text-anchor="end" class="muted mono" font-size="10">${dateLabel(firstDate)} — ${dateLabel(lastDate)}</text>
  <g transform="translate(0 275)">${monthMarkers(14, 4, 54)}</g>
  ${heatmap({ cell: 14, gap: 4, startX: 54, startY: 292, radius: 3 })}
  <rect x="54" y="286" width="12" height="140" rx="6" class="signal scan" opacity="0" />
  <g transform="translate(1042 312)">
    <text x="0" y="0" class="muted mono" font-size="9">LESS</text>
    <rect x="0" y="14" width="12" height="12" rx="3" class="level-0" /><rect x="18" y="14" width="12" height="12" rx="3" class="level-1" /><rect x="36" y="14" width="12" height="12" rx="3" class="level-2" /><rect x="54" y="14" width="12" height="12" rx="3" class="level-3" /><rect x="72" y="14" width="12" height="12" rx="3" class="level-4" />
    <text x="84" y="25" class="muted mono" font-size="9">MORE</text>
  </g>
  <text x="54" y="443" class="muted mono" font-size="10" letter-spacing=".9">GITHUB ACTIVITY · INCLUDES PUBLIC AND PRIVATE-COUNT SIGNALS</text>
  <text x="1146" y="443" text-anchor="end" class="muted mono" font-size="10" letter-spacing=".9">REFRESHED ${dateLabel(refreshed)}</text>
  <rect x="1" y="1" width="1198" height="458" rx="27" fill="none" class="faint" />
</svg>\n`;
}

function mobileSvg() {
  const statCards = stats.map(([value, label, note], index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = 40 + column * 326;
    const y = 84 + row * 130;
    return `<g transform="translate(${x} ${y})">
      <rect width="310" height="112" rx="18" class="panel" stroke="#30363C" />
      <text x="18" y="48" class="ink" font-size="35" font-weight="700" letter-spacing="-1">${xml(value)}</text>
      <text x="18" y="76" class="signal mono" font-size="13" font-weight="700" letter-spacing=".8">${xml(label)}</text>
      <text x="18" y="97" class="muted mono" font-size="11">${xml(note)}</text>
    </g>`;
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="640" viewBox="0 0 720 640" role="img" aria-labelledby="title desc">
  <title id="title">GitHub build signal for ${xml(login)}</title>
  <desc id="desc">${number(collection.contributionCalendar.totalContributions)} GitHub contributions, ${number(collection.totalCommitContributions)} commit contributions, ${number(collection.totalPullRequestContributions)} pull requests, and ${number(collection.totalIssueContributions)} issues in the last twelve months.</desc>
  <defs>
    <pattern id="grid" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M28 0H0V28" fill="none" class="grid-line" /></pattern>
    <clipPath id="frame"><rect width="720" height="640" rx="30" /></clipPath>
    <style>${sharedStyle}
      .month { font-size: 8px; letter-spacing: .5px; }
      .scan { --scan-distance: 656px; }
    </style>
  </defs>
  <rect width="720" height="640" rx="30" class="bg" />
  <g clip-path="url(#frame)"><rect width="720" height="640" fill="url(#grid)" opacity=".42" /></g>
  <text x="40" y="42" class="muted mono" font-size="14" font-weight="700" letter-spacing="1.6">FIELD MANUAL 04 / BUILD SIGNAL</text>
  <circle cx="660" cy="38" r="5" class="signal" />
  <line x1="40" y1="64" x2="680" y2="64" class="faint" />
  ${statCards}
  <text x="40" y="365" class="ink mono" font-size="15" font-weight="700" letter-spacing="1.2">CONTRIBUTION MAP / 12 MONTHS</text>
  <text x="680" y="391" text-anchor="end" class="muted mono" font-size="11">${dateLabel(firstDate)} — ${dateLabel(lastDate)}</text>
  <g transform="translate(0 412)">${monthMarkers(9, 3, 40)}</g>
  ${heatmap({ cell: 9, gap: 3, startX: 40, startY: 430, radius: 2 })}
  <rect x="40" y="426" width="9" height="92" rx="4" class="signal scan" opacity="0" />
  <g transform="translate(40 545)"><text x="0" y="0" class="muted mono" font-size="11">LESS</text><rect x="42" y="-10" width="12" height="12" rx="3" class="level-0" /><rect x="60" y="-10" width="12" height="12" rx="3" class="level-1" /><rect x="78" y="-10" width="12" height="12" rx="3" class="level-2" /><rect x="96" y="-10" width="12" height="12" rx="3" class="level-3" /><rect x="114" y="-10" width="12" height="12" rx="3" class="level-4" /><text x="134" y="0" class="muted mono" font-size="11">MORE</text></g>
  <text x="40" y="586" class="muted mono" font-size="11">GITHUB ACTIVITY · PUBLIC + PRIVATE-COUNT SIGNALS</text>
  <text x="40" y="611" class="muted mono" font-size="11">REFRESHED ${dateLabel(refreshed)}</text>
  <rect x="1" y="1" width="718" height="638" rx="29" fill="none" class="faint" />
</svg>\n`;
}

mkdirSync("assets", { recursive: true });
writeFileSync("assets/activity.svg", desktopSvg());
writeFileSync("assets/activity-mobile.svg", mobileSvg());

console.log(`Rendered activity assets for ${login}: ${collection.contributionCalendar.totalContributions} contributions through ${lastDate}.`);
