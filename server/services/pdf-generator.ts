import puppeteer from "puppeteer";
import { storage } from "../storage";
import type { Competitor, CompanyProfile, Report } from "@shared/schema";
import { format } from "date-fns";

interface ReportData {
  companyProfile: CompanyProfile | null;
  competitors: Competitor[];
  analysis: {
    themes: any[];
    messaging: any[];
    gaps: any[];
  } | null;
  recommendations: any[];
  generatedAt: Date;
  tenantDomain: string;
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

function generateReportHtml(data: ReportData): string {
  const formattedDate = format(data.generatedAt, "MMMM d, yyyy");
  const scopeLabel = data.scope === "project" && data.projectName 
    ? `Project: ${escapeHtml(data.projectName)}` 
    : "Baseline Analysis";

  const competitorRows = data.competitors.map(c => {
    const analysisInfo = c.analysisData as { summary?: string } | null;
    const summary = analysisInfo?.summary || "No analysis yet";
    return `
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #374151;">
        <div style="display: flex; align-items: center; gap: 10px;">
          ${c.faviconUrl ? `<img src="${escapeHtml(c.faviconUrl)}" alt="" style="width: 32px; height: 32px; border-radius: 4px; object-fit: contain;">` : '<div style="width: 32px; height: 32px; background: #374151; border-radius: 4px;"></div>'}
          <div>
            <div style="font-weight: 600; color: #F9FAFB;">${escapeHtml(c.name)}</div>
            <div style="font-size: 12px; color: #9CA3AF;">${escapeHtml(c.url || "")}</div>
          </div>
        </div>
      </td>
      <td style="padding: 12px; border-bottom: 1px solid #374151; color: #D1D5DB; max-width: 300px;">${escapeHtml(summary)}</td>
      <td style="padding: 12px; border-bottom: 1px solid #374151;">
        <span style="background: ${c.status === "Active" ? "#065F46" : "#374151"}; color: ${c.status === "Active" ? "#34D399" : "#9CA3AF"}; padding: 4px 8px; border-radius: 4px; font-size: 12px;">${escapeHtml(c.status)}</span>
      </td>
    </tr>
  `;
  }).join("");

  const themeCards = (data.analysis?.themes || []).map((theme: any) => `
    <div style="background: #1F2937; border-radius: 8px; padding: 16px; margin-bottom: 12px;">
      <div style="font-weight: 600; color: #F9FAFB; margin-bottom: 8px;">${escapeHtml(theme.name || theme.title || "Theme")}</div>
      <div style="color: #D1D5DB; font-size: 14px;">${escapeHtml(theme.description || theme.details || "")}</div>
    </div>
  `).join("");

  const messagingCards = (data.analysis?.messaging || []).map((msg: any) => `
    <div style="background: #1F2937; border-radius: 8px; padding: 16px; margin-bottom: 12px;">
      <div style="font-weight: 600; color: #F9FAFB; margin-bottom: 8px;">${escapeHtml(msg.competitor || msg.name || "Competitor")}</div>
      <div style="color: #D1D5DB; font-size: 14px;">${escapeHtml(msg.keyMessage || msg.message || msg.description || "")}</div>
    </div>
  `).join("");

  const gapCards = (data.analysis?.gaps || []).map((gap: any) => `
    <div style="background: #1F2937; border-radius: 8px; padding: 16px; margin-bottom: 12px; border-left: 3px solid #FB923C;">
      <div style="font-weight: 600; color: #F9FAFB; margin-bottom: 8px;">${escapeHtml(gap.area || gap.title || "Gap Identified")}</div>
      <div style="color: #D1D5DB; font-size: 14px;">${escapeHtml(gap.description || gap.details || "")}</div>
      ${gap.opportunity ? `<div style="color: #34D399; font-size: 13px; margin-top: 8px;"><strong>Opportunity:</strong> ${escapeHtml(gap.opportunity)}</div>` : ""}
    </div>
  `).join("");

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

  const ORBIT_FOOTER = 'Orbit orbit.synozur.com • Published by The Synozur Alliance LLC www.synozur.com © 2026 All Rights Reserved.';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    @page {
      size: A4;
      margin: 20mm;
    }
    body {
      font-family: 'Avenir Next LT Pro', 'Avenir Next', 'Avenir', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: #111827;
      color: #F9FAFB;
      margin: 0;
      padding: 0;
      line-height: 1.6;
    }
    .page-break {
      page-break-after: always;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 24px;
      border-bottom: 2px solid #374151;
      margin-bottom: 32px;
    }
    .logo {
      font-size: 28px;
      font-weight: 700;
      color: #818CF8;
    }
    .logo span {
      color: #F9FAFB;
    }
    .report-meta {
      text-align: right;
      color: #9CA3AF;
      font-size: 14px;
    }
    .section {
      margin-bottom: 40px;
    }
    .section-title {
      font-size: 20px;
      font-weight: 600;
      color: #818CF8;
      margin-bottom: 16px;
      padding-bottom: 8px;
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
      padding: 12px;
      text-align: left;
      font-weight: 600;
    }
    .cover-page {
      height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      text-align: center;
    }
    .cover-title {
      font-size: 48px;
      font-weight: 700;
      margin-bottom: 16px;
    }
    .cover-subtitle {
      font-size: 24px;
      color: #9CA3AF;
      margin-bottom: 40px;
    }
    .cover-scope {
      background: #1F2937;
      padding: 12px 24px;
      border-radius: 8px;
      color: #818CF8;
      font-size: 18px;
      margin-bottom: 40px;
    }
    .cover-meta {
      color: #6B7280;
      font-size: 14px;
    }
    .footer {
      position: fixed;
      bottom: 10mm;
      left: 20mm;
      right: 20mm;
      text-align: center;
      font-size: 11px;
      color: #6B7280;
      border-top: 1px solid #374151;
      padding-top: 10px;
    }
    .company-profile {
      background: #1F2937;
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 24px;
    }
    .company-name {
      font-size: 24px;
      font-weight: 600;
      margin-bottom: 8px;
    }
    .company-url {
      color: #818CF8;
      margin-bottom: 16px;
    }
    .company-desc {
      color: #D1D5DB;
    }
    .empty-state {
      background: #1F2937;
      border-radius: 8px;
      padding: 32px;
      text-align: center;
      color: #6B7280;
    }
  </style>
</head>
<body>
  <div class="cover-page">
    <div class="logo"><span>Orbit</span></div>
    <div class="cover-title" style="color: #F9FAFB;">Competitive Intelligence Report</div>
    <div class="cover-subtitle">${escapeHtml(data.reportName)}</div>
    <div class="cover-scope">${scopeLabel}</div>
    <div class="cover-meta">
      <div>Generated on ${formattedDate}</div>
      <div>Prepared by ${escapeHtml(data.author)}</div>
      <div style="margin-top: 16px; font-size: 11px; color: #6B7280;">
        ${ORBIT_FOOTER}
      </div>
    </div>
  </div>
  
  <div class="page-break"></div>

  <div class="header">
    <div class="logo"><span>Orbit</span></div>
    <div class="report-meta">
      <div>${formattedDate}</div>
      <div>${scopeLabel}</div>
    </div>
  </div>

  ${data.companyProfile ? `
  <div class="section">
    <div class="section-title">Your Company Profile</div>
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
          <th>Description</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${competitorRows}
      </tbody>
    </table>
    ` : '<div class="empty-state">No competitors added yet</div>'}
  </div>

  <div class="page-break"></div>

  <div class="header">
    <div class="logo"><span>Orbit</span></div>
    <div class="report-meta">
      <div>${formattedDate}</div>
      <div>Analysis Findings</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Key Themes</div>
    ${themeCards || '<div class="empty-state">No themes identified yet. Run an analysis to generate insights.</div>'}
  </div>

  <div class="section">
    <div class="section-title">Competitor Messaging</div>
    ${messagingCards || '<div class="empty-state">No messaging analysis available yet.</div>'}
  </div>

  <div class="page-break"></div>

  <div class="header">
    <div class="logo"><span>Orbit</span></div>
    <div class="report-meta">
      <div>${formattedDate}</div>
      <div>Gaps & Recommendations</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Identified Gaps</div>
    ${gapCards || '<div class="empty-state">No gaps identified yet. Run an analysis to discover opportunities.</div>'}
  </div>

  <div class="section">
    <div class="section-title">Recommendations (${data.recommendations.length})</div>
    ${recommendationCards || '<div class="empty-state">No recommendations generated yet.</div>'}
  </div>

  ${data.gtmPlan ? `
  <div class="page-break"></div>
  <div class="header">
    <div class="logo"><span>Orbit</span></div>
    <div class="report-meta">
      <div>${formattedDate}</div>
      <div>Go-To-Market Plan</div>
    </div>
  </div>
  <div class="section">
    <div class="section-title">Go-To-Market Plan</div>
    <div style="background: #1F2937; border-radius: 8px; padding: 20px; color: #D1D5DB; font-size: 14px; line-height: 1.8;">
      ${escapeHtml(data.gtmPlan).replace(/\n/g, '<br>')}
    </div>
  </div>
  ` : ''}

  ${data.messagingFramework ? `
  <div class="page-break"></div>
  <div class="header">
    <div class="logo"><span>Orbit</span></div>
    <div class="report-meta">
      <div>${formattedDate}</div>
      <div>Messaging Framework</div>
    </div>
  </div>
  <div class="section">
    <div class="section-title">Messaging & Positioning Framework</div>
    <div style="background: #1F2937; border-radius: 8px; padding: 20px; color: #D1D5DB; font-size: 14px; line-height: 1.8;">
      ${escapeHtml(data.messagingFramework).replace(/\n/g, '<br>')}
    </div>
  </div>
  ` : ''}

  <div class="footer">
    ${ORBIT_FOOTER}<br/>
    Confidential - ${escapeHtml(data.tenantDomain)} | Generated ${formattedDate}
  </div>
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
  includeStrategicPlans: boolean = false
): Promise<{ pdfBuffer: Buffer; report: Report }> {
  const user = await storage.getUser(userId);
  if (!user) {
    throw new Error("User not found");
  }

  const companyProfile = await storage.getCompanyProfileByTenant(tenantDomain);
  
  let competitors: Competitor[];
  let projectName: string | undefined;
  
  if (scope === "project" && projectId) {
    const project = await storage.getClientProject(projectId);
    if (!project) {
      throw new Error("Project not found");
    }
    projectName = project.name;
    competitors = await storage.getCompetitorsByProject(projectId);
  } else {
    competitors = await storage.getCompetitorsByTenantDomain(tenantDomain);
  }

  const analysis = await storage.getLatestAnalysisByTenant(tenantDomain);
  const recommendations = await storage.getRecommendationsByTenant(tenantDomain);

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
    companyProfile: companyProfile || null,
    competitors,
    analysis: analysis ? {
      themes: Array.isArray(analysis.themes) ? analysis.themes : [],
      messaging: Array.isArray(analysis.messaging) ? analysis.messaging : [],
      gaps: Array.isArray(analysis.gaps) ? analysis.gaps : [],
    } : null,
    recommendations,
    generatedAt: new Date(),
    tenantDomain,
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
        top: "20mm",
        bottom: "25mm",
        left: "15mm",
        right: "15mm",
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
