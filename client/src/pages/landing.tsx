import React, { useState } from "react";
import PublicLayout from "@/components/layout/PublicLayout";
import SEOHead from "@/components/SEOHead";
import { Link } from "wouter";
import {
  ArrowRight, CheckCircle2, Shield, FileText, Brain, Users, Eye,
  Lock, Code2, Accessibility, Cpu, Activity, ClipboardList,
  BarChart3, TrendingUp, Search, AlertTriangle, BookOpen,
  FileDown, Layers, GitBranch, Sparkles, Telescope, ScanLine,
  BadgeCheck, Scale, Gauge, ChevronRight
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePageTracking } from "@/hooks/use-page-tracking";

const landingJsonLd = [
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "The Synozur Alliance",
    "url": "https://www.synozur.com",
    "logo": "/brand/synozur-horizontal.png",
    "contactPoint": {
      "@type": "ContactPoint",
      "email": "contactus@synozur.com",
      "contactType": "sales"
    }
  },
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "name": "Observatory",
    "applicationCategory": "BusinessApplication",
    "operatingSystem": "Web",
    "description": "Application assurance platform for security, code quality, and accessibility assessment.",
    "author": {
      "@type": "Organization",
      "name": "The Synozur Alliance"
    },
    "featureList": [
      "Security & penetration test findings management",
      "Code quality assessment",
      "Accessibility (WCAG / VPAT) testing",
      "Application readiness scoring",
      "Evidence vault with audit trails",
      "Microsoft Entra SSO"
    ]
  }
];

const modules = [
  {
    id: "security",
    icon: Shield,
    title: "Security Assessment",
    tagline: "Find it before they do",
    description: "Track penetration test findings, vulnerability disclosures, and remediation progress in one structured workbench. Every finding is rated, assigned, linked to evidence, and tracked through to closure.",
    features: [
      "Pen-test finding triage with severity ratings",
      "Remediation workflow with owner assignment",
      "Evidence attachments per finding",
      "CVSS scoring and compliance mapping",
      "Audit trail from discovery to sign-off"
    ]
  },
  {
    id: "code",
    icon: Code2,
    title: "Code Quality",
    tagline: "Ship with confidence",
    description: "Assess code health across repositories — architecture quality, technical debt, dependency risk, and engineering practice maturity. Link findings directly to source files and track improvement over time.",
    features: [
      "Repository-level quality assessments",
      "Dependency and licence risk tracking",
      "Engineering practice maturity scoring",
      "Technical debt cataloguing",
      "Branch and commit traceability"
    ]
  },
  {
    id: "accessibility",
    icon: Accessibility,
    title: "Accessibility (WCAG / VPAT)",
    tagline: "Build for everyone",
    description: "Run structured WCAG 2.1/2.2 assessments against every application component. Generate VPAT worksheets for procurement, export compliance reports as PDF or Word, and track remediation through to certification.",
    features: [
      "WCAG 2.1 / 2.2 criterion-level assessment",
      "VPAT worksheet generation (PDF & Word export)",
      "Component-level findings with screenshots",
      "Remediation tracking per criterion",
      "Accessibility readiness score and trend"
    ]
  },
  {
    id: "architecture",
    icon: Layers,
    title: "Architecture Review",
    tagline: "Validate every layer",
    description: "Document and assess the architecture of each application against your organisation's standards. Capture design decisions, identify structural risks, and measure alignment with approved patterns.",
    features: [
      "Structured architecture review workbench",
      "Design decision documentation",
      "Risk identification and scoring",
      "Pattern compliance checks",
      "Evidence-linked review records"
    ]
  },
  {
    id: "performance",
    icon: Gauge,
    title: "Performance",
    tagline: "Measure what matters",
    description: "Capture load testing results, SLA benchmarks, and performance findings against each application. Surface regressions early and track performance readiness as part of the release gate.",
    features: [
      "Load test result ingestion",
      "SLA benchmark tracking",
      "Performance finding management",
      "Trend charting across assessment cycles",
      "Readiness gate integration"
    ]
  },
  {
    id: "compliance",
    icon: Scale,
    title: "Compliance Mapping",
    tagline: "Prove it to auditors",
    description: "Map findings and evidence to compliance frameworks — ISO 27001, SOC 2, NIST, and more. Generate audit-ready reports that link each control to its assessed status and supporting evidence.",
    features: [
      "Multi-framework control mapping",
      "Control-to-finding linkage",
      "Evidence vault with file attachments",
      "Audit-ready PDF report export",
      "Control status dashboard"
    ]
  }
];

const howItWorks = [
  {
    step: 1,
    icon: ScanLine,
    title: "Register",
    desc: "Add your applications and define the scope — repositories, URLs, environments, and frameworks"
  },
  {
    step: 2,
    icon: ClipboardList,
    title: "Assess",
    desc: "Run structured assessments across security, code, accessibility, architecture, performance, and compliance"
  },
  {
    step: 3,
    icon: AlertTriangle,
    title: "Find",
    desc: "Log findings with severity, owner, and evidence. Link them to WCAG criteria, CVEs, or framework controls"
  },
  {
    step: 4,
    icon: Activity,
    title: "Remediate",
    desc: "Track each finding through triage, fix, and verification. The evidence vault captures every decision"
  },
  {
    step: 5,
    icon: TrendingUp,
    title: "Report",
    desc: "Publish readiness scores, VPAT worksheets, and compliance reports to stakeholders"
  }
];

function ModulePreview({ id }: { id: string }) {
  const base = "bg-gradient-to-br from-primary/5 to-primary/10 rounded-xl border border-primary/20 aspect-video flex items-center justify-center p-6 overflow-hidden";

  if (id === "security") return (
    <div className={base}>
      <div className="w-full bg-background/90 rounded-xl p-4 shadow-xl space-y-2 text-left">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold text-foreground">Pen-Test Findings — Q3</span>
          <span className="text-xs text-red-400 bg-red-400/10 px-2 py-0.5 rounded-full">3 critical open</span>
        </div>
        {[
          { id: "PT-041", title: "SQL injection — /api/search", sev: "Critical", sc: "text-red-400 bg-red-400/10", status: "Open" },
          { id: "PT-038", title: "Insecure direct object ref", sev: "High", sc: "text-orange-400 bg-orange-400/10", status: "In Fix" },
          { id: "PT-035", title: "Missing HSTS header", sev: "Medium", sc: "text-yellow-500 bg-yellow-500/10", status: "Verified" },
        ].map((f, i) => (
          <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
            <span className="text-[10px] font-mono text-muted-foreground w-12 flex-shrink-0">{f.id}</span>
            <span className="text-xs text-foreground flex-1 truncate">{f.title}</span>
            <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium", f.sc)}>{f.sev}</span>
          </div>
        ))}
        <div className="pt-1 flex gap-3 text-[10px] text-muted-foreground">
          <span className="text-red-400">● 3 critical</span>
          <span className="text-orange-400">● 7 high</span>
          <span className="text-green-500">● 12 closed</span>
        </div>
      </div>
    </div>
  );

  if (id === "code") return (
    <div className={base}>
      <div className="w-full bg-background/90 rounded-xl p-4 shadow-xl text-left">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold text-foreground">Code Quality — portal-api</span>
          <span className="text-xs text-primary bg-primary/10 px-2 py-0.5 rounded-full">Score: 74/100</span>
        </div>
        <div className="space-y-2">
          {[
            { label: "Architecture", score: 82, color: "bg-green-500" },
            { label: "Test coverage", score: 61, color: "bg-yellow-500" },
            { label: "Dependency risk", score: 70, color: "bg-yellow-500" },
            { label: "Eng. practices", score: 88, color: "bg-green-500" },
          ].map((row, i) => (
            <div key={i} className="flex items-center gap-3">
              <span className="text-[10px] text-muted-foreground w-24 flex-shrink-0">{row.label}</span>
              <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                <div className={cn("h-full rounded-full", row.color)} style={{ width: `${row.score}%` }} />
              </div>
              <span className="text-[10px] font-mono text-foreground w-8 text-right">{row.score}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 p-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20 flex gap-2 items-start">
          <AlertTriangle size={10} className="text-yellow-500 mt-0.5 flex-shrink-0" />
          <span className="text-[10px] text-muted-foreground">4 dependencies with known CVEs — review recommended</span>
        </div>
      </div>
    </div>
  );

  if (id === "accessibility") return (
    <div className={base}>
      <div className="w-full bg-background/90 rounded-xl p-4 shadow-xl text-left space-y-2">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold text-foreground">WCAG 2.1 Assessment</span>
          <span className="text-xs text-yellow-500 bg-yellow-500/10 px-2 py-0.5 rounded-full">Partial — Level AA</span>
        </div>
        {[
          { criterion: "1.1.1 Non-text content", status: "Pass", sc: "text-green-500" },
          { criterion: "1.4.3 Contrast (min)", status: "Fail", sc: "text-red-400" },
          { criterion: "2.1.1 Keyboard", status: "Pass", sc: "text-green-500" },
          { criterion: "2.4.6 Headings & labels", status: "Partial", sc: "text-yellow-500" },
        ].map((r, i) => (
          <div key={i} className="flex items-center gap-2 p-1.5 bg-muted/50 rounded-lg">
            <span className="text-[10px] text-muted-foreground flex-1">{r.criterion}</span>
            <span className={cn("text-[10px] font-medium", r.sc)}>{r.status}</span>
          </div>
        ))}
        <div className="text-[10px] text-primary mt-1">↓ Export VPAT worksheet</div>
      </div>
    </div>
  );

  if (id === "architecture") return (
    <div className={base}>
      <div className="w-full bg-background/90 rounded-xl p-4 shadow-xl text-left">
        <div className="text-xs font-semibold text-foreground mb-3">Architecture Review — intranet-app</div>
        <div className="grid grid-cols-2 gap-2">
          {[
            { area: "API design", status: "Approved", sc: "text-green-500 bg-green-500/10" },
            { area: "Auth model", status: "Approved", sc: "text-green-500 bg-green-500/10" },
            { area: "Data layer", status: "Review", sc: "text-yellow-500 bg-yellow-500/10" },
            { area: "Infra pattern", status: "Deviation", sc: "text-red-400 bg-red-400/10" },
          ].map((a, i) => (
            <div key={i} className="p-2 bg-muted/50 rounded-lg">
              <div className="text-[10px] text-muted-foreground">{a.area}</div>
              <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded-full mt-1 inline-block", a.sc)}>{a.status}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  if (id === "performance") return (
    <div className={base}>
      <div className="w-full bg-background/90 rounded-xl p-4 shadow-xl text-left space-y-2">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-foreground">Load Test — v2.4 release</span>
          <span className="text-xs text-green-500 bg-green-500/10 px-2 py-0.5 rounded-full">SLA Met</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[
            { l: "P95 latency", v: "142ms", c: "text-green-500" },
            { l: "Throughput", v: "1,840 rps", c: "text-foreground" },
            { l: "Error rate", v: "0.04%", c: "text-green-500" },
          ].map((m, i) => (
            <div key={i} className="text-center p-2 bg-muted/50 rounded-lg">
              <div className={cn("text-sm font-bold", m.c)}>{m.v}</div>
              <div className="text-[10px] text-muted-foreground">{m.l}</div>
            </div>
          ))}
        </div>
        <div className="h-8 bg-muted/30 rounded-lg flex items-end gap-0.5 px-2 pb-1 overflow-hidden">
          {[40, 55, 60, 72, 68, 80, 75, 85, 78, 82, 90, 88].map((h, i) => (
            <div key={i} className="flex-1 bg-primary/60 rounded-sm" style={{ height: `${h}%` }} />
          ))}
        </div>
      </div>
    </div>
  );

  // compliance
  return (
    <div className={base}>
      <div className="w-full bg-background/90 rounded-xl p-4 shadow-xl text-left space-y-2">
        <div className="text-xs font-semibold text-foreground mb-2">ISO 27001 Control Coverage</div>
        {[
          { control: "A.12.6 — Vulnerability mgmt", status: "Compliant", sc: "text-green-500" },
          { control: "A.14.2 — Secure development", status: "Partial", sc: "text-yellow-500" },
          { control: "A.18.1 — Legal requirements", status: "Compliant", sc: "text-green-500" },
          { control: "A.9.4 — Access control", status: "Review", sc: "text-yellow-500" },
        ].map((r, i) => (
          <div key={i} className="flex items-center gap-2 p-1.5 bg-muted/50 rounded-lg">
            <span className="text-[10px] text-muted-foreground flex-1 truncate">{r.control}</span>
            <span className={cn("text-[10px] font-medium", r.sc)}>{r.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Landing() {
  usePageTracking("/");
  const [activeModule, setActiveModule] = useState("security");
  const currentModule = modules.find(m => m.id === activeModule) || modules[0];

  return (
    <PublicLayout>
      <SEOHead
        title="Observatory — Application Assurance Platform | Synozur"
        description="Observatory unifies security assessment, code quality, accessibility testing, and compliance mapping so engineering and assurance teams can measure, track, and prove application readiness."
        path="/"
        jsonLd={landingJsonLd}
      />
      <article>

      {/* ── Hero ── */}
      <section aria-label="Hero" className="relative overflow-hidden py-24 md:py-32 px-6 min-h-[85vh] flex items-center justify-center">
        <div
          className="absolute inset-0 z-0 select-none bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: "url('/images/hero-background.jpg')" }}
        />
        <div className="absolute inset-0 z-0 bg-gradient-to-b from-background/30 via-background/70 to-background" />

        <div className="max-w-5xl mx-auto text-center relative z-10">
          <div
            className="mx-auto mb-4 -mt-8 text-7xl md:text-9xl font-bold tracking-tight text-white select-none"
            style={{ fontFamily: "'Avenir Next LT Pro', sans-serif" }}
          >
            Observatory
          </div>

          <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-full text-sm font-medium mb-6">
            <Telescope size={16} />
            <span>Application Assurance Platform</span>
          </div>

          <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6 leading-tight">
            Know your applications.<br />
            <span className="text-primary">Prove they're ready.</span>
          </h1>

          <p className="text-xl text-muted-foreground mb-10 max-w-3xl mx-auto leading-relaxed">
            Observatory gives engineering, security, and assurance teams one place to run structured assessments — security, code quality, accessibility, architecture, performance, and compliance — then track every finding through to closure.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
            <Link href="/auth/signup" className="bg-primary hover:bg-primary/90 text-white px-8 py-4 rounded-lg text-lg font-medium transition-all shadow-lg shadow-primary/25 flex items-center justify-center gap-2">
              Request access <ArrowRight size={20} />
            </Link>
            <Link href="/auth/signin" className="bg-muted hover:bg-muted/80 text-primary px-8 py-4 rounded-lg text-lg font-medium transition-all">
              Sign in
            </Link>
          </div>

          {/* Trust Badges */}
          <div className="flex flex-wrap justify-center gap-6 text-xs text-muted-foreground">
            {[
              { icon: Shield, label: "Security-first architecture" },
              { icon: Users, label: "Microsoft Entra SSO" },
              { icon: BadgeCheck, label: "Role-based access" },
              { icon: Brain, label: "AI-assisted analysis" },
              { icon: Cpu, label: "Azure AI Foundry" },
              { icon: FileText, label: "Full audit trails" },
            ].map(({ icon: Icon, label }, i) => (
              <div key={i} className="flex items-center gap-2">
                <Icon size={16} className="text-primary" />
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── What is Observatory ── */}
      <section aria-label="What is Observatory" className="py-20 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-lg text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground">Application assurance is more than a checklist.</span>{" "}
            Observatory brings structure to the way your teams assess applications — turning one-off audits and scattered spreadsheets into a repeatable, evidence-backed process that leadership can actually trust.
          </p>
          <div className="grid sm:grid-cols-3 gap-8 mt-12 text-left">
            {[
              {
                icon: Eye,
                title: "Complete visibility",
                desc: "Every application, every assessment cycle, every open finding — in one view. No more chasing spreadsheets across teams."
              },
              {
                icon: ClipboardList,
                title: "Structured workflows",
                desc: "Six specialist workbenches guide assessors through consistent, repeatable processes with evidence requirements built in."
              },
              {
                icon: TrendingUp,
                title: "Readiness over time",
                desc: "Readiness scores trend across assessment cycles so leaders can see progress — not just a snapshot on audit day."
              }
            ].map(({ icon: Icon, title, desc }, i) => (
              <div key={i} className="flex flex-col gap-3">
                <Icon size={28} className="text-primary" />
                <h3 className="font-semibold">{title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Six Assessment Modules ── */}
      <section aria-label="Assessment Modules" className="py-24 px-6 bg-card/30 border-y border-border">
        <div className="max-w-6xl mx-auto">
          <p className="text-sm font-medium text-primary uppercase tracking-widest text-center mb-4">Assessment Modules</p>
          <h2 className="text-3xl font-bold text-center mb-4">Six workbenches. One platform.</h2>
          <p className="text-center text-muted-foreground mb-14 max-w-2xl mx-auto">
            Each module is purpose-built for its domain — with the right scoring models, evidence requirements, and report formats — so assessors aren't forcing general-purpose tools to do specialist work.
          </p>

          {/* Module Selector */}
          <div className="flex flex-wrap justify-center gap-3 mb-12">
            {modules.map((mod) => (
              <button
                key={mod.id}
                onClick={() => setActiveModule(mod.id)}
                className={cn(
                  "px-5 py-2.5 rounded-xl font-medium transition-all flex items-center gap-2 text-sm",
                  activeModule === mod.id
                    ? "bg-primary text-white shadow-lg shadow-primary/25"
                    : "bg-muted hover:bg-muted/80 text-foreground"
                )}
              >
                <mod.icon size={16} />
                {mod.title}
              </button>
            ))}
          </div>

          {/* Module Content */}
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <p className="text-primary font-medium mb-2">{currentModule.tagline}</p>
              <h3 className="text-2xl font-bold mb-4">{currentModule.title}</h3>
              <p className="text-muted-foreground leading-relaxed mb-6">{currentModule.description}</p>
              <ul className="space-y-3">
                {currentModule.features.map((feature, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <CheckCircle2 size={18} className="text-primary flex-shrink-0" />
                    <span className="text-sm">{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
            <ModulePreview id={currentModule.id} />
          </div>
        </div>
      </section>

      {/* ── How It Works ── */}
      <section aria-label="How It Works" className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <p className="text-sm font-medium text-primary uppercase tracking-widest text-center mb-4">How It Works</p>
          <h2 className="text-3xl font-bold text-center mb-16">From registration to readiness report</h2>

          <div className="relative">
            <div className="hidden md:block absolute top-12 left-[10%] right-[10%] h-0.5 bg-gradient-to-r from-primary/20 via-primary to-primary/20" />
            <div className="grid md:grid-cols-5 gap-6">
              {howItWorks.map((item) => (
                <div key={item.step} className="text-center relative">
                  <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-primary to-primary/70 text-white flex items-center justify-center mx-auto mb-4 shadow-lg shadow-primary/25">
                    <item.icon size={36} />
                  </div>
                  <div className="absolute top-0 right-0 md:right-auto md:left-1/2 md:-translate-x-1/2 -translate-y-2 bg-background text-primary text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center border-2 border-primary">
                    {item.step}
                  </div>
                  <h3 className="font-semibold mb-2">{item.title}</h3>
                  <p className="text-sm text-muted-foreground">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="text-center mt-12">
            <Link href="/auth/signup" className="inline-flex bg-primary hover:bg-primary/90 text-white px-6 py-3 rounded-lg font-medium transition-all items-center gap-2">
              Request access <ArrowRight size={18} />
            </Link>
          </div>
        </div>
      </section>

      {/* ── Evidence Vault ── */}
      <section aria-label="Evidence Vault" className="py-24 px-6 bg-card/30 border-y border-border">
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-2 gap-16 items-center">
            <div>
              <p className="text-sm font-medium text-primary uppercase tracking-widest mb-4">Evidence Vault</p>
              <h2 className="text-3xl font-bold mb-6">Every claim, every proof, in one place</h2>
              <p className="text-muted-foreground mb-8 leading-relaxed">
                Assertions without evidence don't survive audits. Observatory's evidence vault lets assessors attach screenshots, test results, configuration files, and reports directly to findings — then links them automatically to compliance controls and VPAT criteria.
              </p>
              <ul className="space-y-4">
                {[
                  "File attachments on every finding and assessment",
                  "Evidence linked to compliance controls",
                  "Immutable upload records with timestamps",
                  "Tenant-isolated secure object storage",
                  "Orphan detection — no evidence left dangling",
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <CheckCircle2 size={18} className="text-primary flex-shrink-0" />
                    <span className="text-sm">{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Evidence vault mockup */}
            <div className="bg-gradient-to-br from-primary/10 to-primary/5 rounded-2xl p-6 border border-primary/20 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <BookOpen size={14} className="text-primary" /> Evidence Vault
                </span>
                <span className="text-xs text-muted-foreground">14 items</span>
              </div>
              {[
                { name: "pentest-q3-report.pdf", linked: "PT-041, PT-038", type: "PDF" },
                { name: "wcag-screenshot-contrast.png", linked: "1.4.3 Contrast", type: "IMG" },
                { name: "load-test-results.csv", linked: "Perf Assessment", type: "CSV" },
                { name: "iso27001-audit-log.xlsx", linked: "A.12.6, A.14.2", type: "XLS" },
              ].map((f, i) => (
                <div key={i} className="flex items-center gap-3 p-3 bg-background/80 rounded-xl border border-border">
                  <span className="text-[10px] font-mono bg-primary/10 text-primary px-1.5 py-0.5 rounded flex-shrink-0">{f.type}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-foreground truncate">{f.name}</div>
                    <div className="text-[10px] text-muted-foreground truncate">→ {f.linked}</div>
                  </div>
                  <CheckCircle2 size={14} className="text-green-500 flex-shrink-0" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Readiness Scoring ── */}
      <section aria-label="Readiness Scoring" className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-2 gap-16 items-center">
            {/* Readiness mockup */}
            <div className="bg-gradient-to-br from-primary/10 to-primary/5 rounded-2xl p-6 border border-primary/20">
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-semibold text-foreground">Readiness — portal-app</span>
                <span className="text-xs text-primary bg-primary/10 px-2 py-0.5 rounded-full">Q3 2026</span>
              </div>
              <div className="space-y-3 mb-4">
                {[
                  { label: "Security", score: 68, color: "bg-yellow-500" },
                  { label: "Code Quality", score: 74, color: "bg-yellow-500" },
                  { label: "Accessibility", score: 52, color: "bg-red-400" },
                  { label: "Architecture", score: 91, color: "bg-green-500" },
                  { label: "Performance", score: 87, color: "bg-green-500" },
                  { label: "Compliance", score: 79, color: "bg-yellow-500" },
                ].map((row, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-[10px] text-muted-foreground w-24 flex-shrink-0">{row.label}</span>
                    <div className="flex-1 h-2 bg-background rounded-full overflow-hidden">
                      <div className={cn("h-full rounded-full", row.color)} style={{ width: `${row.score}%` }} />
                    </div>
                    <span className="text-[10px] font-mono text-foreground w-8 text-right">{row.score}</span>
                  </div>
                ))}
              </div>
              <div className="border-t border-border pt-3 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Overall readiness</span>
                <span className="text-lg font-bold text-yellow-500">75 / 100</span>
              </div>
              <div className="mt-2 flex gap-2 text-[10px] text-muted-foreground">
                <span className="text-green-500">▲ +8 vs Q2</span>
                <span>· 3 blockers remaining</span>
              </div>
            </div>

            <div>
              <p className="text-sm font-medium text-primary uppercase tracking-widest mb-4">Readiness Scoring</p>
              <h2 className="text-3xl font-bold mb-6">A single number leaders can act on</h2>
              <p className="text-muted-foreground mb-8 leading-relaxed">
                Observatory combines findings across all six workbenches into a weighted readiness score for each application. Leaders see one clear number — and the breakdown behind it — so release gates, remediation priorities, and investment decisions are grounded in real data.
              </p>
              <ul className="space-y-4">
                {[
                  "Weighted scoring across all six assessment domains",
                  "Configurable weights to match your organisation's priorities",
                  "Blocker identification — what's preventing a passing score",
                  "Trend charts across assessment cycles",
                  "Exportable reports for leadership and auditors",
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <CheckCircle2 size={18} className="text-primary flex-shrink-0" />
                    <span className="text-sm">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── Who It's For ── */}
      <section aria-label="Who It's For" className="py-24 px-6 bg-card/30 border-y border-border">
        <div className="max-w-5xl mx-auto">
          <p className="text-sm font-medium text-primary uppercase tracking-widest text-center mb-4">Who It's For</p>
          <h2 className="text-3xl font-bold text-center mb-16">Built for everyone who owns application quality</h2>

          <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-6">
            {[
              {
                icon: Shield,
                title: "Security Teams",
                desc: "Manage pen-test findings, track remediation, link evidence to CVEs and compliance controls, and close the loop with engineering"
              },
              {
                icon: Code2,
                title: "Engineering Leaders",
                desc: "Maintain code quality baselines, track technical debt, flag dependency risk, and demonstrate improvement across release cycles"
              },
              {
                icon: Accessibility,
                title: "Accessibility Specialists",
                desc: "Run WCAG assessments, generate VPAT worksheets for procurement, and track criterion-level remediation through to certification"
              },
              {
                icon: BarChart3,
                title: "Assurance & Audit",
                desc: "Review evidence-backed assessment records, produce compliance reports for ISO 27001 / SOC 2 / NIST, and brief executive stakeholders"
              }
            ].map((role, i) => (
              <div key={i} className="p-6 rounded-xl bg-card border border-border text-center">
                <role.icon size={28} className="mx-auto mb-3 text-primary" />
                <h3 className="font-semibold text-sm mb-2">{role.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{role.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Enterprise ── */}
      <section aria-label="Enterprise Grade" className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <p className="text-sm font-medium text-primary uppercase tracking-widest mb-4">Enterprise Grade</p>
              <h2 className="text-3xl font-bold mb-6">Built for organisations that can't afford gaps</h2>
              <p className="text-muted-foreground mb-8">
                Observatory is designed for enterprises operating in regulated, security-sensitive environments. Multi-tenant isolation, Entra SSO, and immutable audit logs are built in — not bolted on.
              </p>
              <div className="space-y-4">
                {[
                  "Microsoft Entra ID SSO",
                  "Role-based access control",
                  "Multi-tenant data isolation",
                  "Immutable audit log with full history",
                  "Tenant-isolated object storage for evidence files",
                  "Azure AI Foundry multi-model AI support",
                  "Encryption in transit and at rest",
                  "Microsoft Content AI Partner Program"
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <CheckCircle2 size={18} className="text-primary flex-shrink-0" />
                    <span className="text-sm">{item}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-gradient-to-br from-primary/10 to-primary/5 rounded-2xl p-8 border border-primary/20">
              <div className="space-y-6">
                {[
                  { icon: FileDown, label: "Export anywhere", desc: "PDF reports, Word VPAT worksheets, CSV exports for every workbench" },
                  { icon: GitBranch, label: "Consultant access", desc: "Cross-tenant Consultant role for advisory teams assessing multiple clients" },
                  { icon: Lock, label: "Access controls", desc: "Granular roles — Global Admin, Tenant Admin, Assessor, Standard User" },
                  { icon: Search, label: "Full-text audit log", desc: "Every action, every user, every timestamp — browsable and exportable" },
                ].map(({ icon: Icon, label, desc }, i) => (
                  <div key={i} className="flex gap-4 items-start">
                    <div className="w-9 h-9 rounded-lg bg-primary/20 flex items-center justify-center flex-shrink-0">
                      <Icon size={16} className="text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section aria-label="Call to Action" className="py-24 px-6 relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage: "url('/images/hero-background.jpg')",
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/85 to-background/70" />
        <div className="max-w-4xl mx-auto text-center relative z-10">
          <h2 className="text-4xl font-bold mb-6">Ready to bring rigour to your assessments?</h2>
          <p className="text-xl text-muted-foreground mb-10 max-w-2xl mx-auto">
            Give your teams the structure, evidence, and readiness reporting that auditors and leaders actually trust.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/auth/signup" className="inline-flex bg-primary hover:bg-primary/90 text-white px-8 py-4 rounded-lg text-lg font-medium transition-all shadow-lg shadow-primary/25 items-center gap-2">
              Request access <ArrowRight size={20} />
            </Link>
            <a href="mailto:contactus@synozur.com" className="inline-flex bg-muted hover:bg-muted/80 text-foreground px-8 py-4 rounded-lg text-lg font-medium transition-all items-center gap-2">
              Talk to us <ChevronRight size={20} />
            </a>
          </div>
          <p className="text-sm text-muted-foreground mt-6">
            Questions? <a href="mailto:contactus@synozur.com" className="text-primary hover:underline">contactus@synozur.com</a>
          </p>
        </div>
      </section>

      </article>
    </PublicLayout>
  );
}
