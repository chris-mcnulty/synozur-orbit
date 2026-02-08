import puppeteer from "puppeteer";
import { storage } from "../storage";
import type { Competitor, CompanyProfile, Report, Battlecard } from "@shared/schema";
import { format } from "date-fns";
import { calculateScores } from "./scoring-service";
import * as fs from "fs";
import * as path from "path";

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
  
  return undefined;
}

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

interface ProductSummary {
  id: string;
  name: string;
  description: string | null;
  competitivePositionSummary?: string | null;
  status: string;
  featureCount: number;
  roadmapCount: number;
}

interface ProductFeatureData {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  status: string;
  priority: string | null;
  targetQuarter: string | null;
  targetYear: number | null;
}

interface RoadmapItemData {
  id: string;
  title: string;
  description: string | null;
  quarter: string | null;
  year: number | null;
  effort: string | null;
  status: string;
  aiRecommended: boolean;
}

interface MarketingPlanSummary {
  id: string;
  name: string;
  fiscalYear: string;
  description: string | null;
  status: string;
  taskCount: number;
  tasksByGroup: Record<string, number>;
  tasksByTimeframe: Record<string, number>;
}

interface RecentActivityItem {
  competitorName: string;
  type: "website" | "blog" | "social";
  description: string;
  date?: Date;
}

interface ExecutiveSummaryData {
  companySnapshot: string;
  marketPosition: string;
  competitiveLandscape: string;
  opportunities: string;
}

interface ReportData {
  companyProfile: CompanyProfile | null;
  companyName: string;
  executiveSummary?: ExecutiveSummaryData | null;
  competitors: CompetitorWithAnalysis[];
  analysis: {
    themes: any[];
    messaging: any[];
    gaps: any[];
  } | null;
  recommendations: any[];
  battlecards: Array<{ competitorName: string; battlecard: Battlecard }>;
  projects: ProjectSummary[];
  products: ProductSummary[];
  generatedAt: Date;
  tenantDomain: string;
  marketName?: string;
  reportName: string;
  author: string;
  scope: "baseline" | "project";
  projectName?: string;
  gtmPlan?: string | null;
  messagingFramework?: string | null;
  baselineProductName?: string;
  productFeatures?: ProductFeatureData[];
  roadmapItems?: RoadmapItemData[];
  marketingPlans?: MarketingPlanSummary[];
  recentActivity?: RecentActivityItem[];
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

function markdownToHtml(markdown: string): string {
  if (!markdown) return "";
  
  let html = escapeHtml(markdown);
  
  html = html.replace(/^### (.+)$/gm, '<h3 style="font-size: 16px; font-weight: 600; color: #1e293b; margin: 20px 0 12px 0;">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 style="font-size: 18px; font-weight: 700; color: #1e293b; margin: 24px 0 14px 0;">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 style="font-size: 22px; font-weight: 700; color: #1e293b; margin: 28px 0 16px 0;">$1</h1>');
  
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  
  html = html.replace(/^- (.+)$/gm, '<li style="margin: 4px 0; padding-left: 4px;">$1</li>');
  html = html.replace(/(<li[^>]*>.*<\/li>\n?)+/g, (match) => `<ul style="margin: 10px 0; padding-left: 24px; list-style-type: disc;">${match}</ul>`);
  
  html = html.replace(/^\d+\. (.+)$/gm, '<li style="margin: 4px 0; padding-left: 4px;">$1</li>');
  
  const paragraphs = html.split(/\n{2,}/);
  html = paragraphs.map(p => {
    const trimmed = p.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('<h') || trimmed.startsWith('<ul') || trimmed.startsWith('<ol') || trimmed.startsWith('<li')) {
      return trimmed;
    }
    return `<p style="margin: 10px 0; line-height: 1.7;">${trimmed.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
  
  return html;
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

function getOrbitLogoBase64(): string {
  try {
    const logoPath = path.join(process.cwd(), "client/public/brand/orbit-logo.png");
    if (fs.existsSync(logoPath)) {
      const logoBuffer = fs.readFileSync(logoPath);
      return `data:image/png;base64,${logoBuffer.toString("base64")}`;
    }
  } catch (e) {
    console.error("Failed to load Orbit logo:", e);
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
  const orbitLogo = getOrbitLogoBase64();

  const competitorRows = data.competitors.map(c => {
    const analysisInfo = c.analysisData as { summary?: string; valueProposition?: string } | null;
    const summary = analysisInfo?.summary || analysisInfo?.valueProposition || "No analysis yet";
    const scoreInfo = c.scores ? `<div style="font-size: 11px; color: #6366F1; margin-top: 4px;">Score: ${c.scores.overallScore.toFixed(0)}/100</div>` : "";
    const logoHtml = c.faviconUrl 
      ? `<img src="${c.faviconUrl}" alt="${escapeHtml(c.name)}" style="width: 32px; height: 32px; border-radius: 4px; object-fit: contain; background: #F1F5F9;" onerror="this.style.display='none'" />`
      : `<div style="width: 32px; height: 32px; background: #F1F5F9; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-weight: 600; color: #6366F1; font-size: 14px;">${escapeHtml(c.name.substring(0, 2).toUpperCase())}</div>`;
    return `
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #E2E8F0;">
        <div style="display: flex; align-items: center; gap: 10px;">
          ${logoHtml}
          <div>
            <div style="font-weight: 600; color: #1E293B;">${escapeHtml(c.name)}</div>
            <div style="font-size: 12px; color: #64748B;">${escapeHtml(c.url || "")}</div>
            ${scoreInfo}
          </div>
        </div>
      </td>
      <td style="padding: 12px; border-bottom: 1px solid #E2E8F0; color: #475569; max-width: 300px; font-size: 13px;">${escapeHtml(summary.slice(0, 200))}${summary.length > 200 ? "..." : ""}</td>
      <td style="padding: 12px; border-bottom: 1px solid #E2E8F0;">
        <span style="background: ${c.status === "Active" ? "#DCFCE7" : "#F1F5F9"}; color: ${c.status === "Active" ? "#059669" : "#64748B"}; padding: 4px 8px; border-radius: 4px; font-size: 12px;">${escapeHtml(c.status)}</span>
      </td>
    </tr>
  `;
  }).join("");

  const themeCards = (data.analysis?.themes || []).map((theme: any) => {
    const themeName = theme.theme || theme.name || theme.title || "";
    const themeDesc = theme.description || theme.details || theme.observation || "";
    const competitorRef = theme.competitorName || theme.competitor || "";
    const source = theme.source || "";
    if (!themeName && !themeDesc) return "";
    const displayDesc = themeDesc && themeDesc !== "Based on profile" ? themeDesc : "";
    return `
    <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px; margin-bottom: 12px;">
      <div style="font-weight: 600; color: #1E293B; margin-bottom: 4px;">${escapeHtml(themeName)}</div>
      ${displayDesc ? `<div style="color: #475569; font-size: 13px; margin-bottom: 6px;">${escapeHtml(displayDesc)}</div>` : ''}
      ${competitorRef ? `<div style="color: #64748B; font-size: 12px; font-style: italic;">Source: ${escapeHtml(competitorRef)}</div>` : ''}
    </div>
  `;
  }).filter(Boolean).join("");

  const messagingCards = (data.analysis?.messaging || []).map((msg: any) => {
    const competitorName = msg.competitorName || msg.competitor || "";
    const category = msg.category || msg.name || "Market Positioning";
    const ourMsg = msg.us || msg.ourMessage || msg.ourPosition || "";
    const compMsg = msg.competitorMessage || msg.competitorA || msg.keyMessage || msg.message || msg.them || msg.competitorPosition || "";
    if (!ourMsg && !compMsg) return "";
    const displayTitle = competitorName || (category.length > 60 ? "Market Positioning" : category);
    const headerLabel = competitorName ? competitorName : "Competitor";
    return `
    <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px; margin-bottom: 12px;">
      <div style="font-weight: 600; color: #1E293B; margin-bottom: 10px;">${escapeHtml(displayTitle)}</div>
      ${ourMsg ? `<div style="color: #059669; font-size: 13px; margin-bottom: 8px;"><strong>Our Position:</strong> ${escapeHtml(ourMsg)}</div>` : ""}
      ${compMsg ? `<div style="color: #475569; font-size: 14px;"><strong>${escapeHtml(headerLabel)}:</strong> ${escapeHtml(compMsg)}</div>` : ""}
    </div>
  `;
  }).filter(Boolean).join("");

  // Filter to only show active/accepted gaps, not dismissed
  const activeGaps = (data.analysis?.gaps || []).filter((gap: any) => 
    !gap.status || gap.status === "pending" || gap.status === "accepted"
  );
  
  const gapCards = activeGaps.map((gap: any) => {
    const gapArea = gap.area || gap.title || gap.name || "Gap Identified";
    const gapDesc = gap.observation || gap.description || gap.details || gap.summary || "";
    const gapOpp = gap.opportunity || gap.recommendation || "";
    const gapImpact = gap.impact || "";
    if (!gapDesc && !gapArea) return "";
    return `
    <div style="background: #FFFBEB; border: 1px solid #FCD34D; border-left: 3px solid #F59E0B; border-radius: 8px; padding: 16px; margin-bottom: 12px;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start;">
        <div style="font-weight: 600; color: #1E293B; margin-bottom: 8px;">${escapeHtml(gapArea)}</div>
        ${gapImpact ? `<span style="background: ${gapImpact === "High" ? "#7C3AED" : gapImpact === "Medium" ? "#3B82F6" : "#6B7280"}; color: white; padding: 2px 8px; border-radius: 4px; font-size: 11px;">${escapeHtml(gapImpact)}</span>` : ""}
      </div>
      ${gapDesc ? `<div style="color: #475569; font-size: 14px;">${escapeHtml(gapDesc)}</div>` : ""}
      ${gapOpp ? `<div style="color: #059669; font-size: 13px; margin-top: 8px;"><strong>Opportunity:</strong> ${escapeHtml(gapOpp)}</div>` : ""}
    </div>
  `;
  }).filter(Boolean).join("");

  const recommendationCards = data.recommendations.map((rec: any) => `
    <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px; margin-bottom: 12px;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
        <div style="font-weight: 600; color: #1E293B;">${escapeHtml(rec.title)}</div>
        <span style="background: ${rec.impact === "High" ? "#7C3AED" : rec.impact === "Medium" ? "#3B82F6" : "#6B7280"}; color: white; padding: 2px 8px; border-radius: 4px; font-size: 11px;">${escapeHtml(rec.impact)} Impact</span>
      </div>
      <div style="color: #475569; font-size: 14px;">${escapeHtml(rec.description)}</div>
      <div style="color: #64748B; font-size: 12px; margin-top: 8px;">Area: ${escapeHtml(rec.area)}</div>
    </div>
  `).join("");

  const getStatusColor = (status: string): string => {
    switch (status) {
      case "released": case "completed": return "#10B981";
      case "in_progress": return "#3B82F6";
      case "planned": return "#F59E0B";
      default: return "#6B7280";
    }
  };

  const getEffortLabel = (effort: string | null): string => {
    const labels: Record<string, string> = {
      xs: "XS (1-2 days)", s: "S (1 week)", m: "M (2-4 weeks)",
      l: "L (1-2 months)", xl: "XL (3+ months)"
    };
    return effort ? labels[effort] || effort.toUpperCase() : "";
  };

  const featureCards = (data.productFeatures || []).map((f) => `
    <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px; margin-bottom: 12px;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
        <div style="font-weight: 600; color: #1E293B;">${escapeHtml(f.name)}</div>
        <span style="background: ${getStatusColor(f.status)}20; color: ${getStatusColor(f.status)}; padding: 2px 8px; border-radius: 4px; font-size: 11px;">${escapeHtml(f.status.replace("_", " "))}</span>
      </div>
      ${f.description ? `<div style="color: #475569; font-size: 14px; margin-bottom: 8px;">${escapeHtml(f.description)}</div>` : ""}
      <div style="display: flex; gap: 12px; flex-wrap: wrap;">
        ${f.category ? `<span style="color: #64748B; font-size: 12px;">Category: ${escapeHtml(f.category)}</span>` : ""}
        ${f.priority ? `<span style="color: #64748B; font-size: 12px;">Priority: ${escapeHtml(f.priority)}</span>` : ""}
        ${f.targetQuarter ? `<span style="color: #64748B; font-size: 12px;">Target: ${escapeHtml(f.targetQuarter)} ${f.targetYear || ""}</span>` : ""}
      </div>
    </div>
  `).join("");

  const roadmapCards = (data.roadmapItems || []).map((r) => `
    <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px; margin-bottom: 12px;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
        <div style="font-weight: 600; color: #1E293B;">
          ${escapeHtml(r.title)}
          ${r.aiRecommended ? `<span style="background: #818CF830; color: #6366F1; padding: 2px 6px; border-radius: 4px; font-size: 10px; margin-left: 8px;">AI</span>` : ""}
        </div>
        <span style="background: ${getStatusColor(r.status)}20; color: ${getStatusColor(r.status)}; padding: 2px 8px; border-radius: 4px; font-size: 11px;">${escapeHtml(r.status.replace("_", " "))}</span>
      </div>
      ${r.description ? `<div style="color: #475569; font-size: 14px; margin-bottom: 8px;">${escapeHtml(r.description)}</div>` : ""}
      <div style="display: flex; gap: 12px; flex-wrap: wrap;">
        ${r.quarter ? `<span style="color: #64748B; font-size: 12px;">Quarter: ${escapeHtml(r.quarter)} ${r.year || ""}</span>` : "<span style=\"color: #64748B; font-size: 12px;\">Unscheduled</span>"}
        ${r.effort ? `<span style="color: #64748B; font-size: 12px;">Effort: ${escapeHtml(getEffortLabel(r.effort))}</span>` : ""}
      </div>
    </div>
  `).join("");

  const socialWebCards = data.competitors.filter(c => c.socialSummary || c.webUpdateSummary).map(c => `
    <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px; margin-bottom: 12px;">
      <div style="font-weight: 600; color: #1E293B; margin-bottom: 8px;">${escapeHtml(c.name)}</div>
      ${c.socialSummary ? `<div style="color: #475569; font-size: 13px; margin-bottom: 8px;"><strong style="color: #6366F1;">Social:</strong> ${escapeHtml(c.socialSummary)}</div>` : ""}
      ${c.webUpdateSummary ? `<div style="color: #475569; font-size: 13px;"><strong style="color: #6366F1;">Web Updates:</strong> ${escapeHtml(c.webUpdateSummary)}</div>` : ""}
    </div>
  `).join("");

  const battlecardCards = data.battlecards.map(({ competitorName, battlecard }) => {
    const strengths = Array.isArray(battlecard.strengths) ? battlecard.strengths.slice(0, 3) : [];
    const weaknesses = Array.isArray(battlecard.weaknesses) ? battlecard.weaknesses.slice(0, 3) : [];
    const advantages = Array.isArray(battlecard.ourAdvantages) ? battlecard.ourAdvantages.slice(0, 3) : [];
    return `
    <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 20px; margin-bottom: 16px; page-break-inside: avoid;">
      <div style="font-weight: 700; color: #1E293B; font-size: 18px; margin-bottom: 16px; border-bottom: 1px solid #E2E8F0; padding-bottom: 8px;">${escapeHtml(competitorName)}</div>
      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px;">
        <div>
          <div style="font-weight: 600; color: #DC2626; font-size: 12px; margin-bottom: 8px;">THEIR STRENGTHS</div>
          ${strengths.map(s => `<div style="color: #475569; font-size: 13px; margin-bottom: 4px;">• ${escapeHtml(String(s))}</div>`).join("")}
        </div>
        <div>
          <div style="font-weight: 600; color: #D97706; font-size: 12px; margin-bottom: 8px;">THEIR WEAKNESSES</div>
          ${weaknesses.map(w => `<div style="color: #475569; font-size: 13px; margin-bottom: 4px;">• ${escapeHtml(String(w))}</div>`).join("")}
        </div>
        <div>
          <div style="font-weight: 600; color: #059669; font-size: 12px; margin-bottom: 8px;">OUR ADVANTAGES</div>
          ${advantages.map(a => `<div style="color: #475569; font-size: 13px; margin-bottom: 4px;">• ${escapeHtml(String(a))}</div>`).join("")}
        </div>
      </div>
    </div>
  `;
  }).join("");

  const projectCards = data.projects.map(p => `
    <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px; margin-bottom: 12px;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <div style="font-weight: 600; color: #1E293B;">${escapeHtml(p.name)}</div>
          ${p.clientName ? `<div style="font-size: 12px; color: #64748B;">Client: ${escapeHtml(p.clientName)}</div>` : ""}
        </div>
        <div style="text-align: right;">
          <span style="background: ${p.status === "active" ? "#DCFCE7" : "#F1F5F9"}; color: ${p.status === "active" ? "#059669" : "#64748B"}; padding: 4px 8px; border-radius: 4px; font-size: 11px;">${escapeHtml(p.status)}</span>
          <div style="font-size: 11px; color: #64748B; margin-top: 4px;">${p.productCount} products</div>
        </div>
      </div>
    </div>
  `).join("");

  const productCards = data.products.map(prod => `
    <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px; margin-bottom: 12px;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div style="flex: 1;">
          <div style="font-weight: 600; color: #1E293B;">${escapeHtml(prod.name)}</div>
          ${prod.description ? `<div style="font-size: 13px; color: #475569; margin-top: 4px;">${escapeHtml(prod.description.slice(0, 150))}${prod.description.length > 150 ? "..." : ""}</div>` : ""}
          ${prod.competitivePositionSummary ? `<div style="font-size: 12px; color: #6B7280; margin-top: 6px; padding: 8px; background: #F1F5F9; border-radius: 4px; border-left: 3px solid #7C3AED; font-style: italic;">${escapeHtml(prod.competitivePositionSummary)}</div>` : ""}
        </div>
        <div style="text-align: right; margin-left: 16px;">
          <span style="background: ${prod.status === "baseline" ? "#EDE9FE" : "#F1F5F9"}; color: ${prod.status === "baseline" ? "#7C3AED" : "#64748B"}; padding: 4px 8px; border-radius: 4px; font-size: 11px;">${prod.status === "baseline" ? "Your Product" : "Competitor"}</span>
          <div style="font-size: 11px; color: #64748B; margin-top: 4px;">${prod.featureCount} features, ${prod.roadmapCount} roadmap items</div>
        </div>
      </div>
    </div>
  `).join("");

  const marketingPlanCards = (data.marketingPlans || []).map(plan => {
    const statusColors: Record<string, { bg: string; text: string }> = {
      draft: { bg: "#FEF3C7", text: "#92400E" },
      active: { bg: "#DCFCE7", text: "#059669" },
      archived: { bg: "#F1F5F9", text: "#64748B" },
    };
    const statusStyle = statusColors[plan.status] || statusColors.draft;
    const groupLabels = Object.entries(plan.tasksByGroup)
      .map(([group, count]) => `${group}: ${count}`)
      .join(" | ");
    
    // Build quarterly breakdown with defensive default
    const quarterOrder = ["Ongoing", "Q1", "Q2", "Q3", "Q4", "Future"];
    const quarterColors: Record<string, string> = {
      "Ongoing": "#8b5cf6",
      "Q1": "#22c55e",
      "Q2": "#3b82f6",
      "Q3": "#f59e0b",
      "Q4": "#ef4444",
      "Future": "#64748b",
    };
    const timeframeData = plan.tasksByTimeframe || {};
    const quarterBadges = quarterOrder
      .filter(q => timeframeData[q])
      .map(q => `<span style="display: inline-block; background: ${quarterColors[q]}20; color: ${quarterColors[q]}; padding: 2px 8px; border-radius: 4px; font-size: 10px; margin-right: 6px; margin-bottom: 4px;">${q}: ${timeframeData[q]}</span>`)
      .join("");
    
    return `
    <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px; margin-bottom: 12px;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start;">
        <div style="flex: 1;">
          <div style="font-weight: 600; color: #1E293B;">${escapeHtml(plan.name)}</div>
          <div style="font-size: 13px; color: #64748B; margin-top: 2px;">FY ${escapeHtml(plan.fiscalYear)}</div>
          ${plan.description ? `<div style="font-size: 13px; color: #475569; margin-top: 4px;">${escapeHtml(plan.description.slice(0, 150))}${plan.description.length > 150 ? "..." : ""}</div>` : ""}
          ${quarterBadges ? `<div style="margin-top: 10px;">${quarterBadges}</div>` : ""}
          ${groupLabels ? `<div style="font-size: 11px; color: #64748B; margin-top: 8px;">By Activity: ${escapeHtml(groupLabels)}</div>` : ""}
        </div>
        <div style="text-align: right; margin-left: 16px;">
          <span style="background: ${statusStyle.bg}; color: ${statusStyle.text}; padding: 4px 8px; border-radius: 4px; font-size: 11px; text-transform: capitalize;">${escapeHtml(plan.status)}</span>
          <div style="font-size: 11px; color: #64748B; margin-top: 4px;">${plan.taskCount} activities</div>
        </div>
      </div>
    </div>
  `;
  }).join("");

  // Build recent activity cards
  const activityTypeColors: Record<string, { bg: string; text: string; icon: string }> = {
    website: { bg: "#dbeafe", text: "#1d4ed8", icon: "🌐" },
    blog: { bg: "#dcfce7", text: "#059669", icon: "📝" },
    social: { bg: "#fce7f3", text: "#be185d", icon: "📱" },
  };
  const recentActivityCards = (data.recentActivity || []).map(activity => {
    const style = activityTypeColors[activity.type] || activityTypeColors.website;
    const dateStr = activity.date ? format(activity.date, "MMM d, yyyy") : "";
    return `
    <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 14px; margin-bottom: 10px;">
      <div style="display: flex; align-items: center; gap: 12px;">
        <span style="font-size: 18px;">${style.icon}</span>
        <div style="flex: 1;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div style="font-weight: 600; color: #1E293B; font-size: 13px;">${escapeHtml(activity.competitorName)}</div>
            ${dateStr ? `<div style="font-size: 11px; color: #64748B;">${dateStr}</div>` : ""}
          </div>
          <div style="font-size: 12px; color: #475569; margin-top: 4px;">${escapeHtml(activity.description)}</div>
        </div>
        <span style="background: ${style.bg}; color: ${style.text}; padding: 2px 8px; border-radius: 4px; font-size: 10px; text-transform: capitalize;">${activity.type}</span>
      </div>
    </div>
  `;
  }).join("");

  const ORBIT_FOOTER = `
    <div style="text-align: center; padding: 12px 0; border-top: 1px solid #E2E8F0; margin-top: 40px; font-size: 10px; color: #64748B;">
      <div style="margin-bottom: 4px;">Orbit • orbit.synozur.com</div>
      <div>Published by The Synozur Alliance LLC • www.synozur.com • © 2026 All Rights Reserved</div>
      <div style="margin-top: 4px;">Confidential - ${escapeHtml(data.tenantDomain)} | Generated ${formattedDate}</div>
    </div>
  `;

  const headerLogo = orbitLogo && synozurLogo
    ? `<div style="display: flex; align-items: center; gap: 12px;"><img src="${synozurLogo}" alt="Synozur" style="height: 24px; width: auto;"><span style="color: #94A3B8; font-size: 20px;">|</span><img src="${orbitLogo}" alt="Orbit" style="height: 32px; width: auto;"></div>`
    : orbitLogo
      ? `<div style="display: flex; align-items: center; gap: 8px;"><img src="${orbitLogo}" alt="Orbit" style="height: 32px; width: auto;"></div>`
      : synozurLogo
        ? `<div style="display: flex; align-items: center; gap: 8px;"><img src="${synozurLogo}" alt="Synozur" style="height: 28px; width: auto;"><span style="font-size: 24px; font-weight: 700; color: #1E293B;">Orbit</span></div>`
        : `<div class="logo"><span>Orbit</span></div>`;

  const coverLogo = orbitLogo && synozurLogo
    ? `<div style="display: flex; align-items: center; gap: 16px; margin-bottom: 24px;"><img src="${synozurLogo}" alt="Synozur" style="height: 48px; width: auto;"><span style="color: #94A3B8; font-size: 28px;">|</span><img src="${orbitLogo}" alt="Orbit" style="height: 56px; width: auto;"></div>`
    : orbitLogo
      ? `<div style="margin-bottom: 24px;"><img src="${orbitLogo}" alt="Orbit" style="height: 56px; width: auto;"></div>`
      : synozurLogo
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
      background: #FFFFFF;
      color: #1E293B;
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
      border-bottom: 2px solid #E2E8F0;
      margin-bottom: 28px;
    }
    .logo {
      font-size: 24px;
      font-weight: 700;
      color: #6366F1;
    }
    .logo span {
      color: #1E293B;
    }
    .report-meta {
      text-align: right;
      color: #64748B;
      font-size: 13px;
    }
    .section {
      margin-bottom: 32px;
    }
    .section-title {
      font-size: 18px;
      font-weight: 600;
      color: #6366F1;
      margin-bottom: 14px;
      padding-bottom: 6px;
      border-bottom: 1px solid #E2E8F0;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 16px;
    }
    th {
      background: #F1F5F9;
      color: #1E293B;
      padding: 10px;
      text-align: left;
      font-weight: 600;
      font-size: 13px;
      border-bottom: 1px solid #E2E8F0;
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
      color: #1E293B;
    }
    .cover-subtitle {
      font-size: 22px;
      color: #64748B;
      margin-bottom: 32px;
    }
    .cover-scope {
      background: #F1F5F9;
      padding: 10px 20px;
      border-radius: 8px;
      color: #6366F1;
      font-size: 16px;
      margin-bottom: 32px;
    }
    .cover-meta {
      color: #64748B;
      font-size: 13px;
    }
    .company-profile {
      background: #F8FAFC;
      border: 1px solid #E2E8F0;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 20px;
    }
    .company-name {
      font-size: 22px;
      font-weight: 600;
      margin-bottom: 6px;
      color: #1E293B;
    }
    .company-url {
      color: #6366F1;
      margin-bottom: 12px;
      font-size: 13px;
    }
    .company-desc {
      color: #475569;
      font-size: 14px;
    }
    .empty-state {
      background: #F8FAFC;
      border: 1px solid #E2E8F0;
      border-radius: 8px;
      padding: 24px;
      text-align: center;
      color: #64748B;
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
    <div style="background: #F1F5F9; padding: 16px 32px; border-radius: 8px; margin-bottom: 24px;">
      <div style="font-size: 14px; color: #64748B;">Prepared for</div>
      <div style="font-size: 20px; font-weight: 600; color: #1E293B;">${escapeHtml(data.companyName)}</div>
    </div>
    <div class="cover-meta">
      <div>Generated on ${formattedDate}</div>
      <div>Prepared by ${escapeHtml(data.author)}</div>
    </div>
  </div>
  
  <div class="page-break"></div>

  <!-- Table of Contents -->
  <div class="content-wrapper">
    <div class="header">
      ${headerLogo}
      <div class="report-meta">
        <div>${formattedDate}</div>
        <div>Contents</div>
      </div>
    </div>
    <div class="section">
      <div class="section-title" style="font-size: 22px; border-bottom: 2px solid #6366F1; padding-bottom: 10px; margin-bottom: 24px;">Table of Contents</div>
      <div style="font-size: 14px; line-height: 2.2;">
        ${data.executiveSummary ? `<div style="display: flex; justify-content: space-between; border-bottom: 1px dotted #cbd5e1; padding: 4px 0;"><span style="font-weight: 500;">Executive Summary</span></div>` : ""}
        ${data.companyProfile ? `<div style="display: flex; justify-content: space-between; border-bottom: 1px dotted #cbd5e1; padding: 4px 0;"><span style="font-weight: 500;">Company Baseline</span></div>` : ""}
        ${data.competitors.length > 0 ? `<div style="display: flex; justify-content: space-between; border-bottom: 1px dotted #cbd5e1; padding: 4px 0;"><span style="font-weight: 500;">Competitors Overview (${data.competitors.length})</span></div>` : ""}
        ${data.analysis?.themes?.length ? `<div style="display: flex; justify-content: space-between; border-bottom: 1px dotted #cbd5e1; padding: 4px 0;"><span style="font-weight: 500;">Competitive Themes</span></div>` : ""}
        ${data.analysis?.messaging?.length ? `<div style="display: flex; justify-content: space-between; border-bottom: 1px dotted #cbd5e1; padding: 4px 0;"><span style="font-weight: 500;">Messaging Comparison</span></div>` : ""}
        ${activeGaps.length ? `<div style="display: flex; justify-content: space-between; border-bottom: 1px dotted #cbd5e1; padding: 4px 0;"><span style="font-weight: 500;">Gap Analysis (${activeGaps.length} gaps identified)</span></div>` : ""}
        ${data.recommendations.length > 0 ? `<div style="display: flex; justify-content: space-between; border-bottom: 1px dotted #cbd5e1; padding: 4px 0;"><span style="font-weight: 500;">Recommendations (${data.recommendations.length})</span></div>` : ""}
        ${data.battlecards.length > 0 ? `<div style="display: flex; justify-content: space-between; border-bottom: 1px dotted #cbd5e1; padding: 4px 0;"><span style="font-weight: 500;">Battlecards (${data.battlecards.length})</span></div>` : ""}
        ${data.marketingPlans?.length ? `<div style="display: flex; justify-content: space-between; border-bottom: 1px dotted #cbd5e1; padding: 4px 0;"><span style="font-weight: 500;">Marketing Plans (${data.marketingPlans.length})</span></div>` : ""}
        ${data.gtmPlan ? `<div style="display: flex; justify-content: space-between; border-bottom: 1px dotted #cbd5e1; padding: 4px 0;"><span style="font-weight: 500;">Go-To-Market Plan</span></div>` : ""}
        ${data.messagingFramework ? `<div style="display: flex; justify-content: space-between; border-bottom: 1px dotted #cbd5e1; padding: 4px 0;"><span style="font-weight: 500;">Messaging & Positioning Framework</span></div>` : ""}
      </div>
    </div>
    ${ORBIT_FOOTER}
  </div>

  <div class="page-break"></div>

  ${data.executiveSummary ? `
  <div class="content-wrapper">
    <div class="header">
      ${headerLogo}
      <div class="report-meta">
        <div>${formattedDate}</div>
        <div>Executive Summary</div>
      </div>
    </div>

    <div class="section">
      <div class="section-title" style="font-size: 22px; border-bottom: 2px solid #6366F1; padding-bottom: 10px; margin-bottom: 24px;">Executive Summary</div>
      
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
        <div style="background: linear-gradient(135deg, #f8fafc, #f1f5f9); border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
            <div style="width: 32px; height: 32px; background: #6366f1; border-radius: 8px; display: flex; align-items: center; justify-content: center;">
              <span style="color: white; font-size: 16px;">🏢</span>
            </div>
            <div style="font-size: 16px; font-weight: 600; color: #1e293b;">Company Snapshot</div>
          </div>
          <div style="color: #475569; font-size: 13px; line-height: 1.7;">${escapeHtml(data.executiveSummary.companySnapshot || "")}</div>
        </div>
        
        <div style="background: linear-gradient(135deg, #f8fafc, #f1f5f9); border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
            <div style="width: 32px; height: 32px; background: #10b981; border-radius: 8px; display: flex; align-items: center; justify-content: center;">
              <span style="color: white; font-size: 16px;">🎯</span>
            </div>
            <div style="font-size: 16px; font-weight: 600; color: #1e293b;">Market Position</div>
          </div>
          <div style="color: #475569; font-size: 13px; line-height: 1.7;">${escapeHtml(data.executiveSummary.marketPosition || "")}</div>
        </div>
        
        <div style="background: linear-gradient(135deg, #f8fafc, #f1f5f9); border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
            <div style="width: 32px; height: 32px; background: #f59e0b; border-radius: 8px; display: flex; align-items: center; justify-content: center;">
              <span style="color: white; font-size: 16px;">⚔️</span>
            </div>
            <div style="font-size: 16px; font-weight: 600; color: #1e293b;">Competitive Landscape</div>
          </div>
          <div style="color: #475569; font-size: 13px; line-height: 1.7;">${escapeHtml(data.executiveSummary.competitiveLandscape || "")}</div>
        </div>
        
        <div style="background: linear-gradient(135deg, #f8fafc, #f1f5f9); border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
            <div style="width: 32px; height: 32px; background: #8b5cf6; border-radius: 8px; display: flex; align-items: center; justify-content: center;">
              <span style="color: white; font-size: 16px;">💡</span>
            </div>
            <div style="font-size: 16px; font-weight: 600; color: #1e293b;">Opportunities</div>
          </div>
          <div style="color: #475569; font-size: 13px; line-height: 1.7;">${escapeHtml(data.executiveSummary.opportunities || "")}</div>
        </div>
      </div>
    </div>

    ${ORBIT_FOOTER}
  </div>

  <div class="page-break"></div>
  ` : ""}

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
        <div style="display: flex; align-items: flex-start; gap: 16px;">
          ${data.companyProfile.faviconUrl ? `<img src="${data.companyProfile.faviconUrl}" alt="Logo" style="width: 48px; height: 48px; border-radius: 8px; object-fit: contain; background: #f1f5f9;" />` : `<div style="width: 48px; height: 48px; border-radius: 8px; background: linear-gradient(135deg, #1e3a5f, #3b82f6); display: flex; align-items: center; justify-content: center; color: white; font-weight: 700; font-size: 18px;">${escapeHtml(data.companyProfile.companyName.charAt(0))}</div>`}
          <div style="flex: 1;">
            <div class="company-name">${escapeHtml(data.companyProfile.companyName)}</div>
            <div class="company-url">${escapeHtml(data.companyProfile.websiteUrl)}</div>
          </div>
        </div>
        ${data.companyProfile.description ? `<div class="company-desc" style="margin-top: 12px;">${escapeHtml(data.companyProfile.description)}</div>` : ""}
        ${(data.companyProfile.headquarters || data.companyProfile.founded || data.companyProfile.employeeCount || data.companyProfile.revenue || data.companyProfile.fundingRaised) ? `
        <div style="margin-top: 16px; padding: 12px; background: #f8fafc; border-radius: 8px; display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px;">
          ${data.companyProfile.headquarters ? `<div><div style="font-size: 10px; color: #64748b; text-transform: uppercase; margin-bottom: 2px;">Headquarters</div><div style="font-size: 13px; color: #1e293b;">${escapeHtml(data.companyProfile.headquarters)}</div></div>` : ''}
          ${data.companyProfile.founded ? `<div><div style="font-size: 10px; color: #64748b; text-transform: uppercase; margin-bottom: 2px;">Founded</div><div style="font-size: 13px; color: #1e293b;">${escapeHtml(data.companyProfile.founded)}</div></div>` : ''}
          ${data.companyProfile.employeeCount ? `<div><div style="font-size: 10px; color: #64748b; text-transform: uppercase; margin-bottom: 2px;">Employees</div><div style="font-size: 13px; color: #1e293b;">${escapeHtml(data.companyProfile.employeeCount)}</div></div>` : ''}
          ${data.companyProfile.revenue ? `<div><div style="font-size: 10px; color: #64748b; text-transform: uppercase; margin-bottom: 2px;">Revenue</div><div style="font-size: 13px; color: #1e293b;">${escapeHtml(data.companyProfile.revenue)}</div></div>` : ''}
          ${data.companyProfile.fundingRaised ? `<div><div style="font-size: 10px; color: #64748b; text-transform: uppercase; margin-bottom: 2px;">Funding</div><div style="font-size: 13px; color: #1e293b;">${escapeHtml(data.companyProfile.fundingRaised)}</div></div>` : ''}
        </div>
        ` : ''}
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
      <div class="section-title">Identified Gaps${activeGaps.length > 0 ? ` (${activeGaps.length})` : ''}</div>
      ${gapCards || '<div class="empty-state">No active gaps identified. Run analysis to discover opportunities.</div>'}
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

  ${data.productFeatures && data.productFeatures.length > 0 ? `
  <div class="page-break"></div>
  <div class="content-wrapper">
    <div class="header">
      ${headerLogo}
      <div class="report-meta">
        <div>${formattedDate}</div>
        <div>Product Features</div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">${data.baselineProductName ? escapeHtml(data.baselineProductName) + " - " : ""}Features (${data.productFeatures.length})</div>
      ${featureCards}
    </div>

    ${ORBIT_FOOTER}
  </div>
  ` : ""}

  ${data.roadmapItems && data.roadmapItems.length > 0 ? `
  <div class="page-break"></div>
  <div class="content-wrapper">
    <div class="header">
      ${headerLogo}
      <div class="report-meta">
        <div>${formattedDate}</div>
        <div>Product Roadmap</div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">${data.baselineProductName ? escapeHtml(data.baselineProductName) + " - " : ""}Roadmap (${data.roadmapItems.length})</div>
      ${roadmapCards}
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

  ${data.products.length > 0 ? `
  <div class="page-break"></div>
  <div class="content-wrapper">
    <div class="header">
      ${headerLogo}
      <div class="report-meta">
        <div>${formattedDate}</div>
        <div>Products</div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Products (${data.products.length})</div>
      ${productCards || '<div class="empty-state">No products defined in this market.</div>'}
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
        <div>Product Analysis Projects</div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Active Projects (${data.projects.length})</div>
      ${projectCards}
    </div>

    ${ORBIT_FOOTER}
  </div>
  ` : ""}

  ${(data.recentActivity && data.recentActivity.length > 0) ? `
  <div class="page-break"></div>
  <div class="content-wrapper">
    <div class="header">
      ${headerLogo}
      <div class="report-meta">
        <div>${formattedDate}</div>
        <div>Recent Activity</div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Recent Competitor Activity</div>
      <p style="color: #64748B; font-size: 13px; margin-bottom: 16px;">Recent website updates, blog posts, and social media activity from tracked competitors.</p>
      ${recentActivityCards}
    </div>

    ${ORBIT_FOOTER}
  </div>
  ` : ""}

  ${(data.marketingPlans && data.marketingPlans.length > 0) ? `
  <div class="page-break"></div>
  <div class="content-wrapper">
    <div class="header">
      ${headerLogo}
      <div class="report-meta">
        <div>${formattedDate}</div>
        <div>Marketing Plans</div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Marketing Plans (${data.marketingPlans.length})</div>
      ${marketingPlanCards || '<div class="empty-state">No marketing plans defined.</div>'}
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
      <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 24px; color: #475569; font-size: 14px;">
        ${markdownToHtml(data.gtmPlan)}
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
      <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 24px; color: #475569; font-size: 14px;">
        ${markdownToHtml(data.messagingFramework)}
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
  let baselineProducts: ProductSummary[] = [];

  // Determine if the market is the default market for correct context filtering
  const defaultMarket = await storage.getDefaultMarket(tenant.id);
  const effectiveMarketId = marketId || defaultMarket?.id || "";
  const isDefaultMarket = defaultMarket?.id === effectiveMarketId;
  
  const contextFilter = { 
    tenantId: tenant.id, 
    tenantDomain, 
    marketId: effectiveMarketId,
    isDefaultMarket
  };

  if (marketId) {
    const market = await storage.getMarket(marketId);
    marketName = market?.name;
  } else if (defaultMarket) {
    marketName = defaultMarket.name;
  }

  let baselineProductId: string | null = null;
  let baselineProductName: string | undefined;
  let productFeatures: ProductFeatureData[] = [];
  let roadmapItems: RoadmapItemData[] = [];

  if (scope === "project" && projectId) {
    const project = await storage.getClientProject(projectId);
    if (!project) {
      throw new Error("Project not found");
    }
    projectName = project.name;
    companyProfile = (await storage.getCompanyProfileByContext(contextFilter)) || null;
    
    const projectProducts = await storage.getProjectProducts(projectId);
    const baselineProduct = projectProducts.find(pp => pp.role === "baseline");
    const competitorProducts = projectProducts.filter(pp => pp.role === "competitor");
    
    // Get competitors from the project's competitor products
    const competitorIds: string[] = [];
    for (const pp of competitorProducts) {
      if (pp.product.competitorId && !competitorIds.includes(pp.product.competitorId)) {
        competitorIds.push(pp.product.competitorId);
      }
    }
    
    // Fetch the actual competitor records
    for (const compId of competitorIds) {
      const comp = await storage.getCompetitor(compId);
      if (comp) {
        competitors.push(comp);
      }
    }
    
    // Also include competitor products as summary items for display
    for (const pp of competitorProducts) {
      baselineProducts.push({
        id: pp.product.id,
        name: pp.product.name,
        description: pp.product.description,
        competitivePositionSummary: pp.product.competitivePositionSummary,
        status: "competitor",
        featureCount: (await storage.getProductFeaturesByProduct(pp.product.id)).length,
        roadmapCount: (await storage.getRoadmapItemsByProduct(pp.product.id)).length,
      });
    }
    
    if (baselineProduct) {
      baselineProductId = baselineProduct.productId;
      baselineProductName = baselineProduct.product.name;
      
      // Add baseline product to products list
      baselineProducts.unshift({
        id: baselineProduct.product.id,
        name: baselineProduct.product.name,
        description: baselineProduct.product.description,
        competitivePositionSummary: baselineProduct.product.competitivePositionSummary,
        status: "baseline",
        featureCount: 0,
        roadmapCount: 0,
      });
      
      const features = await storage.getProductFeaturesByProduct(baselineProductId);
      productFeatures = features.map(f => ({
        id: f.id,
        name: f.name,
        description: f.description,
        category: f.category,
        status: f.status,
        priority: f.priority,
        targetQuarter: f.targetQuarter,
        targetYear: f.targetYear,
      }));
      
      // Update baseline product counts
      if (baselineProducts.length > 0 && baselineProducts[0].status === "baseline") {
        baselineProducts[0].featureCount = features.length;
      }
      
      const roadmap = await storage.getRoadmapItemsByProduct(baselineProductId);
      roadmapItems = roadmap.map(r => ({
        id: r.id,
        title: r.title,
        description: r.description,
        quarter: r.quarter,
        year: r.year,
        effort: r.effort,
        status: r.status,
        aiRecommended: r.aiRecommended || false,
      }));
      
      if (baselineProducts.length > 0 && baselineProducts[0].status === "baseline") {
        baselineProducts[0].roadmapCount = roadmap.length;
      }
    }
  } else {
    companyProfile = (await storage.getCompanyProfileByContext(contextFilter)) || null;
    competitors = await storage.getCompetitorsByContext(contextFilter);
    
    const allProjects = await storage.getClientProjectsByContext(contextFilter);
    for (const p of allProjects) {
      const projProducts = await storage.getProjectProducts(p.id);
      projects.push({
        id: p.id,
        name: p.name,
        clientName: p.clientName || undefined,
        status: p.status,
        productCount: projProducts.length,
      });
    }
    
    // Fetch all products in the market for baseline reports
    const allProducts = await storage.getProductsByContext(contextFilter);
    for (const prod of allProducts) {
      const features = await storage.getProductFeaturesByProduct(prod.id);
      const roadmap = await storage.getRoadmapItemsByProduct(prod.id);
      baselineProducts.push({
        id: prod.id,
        name: prod.name,
        description: prod.description,
        competitivePositionSummary: prod.competitivePositionSummary,
        status: prod.isBaseline ? "baseline" : "competitor",
        featureCount: features.length,
        roadmapCount: roadmap.length,
      });
    }
  }

  // Fetch marketing plans for baseline reports
  let marketingPlanSummaries: MarketingPlanSummary[] = [];
  if (scope === "baseline") {
    const marketingPlans = await storage.getMarketingPlans({ tenantDomain, marketId: marketId || null });
    for (const plan of marketingPlans) {
      const tasks = await storage.getMarketingTasks(plan.id, { tenantDomain, marketId: marketId || null });
      const tasksByGroup: Record<string, number> = {};
      const tasksByTimeframe: Record<string, number> = {};
      for (const task of tasks) {
        tasksByGroup[task.activityGroup] = (tasksByGroup[task.activityGroup] || 0) + 1;
        tasksByTimeframe[task.timeframe] = (tasksByTimeframe[task.timeframe] || 0) + 1;
      }
      marketingPlanSummaries.push({
        id: plan.id,
        name: plan.name,
        fiscalYear: plan.fiscalYear,
        description: plan.description,
        status: plan.status,
        taskCount: tasks.length,
        tasksByGroup,
        tasksByTimeframe,
      });
    }
  }

  // Fetch executive summary for baseline reports
  let executiveSummary: ExecutiveSummaryData | null = null;
  if (scope === "baseline") {
    const execSummaryRecord = await storage.getExecutiveSummaryByContext(contextFilter);
    if (execSummaryRecord) {
      // Executive summary fields are stored directly on the record, not in a nested content object
      executiveSummary = {
        companySnapshot: execSummaryRecord.companySnapshot || "",
        marketPosition: execSummaryRecord.marketPosition || "",
        competitiveLandscape: execSummaryRecord.competitiveLandscape || "",
        opportunities: execSummaryRecord.opportunities || "",
      };
    }
  }

  // For project-scoped reports, don't include market-level analysis (themes/messaging)
  // as it's not relevant to product-vs-product comparison
  const analysis = scope === "baseline" ? await storage.getLatestAnalysisByContext(contextFilter) : null;
    
  // Get project-specific recommendations if available, otherwise market recommendations for baseline
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

  // Build recent activity from competitor data
  const recentActivity: RecentActivityItem[] = [];
  for (const c of competitorsWithAnalysis) {
    const crawlData = (c as any).crawlData as any;
    const blogSnapshot = (c as any).blogSnapshot as any;
    const linkedIn = (c as any).linkedInEngagement as any;
    const instagram = (c as any).instagramEngagement as any;
    
    // Website changes
    if (crawlData?.crawledAt) {
      const pageCount = crawlData.pages?.length || 0;
      if (pageCount > 0) {
        recentActivity.push({
          competitorName: c.name,
          type: "website",
          description: `${pageCount} pages crawled${crawlData.totalWordCount ? ` (${crawlData.totalWordCount.toLocaleString()} words)` : ""}`,
          date: new Date(crawlData.crawledAt),
        });
      }
    }
    
    // Blog posts
    if (blogSnapshot?.postCount && blogSnapshot.postCount > 0) {
      const latestTitle = blogSnapshot.latestTitles?.[0] || "Recent blog activity";
      recentActivity.push({
        competitorName: c.name,
        type: "blog",
        description: `${blogSnapshot.postCount} blog posts tracked. Latest: "${latestTitle.slice(0, 60)}${latestTitle.length > 60 ? "..." : ""}"`,
        date: blogSnapshot.lastChecked ? new Date(blogSnapshot.lastChecked) : undefined,
      });
    }
    
    // Social presence
    if (linkedIn?.followers || instagram?.followers) {
      const parts = [];
      if (linkedIn?.followers) parts.push(`LinkedIn: ${linkedIn.followers.toLocaleString()} followers`);
      if (instagram?.followers) parts.push(`Instagram: ${instagram.followers.toLocaleString()} followers`);
      recentActivity.push({
        competitorName: c.name,
        type: "social",
        description: parts.join(", "),
        date: linkedIn?.lastUpdated ? new Date(linkedIn.lastUpdated) : undefined,
      });
    }
  }
  // Sort by date, most recent first, limit to 15 items
  recentActivity.sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return b.date.getTime() - a.date.getTime();
  });
  const limitedActivity = recentActivity.slice(0, 15);

  const reportData: ReportData = {
    companyProfile,
    companyName: companyProfile?.companyName || tenant.name || tenantDomain,
    executiveSummary,
    competitors: competitorsWithAnalysis,
    analysis: analysis ? {
      themes: Array.isArray(analysis.themes) ? analysis.themes : [],
      messaging: Array.isArray(analysis.messaging) ? analysis.messaging : [],
      gaps: Array.isArray(analysis.gaps) ? analysis.gaps : [],
    } : null,
    recommendations,
    battlecards,
    projects,
    products: baselineProducts,
    generatedAt: new Date(),
    tenantDomain,
    marketName,
    reportName,
    author: user.name || user.email,
    scope,
    projectName,
    gtmPlan,
    messagingFramework,
    baselineProductName,
    productFeatures: productFeatures.length > 0 ? productFeatures : undefined,
    roadmapItems: roadmapItems.length > 0 ? roadmapItems : undefined,
    marketingPlans: marketingPlanSummaries.length > 0 ? marketingPlanSummaries : undefined,
    recentActivity: limitedActivity.length > 0 ? limitedActivity : undefined,
  };

  const html = generateReportHtml(reportData);
  const startTime = Date.now();

  const executablePath = await findChromiumPath();
  console.log(`[Report PDF] Starting generation, chromium path: ${executablePath || 'auto-detect'}`);

  const browser = await puppeteer.launch({
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
      "--disable-web-security",
      "--disable-features=IsolateOrigins,site-per-process",
      "--js-flags=--max-old-space-size=256",
      "--disable-software-rasterizer",
    ],
    timeout: 180000,
    protocolTimeout: 180000,
  });

  console.log(`[Report PDF] Browser launched in ${Date.now() - startTime}ms`);

  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });
    await page.setViewport({ width: 800, height: 600 });
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 30000 });
    
    console.log(`[Report PDF] Content loaded in ${Date.now() - startTime}ms`);
    
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
    
    console.log(`[Report PDF] PDF generated in ${Date.now() - startTime}ms, size: ${sizeLabel}`);

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

interface CompetitorReportData {
  competitor: Competitor;
  companyProfile: CompanyProfile | null;
  battlecard: Battlecard | null;
  scores: {
    overallScore: number;
    innovationScore: number;
    marketPresenceScore: number;
  } | null;
  generatedAt: Date;
  tenantDomain: string;
  marketName?: string;
  reportName: string;
  author: string;
}

function generateCompetitorReportHtml(data: CompetitorReportData): string {
  const formattedDate = format(data.generatedAt, "MMMM d, yyyy");
  const synozurLogo = getSynozurLogoBase64();
  const orbitLogo = getOrbitLogoBase64();
  const fontFaces = getFontFacesCss();

  const headerLogo = orbitLogo && synozurLogo
    ? `<div style="display: flex; align-items: center; gap: 12px;"><img src="${synozurLogo}" alt="Synozur" style="height: 24px; width: auto;"><span style="color: #94A3B8; font-size: 20px;">|</span><img src="${orbitLogo}" alt="Orbit" style="height: 32px; width: auto;"></div>`
    : orbitLogo
      ? `<div style="display: flex; align-items: center; gap: 8px;"><img src="${orbitLogo}" alt="Orbit" style="height: 32px; width: auto;"></div>`
      : synozurLogo
        ? `<div style="display: flex; align-items: center; gap: 8px;"><img src="${synozurLogo}" alt="Synozur" style="height: 28px; width: auto;"><span style="font-size: 24px; font-weight: 700; color: #1E293B;">Orbit</span></div>`
        : `<div class="logo"><span>Orbit</span></div>`;

  const coverLogo = orbitLogo && synozurLogo
    ? `<div style="display: flex; align-items: center; gap: 16px; margin-bottom: 24px;"><img src="${synozurLogo}" alt="Synozur" style="height: 48px; width: auto;"><span style="color: #94A3B8; font-size: 28px;">|</span><img src="${orbitLogo}" alt="Orbit" style="height: 56px; width: auto;"></div>`
    : orbitLogo
      ? `<div style="margin-bottom: 24px;"><img src="${orbitLogo}" alt="Orbit" style="height: 56px; width: auto;"></div>`
      : synozurLogo
        ? `<img src="${synozurLogo}" alt="Synozur" style="height: 40px; width: auto; margin-bottom: 24px;">`
        : "";

  const analysisData = data.competitor.analysisData as any;
  const linkedIn = data.competitor.linkedInEngagement as any;
  const instagram = data.competitor.instagramEngagement as any;
  const crawlData = data.competitor.crawlData as any;
  const blogSnapshot = data.competitor.blogSnapshot as any;

  const ORBIT_FOOTER = `
    <div style="text-align: center; padding: 12px 0; border-top: 1px solid #E2E8F0; margin-top: 40px; font-size: 10px; color: #64748B;">
      <div style="margin-bottom: 4px;">Orbit • orbit.synozur.com</div>
      <div>Published by The Synozur Alliance LLC • www.synozur.com • © 2026 All Rights Reserved</div>
      <div style="margin-top: 4px;">Confidential - ${escapeHtml(data.tenantDomain)} | Generated ${formattedDate}</div>
    </div>
  `;

  const battlecardHtml = data.battlecard ? `
    <div class="section">
      <div class="section-title">Battlecard</div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px;">
        <div style="background: #FEF2F2; border: 1px solid #FECACA; border-radius: 8px; padding: 16px;">
          <div style="font-weight: 600; color: #DC2626; font-size: 13px; margin-bottom: 12px;">THEIR STRENGTHS</div>
          ${(Array.isArray(data.battlecard.strengths) ? data.battlecard.strengths : []).map((s: string) => `<div style="color: #475569; font-size: 13px; margin-bottom: 6px;">• ${escapeHtml(String(s))}</div>`).join("") || '<div style="color: #94A3B8; font-size: 13px;">No strengths identified</div>'}
        </div>
        <div style="background: #FFFBEB; border: 1px solid #FDE68A; border-radius: 8px; padding: 16px;">
          <div style="font-weight: 600; color: #D97706; font-size: 13px; margin-bottom: 12px;">THEIR WEAKNESSES</div>
          ${(Array.isArray(data.battlecard.weaknesses) ? data.battlecard.weaknesses : []).map((w: string) => `<div style="color: #475569; font-size: 13px; margin-bottom: 6px;">• ${escapeHtml(String(w))}</div>`).join("") || '<div style="color: #94A3B8; font-size: 13px;">No weaknesses identified</div>'}
        </div>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
        <div style="background: #ECFDF5; border: 1px solid #A7F3D0; border-radius: 8px; padding: 16px;">
          <div style="font-weight: 600; color: #059669; font-size: 13px; margin-bottom: 12px;">OUR ADVANTAGES</div>
          ${(Array.isArray(data.battlecard.ourAdvantages) ? data.battlecard.ourAdvantages : []).map((a: string) => `<div style="color: #475569; font-size: 13px; margin-bottom: 6px;">• ${escapeHtml(String(a))}</div>`).join("") || '<div style="color: #94A3B8; font-size: 13px;">No advantages identified</div>'}
        </div>
        <div style="background: #EEF2FF; border: 1px solid #C7D2FE; border-radius: 8px; padding: 16px;">
          <div style="font-weight: 600; color: #4F46E5; font-size: 13px; margin-bottom: 12px;">HOW TO WIN</div>
          ${(Array.isArray(data.battlecard.talkingPoints) ? data.battlecard.talkingPoints : []).map((t: string) => `<div style="color: #475569; font-size: 13px; margin-bottom: 6px;">• ${escapeHtml(String(t))}</div>`).join("") || '<div style="color: #94A3B8; font-size: 13px;">No talking points defined</div>'}
        </div>
      </div>
    </div>
  ` : '';

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
      background: #FFFFFF;
      color: #1E293B;
      margin: 0;
      padding: 0;
      line-height: 1.6;
      font-size: 14px;
    }
    .cover-page {
      height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      text-align: center;
      padding: 40px;
      background: linear-gradient(135deg, #0F172A 0%, #1E293B 50%, #334155 100%);
      color: white;
    }
    .cover-title {
      font-size: 36px;
      font-weight: 700;
      margin-bottom: 16px;
    }
    .cover-subtitle {
      font-size: 20px;
      color: #94A3B8;
      margin-bottom: 40px;
    }
    .cover-meta {
      font-size: 14px;
      color: #64748B;
    }
    .page-break {
      page-break-after: always;
    }
    .content-wrapper {
      padding: 20px 0;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 16px;
      border-bottom: 2px solid #E2E8F0;
      margin-bottom: 24px;
    }
    .report-meta {
      text-align: right;
      font-size: 12px;
      color: #64748B;
    }
    .section {
      margin-bottom: 32px;
    }
    .section-title {
      font-size: 20px;
      font-weight: 600;
      color: #1E293B;
      margin-bottom: 16px;
      padding-bottom: 8px;
      border-bottom: 1px solid #E2E8F0;
    }
    .stat-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
      margin-bottom: 24px;
    }
    .stat-card {
      background: #F8FAFC;
      border: 1px solid #E2E8F0;
      border-radius: 8px;
      padding: 16px;
      text-align: center;
    }
    .stat-value {
      font-size: 28px;
      font-weight: 700;
      color: #6366F1;
    }
    .stat-label {
      font-size: 12px;
      color: #64748B;
      margin-top: 4px;
    }
    .info-card {
      background: #F8FAFC;
      border: 1px solid #E2E8F0;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 16px;
    }
    .info-label {
      font-size: 12px;
      font-weight: 600;
      color: #64748B;
      margin-bottom: 4px;
      text-transform: uppercase;
    }
    .info-value {
      font-size: 14px;
      color: #1E293B;
    }
    .keywords-container {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 8px;
    }
    .keyword-tag {
      background: #EEF2FF;
      color: #4F46E5;
      padding: 4px 12px;
      border-radius: 16px;
      font-size: 12px;
    }
  </style>
</head>
<body>

  <!-- Cover Page -->
  <div class="cover-page">
    ${coverLogo}
    <div class="cover-title">Competitor Intelligence Report</div>
    <div class="cover-subtitle">${escapeHtml(data.competitor.name)}</div>
    <div class="cover-meta">
      <div>${formattedDate}</div>
      <div>Prepared by ${escapeHtml(data.author)}</div>
      ${data.marketName ? `<div style="margin-top: 8px;">Market: ${escapeHtml(data.marketName)}</div>` : ""}
    </div>
  </div>

  <div class="page-break"></div>

  <!-- Overview Page -->
  <div class="content-wrapper">
    <div class="header">
      ${headerLogo}
      <div class="report-meta">
        <div>${formattedDate}</div>
        <div>Competitor Overview</div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">${escapeHtml(data.competitor.name)}</div>
      
      ${data.scores ? `
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-value">${data.scores.overallScore.toFixed(0)}</div>
          <div class="stat-label">Orbit Score</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${data.scores.innovationScore.toFixed(0)}</div>
          <div class="stat-label">Innovation Score</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${data.scores.marketPresenceScore.toFixed(0)}</div>
          <div class="stat-label">Market Presence</div>
        </div>
      </div>
      ` : ''}

      <div class="info-card">
        <div class="info-label">Website</div>
        <div class="info-value">${escapeHtml(data.competitor.url || 'Not specified')}</div>
      </div>

      ${analysisData?.summary ? `
      <div class="info-card">
        <div class="info-label">Summary</div>
        <div class="info-value">${escapeHtml(analysisData.summary)}</div>
      </div>
      ` : ''}

      ${analysisData?.valueProposition ? `
      <div class="info-card">
        <div class="info-label">Value Proposition</div>
        <div class="info-value">${escapeHtml(analysisData.valueProposition)}</div>
      </div>
      ` : ''}

      ${analysisData?.targetAudience ? `
      <div class="info-card">
        <div class="info-label">Target Audience</div>
        <div class="info-value">${escapeHtml(analysisData.targetAudience)}</div>
      </div>
      ` : ''}

      ${analysisData?.tone ? `
      <div class="info-card">
        <div class="info-label">Brand Tone</div>
        <div class="info-value">${escapeHtml(analysisData.tone)}</div>
      </div>
      ` : ''}

      ${analysisData?.keywords && Array.isArray(analysisData.keywords) && analysisData.keywords.length > 0 ? `
      <div class="info-card">
        <div class="info-label">Key Themes</div>
        <div class="keywords-container">
          ${analysisData.keywords.slice(0, 10).map((k: string) => `<span class="keyword-tag">${escapeHtml(k)}</span>`).join("")}
        </div>
      </div>
      ` : ''}

      ${analysisData?.keyMessages && Array.isArray(analysisData.keyMessages) && analysisData.keyMessages.length > 0 ? `
      <div class="info-card">
        <div class="info-label">Key Messages</div>
        <div class="info-value">
          ${analysisData.keyMessages.map((m: string) => `<div style="margin-bottom: 6px;">• ${escapeHtml(m)}</div>`).join("")}
        </div>
      </div>
      ` : ''}
    </div>

    ${ORBIT_FOOTER}
  </div>

  ${data.battlecard ? `
  <div class="page-break"></div>
  <div class="content-wrapper">
    <div class="header">
      ${headerLogo}
      <div class="report-meta">
        <div>${formattedDate}</div>
        <div>Competitive Battlecard</div>
      </div>
    </div>

    ${battlecardHtml}

    ${ORBIT_FOOTER}
  </div>
  ` : ''}

  ${(linkedIn || instagram || blogSnapshot) ? `
  <div class="page-break"></div>
  <div class="content-wrapper">
    <div class="header">
      ${headerLogo}
      <div class="report-meta">
        <div>${formattedDate}</div>
        <div>Social & Web Presence</div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Digital Presence</div>
      
      ${linkedIn ? `
      <div class="info-card">
        <div class="info-label">LinkedIn</div>
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-top: 8px;">
          ${linkedIn.followers ? `<div><div style="font-size: 20px; font-weight: 600; color: #0A66C2;">${linkedIn.followers.toLocaleString()}</div><div style="font-size: 11px; color: #64748B;">Followers</div></div>` : ''}
          ${linkedIn.engagementRate ? `<div><div style="font-size: 20px; font-weight: 600; color: #0A66C2;">${(linkedIn.engagementRate * 100).toFixed(1)}%</div><div style="font-size: 11px; color: #64748B;">Engagement Rate</div></div>` : ''}
          ${linkedIn.postFrequency ? `<div><div style="font-size: 20px; font-weight: 600; color: #0A66C2;">${linkedIn.postFrequency}</div><div style="font-size: 11px; color: #64748B;">Posts/Week</div></div>` : ''}
        </div>
      </div>
      ` : ''}

      ${instagram ? `
      <div class="info-card">
        <div class="info-label">Instagram</div>
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-top: 8px;">
          ${instagram.followers ? `<div><div style="font-size: 20px; font-weight: 600; color: #E4405F;">${instagram.followers.toLocaleString()}</div><div style="font-size: 11px; color: #64748B;">Followers</div></div>` : ''}
          ${instagram.engagementRate ? `<div><div style="font-size: 20px; font-weight: 600; color: #E4405F;">${(instagram.engagementRate * 100).toFixed(1)}%</div><div style="font-size: 11px; color: #64748B;">Engagement Rate</div></div>` : ''}
          ${instagram.postFrequency ? `<div><div style="font-size: 20px; font-weight: 600; color: #E4405F;">${instagram.postFrequency}</div><div style="font-size: 11px; color: #64748B;">Posts/Week</div></div>` : ''}
        </div>
      </div>
      ` : ''}

      ${blogSnapshot ? `
      <div class="info-card">
        <div class="info-label">Blog Activity</div>
        <div class="info-value">
          <div style="font-size: 20px; font-weight: 600; color: #6366F1; margin-bottom: 8px;">${blogSnapshot.postCount || 0} posts tracked</div>
          ${blogSnapshot.latestTitles && Array.isArray(blogSnapshot.latestTitles) ? `
          <div style="margin-top: 8px;">
            <div style="font-size: 12px; color: #64748B; margin-bottom: 4px;">Recent Topics:</div>
            ${blogSnapshot.latestTitles.slice(0, 5).map((t: string) => `<div style="font-size: 13px; color: #475569; margin-bottom: 2px;">• ${escapeHtml(t)}</div>`).join("")}
          </div>
          ` : ''}
        </div>
      </div>
      ` : ''}

      ${crawlData ? `
      <div class="info-card">
        <div class="info-label">Website Crawl</div>
        <div class="info-value">
          ${crawlData.pages?.length ? `<div>${crawlData.pages.length} pages analyzed</div>` : ''}
          ${crawlData.totalWordCount ? `<div style="font-size: 13px; color: #64748B;">${crawlData.totalWordCount.toLocaleString()} total words</div>` : ''}
          ${crawlData.crawledAt ? `<div style="font-size: 12px; color: #94A3B8; margin-top: 4px;">Last crawled: ${format(new Date(crawlData.crawledAt), "MMM d, yyyy")}</div>` : ''}
        </div>
      </div>
      ` : ''}
    </div>

    ${ORBIT_FOOTER}
  </div>
  ` : ''}

</body>
</html>
  `;
}

export async function generateCompetitorPdfReport(
  competitorId: string,
  tenantDomain: string,
  userId: string,
  marketId?: string
): Promise<{ pdfBuffer: Buffer; report: Report }> {
  const user = await storage.getUser(userId);
  if (!user) {
    throw new Error("User not found");
  }

  const competitor = await storage.getCompetitor(competitorId);
  if (!competitor) {
    throw new Error("Competitor not found");
  }

  const tenant = await storage.getTenantByDomain(tenantDomain);
  if (!tenant) {
    throw new Error("Tenant not found");
  }

  let marketName: string | undefined;
  if (marketId) {
    const market = await storage.getMarket(marketId);
    marketName = market?.name;
  }

  const contextFilter = { 
    tenantId: tenant.id, 
    tenantDomain, 
    marketId: marketId || "",
    isDefaultMarket: !marketId
  };

  const companyProfile = await storage.getCompanyProfileByContext(contextFilter);
  
  const battlecards = await storage.getBattlecardsByContext(contextFilter);
  const battlecard = battlecards.find(bc => bc.competitorId === competitorId) || null;

  const analysisData = competitor.analysisData as any;
  const linkedIn = competitor.linkedInEngagement as any;
  const instagram = competitor.instagramEngagement as any;
  const crawlData = competitor.crawlData as any;
  const blogSnapshot = competitor.blogSnapshot as any;

  let scores: CompetitorReportData["scores"] = null;
  if (analysisData) {
    const calculated = calculateScores(
      analysisData,
      linkedIn,
      instagram,
      crawlData,
      blogSnapshot,
      competitor.lastCrawl ? new Date(competitor.lastCrawl) : null
    );
    scores = {
      overallScore: calculated.overallScore,
      innovationScore: calculated.innovationScore,
      marketPresenceScore: calculated.marketPresenceScore,
    };
  }

  const reportName = `Competitor Report - ${competitor.name} - ${format(new Date(), "yyyy-MM-dd")}`;

  const reportData: CompetitorReportData = {
    competitor,
    companyProfile,
    battlecard,
    scores,
    generatedAt: new Date(),
    tenantDomain,
    marketName,
    reportName,
    author: user.name || user.email,
  };

  const html = generateCompetitorReportHtml(reportData);
  const startTime = Date.now();

  const executablePath = await findChromiumPath();
  console.log(`[Competitor PDF] Starting generation for ${competitor.name}, chromium path: ${executablePath || 'auto-detect'}`);

  const browser = await puppeteer.launch({
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
      "--disable-web-security",
      "--disable-features=IsolateOrigins,site-per-process",
      "--js-flags=--max-old-space-size=256",
      "--disable-software-rasterizer",
    ],
    timeout: 180000,
    protocolTimeout: 180000,
  });

  console.log(`[Competitor PDF] Browser launched in ${Date.now() - startTime}ms`);

  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });
    await page.setViewport({ width: 800, height: 600 });
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 30000 });
    
    console.log(`[Competitor PDF] Content loaded in ${Date.now() - startTime}ms`);
    
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
    
    console.log(`[Competitor PDF] PDF generated in ${Date.now() - startTime}ms, size: ${sizeLabel}`);

    const report = await storage.createReport({
      name: reportName,
      date: format(new Date(), "yyyy-MM-dd"),
      type: "Competitor Intelligence",
      size: sizeLabel,
      author: user.name || user.email,
      status: "Generated",
      scope: "baseline",
      projectId: null,
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
