import puppeteer from "puppeteer";
import type { Battlecard, Tenant, ProductBattlecard } from "@shared/schema";
import * as fs from "fs";
import * as path from "path";

function getSynozurLogoBase64(): string {
  try {
    const logoPath = path.join(process.cwd(), "client/public/brand/synozur-horizontal.png");
    if (fs.existsSync(logoPath)) {
      const logoBuffer = fs.readFileSync(logoPath);
      return `data:image/png;base64,${logoBuffer.toString("base64")}`;
    }
  } catch (e) {
    console.error("Failed to load Synozur logo:", e);
  }
  return "";
}

function getFontBase64(fontFile: string): string {
  try {
    const fontPath = path.join(process.cwd(), "client/public/fonts", fontFile);
    if (fs.existsSync(fontPath)) {
      const fontBuffer = fs.readFileSync(fontPath);
      return `data:font/truetype;base64,${fontBuffer.toString("base64")}`;
    }
  } catch (e) {
    console.error(`Failed to load font ${fontFile}:`, e);
  }
  return "";
}

function getFontFacesCss(): string {
  const regularFont = getFontBase64("AvenirNextLTPro-Regular.ttf");
  const mediumFont = getFontBase64("AvenirNextLTPro-Medium.ttf");
  const boldFont = getFontBase64("AvenirNextLTPro-Bold.ttf");
  const lightFont = getFontBase64("AvenirNextLTPro-Light.ttf");
  
  return `
    @font-face {
      font-family: 'Avenir Next LT Pro';
      src: url('${regularFont}') format('truetype');
      font-weight: 400;
      font-style: normal;
    }
    @font-face {
      font-family: 'Avenir Next LT Pro';
      src: url('${mediumFont}') format('truetype');
      font-weight: 500;
      font-style: normal;
    }
    @font-face {
      font-family: 'Avenir Next LT Pro';
      src: url('${boldFont}') format('truetype');
      font-weight: 600;
      font-style: normal;
    }
    @font-face {
      font-family: 'Avenir Next LT Pro';
      src: url('${boldFont}') format('truetype');
      font-weight: 700;
      font-style: normal;
    }
    @font-face {
      font-family: 'Avenir Next LT Pro';
      src: url('${lightFont}') format('truetype');
      font-weight: 300;
      font-style: normal;
    }
  `;
}

interface ComparisonItem {
  category: string;
  us: string;
  them: string;
  notes?: string;
}

interface ObjectionItem {
  objection: string;
  response: string;
}

interface TalkTrack {
  scenario: string;
  script: string;
}

function harveyBallSvg(value: string): string {
  const fills: Record<string, string> = {
    full: '<circle cx="8" cy="8" r="6" fill="#810FFB"/>',
    "three-quarter": '<circle cx="8" cy="8" r="6" fill="none" stroke="#810FFB" stroke-width="2"/><path d="M8 2 A6 6 0 1 1 2 8 L8 8 Z" fill="#810FFB"/>',
    half: '<circle cx="8" cy="8" r="6" fill="none" stroke="#810FFB" stroke-width="2"/><path d="M8 2 A6 6 0 0 1 8 14 L8 8 Z" fill="#810FFB"/>',
    quarter: '<circle cx="8" cy="8" r="6" fill="none" stroke="#810FFB" stroke-width="2"/><path d="M8 2 A6 6 0 0 1 14 8 L8 8 Z" fill="#810FFB"/>',
    empty: '<circle cx="8" cy="8" r="6" fill="none" stroke="#810FFB" stroke-width="2"/>',
  };
  return `<svg width="16" height="16" viewBox="0 0 16 16">${fills[value] || fills.empty}</svg>`;
}

const ORBIT_FOOTER = 'Orbit orbit.synozur.com • Published by The Synozur Alliance LLC www.synozur.com © 2026 All Rights Reserved.';

function generateBattlecardHtml(
  battlecard: Battlecard,
  competitorName: string,
  companyName: string,
  tenant?: Tenant | null,
  generatedAt?: Date | string | null
): string {
  const bc = battlecard as any;
  const primaryColor = tenant?.primaryColor || "#810FFB";
  const secondaryColor = tenant?.secondaryColor || "#E60CB3";
  const tenantLogo = tenant?.logoUrl || null;
  const tenantName = tenant?.name || companyName;
  
  const strengths = bc.strengths || [];
  const weaknesses = bc.weaknesses || [];
  const ourAdvantages = bc.ourAdvantages || [];
  const comparison = (bc.comparison || []) as ComparisonItem[];
  const objections = (bc.objections || []) as ObjectionItem[];
  const talkTracks = (bc.talkTracks || []) as TalkTrack[];
  const quickStats = bc.quickStats || {};
  
  const synozurLogo = getSynozurLogoBase64();
  const fontFaces = getFontFacesCss();

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    ${fontFaces}
    @page { margin: 0.75in; size: letter; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: 'Avenir Next LT Pro', -apple-system, BlinkMacSystemFont, sans-serif; 
      font-size: 11pt; 
      line-height: 1.5;
      color: #1a1a2e;
      background: white;
    }
    .doc-title {
      text-align: center;
      font-size: 10pt;
      font-weight: 600;
      letter-spacing: 3px;
      text-transform: uppercase;
      color: ${primaryColor};
      padding: 12px 0;
      margin: -0.75in -0.75in 0 -0.75in;
      border-bottom: 1px solid #e5e7eb;
    }
    .header {
      background: linear-gradient(135deg, ${primaryColor}, ${secondaryColor});
      color: white;
      padding: 24px 32px;
      margin: 0 -0.75in 24px -0.75in;
      display: flex;
      align-items: center;
      gap: 20px;
    }
    .header-logo {
      width: 48px;
      height: 48px;
      background: white;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .header-logo img {
      max-width: 40px;
      max-height: 40px;
      object-fit: contain;
    }
    .header-content { flex: 1; }
    .header h1 { font-size: 22pt; font-weight: 600; margin-bottom: 4px; }
    .header .subtitle { font-size: 12pt; opacity: 0.9; }
    .section { margin-bottom: 20px; page-break-inside: avoid; }
    .section-title {
      font-size: 11pt;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: ${primaryColor};
      border-bottom: 2px solid ${primaryColor};
      padding-bottom: 6px;
      margin-bottom: 12px;
    }
    .two-col { display: flex; gap: 24px; }
    .col { flex: 1; }
    .list-item { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 8px; }
    .bullet { color: ${primaryColor}; font-weight: bold; }
    .bullet-red { color: #dc2626; font-weight: bold; }
    .bullet-green { color: #16a34a; font-weight: bold; }
    .comparison-table { width: 100%; border-collapse: collapse; font-size: 10pt; }
    .comparison-table th { 
      background: #f3f4f6; 
      padding: 8px 12px; 
      text-align: left;
      font-weight: 600;
    }
    .comparison-table td { 
      padding: 8px 12px; 
      border-bottom: 1px solid #e5e7eb;
      vertical-align: middle;
    }
    .comparison-table .harvey-cell { text-align: center; width: 60px; }
    .objection-card {
      background: #f9fafb;
      border-left: 3px solid ${primaryColor};
      padding: 12px 16px;
      margin-bottom: 12px;
    }
    .objection-q { font-weight: 600; margin-bottom: 6px; }
    .objection-a { color: #4b5563; }
    .talk-track {
      background: linear-gradient(135deg, rgba(129,15,251,0.05), rgba(230,12,179,0.05));
      border-radius: 8px;
      padding: 12px 16px;
      margin-bottom: 12px;
    }
    .talk-track-scenario { font-weight: 600; margin-bottom: 6px; }
    .talk-track-script { color: #4b5563; font-style: italic; }
    .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .stat-box {
      background: #f3f4f6;
      padding: 12px;
      border-radius: 6px;
    }
    .stat-label { font-size: 9pt; color: #6b7280; text-transform: uppercase; }
    .stat-value { font-weight: 600; }
    .footer {
      margin-top: 24px;
      padding-top: 12px;
      border-top: 1px solid #e5e7eb;
      font-size: 9pt;
      color: #6b7280;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="doc-title">BATTLE CARD</div>
  <div class="header">
    ${tenantLogo ? `
    <div class="header-logo">
      <img src="${tenantLogo}" alt="${tenantName}" />
    </div>
    ` : ''}
    <div class="header-content">
      <h1>${competitorName}</h1>
      <div class="subtitle">Competitive comparison vs ${companyName}</div>
    </div>
  </div>

  ${strengths.length || weaknesses.length ? `
  <div class="section">
    <div class="section-title">Competitor Overview</div>
    <div class="two-col">
      ${strengths.length ? `
      <div class="col">
        <strong style="color: #16a34a;">Their Strengths</strong>
        <div style="margin-top: 8px;">
          ${strengths.map((s: string) => `<div class="list-item"><span class="bullet-green">✓</span> ${s}</div>`).join('')}
        </div>
      </div>
      ` : ''}
      ${weaknesses.length ? `
      <div class="col">
        <strong style="color: #dc2626;">Their Weaknesses</strong>
        <div style="margin-top: 8px;">
          ${weaknesses.map((w: string) => `<div class="list-item"><span class="bullet-red">✗</span> ${w}</div>`).join('')}
        </div>
      </div>
      ` : ''}
    </div>
  </div>
  ` : ''}

  ${ourAdvantages.length ? `
  <div class="section">
    <div class="section-title">Our Advantages</div>
    ${ourAdvantages.map((a: string) => `<div class="list-item"><span class="bullet">★</span> ${a}</div>`).join('')}
  </div>
  ` : ''}

  ${comparison.length ? `
  <div class="section">
    <div class="section-title">Feature Comparison</div>
    <table class="comparison-table">
      <thead>
        <tr>
          <th>Category</th>
          <th class="harvey-cell">${companyName}</th>
          <th class="harvey-cell">${competitorName}</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>
        ${comparison.map((c: ComparisonItem) => `
        <tr>
          <td>${c.category}</td>
          <td class="harvey-cell">${harveyBallSvg(c.us)}</td>
          <td class="harvey-cell">${harveyBallSvg(c.them)}</td>
          <td>${c.notes || ''}</td>
        </tr>
        `).join('')}
      </tbody>
    </table>
  </div>
  ` : ''}

  ${objections.length ? `
  <div class="section">
    <div class="section-title">Objection Handling</div>
    ${objections.map((o: ObjectionItem) => `
    <div class="objection-card">
      <div class="objection-q">"${o.objection}"</div>
      <div class="objection-a">${o.response}</div>
    </div>
    `).join('')}
  </div>
  ` : ''}

  ${talkTracks.length ? `
  <div class="section">
    <div class="section-title">Talk Tracks</div>
    ${talkTracks.map((t: TalkTrack) => `
    <div class="talk-track">
      <div class="talk-track-scenario">${t.scenario}</div>
      <div class="talk-track-script">"${t.script}"</div>
    </div>
    `).join('')}
  </div>
  ` : ''}

  ${Object.keys(quickStats).length ? `
  <div class="section">
    <div class="section-title">Quick Stats</div>
    <div class="stats-grid">
      ${quickStats.pricing ? `<div class="stat-box"><div class="stat-label">Pricing</div><div class="stat-value">${quickStats.pricing}</div></div>` : ''}
      ${quickStats.marketPosition ? `<div class="stat-box"><div class="stat-label">Market Position</div><div class="stat-value">${quickStats.marketPosition}</div></div>` : ''}
      ${quickStats.targetAudience ? `<div class="stat-box"><div class="stat-label">Target Audience</div><div class="stat-value">${quickStats.targetAudience}</div></div>` : ''}
      ${quickStats.keyProducts ? `<div class="stat-box"><div class="stat-label">Key Products</div><div class="stat-value">${quickStats.keyProducts}</div></div>` : ''}
    </div>
  </div>
  ` : ''}

  <div class="footer">
    ${synozurLogo ? `<div style="text-align: center; margin-bottom: 16px;"><img src="${synozurLogo}" alt="Synozur" style="height: 32px; width: auto;" /></div>` : ''}
    ${ORBIT_FOOTER}<br/>
    Generated ${generatedAt ? new Date(generatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} • Confidential
  </div>
</body>
</html>
  `;
}

async function findChromiumPath(): Promise<string | undefined> {
  const possiblePaths = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    "/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  ].filter(Boolean) as string[];
  
  for (const execPath of possiblePaths) {
    try {
      if (fs.existsSync(execPath)) {
        return execPath;
      }
    } catch {
      continue;
    }
  }
  
  // Let Puppeteer try to find it
  return undefined;
}

export async function generateBattlecardPdf(
  battlecard: Battlecard,
  competitorName: string,
  companyName: string,
  tenant?: Tenant | null,
  generatedAt?: Date | string | null
): Promise<Buffer> {
  const html = generateBattlecardHtml(battlecard, competitorName, companyName, tenant, generatedAt);
  
  let browser;
  const startTime = Date.now();
  
  try {
    const executablePath = await findChromiumPath();
    console.log(`[Battlecard PDF] Starting generation for ${competitorName}, chromium path: ${executablePath || 'auto-detect'}`);
    
    browser = await puppeteer.launch({
      headless: true,
      executablePath,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--single-process",
        "--no-zygote",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-sync",
        "--disable-translate",
        "--hide-scrollbars",
        "--mute-audio",
      ],
      timeout: 30000,
    });
    
    console.log(`[Battlecard PDF] Browser launched in ${Date.now() - startTime}ms`);
    
    const page = await browser.newPage();
    
    // Set smaller viewport for faster rendering
    await page.setViewport({ width: 800, height: 600 });
    
    await page.setContent(html, { 
      waitUntil: "domcontentloaded",
      timeout: 15000
    });
    
    console.log(`[Battlecard PDF] Content loaded in ${Date.now() - startTime}ms`);
    
    // Shorter wait for fonts to load
    await new Promise(resolve => setTimeout(resolve, 200));
    
    const pdfBuffer = await page.pdf({
      format: "Letter",
      printBackground: true,
      margin: { top: "0", bottom: "0", left: "0", right: "0" },
      timeout: 30000,
    });
    
    console.log(`[Battlecard PDF] PDF generated in ${Date.now() - startTime}ms, size: ${Math.round(pdfBuffer.length / 1024)}KB`);
    
    return Buffer.from(pdfBuffer);
  } catch (error) {
    console.error(`[Battlecard PDF] Generation failed after ${Date.now() - startTime}ms:`, error);
    throw error;
  } finally {
    if (browser) {
      await browser.close().catch(e => console.error("[Battlecard PDF] Failed to close browser:", e));
    }
  }
}

export function generateBattlecardText(
  battlecard: Battlecard,
  competitorName: string,
  companyName: string
): string {
  const bc = battlecard as any;
  const strengths = bc.strengths || [];
  const weaknesses = bc.weaknesses || [];
  const ourAdvantages = bc.ourAdvantages || [];
  const comparison = (bc.comparison || []) as ComparisonItem[];
  const objections = (bc.objections || []) as ObjectionItem[];
  const talkTracks = (bc.talkTracks || []) as TalkTrack[];
  const quickStats = bc.quickStats || {};

  let content = `${competitorName} Battle Card
Competitive comparison vs ${companyName}
Generated: ${new Date().toLocaleDateString()}

`;

  if (strengths.length || weaknesses.length) {
    content += `COMPETITOR OVERVIEW
==================

`;
    if (strengths.length) {
      content += `Their Strengths:
${strengths.map((s: string) => `  • ${s}`).join('\n')}

`;
    }
    if (weaknesses.length) {
      content += `Their Weaknesses:
${weaknesses.map((w: string) => `  • ${w}`).join('\n')}

`;
    }
  }

  if (ourAdvantages.length) {
    content += `OUR ADVANTAGES
==============
${ourAdvantages.map((a: string) => `  ★ ${a}`).join('\n')}

`;
  }

  if (comparison.length) {
    content += `FEATURE COMPARISON
==================
`;
    comparison.forEach((c: ComparisonItem) => {
      content += `${c.category}:
  - ${companyName}: ${c.us}
  - ${competitorName}: ${c.them}
  ${c.notes ? `  Notes: ${c.notes}` : ''}

`;
    });
  }

  if (objections.length) {
    content += `OBJECTION HANDLING
==================
`;
    objections.forEach((o: ObjectionItem, i: number) => {
      content += `${i + 1}. "${o.objection}"
   Response: ${o.response}

`;
    });
  }

  if (talkTracks.length) {
    content += `TALK TRACKS
===========
`;
    talkTracks.forEach((t: TalkTrack, i: number) => {
      content += `${i + 1}. ${t.scenario}
   "${t.script}"

`;
    });
  }

  if (Object.keys(quickStats).length) {
    content += `QUICK STATS
===========
`;
    if (quickStats.pricing) content += `Pricing: ${quickStats.pricing}\n`;
    if (quickStats.marketPosition) content += `Market Position: ${quickStats.marketPosition}\n`;
    if (quickStats.targetAudience) content += `Target Audience: ${quickStats.targetAudience}\n`;
    if (quickStats.keyProducts) content += `Key Products: ${quickStats.keyProducts}\n`;
  }

  content += `
---
Generated by Orbit • Confidential
`;

  return content;
}

export function formatBattlecardForClipboard(
  battlecard: Battlecard,
  competitorName: string,
  companyName: string
): string {
  const bc = battlecard as any;
  const strengths = bc.strengths || [];
  const weaknesses = bc.weaknesses || [];
  const ourAdvantages = bc.ourAdvantages || [];
  const comparison = (bc.comparison || []) as ComparisonItem[];
  const objections = (bc.objections || []) as ObjectionItem[];
  const talkTracks = (bc.talkTracks || []) as TalkTrack[];
  const quickStats = bc.quickStats || {};

  let text = `🎯 ${competitorName} Battle Card\nvs ${companyName}\n\n`;

  if (strengths.length) {
    text += `✅ THEIR STRENGTHS\n${strengths.map((s: string) => `• ${s}`).join('\n')}\n\n`;
  }

  if (weaknesses.length) {
    text += `❌ THEIR WEAKNESSES\n${weaknesses.map((w: string) => `• ${w}`).join('\n')}\n\n`;
  }

  if (ourAdvantages.length) {
    text += `⭐ OUR ADVANTAGES\n${ourAdvantages.map((a: string) => `• ${a}`).join('\n')}\n\n`;
  }

  if (comparison.length) {
    text += `📊 FEATURE COMPARISON\n`;
    comparison.forEach((c: ComparisonItem) => {
      text += `• ${c.category}: Us (${c.us}) vs Them (${c.them})${c.notes ? ` - ${c.notes}` : ''}\n`;
    });
    text += '\n';
  }

  if (objections.length) {
    text += `💬 OBJECTION HANDLING\n`;
    objections.forEach((o: ObjectionItem) => {
      text += `Q: "${o.objection}"\nA: ${o.response}\n\n`;
    });
  }

  if (talkTracks.length) {
    text += `🎤 TALK TRACKS\n`;
    talkTracks.forEach((t: TalkTrack) => {
      text += `Scenario: ${t.scenario}\nScript: "${t.script}"\n\n`;
    });
  }

  if (Object.keys(quickStats).length) {
    text += `📈 QUICK STATS\n`;
    if (quickStats.pricing) text += `• Pricing: ${quickStats.pricing}\n`;
    if (quickStats.marketPosition) text += `• Position: ${quickStats.marketPosition}\n`;
    if (quickStats.targetAudience) text += `• Target: ${quickStats.targetAudience}\n`;
    if (quickStats.keyProducts) text += `• Products: ${quickStats.keyProducts}\n`;
  }

  return text;
}

// Product Battlecard export functions
interface KeyDifferentiator {
  feature: string;
  ours: string;
  theirs: string;
}

function generateProductBattlecardHtml(
  battlecard: ProductBattlecard,
  competitorName: string,
  baselineName: string,
  tenant?: Tenant | null
): string {
  const bc = battlecard as any;
  const primaryColor = tenant?.primaryColor || "#810FFB";
  const secondaryColor = tenant?.secondaryColor || "#E60CB3";
  const tenantLogo = tenant?.logoUrl || null;
  const tenantName = tenant?.name || baselineName;
  
  const strengths = bc.strengths || [];
  const weaknesses = bc.weaknesses || [];
  const ourAdvantages = bc.ourAdvantages || [];
  const keyDifferentiators = (bc.keyDifferentiators || []) as KeyDifferentiator[];
  const objections = (bc.objections || []) as ObjectionItem[];
  const talkTracks = (bc.talkTracks || []) as TalkTrack[];
  
  const synozurLogo = getSynozurLogoBase64();
  const fontFaces = getFontFacesCss();

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    ${fontFaces}
    @page { margin: 0.75in; size: letter; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: 'Avenir Next LT Pro', -apple-system, BlinkMacSystemFont, sans-serif; 
      font-size: 11pt; 
      line-height: 1.5;
      color: #1a1a2e;
      background: white;
    }
    .doc-title {
      text-align: center;
      font-size: 10pt;
      font-weight: 600;
      letter-spacing: 3px;
      text-transform: uppercase;
      color: ${primaryColor};
      padding: 12px 0;
      margin: -0.75in -0.75in 0 -0.75in;
      border-bottom: 1px solid #e5e7eb;
    }
    .header {
      background: linear-gradient(135deg, ${primaryColor}, ${secondaryColor});
      color: white;
      padding: 24px 32px;
      margin: 0 -0.75in 24px -0.75in;
      display: flex;
      align-items: center;
      gap: 20px;
    }
    .header-logo {
      width: 48px;
      height: 48px;
      background: white;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .header-logo img {
      max-width: 40px;
      max-height: 40px;
      object-fit: contain;
    }
    .header-content { flex: 1; }
    .header h1 { font-size: 22pt; font-weight: 600; margin-bottom: 4px; }
    .header .subtitle { font-size: 12pt; opacity: 0.9; }
    .section { margin-bottom: 20px; page-break-inside: avoid; }
    .section-title {
      font-size: 11pt;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: ${primaryColor};
      border-bottom: 2px solid ${primaryColor};
      padding-bottom: 6px;
      margin-bottom: 12px;
    }
    .two-col { display: flex; gap: 24px; }
    .col { flex: 1; }
    .list-item { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 8px; }
    .bullet { color: ${primaryColor}; font-weight: bold; }
    .bullet-red { color: #dc2626; font-weight: bold; }
    .bullet-green { color: #16a34a; font-weight: bold; }
    .comparison-table { width: 100%; border-collapse: collapse; font-size: 10pt; }
    .comparison-table th { 
      background: #f3f4f6; 
      padding: 8px 12px; 
      text-align: left;
      font-weight: 600;
    }
    .comparison-table td { 
      padding: 8px 12px; 
      border-bottom: 1px solid #e5e7eb;
      vertical-align: middle;
    }
    .objection-card {
      background: #f9fafb;
      border-left: 3px solid ${primaryColor};
      padding: 12px 16px;
      margin-bottom: 12px;
    }
    .objection-q { font-weight: 600; margin-bottom: 6px; }
    .objection-a { color: #4b5563; }
    .talk-track {
      background: linear-gradient(135deg, rgba(129,15,251,0.05), rgba(230,12,179,0.05));
      border-radius: 8px;
      padding: 12px 16px;
      margin-bottom: 12px;
    }
    .talk-track-scenario { font-weight: 600; margin-bottom: 6px; }
    .talk-track-script { color: #4b5563; font-style: italic; }
    .footer {
      margin-top: 32px;
      padding-top: 16px;
      border-top: 1px solid #e5e7eb;
      font-size: 9pt;
      color: #6b7280;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="doc-title">PRODUCT BATTLE CARD</div>
  <div class="header">
    ${tenantLogo ? `
    <div class="header-logo">
      <img src="${tenantLogo}" alt="${tenantName}" />
    </div>
    ` : ''}
    <div class="header-content">
      <h1>${competitorName}</h1>
      <div class="subtitle">vs ${baselineName} • Product Comparison</div>
    </div>
  </div>

  <div class="two-col">
    <div class="col">
      <div class="section">
        <div class="section-title">Their Strengths</div>
        ${strengths.map((s: string) => `<div class="list-item"><span class="bullet-green">●</span><span>${s}</span></div>`).join('')}
      </div>
    </div>
    <div class="col">
      <div class="section">
        <div class="section-title">Their Weaknesses</div>
        ${weaknesses.map((w: string) => `<div class="list-item"><span class="bullet-red">●</span><span>${w}</span></div>`).join('')}
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Our Advantages</div>
    ${ourAdvantages.map((a: string) => `<div class="list-item"><span class="bullet">★</span><span>${a}</span></div>`).join('')}
  </div>

  ${keyDifferentiators.length ? `
  <div class="section">
    <div class="section-title">Key Differentiators</div>
    <table class="comparison-table">
      <thead>
        <tr>
          <th>Feature</th>
          <th>Us (${baselineName})</th>
          <th>Them (${competitorName})</th>
        </tr>
      </thead>
      <tbody>
        ${keyDifferentiators.map((d: KeyDifferentiator) => `
          <tr>
            <td><strong>${d.feature}</strong></td>
            <td>${d.ours}</td>
            <td>${d.theirs}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>
  ` : ''}

  ${objections.length ? `
  <div class="section">
    <div class="section-title">Objection Handling</div>
    ${objections.map((o: ObjectionItem) => `
      <div class="objection-card">
        <div class="objection-q">"${o.objection}"</div>
        <div class="objection-a">→ ${o.response}</div>
      </div>
    `).join('')}
  </div>
  ` : ''}

  ${talkTracks.length ? `
  <div class="section">
    <div class="section-title">Sales Talk Tracks</div>
    ${talkTracks.map((t: TalkTrack) => `
      <div class="talk-track">
        <div class="talk-track-scenario">${t.scenario}</div>
        <div class="talk-track-script">"${t.script}"</div>
      </div>
    `).join('')}
  </div>
  ` : ''}

  <div class="footer">
    ${synozurLogo ? `<div style="text-align: center; margin-bottom: 16px;"><img src="${synozurLogo}" alt="Synozur" style="height: 32px; width: auto;" /></div>` : ''}
    ${ORBIT_FOOTER}<br/>
    Generated ${new Date().toLocaleDateString()} • Confidential
  </div>
</body>
</html>
`;
}

export async function generateProductBattlecardPdf(
  battlecard: ProductBattlecard,
  competitorName: string,
  baselineName: string,
  tenant?: Tenant | null
): Promise<Buffer> {
  const html = generateProductBattlecardHtml(battlecard, competitorName, baselineName, tenant);
  
  let browser;
  const startTime = Date.now();
  
  try {
    const executablePath = await findChromiumPath();
    console.log(`[Product Battlecard PDF] Starting generation for ${competitorName}, chromium path: ${executablePath || 'auto-detect'}`);
    
    browser = await puppeteer.launch({
      headless: true,
      executablePath,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--single-process",
        "--no-zygote",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-sync",
        "--disable-translate",
        "--hide-scrollbars",
        "--mute-audio",
      ],
      timeout: 30000,
    });
    
    console.log(`[Product Battlecard PDF] Browser launched in ${Date.now() - startTime}ms`);
    
    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 600 });
    
    await page.setContent(html, { 
      waitUntil: "domcontentloaded",
      timeout: 15000
    });
    
    console.log(`[Product Battlecard PDF] Content loaded in ${Date.now() - startTime}ms`);
    
    await new Promise(resolve => setTimeout(resolve, 200));
    
    const pdfBuffer = await page.pdf({
      format: "Letter",
      printBackground: true,
      margin: { top: "0", bottom: "0", left: "0", right: "0" },
      timeout: 30000,
    });
    
    console.log(`[Product Battlecard PDF] PDF generated in ${Date.now() - startTime}ms, size: ${Math.round(pdfBuffer.length / 1024)}KB`);
    
    return Buffer.from(pdfBuffer);
  } catch (error) {
    console.error(`[Product Battlecard PDF] Generation failed after ${Date.now() - startTime}ms:`, error);
    throw error;
  } finally {
    if (browser) {
      await browser.close().catch(e => console.error("[Product Battlecard PDF] Failed to close browser:", e));
    }
  }
}

export function generateProductBattlecardText(
  battlecard: ProductBattlecard,
  competitorName: string,
  baselineName: string
): string {
  const bc = battlecard as any;
  const strengths = bc.strengths || [];
  const weaknesses = bc.weaknesses || [];
  const ourAdvantages = bc.ourAdvantages || [];
  const keyDifferentiators = (bc.keyDifferentiators || []) as KeyDifferentiator[];
  const objections = (bc.objections || []) as ObjectionItem[];
  const talkTracks = (bc.talkTracks || []) as TalkTrack[];

  let content = `${competitorName.toUpperCase()} BATTLE CARD
vs ${baselineName}
${'='.repeat(50)}
Generated: ${new Date().toLocaleDateString()}

`;

  if (strengths.length) {
    content += `THEIR STRENGTHS
===============
${strengths.map((s: string, i: number) => `${i + 1}. ${s}`).join('\n')}

`;
  }

  if (weaknesses.length) {
    content += `THEIR WEAKNESSES
================
${weaknesses.map((w: string, i: number) => `${i + 1}. ${w}`).join('\n')}

`;
  }

  if (ourAdvantages.length) {
    content += `OUR ADVANTAGES
==============
${ourAdvantages.map((a: string, i: number) => `${i + 1}. ${a}`).join('\n')}

`;
  }

  if (keyDifferentiators.length) {
    content += `KEY DIFFERENTIATORS
===================
`;
    keyDifferentiators.forEach((d: KeyDifferentiator, i: number) => {
      content += `${i + 1}. ${d.feature}
   Us: ${d.ours}
   Them: ${d.theirs}

`;
    });
  }

  if (objections.length) {
    content += `OBJECTION HANDLING
==================
`;
    objections.forEach((o: ObjectionItem, i: number) => {
      content += `${i + 1}. Objection: "${o.objection}"
   Response: ${o.response}

`;
    });
  }

  if (talkTracks.length) {
    content += `TALK TRACKS
===========
`;
    talkTracks.forEach((t: TalkTrack, i: number) => {
      content += `${i + 1}. ${t.scenario}
   "${t.script}"

`;
    });
  }

  content += `
---
Generated by Orbit • Confidential
`;

  return content;
}
