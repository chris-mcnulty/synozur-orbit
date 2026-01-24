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
    return `
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #E2E8F0;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <div style="width: 32px; height: 32px; background: #F1F5F9; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-weight: 600; color: #6366F1; font-size: 14px;">${escapeHtml(c.name.substring(0, 2).toUpperCase())}</div>
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
    const themeName = theme.theme || theme.name || theme.title || "Theme";
    const themeDesc = theme.description || theme.details || theme.us || theme.observation || "";
    const competitorRef = theme.competitorName || theme.competitor || theme.source || "";
    if (!themeDesc && !themeName) return "";
    return `
    <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px; margin-bottom: 12px;">
      <div style="font-weight: 600; color: #1E293B; margin-bottom: 8px;">${escapeHtml(themeDesc || themeName)}</div>
      ${competitorRef ? `<div style="color: #64748B; font-size: 12px; margin-top: 8px;">Based on ${escapeHtml(competitorRef)} profile</div>` : '<div style="color: #64748B; font-size: 12px; margin-top: 8px;">Based on profile</div>'}
    </div>
  `;
  }).filter(Boolean).join("");

  const messagingCards = (data.analysis?.messaging || []).map((msg: any) => {
    const msgName = msg.category || msg.name || "Messaging";
    const competitorRef = msg.competitor || msg.competitorName || msg.targetAudience || "";
    const ourMsg = msg.us || msg.ourMessage || msg.ourPosition || "";
    const compMsg = msg.competitorA || msg.keyMessage || msg.message || msg.them || msg.competitorPosition || msg.description || "";
    if (!ourMsg && !compMsg && !competitorRef) return "";
    return `
    <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px; margin-bottom: 12px;">
      ${competitorRef ? `<div style="font-weight: 600; color: #1E293B; margin-bottom: 10px;">${escapeHtml(competitorRef)}</div>` : ""}
      ${ourMsg ? `<div style="color: #059669; font-size: 13px; margin-bottom: 8px;"><strong>Our Position:</strong> ${escapeHtml(ourMsg)}</div>` : ""}
      ${compMsg ? `<div style="color: #475569; font-size: 14px;"><strong>Competitor:</strong> ${escapeHtml(compMsg)}</div>` : ""}
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
        <div>
          <div style="font-weight: 600; color: #1E293B;">${escapeHtml(prod.name)}</div>
          ${prod.description ? `<div style="font-size: 13px; color: #475569; margin-top: 4px;">${escapeHtml(prod.description.slice(0, 150))}${prod.description.length > 150 ? "..." : ""}</div>` : ""}
        </div>
        <div style="text-align: right;">
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
    
    return `
    <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px; margin-bottom: 12px;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start;">
        <div style="flex: 1;">
          <div style="font-weight: 600; color: #1E293B;">${escapeHtml(plan.name)}</div>
          <div style="font-size: 13px; color: #64748B; margin-top: 2px;">FY ${escapeHtml(plan.fiscalYear)}</div>
          ${plan.description ? `<div style="font-size: 13px; color: #475569; margin-top: 4px;">${escapeHtml(plan.description.slice(0, 150))}${plan.description.length > 150 ? "..." : ""}</div>` : ""}
          ${groupLabels ? `<div style="font-size: 11px; color: #64748B; margin-top: 8px;">${escapeHtml(groupLabels)}</div>` : ""}
        </div>
        <div style="text-align: right; margin-left: 16px;">
          <span style="background: ${statusStyle.bg}; color: ${statusStyle.text}; padding: 4px 8px; border-radius: 4px; font-size: 11px; text-transform: capitalize;">${escapeHtml(plan.status)}</span>
          <div style="font-size: 11px; color: #64748B; margin-top: 4px;">${plan.taskCount} tasks</div>
        </div>
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
      <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 20px; color: #475569; font-size: 13px; line-height: 1.8;">
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
      <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 20px; color: #475569; font-size: 13px; line-height: 1.8;">
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
  let baselineProducts: ProductSummary[] = [];

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
        status: "baseline",
        featureCount: 0, // Will be set below
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
      for (const task of tasks) {
        tasksByGroup[task.activityGroup] = (tasksByGroup[task.activityGroup] || 0) + 1;
      }
      marketingPlanSummaries.push({
        id: plan.id,
        name: plan.name,
        fiscalYear: plan.fiscalYear,
        description: plan.description,
        status: plan.status,
        taskCount: tasks.length,
        tasksByGroup,
      });
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
