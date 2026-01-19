import puppeteer from "puppeteer";
import { storage } from "../storage";
import type { Competitor, CompanyProfile, Report, Battlecard } from "@shared/schema";
import { format } from "date-fns";
import { calculateScores } from "./scoring-service";
import * as fs from "fs";
import * as path from "path";

interface CompetitorWithAnalysis extends Competitor {
  scores?: {
    overallScore: number;
    innovationScore: number;
    marketPresenceScore: number;
  };
  socialSummary?: string;
  webUpdateSummary?: string;
}

interface ProjectSummary {
  id: string;
  name: string;
  clientName?: string;
  status: string;
  productCount: number;
}

interface ReportData {
  companyProfile: CompanyProfile | null;
  companyName: string;
  competitors: CompetitorWithAnalysis[];
  analysis: {
    themes: any[];
    messaging: any[];
    gaps: any[];
  } | null;
  recommendations: any[];
  battlecards: Array<{ competitorName: string; battlecard: Battlecard }>;
  projects: ProjectSummary[];
  generatedAt: Date;
  tenantDomain: string;
  marketName?: string;
  reportName: string;
  author: string;
  scope: "baseline" | "project";
  projectName?: string;
  gtmPlan?: string | null;
  messagingFramework?: string | null;
}

function escapeHtml(text: string): string {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

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

function getOrbitMarkBase64(): string {
  try {
    const markPath = path.join(process.cwd(), "client/public/brand/synozur-mark.png");
    if (fs.existsSync(markPath)) {
      const markBuffer = fs.readFileSync(markPath);
      return `data:image/png;base64,${markBuffer.toString("base64")}`;
    }
  } catch (e) {
    console.error("Failed to load Orbit mark:", e);
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

function generateReportHtml(data: ReportData): string {
  const formattedDate = format(data.generatedAt, "MMMM d, yyyy");
  const scopeLabel = data.scope === "project" && data.projectName 
    ? `Project: ${escapeHtml(data.projectName)}` 
    : data.marketName ? `Market: ${escapeHtml(data.marketName)}` : "Baseline Analysis";

  const synozurLogo = getSynozurLogoBase64();
  const orbitMark = getOrbitMarkBase64();

  const competitorRows = data.competitors.map(c => {
    const analysisInfo = c.analysisData as { summary?: string; valueProposition?: string } | null;
    const summary = analysisInfo?.summary || analysisInfo?.valueProposition || "No analysis yet";
    const scoreInfo = c.scores ? `<div style="font-size: 11px; color: #818CF8; margin-top: 4px;">Score: ${c.scores.overallScore.toFixed(0)}/100</div>` : "";
    return `
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #374151;">
        <div style="display: flex; align-items: center; gap: 10px;">
          ${c.faviconUrl ? `<img src="${escapeHtml(c.faviconUrl)}" alt="" style="width: 32px; height: 32px; border-radius: 4px; object-fit: contain;">` : '<div style="width: 32px; height: 32px; background: #374151; border-radius: 4px;"></div>'}
          <div>
            <div style="font-weight: 600; color: #F9FAFB;">${escapeHtml(c.name)}</div>
            <div style="font-size: 12px; color: #9CA3AF;">${escapeHtml(c.url || "")}</div>
            ${scoreInfo}
          </div>
        </div>
      </td>
      <td style="padding: 12px; border-bottom: 1px solid #374151; color: #D1D5DB; max-width: 300px; font-size: 13px;">${escapeHtml(summary.slice(0, 200))}${summary.length > 200 ? "..." : ""}</td>
      <td style="padding: 12px; border-bottom: 1px solid #374151;">
        <span style="background: ${c.status === "Active" ? "#065F46" : "#374151"}; color: ${c.status === "Active" ? "#34D399" : "#9CA3AF"}; padding: 4px 8px; border-radius: 4px; font-size: 12px;">${escapeHtml(c.status)}</span>
      </td>
    </tr>
  `;
  }).join("");

  const themeCards = (data.analysis?.themes || []).map((theme: any) => {
    const themeName = theme.theme || theme.name || theme.title || "Theme";
    const themeDesc = theme.description || theme.details || theme.us || theme.observation || "";
    if (!themeDesc && !themeName) return "";
    return `
    <div style="background: #1F2937; border-radius: 8px; padding: 16px; margin-bottom: 12px;">
      <div style="font-weight: 600; color: #F9FAFB; margin-bottom: 8px;">${escapeHtml(themeName)}</div>
      ${themeDesc ? `<div style="color: #D1D5DB; font-size: 14px;">${escapeHtml(themeDesc)}</div>` : ""}
    </div>
  `;
  }).filter(Boolean).join("");

  const messagingCards = (data.analysis?.messaging || []).map((msg: any) => {
    const msgName = msg.category || msg.competitor || msg.name || "Messaging";
    const ourMsg = msg.us || msg.ourMessage || "";
    const compMsg = msg.competitorA || msg.keyMessage || msg.message || msg.description || "";
    if (!ourMsg && !compMsg) return "";
    return `
    <div style="background: #1F2937; border-radius: 8px; padding: 16px; margin-bottom: 12px;">
      <div style="font-weight: 600; color: #F9FAFB; margin-bottom: 8px;">${escapeHtml(msgName)}</div>
      ${ourMsg ? `<div style="color: #34D399; font-size: 13px; margin-bottom: 6px;"><strong>Our Position:</strong> ${escapeHtml(ourMsg)}</div>` : ""}
      ${compMsg ? `<div style="color: #D1D5DB; font-size: 14px;"><strong>Competitor:</strong> ${escapeHtml(compMsg)}</div>` : ""}
    </div>
  `;
  }).filter(Boolean).join("");

  const gapCards = (data.analysis?.gaps || []).map((gap: any) => {
    const gapArea = gap.area || gap.title || gap.name || "Gap Identified";
    const gapDesc = gap.observation || gap.description || gap.details || gap.summary || "";
    const gapOpp = gap.opportunity || gap.recommendation || "";
    const gapImpact = gap.impact || "";
    if (!gapDesc && !gapArea) return "";
    return `
    <div style="background: #1F2937; border-radius: 8px; padding: 16px; margin-bottom: 12px; border-left: 3px solid #FB923C;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start;">
        <div style="font-weight: 600; color: #F9FAFB; margin-bottom: 8px;">${escapeHtml(gapArea)}</div>
        ${gapImpact ? `<span style="background: ${gapImpact === "High" ? "#7C3AED" : gapImpact === "Medium" ? "#2563EB" : "#374151"}; color: white; padding: 2px 8px; border-radius: 4px; font-size: 11px;">${escapeHtml(gapImpact)}</span>` : ""}
      </div>
      ${gapDesc ? `<div style="color: #D1D5DB; font-size: 14px;">${escapeHtml(gapDesc)}</div>` : ""}
      ${gapOpp ? `<div style="color: #34D399; font-size: 13px; margin-top: 8px;"><strong>Opportunity:</strong> ${escapeHtml(gapOpp)}</div>` : ""}
    </div>
  `;
  }).filter(Boolean).join("");

  const recommendationCards = data.recommendations.map((rec: any) => `
    <div style="background: #1F2937; border-radius: 8px; padding: 16px; margin-bottom: 12px;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
        <div style="font-weight: 600; color: #F9FAFB;">${escapeHtml(rec.title)}</div>
        <span style="background: ${rec.impact === "High" ? "#7C3AED" : rec.impact === "Medium" ? "#2563EB" : "#374151"}; color: white; padding: 2px 8px; border-radius: 4px; font-size: 11px;">${escapeHtml(rec.impact)} Impact</span>
      </div>
      <div style="color: #D1D5DB; font-size: 14px;">${escapeHtml(rec.description)}</div>
      <div style="color: #9CA3AF; font-size: 12px; margin-top: 8px;">Area: ${escapeHtml(rec.area)}</div>
    </div>
  `).join("");

  const socialWebCards = data.competitors.filter(c => c.socialSummary || c.webUpdateSummary).map(c => `
    <div style="background: #1F2937; border-radius: 8px; padding: 16px; margin-bottom: 12px;">
      <div style="font-weight: 600; color: #F9FAFB; margin-bottom: 8px;">${escapeHtml(c.name)}</div>
      ${c.socialSummary ? `<div style="color: #D1D5DB; font-size: 13px; margin-bottom: 8px;"><strong style="color: #818CF8;">Social:</strong> ${escapeHtml(c.socialSummary)}</div>` : ""}
      ${c.webUpdateSummary ? `<div style="color: #D1D5DB; font-size: 13px;"><strong style="color: #818CF8;">Web Updates:</strong> ${escapeHtml(c.webUpdateSummary)}</div>` : ""}
    </div>
  `).join("");

  const battlecardCards = data.battlecards.map(({ competitorName, battlecard }) => {
    const strengths = Array.isArray(battlecard.strengths) ? battlecard.strengths.slice(0, 3) : [];
    const weaknesses = Array.isArray(battlecard.weaknesses) ? battlecard.weaknesses.slice(0, 3) : [];
    const advantages = Array.isArray(battlecard.ourAdvantages) ? battlecard.ourAdvantages.slice(0, 3) : [];
    return `
    <div style="background: #1F2937; border-radius: 8px; padding: 20px; margin-bottom: 16px; page-break-inside: avoid;">
      <div style="font-weight: 700; color: #F9FAFB; font-size: 18px; margin-bottom: 16px; border-bottom: 1px solid #374151; padding-bottom: 8px;">${escapeHtml(competitorName)}</div>
      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px;">
        <div>
          <div style="font-weight: 600; color: #EF4444; font-size: 12px; margin-bottom: 8px;">THEIR STRENGTHS</div>
          ${strengths.map(s => `<div style="color: #D1D5DB; font-size: 13px; margin-bottom: 4px;">• ${escapeHtml(String(s))}</div>`).join("")}
        </div>
        <div>
          <div style="font-weight: 600; color: #F59E0B; font-size: 12px; margin-bottom: 8px;">THEIR WEAKNESSES</div>
          ${weaknesses.map(w => `<div style="color: #D1D5DB; font-size: 13px; margin-bottom: 4px;">• ${escapeHtml(String(w))}</div>`).join("")}
        </div>
        <div>
          <div style="font-weight: 600; color: #10B981; font-size: 12px; margin-bottom: 8px;">OUR ADVANTAGES</div>
          ${advantages.map(a => `<div style="color: #D1D5DB; font-size: 13px; margin-bottom: 4px;">• ${escapeHtml(String(a))}</div>`).join("")}
        </div>
      </div>
    </div>
  `;
  }).join("");

  const projectCards = data.projects.map(p => `
    <div style="background: #1F2937; border-radius: 8px; padding: 16px; margin-bottom: 12px;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <div style="font-weight: 600; color: #F9FAFB;">${escapeHtml(p.name)}</div>
          ${p.clientName ? `<div style="font-size: 12px; color: #9CA3AF;">Client: ${escapeHtml(p.clientName)}</div>` : ""}
        </div>
        <div style="text-align: right;">
          <span style="background: ${p.status === "active" ? "#065F46" : "#374151"}; color: ${p.status === "active" ? "#34D399" : "#9CA3AF"}; padding: 4px 8px; border-radius: 4px; font-size: 11px;">${escapeHtml(p.status)}</span>
          <div style="font-size: 11px; color: #9CA3AF; margin-top: 4px;">${p.productCount} products</div>
        </div>
      </div>
    </div>
  `).join("");

  const ORBIT_FOOTER = `
    <div style="text-align: center; padding: 12px 0; border-top: 1px solid #374151; margin-top: 40px; font-size: 10px; color: #6B7280;">
      <div style="margin-bottom: 4px;">Orbit • orbit.synozur.com</div>
      <div>Published by The Synozur Alliance LLC • www.synozur.com • © 2026 All Rights Reserved</div>
      <div style="margin-top: 4px;">Confidential - ${escapeHtml(data.tenantDomain)} | Generated ${formattedDate}</div>
    </div>
  `;

  const headerLogo = orbitMark 
    ? `<div style="display: flex; align-items: center; gap: 8px;"><img src="${orbitMark}" alt="Orbit" style="height: 28px; width: auto;"><span style="font-size: 24px; font-weight: 700; color: #F9FAFB;">Orbit</span></div>`
    : `<div class="logo"><span>Orbit</span></div>`;

  const coverLogo = synozurLogo
    ? `<img src="${synozurLogo}" alt="Synozur" style="height: 40px; width: auto; margin-bottom: 24px;">`
    : "";

  const fontFaces = getFontFacesCss();
  
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    ${fontFaces}
    @page {
      size: A4;
      margin: 20mm 15mm 30mm 15mm;
    }
    * {
      box-sizing: border-box;
    }
    body {
      font-family: 'Avenir Next LT Pro', 'Avenir Next', 'Avenir', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #111827;
      color: #F9FAFB;
      margin: 0;
      padding: 0;
      line-height: 1.6;
      font-size: 14px;
    }
    .page-break {
      page-break-after: always;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 20px;
      border-bottom: 2px solid #374151;
      margin-bottom: 28px;
    }
    .logo {
      font-size: 24px;
      font-weight: 700;
      color: #818CF8;
    }
    .logo span {
      color: #F9FAFB;
    }
    .report-meta {
      text-align: right;
      color: #9CA3AF;
      font-size: 13px;
    }
    .section {
      margin-bottom: 32px;
    }
    .section-title {
      font-size: 18px;
      font-weight: 600;
      color: #818CF8;
      margin-bottom: 14px;
      padding-bottom: 6px;
      border-bottom: 1px solid #374151;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 16px;
    }
    th {
      background: #374151;
      color: #F9FAFB;
      padding: 10px;
      text-align: left;
      font-weight: 600;
      font-size: 13px;
    }
    .cover-page {
      min-height: 90vh;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      text-align: center;
      padding: 40px 20px;
    }
    .cover-title {
      font-size: 42px;
      font-weight: 700;
      margin-bottom: 12px;
      color: #F9FAFB;
    }
    .cover-subtitle {
      font-size: 22px;
      color: #9CA3AF;
      margin-bottom: 32px;
    }
    .cover-scope {
      background: #1F2937;
      padding: 10px 20px;
      border-radius: 8px;
      color: #818CF8;
      font-size: 16px;
      margin-bottom: 32px;
    }
    .cover-meta {
      color: #6B7280;
      font-size: 13px;
    }
    .company-profile {
      background: #1F2937;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 20px;
    }
    .company-name {
      font-size: 22px;
      font-weight: 600;
      margin-bottom: 6px;
    }
    .company-url {
      color: #818CF8;
      margin-bottom: 12px;
      font-size: 13px;
    }
    .company-desc {
      color: #D1D5DB;
      font-size: 14px;
    }
    .empty-state {
      background: #1F2937;
      border-radius: 8px;
      padding: 24px;
      text-align: center;
      color: #6B7280;
      font-size: 13px;
    }
    .content-wrapper {
      padding-bottom: 20px;
    }
  </style>
</head>
<body>
  <div class="cover-page">
    ${coverLogo}
    ${headerLogo}
    <div class="cover-title">Competitive Intelligence Report</div>
    <div class="cover-subtitle">${escapeHtml(data.reportName)}</div>
    <div class="cover-scope">${scopeLabel}</div>
    <div style="background: #1F2937; padding: 16px 32px; border-radius: 8px; margin-bottom: 24px;">
      <div style="font-size: 14px; color: #9CA3AF;">Prepared for</div>
      <div style="font-size: 20px; font-weight: 600; color: #F9FAFB;">${escapeHtml(data.companyName)}</div>
    </div>
    <div class="cover-meta">
      <div>Generated on ${formattedDate}</div>
      <div>Prepared by ${escapeHtml(data.author)}</div>
    </div>
  </div>
  
  <div class="page-break"></div>

  <div class="content-wrapper">
    <div class="header">
      ${headerLogo}
      <div class="report-meta">
        <div>${formattedDate}</div>
        <div>${scopeLabel}</div>
      </div>
    </div>

    ${data.companyProfile ? `
    <div class="section">
      <div class="section-title">Company Baseline</div>
      <div class="company-profile">
        <div class="company-name">${escapeHtml(data.companyProfile.companyName)}</div>
        <div class="company-url">${escapeHtml(data.companyProfile.websiteUrl)}</div>
        ${data.companyProfile.description ? `<div class="company-desc">${escapeHtml(data.companyProfile.description)}</div>` : ""}
      </div>
    </div>
    ` : ""}

    <div class="section">
      <div class="section-title">Competitors Overview (${data.competitors.length})</div>
      ${data.competitors.length > 0 ? `
      <table>
        <thead>
          <tr>
            <th>Competitor</th>
            <th>Summary</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${competitorRows}
        </tbody>
      </table>
      ` : '<div class="empty-state">No competitors tracked in this market.</div>'}
    </div>

    ${ORBIT_FOOTER}
  </div>

  <div class="page-break"></div>

  <div class="content-wrapper">
    <div class="header">
      ${headerLogo}
      <div class="report-meta">
        <div>${formattedDate}</div>
        <div>Analysis Findings</div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Key Themes</div>
      ${themeCards || '<div class="empty-state">No themes identified. Run competitive analysis to generate insights.</div>'}
    </div>

    <div class="section">
      <div class="section-title">Messaging Comparison</div>
      ${messagingCards || '<div class="empty-state">No messaging comparison available.</div>'}
    </div>

    ${ORBIT_FOOTER}
  </div>

  <div class="page-break"></div>

  <div class="content-wrapper">
    <div class="header">
      ${headerLogo}
      <div class="report-meta">
        <div>${formattedDate}</div>
        <div>Gaps & Opportunities</div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Identified Gaps</div>
      ${gapCards || '<div class="empty-state">No gaps identified. Run analysis to discover opportunities.</div>'}
    </div>

    <div class="section">
      <div class="section-title">Recommendations (${data.recommendations.length})</div>
      ${recommendationCards || '<div class="empty-state">No recommendations generated.</div>'}
    </div>

    ${ORBIT_FOOTER}
  </div>

  ${data.battlecards.length > 0 ? `
  <div class="page-break"></div>
  <div class="content-wrapper">
    <div class="header">
      ${headerLogo}
      <div class="report-meta">
        <div>${formattedDate}</div>
        <div>Battle Cards</div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Competitive Battle Cards (${data.battlecards.length})</div>
      ${battlecardCards}
    </div>

    ${ORBIT_FOOTER}
  </div>
  ` : ""}

  ${socialWebCards ? `
  <div class="page-break"></div>
  <div class="content-wrapper">
    <div class="header">
      ${headerLogo}
      <div class="report-meta">
        <div>${formattedDate}</div>
        <div>Social & Web Activity</div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Competitor Social & Web Updates</div>
      ${socialWebCards || '<div class="empty-state">No social or web activity data available.</div>'}
    </div>

    ${ORBIT_FOOTER}
  </div>
  ` : ""}

  ${data.projects.length > 0 ? `
  <div class="page-break"></div>
  <div class="content-wrapper">
    <div class="header">
      ${headerLogo}
      <div class="report-meta">
        <div>${formattedDate}</div>
        <div>Product Projects</div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Active Projects (${data.projects.length})</div>
      ${projectCards}
    </div>

    ${ORBIT_FOOTER}
  </div>
  ` : ""}

  ${data.gtmPlan ? `
  <div class="page-break"></div>
  <div class="content-wrapper">
    <div class="header">
      ${headerLogo}
      <div class="report-meta">
        <div>${formattedDate}</div>
        <div>Go-To-Market Plan</div>
      </div>
    </div>
    <div class="section">
      <div class="section-title">Go-To-Market Plan</div>
      <div style="background: #1F2937; border-radius: 8px; padding: 20px; color: #D1D5DB; font-size: 13px; line-height: 1.8;">
        ${escapeHtml(data.gtmPlan).replace(/\n/g, '<br>')}
      </div>
    </div>
    ${ORBIT_FOOTER}
  </div>
  ` : ''}

  ${data.messagingFramework ? `
  <div class="page-break"></div>
  <div class="content-wrapper">
    <div class="header">
      ${headerLogo}
      <div class="report-meta">
        <div>${formattedDate}</div>
        <div>Messaging Framework</div>
      </div>
    </div>
    <div class="section">
      <div class="section-title">Messaging & Positioning Framework</div>
      <div style="background: #1F2937; border-radius: 8px; padding: 20px; color: #D1D5DB; font-size: 13px; line-height: 1.8;">
        ${escapeHtml(data.messagingFramework).replace(/\n/g, '<br>')}
      </div>
    </div>
    ${ORBIT_FOOTER}
  </div>
  ` : ''}

</body>
</html>
  `;
}

export async function generatePdfReport(
  tenantDomain: string,
  userId: string,
  reportName: string,
  scope: "baseline" | "project" = "baseline",
  projectId?: string,
  includeStrategicPlans: boolean = false,
  marketId?: string
): Promise<{ pdfBuffer: Buffer; report: Report }> {
  const user = await storage.getUser(userId);
  if (!user) {
    throw new Error("User not found");
  }

  const tenant = await storage.getTenantByDomain(tenantDomain);
  if (!tenant) {
    throw new Error("Tenant not found");
  }

  let companyProfile: CompanyProfile | null = null;
  let competitors: Competitor[] = [];
  let projectName: string | undefined;
  let marketName: string | undefined;
  let projects: ProjectSummary[] = [];

  const contextFilter = { 
    tenantId: tenant.id, 
    tenantDomain, 
    marketId: marketId || "",
    isDefaultMarket: !marketId
  };

  if (marketId) {
    const market = await storage.getMarket(marketId);
    marketName = market?.name;
  }

  if (scope === "project" && projectId) {
    const project = await storage.getClientProject(projectId);
    if (!project) {
      throw new Error("Project not found");
    }
    projectName = project.name;
    competitors = await storage.getCompetitorsByProject(projectId);
    companyProfile = (await storage.getCompanyProfileByContext(contextFilter)) || null;
  } else {
    companyProfile = (await storage.getCompanyProfileByContext(contextFilter)) || null;
    competitors = await storage.getCompetitorsByContext(contextFilter);
    
    const allProjects = await storage.getClientProjectsByContext(contextFilter);
    for (const p of allProjects) {
      const projectProducts = await storage.getProjectProducts(p.id);
      projects.push({
        id: p.id,
        name: p.name,
        clientName: p.clientName || undefined,
        status: p.status,
        productCount: projectProducts.length,
      });
    }
  }

  const analysis = await storage.getLatestAnalysisByContext(contextFilter);
    
  const recommendations = await storage.getRecommendationsByContext(contextFilter);

  const battlecards: Array<{ competitorName: string; battlecard: Battlecard }> = [];
  const allBattlecards = await storage.getBattlecardsByContext(contextFilter);
    
  for (const bc of allBattlecards) {
    const competitor = competitors.find(c => c.id === bc.competitorId);
    if (competitor) {
      battlecards.push({ competitorName: competitor.name, battlecard: bc });
    }
  }

  const competitorsWithAnalysis: CompetitorWithAnalysis[] = competitors.map(c => {
    const analysisData = c.analysisData as any;
    const linkedIn = c.linkedInEngagement as any;
    const instagram = c.instagramEngagement as any;
    const crawlData = c.crawlData as any;
    const blogSnapshot = c.blogSnapshot as any;
    
    let scores: CompetitorWithAnalysis["scores"];
    if (analysisData) {
      const calculated = calculateScores(
        analysisData,
        linkedIn,
        instagram,
        crawlData,
        blogSnapshot,
        c.lastCrawl ? new Date(c.lastCrawl) : null
      );
      scores = {
        overallScore: calculated.overallScore,
        innovationScore: calculated.innovationScore,
        marketPresenceScore: calculated.marketPresenceScore,
      };
    }

    let socialSummary = "";
    if (linkedIn?.followers) {
      socialSummary += `LinkedIn: ${linkedIn.followers.toLocaleString()} followers`;
    }
    if (instagram?.followers) {
      socialSummary += socialSummary ? `, Instagram: ${instagram.followers.toLocaleString()} followers` : `Instagram: ${instagram.followers.toLocaleString()} followers`;
    }

    let webUpdateSummary = "";
    if (blogSnapshot?.postCount) {
      webUpdateSummary = `${blogSnapshot.postCount} blog posts tracked`;
    }
    if (crawlData?.pages?.length) {
      webUpdateSummary += webUpdateSummary ? `, ${crawlData.pages.length} pages crawled` : `${crawlData.pages.length} pages crawled`;
    }

    return {
      ...c,
      scores,
      socialSummary: socialSummary || undefined,
      webUpdateSummary: webUpdateSummary || undefined,
    };
  });

  let gtmPlan: string | null = null;
  let messagingFramework: string | null = null;

  if (includeStrategicPlans && companyProfile) {
    const longFormRecs = await storage.getLongFormRecommendationsByCompanyProfile(companyProfile.id);
    const gtmRec = longFormRecs.find(r => r.type === "gtm_plan" && r.status === "generated");
    const msgRec = longFormRecs.find(r => r.type === "messaging_framework" && r.status === "generated");
    gtmPlan = gtmRec?.content || null;
    messagingFramework = msgRec?.content || null;
  }

  const reportData: ReportData = {
    companyProfile,
    companyName: companyProfile?.companyName || tenant.name || tenantDomain,
    competitors: competitorsWithAnalysis,
    analysis: analysis ? {
      themes: Array.isArray(analysis.themes) ? analysis.themes : [],
      messaging: Array.isArray(analysis.messaging) ? analysis.messaging : [],
      gaps: Array.isArray(analysis.gaps) ? analysis.gaps : [],
    } : null,
    recommendations,
    battlecards,
    projects,
    generatedAt: new Date(),
    tenantDomain,
    marketName,
    reportName,
    author: user.name || user.email,
    scope,
    projectName,
    gtmPlan,
    messagingFramework,
  };

  const html = generateReportHtml(reportData);

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: "15mm",
        bottom: "15mm",
        left: "12mm",
        right: "12mm",
      },
    });

    const pdfSizeKb = Math.round(pdfBuffer.length / 1024);
    const sizeLabel = pdfSizeKb > 1024 
      ? `${(pdfSizeKb / 1024).toFixed(1)} MB` 
      : `${pdfSizeKb} KB`;

    const report = await storage.createReport({
      name: reportName,
      date: format(new Date(), "yyyy-MM-dd"),
      type: "Competitive Analysis",
      size: sizeLabel,
      author: user.name || user.email,
      status: "Generated",
      scope,
      projectId: projectId || null,
      tenantDomain,
      createdBy: userId,
      fileUrl: null,
      marketId: marketId || null,
    });

    return { pdfBuffer: Buffer.from(pdfBuffer), report };
  } finally {
    await browser.close();
  }
}

export async function getReportPdf(reportId: string): Promise<Buffer | null> {
  const report = await storage.getReport(reportId);
  if (!report) {
    return null;
  }
  return null;
}
