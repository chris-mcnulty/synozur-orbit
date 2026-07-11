import React, { useState } from "react";
import PublicLayout from "@/components/layout/PublicLayout";
import SEOHead from "@/components/SEOHead";
import { Link } from "wouter";
import { ArrowRight, CheckCircle2, Shield, Zap, Target, BarChart3, FileText, Brain, Users, TrendingUp, Clock, Eye, Lightbulb, Radar, CalendarDays, Layers, Rocket, MapPin, GitBranch, PieChart, Gem, Download, Table, FileDown, Sparkles, Mail, HardDrive, Cpu, Handshake, Activity, Share2, BookOpen, Wand2, UserSearch, Send, Globe, Search, Repeat2, Megaphone, MailCheck, LineChart, SlidersHorizontal, Newspaper } from "lucide-react";
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
    "name": "Orbit",
    "applicationCategory": "BusinessApplication",
    "operatingSystem": "Web",
    "description": "AI-powered go-to-market intelligence platform that unifies competitive intelligence, marketing planning, and product management.",
    "offers": {
      "@type": "Offer",
      "price": "0",
      "priceCurrency": "USD",
      "description": "60-day free trial with full access"
    },
    "author": {
      "@type": "Organization",
      "name": "The Synozur Alliance"
    },
    "featureList": [
      "AI-powered competitive analysis",
      "Competitive battlecards",
      "Marketing planning",
      "Product roadmap management",
      "PDF report generation",
      "Microsoft Entra SSO",
      "Multi-tenant architecture"
    ]
  }
];

const platformPillars = [
  {
    id: "intelligence",
    icon: Radar,
    title: "Competitive Intelligence",
    tagline: "Know your battlefield",
    description: "AI-powered analysis of competitor positioning, messaging, and market movements. Orbit continuously monitors competitors, surfaces gaps, and synthesises everything into actionable intelligence briefings.",
    features: [
      "Automated competitor website monitoring",
      "Claude-powered positioning & gap analysis",
      "Competitive battlecards with Harvey Ball scoring",
      "AI intelligence briefings on demand",
      "SEO & share-of-voice keyword tracking"
    ]
  },
  {
    id: "marketing",
    icon: CalendarDays,
    title: "Marketing & Campaigns",
    tagline: "Create, deliver, and track",
    description: "Run the full campaign lifecycle inside Orbit. Generate multi-format content, deliver email campaigns directly to your list with open and click tracking, publish social posts to LinkedIn, X, Facebook, and Bluesky—and measure everything in one editorial calendar.",
    features: [
      "Editorial calendar with campaign briefs & themes",
      "Email delivery — lists, scheduling, open/click tracking",
      "Social direct publishing — LinkedIn, X, Facebook, Bluesky",
      "Multi-format content: blog, whitepaper, case study, podcast, video script",
      "One-click content repurposing across formats",
      "Distribution planner & UTM link tracking"
    ]
  },
  {
    id: "sales",
    icon: UserSearch,
    title: "Sales Outreach",
    tagline: "Build pipeline at scale",
    description: "Turn market intelligence into pipeline. Orbit's prospecting engine finds ICP-matched contacts via Apollo, drafts personalised outreach in your voice, manages multi-touch cadences, and syncs everything back to HubSpot automatically.",
    features: [
      "ICP prospect discovery — titles, company size, market",
      "AI-drafted outreach with personal voice profiles",
      "Multi-touch email & LinkedIn cadence management",
      "HubSpot contact sync & timeline event logging",
      "Relationship intelligence reports on target accounts",
      "Prospect suppression & compliance controls"
    ]
  },
  {
    id: "product",
    icon: GitBranch,
    title: "Product Management",
    tagline: "Build what matters",
    description: "Align product development with competitive reality. Manage roadmaps, track feature gaps, collect customer feedback, and make prioritisation decisions grounded in market intelligence—not gut feel.",
    features: [
      "Product roadmap management & release planning",
      "Competitive feature gap tracking",
      "Customer feedback collection & voting",
      "AI-powered roadmap recommendations",
      "Market-driven prioritisation"
    ]
  }
];

const capabilities = [
  {
    id: "intelligence",
    label: "Market Intelligence",
    icon: Radar,
    title: "Know your competitive landscape",
    description: "Orbit continuously monitors competitor websites, extracting messaging, value propositions, and positioning changes. Real-time intelligence briefings synthesise everything into a clear picture of how your market is moving—so you're never caught off guard."
  },
  {
    id: "battlecards",
    label: "Battlecards",
    icon: Shield,
    title: "Arm your sales team",
    description: "Generate competitive battlecards with Harvey Ball scoring, qualitative feature comparisons, and objection-handling scripts. Sales reps get the ammunition they need to win deals—delivered in branded PDFs or live in the app."
  },
  {
    id: "outreach",
    label: "Sales Outreach",
    icon: UserSearch,
    title: "Prospect and outreach at scale",
    description: "Discover ICP-matched contacts directly inside Orbit using Apollo's database—filter by persona, title, company size, and market. Orbit drafts personalised outreach sequences in your own voice using your writing samples, manages multi-touch email and LinkedIn cadences, and syncs every interaction back to HubSpot automatically."
  },
  {
    id: "campaigns",
    label: "Campaign Planning",
    icon: Megaphone,
    title: "Plan campaigns from brief to delivery",
    description: "Build campaigns with themes, briefs, and an editorial calendar. Orbit's AI generates a full content brief from a campaign objective, then routes each asset—blog posts, social posts, emails, whitepapers—through the right channel automatically. The distribution planner schedules and tracks everything in one view."
  },
  {
    id: "email",
    label: "Email Delivery",
    icon: MailCheck,
    title: "Send campaigns directly from Orbit",
    description: "Orbit is a complete email delivery engine—not just a generator. Build recipient lists, configure named sender identities, schedule sends, and track opens and clicks per recipient. Unsubscribe management and one-click HubSpot contact sync are built in. No third-party ESP configuration required."
  },
  {
    id: "social",
    label: "Social Publishing",
    icon: Share2,
    title: "Publish directly to every major network",
    description: "Connect LinkedIn, X/Twitter, Facebook, and Bluesky once—then publish social posts directly from Orbit's social calendar. AI generates platform-native copy with tone selection. Schedule posts at optimal times, track delivery status, and export to SocialPilot CSV as a fallback. Conference promotion posts include AI-generated hero images."
  },
  {
    id: "content-engine",
    label: "Content Engine",
    icon: Repeat2,
    title: "One brief, every format",
    description: "Orbit generates the full content catalogue from a single campaign brief: blog posts with SEO metadata, whitepapers, case studies, landing page copy, video scripts, and Polaris podcast outlines. Repurpose any asset into another format with one click—including LinkedIn carousels and branded social graphics."
  },
  {
    id: "seo",
    label: "SEO & Share of Voice",
    icon: LineChart,
    title: "Track your visibility against competitors",
    description: "Monitor keyword rankings for your brand and every tracked competitor. Orbit pulls weekly SERP snapshots, calculates share-of-voice across your target keyword set, and surfaces ranking movements so you can see whether your content is gaining or losing ground."
  },
  {
    id: "roadmap",
    label: "Product Roadmap",
    icon: GitBranch,
    title: "Prioritize with market context",
    description: "Align product development with competitive reality. Manage your feature roadmap, track gaps against competitors, collect and triage customer feedback with a voting portal, and get AI-generated prioritisation recommendations grounded in market intelligence."
  },
  {
    id: "reporting",
    label: "Reporting",
    icon: FileText,
    title: "Share intelligence that drives decisions",
    description: "Export branded PDF reports for leadership, board presentations, and sales enablement. Track positioning changes over time with assessment snapshots. Relationship intelligence reports synthesise everything Orbit knows about a target account into a single briefing document."
  },
  {
    id: "content-libraries",
    label: "Content & Brand",
    icon: BookOpen,
    title: "One home for all brand and content assets",
    description: "Maintain your content library—blog drafts, whitepapers, case studies, landing page copy—alongside a brand library of logos, colours, fonts, and guidelines. Every AI generation draws on your brand context automatically."
  }
];

function PillarPreview({ id }: { id: string }) {
  const base = "bg-gradient-to-br from-primary/5 to-primary/10 rounded-xl border border-primary/20 aspect-video flex items-center justify-center p-6 overflow-hidden";
  if (id === "intelligence") return (
    <div className={base}>
      <div className="w-full bg-background/90 rounded-xl p-4 shadow-xl space-y-2 text-left">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold text-foreground">Competitive Briefing</span>
          <span className="text-xs text-primary bg-primary/10 px-2 py-0.5 rounded-full">3 gaps found</span>
        </div>
        {[
          { name: "Acme Corp", change: "+12%", color: "text-red-400", bar: "w-4/5" },
          { name: "RivalTech", change: "−8%", color: "text-green-500", bar: "w-1/2" },
          { name: "MarketPro", change: "+3%", color: "text-yellow-500", bar: "w-2/3" },
        ].map((c, i) => (
          <div key={i} className="flex items-center gap-3 p-2 rounded-lg bg-muted/50">
            <div className="w-5 h-5 rounded bg-primary/20 flex-shrink-0" />
            <span className="text-xs font-medium flex-1 text-foreground">{c.name}</span>
            <div className={`h-1.5 rounded-full bg-current ${c.color} ${c.bar}`} />
            <span className={`text-xs font-mono ${c.color}`}>{c.change}</span>
          </div>
        ))}
        <div className="mt-2 p-2 rounded-lg bg-primary/10 border border-primary/20 flex gap-2 items-start">
          <Brain size={12} className="text-primary mt-0.5 flex-shrink-0" />
          <span className="text-xs text-muted-foreground">Acme shifted messaging to enterprise security — update battlecard Q3</span>
        </div>
      </div>
    </div>
  );
  if (id === "marketing") return (
    <div className={base}>
      <div className="w-full bg-background/90 rounded-xl p-4 shadow-xl text-left">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold text-foreground">Editorial Calendar — July</span>
          <div className="flex gap-1">
            <span className="text-xs bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded">Email</span>
            <span className="text-xs bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded">Social</span>
            <span className="text-xs bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded">Blog</span>
          </div>
        </div>
        <div className="grid grid-cols-5 gap-1 mb-1">
          {["Mon","Tue","Wed","Thu","Fri"].map(d => <div key={d} className="text-center text-xs text-muted-foreground">{d}</div>)}
        </div>
        <div className="grid grid-cols-5 gap-1">
          {[
            { type:"blog", label:"Case Study" }, null, { type:"email", label:"Newsletter" }, null, { type:"social", label:"X Post" },
            null, { type:"social", label:"LinkedIn" }, null, { type:"blog", label:"Whitepaper" }, null,
            { type:"email", label:"Campaign" }, null, null, { type:"social", label:"Facebook" }, null,
          ].map((item, i) => (
            <div key={i} className={cn("h-7 rounded text-center flex items-center justify-center", item
              ? item.type === "email" ? "bg-blue-500/20 text-blue-400"
              : item.type === "social" ? "bg-purple-500/20 text-purple-400"
              : "bg-green-500/20 text-green-400"
              : "bg-muted/30"
            )}>
              {item && <span className="text-[9px] font-medium truncate px-1">{item.label}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
  if (id === "sales") return (
    <div className={base}>
      <div className="w-full bg-background/90 rounded-xl p-4 shadow-xl text-left space-y-2">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold text-foreground">Outreach Prospects</span>
          <span className="text-xs text-primary bg-primary/10 px-2 py-0.5 rounded-full">42 ICP matches</span>
        </div>
        {[
          { name: "Sarah Chen", title: "VP Marketing", co: "TechFlow Inc", status: "Replied", sc: "text-green-500 bg-green-500/10" },
          { name: "James Okafor", title: "CMO", co: "Growbase", status: "Opened", sc: "text-yellow-500 bg-yellow-500/10" },
          { name: "Priya Nair", title: "Dir. Demand Gen", co: "Scalr", status: "Sent", sc: "text-blue-400 bg-blue-400/10" },
        ].map((p, i) => (
          <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
            <div className="w-6 h-6 rounded-full bg-primary/30 flex-shrink-0 flex items-center justify-center text-xs text-primary font-bold">{p.name[0]}</div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-foreground truncate">{p.name}</div>
              <div className="text-[10px] text-muted-foreground truncate">{p.title} · {p.co}</div>
            </div>
            <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium", p.sc)}>{p.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
  // product
  return (
    <div className={base}>
      <div className="w-full bg-background/90 rounded-xl p-4 shadow-xl text-left">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold text-foreground">Product Roadmap — Q3</span>
          <span className="text-xs text-muted-foreground">AI prioritisation on</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[
            { col: "Backlog", color: "border-muted", items: ["SSO Enhancements", "CSV Export v2"] },
            { col: "In Progress", color: "border-yellow-500/50", items: ["API Gateway", "Mobile App"] },
            { col: "Done", color: "border-green-500/50", items: ["HubSpot Sync", "Apollo ICP"] },
          ].map((col, i) => (
            <div key={i} className={cn("rounded-lg border p-2 space-y-1.5", col.color)}>
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">{col.col}</div>
              {col.items.map((item, j) => (
                <div key={j} className="text-[10px] bg-muted/60 rounded p-1.5 text-foreground">{item}</div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CapabilityPreview({ id, icon: Icon }: { id: string; icon: React.ComponentType<{ size?: number; className?: string }> }) {
  const base = "bg-gradient-to-br from-primary/5 to-primary/10 rounded-xl border border-primary/20 aspect-video flex items-center justify-center p-6 overflow-hidden";

  if (id === "intelligence") return (
    <div className={base}>
      <div className="w-full bg-background/90 rounded-xl p-4 shadow-xl text-left space-y-2">
        <div className="text-xs font-semibold text-foreground mb-2 flex items-center gap-2"><Radar size={12} className="text-primary" /> Monitoring — 8 competitors</div>
        {[
          { name: "Acme Corp", change: "Messaging update", when: "2h ago", dot: "bg-red-400" },
          { name: "RivalTech", change: "Pricing page changed", when: "Yesterday", dot: "bg-yellow-400" },
          { name: "MarketPro", change: "New case study", when: "3 days ago", dot: "bg-muted" },
        ].map((r, i) => (
          <div key={i} className="flex items-center gap-2 p-2 bg-muted/50 rounded-lg">
            <div className={cn("w-2 h-2 rounded-full flex-shrink-0", r.dot)} />
            <span className="text-xs text-foreground font-medium w-20 flex-shrink-0">{r.name}</span>
            <span className="text-xs text-muted-foreground flex-1">{r.change}</span>
            <span className="text-[10px] text-muted-foreground">{r.when}</span>
          </div>
        ))}
      </div>
    </div>
  );

  if (id === "battlecards") return (
    <div className={base}>
      <div className="w-full bg-background/90 rounded-xl p-4 shadow-xl text-left">
        <div className="text-xs font-semibold text-foreground mb-3 flex items-center gap-2"><Shield size={12} className="text-primary" /> vs. Acme Corp</div>
        <div className="space-y-1.5">
          {[
            { label: "Ease of use", us: 5, them: 3 },
            { label: "Integrations", us: 4, them: 5 },
            { label: "AI features", us: 5, them: 2 },
            { label: "Price/value", us: 4, them: 3 },
          ].map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground w-20">{row.label}</span>
              <div className="flex gap-0.5">{Array.from({length:5}).map((_,j)=><div key={j} className={cn("w-3 h-3 rounded-sm", j < row.us ? "bg-primary" : "bg-muted")} />)}</div>
              <span className="text-[10px] text-muted-foreground mx-1">vs</span>
              <div className="flex gap-0.5">{Array.from({length:5}).map((_,j)=><div key={j} className={cn("w-3 h-3 rounded-sm", j < row.them ? "bg-muted-foreground/60" : "bg-muted")} />)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  if (id === "outreach") return (
    <div className={base}>
      <div className="w-full bg-background/90 rounded-xl p-4 shadow-xl text-left space-y-2">
        <div className="text-xs font-semibold text-foreground mb-2 flex items-center gap-2"><UserSearch size={12} className="text-primary" /> Cadence — Week 1 Touch</div>
        <div className="p-2 bg-primary/10 rounded-lg border border-primary/20 text-xs text-foreground">
          Hi Sarah — saw Acme just updated their pricing. Given TechFlow's growth stage, here's why teams like yours are switching to Orbit...
        </div>
        <div className="flex gap-2">
          <div className="flex-1 p-2 bg-muted/50 rounded-lg text-center">
            <div className="text-sm font-bold text-foreground">42</div>
            <div className="text-[10px] text-muted-foreground">Prospects</div>
          </div>
          <div className="flex-1 p-2 bg-muted/50 rounded-lg text-center">
            <div className="text-sm font-bold text-yellow-500">68%</div>
            <div className="text-[10px] text-muted-foreground">Opened</div>
          </div>
          <div className="flex-1 p-2 bg-muted/50 rounded-lg text-center">
            <div className="text-sm font-bold text-green-500">12</div>
            <div className="text-[10px] text-muted-foreground">Replied</div>
          </div>
        </div>
      </div>
    </div>
  );

  if (id === "campaigns") return (
    <div className={base}>
      <div className="w-full bg-background/90 rounded-xl p-4 shadow-xl text-left space-y-2">
        <div className="text-xs font-semibold text-foreground mb-2 flex items-center gap-2"><Megaphone size={12} className="text-primary" /> Campaign — Q3 Launch</div>
        {[
          { label: "Email Newsletter", status: "Scheduled", sc: "bg-blue-500/20 text-blue-400" },
          { label: "LinkedIn Post", status: "Published", sc: "bg-green-500/20 text-green-400" },
          { label: "Case Study", status: "In Review", sc: "bg-yellow-500/20 text-yellow-500" },
          { label: "Blog Post", status: "Drafting", sc: "bg-muted text-muted-foreground" },
        ].map((r, i) => (
          <div key={i} className="flex items-center gap-2 p-2 bg-muted/50 rounded-lg">
            <span className="text-xs text-foreground flex-1">{r.label}</span>
            <span className={cn("text-[10px] px-2 py-0.5 rounded-full", r.sc)}>{r.status}</span>
          </div>
        ))}
      </div>
    </div>
  );

  if (id === "email") return (
    <div className={base}>
      <div className="w-full bg-background/90 rounded-xl p-4 shadow-xl text-left space-y-2">
        <div className="text-xs font-semibold text-foreground mb-2 flex items-center gap-2"><MailCheck size={12} className="text-primary" /> July Newsletter — Sent</div>
        <div className="grid grid-cols-3 gap-2 mb-2">
          {[{l:"Delivered",v:"1,204",c:"text-foreground"},{l:"Opened",v:"61%",c:"text-yellow-500"},{l:"Clicked",v:"18%",c:"text-primary"}].map((m,i)=>(
            <div key={i} className="text-center p-2 bg-muted/50 rounded-lg">
              <div className={cn("text-sm font-bold", m.c)}>{m.v}</div>
              <div className="text-[10px] text-muted-foreground">{m.l}</div>
            </div>
          ))}
        </div>
        <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden"><div className="h-full bg-primary rounded-full" style={{width:"61%"}} /></div>
        <div className="text-[10px] text-muted-foreground">61% open rate · 4 unsubscribes · HubSpot synced</div>
      </div>
    </div>
  );

  if (id === "social") return (
    <div className={base}>
      <div className="w-full bg-background/90 rounded-xl p-4 shadow-xl text-left space-y-2">
        <div className="text-xs font-semibold text-foreground mb-2 flex items-center gap-2"><Share2 size={12} className="text-primary" /> Social Publishing</div>
        {[
          { platform: "LinkedIn", text: "Thrilled to announce...", status: "Posted", sc: "text-green-500" },
          { platform: "X / Twitter", text: "Big news for GTM teams...", status: "Scheduled", sc: "text-yellow-500" },
          { platform: "Facebook", text: "We're launching...", status: "Scheduled", sc: "text-yellow-500" },
          { platform: "Bluesky", text: "🚀 Orbit just shipped...", status: "Draft", sc: "text-muted-foreground" },
        ].map((p, i) => (
          <div key={i} className="flex items-center gap-2 p-1.5 bg-muted/50 rounded-lg">
            <span className="text-[10px] font-medium text-muted-foreground w-16 flex-shrink-0">{p.platform}</span>
            <span className="text-[10px] text-foreground flex-1 truncate">{p.text}</span>
            <span className={cn("text-[10px]", p.sc)}>{p.status}</span>
          </div>
        ))}
      </div>
    </div>
  );

  if (id === "content-engine") return (
    <div className={base}>
      <div className="w-full bg-background/90 rounded-xl p-4 shadow-xl text-left space-y-2">
        <div className="text-xs font-semibold text-foreground mb-2 flex items-center gap-2"><Repeat2 size={12} className="text-primary" /> Repurpose: "Q3 GTM Brief"</div>
        <div className="grid grid-cols-2 gap-1.5">
          {[
            {f:"Blog Post", done: true}, {f:"LinkedIn Post", done: true},
            {f:"Whitepaper", done: false}, {f:"Case Study", done: false},
            {f:"Video Script", done: false}, {f:"Podcast Outline", done: false},
          ].map((item, i) => (
            <div key={i} className={cn("p-1.5 rounded-lg text-[10px] flex items-center gap-1.5", item.done ? "bg-green-500/10 text-green-400" : "bg-muted/50 text-muted-foreground")}>
              <div className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", item.done ? "bg-green-500" : "bg-muted-foreground/40")} />
              {item.f}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  if (id === "seo") return (
    <div className={base}>
      <div className="w-full bg-background/90 rounded-xl p-4 shadow-xl text-left space-y-2">
        <div className="text-xs font-semibold text-foreground mb-2 flex items-center gap-2"><LineChart size={12} className="text-primary" /> Share of Voice — Top Keywords</div>
        {[
          { kw: "GTM platform", pos: 3, sov: "28%", trend: "▲", tc: "text-green-500" },
          { kw: "competitive intel", pos: 7, sov: "12%", trend: "▲", tc: "text-green-500" },
          { kw: "sales prospecting", pos: 14, sov: "5%", trend: "▼", tc: "text-red-400" },
        ].map((r, i) => (
          <div key={i} className="flex items-center gap-2 p-2 bg-muted/50 rounded-lg">
            <span className="text-xs text-foreground flex-1">{r.kw}</span>
            <span className="text-[10px] text-muted-foreground">#{r.pos}</span>
            <span className={cn("text-[10px] font-mono", r.tc)}>{r.trend} {r.sov}</span>
          </div>
        ))}
      </div>
    </div>
  );

  if (id === "roadmap") return (
    <div className={base}>
      <div className="w-full bg-background/90 rounded-xl p-4 shadow-xl text-left">
        <div className="text-xs font-semibold text-foreground mb-3 flex items-center gap-2"><GitBranch size={12} className="text-primary" /> Roadmap · Q3 2026</div>
        <div className="grid grid-cols-3 gap-2">
          {[
            { col: "Now", items: ["HubSpot sync", "Apollo ICP"] },
            { col: "Next", items: ["API Gateway", "Mobile"] },
            { col: "Later", items: ["AI scoring", "SSO v2"] },
          ].map((col, i) => (
            <div key={i} className="space-y-1">
              <div className="text-[10px] font-semibold text-muted-foreground uppercase">{col.col}</div>
              {col.items.map((item, j) => (
                <div key={j} className="text-[10px] bg-muted/60 rounded p-1.5 text-foreground">{item}</div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  if (id === "reporting") return (
    <div className={base}>
      <div className="w-full bg-background/90 rounded-xl p-4 shadow-xl text-left space-y-2">
        <div className="text-xs font-semibold text-foreground mb-2 flex items-center gap-2"><FileText size={12} className="text-primary" /> Intelligence Report — July</div>
        <div className="h-2 w-full bg-primary/20 rounded-full"><div className="h-2 bg-primary rounded-full w-3/4" /></div>
        {["Executive Summary", "Competitor Matrix", "Positioning Gaps", "Recommendations"].map((s, i) => (
          <div key={i} className="flex items-center gap-2 p-1.5 bg-muted/50 rounded-lg">
            <div className="w-3 h-3 rounded bg-primary/30 flex-shrink-0" />
            <span className="text-[10px] text-foreground">{s}</span>
            <CheckCircle2 size={10} className="ml-auto text-green-500" />
          </div>
        ))}
        <div className="text-[10px] text-primary mt-1">↓ Export branded PDF</div>
      </div>
    </div>
  );

  // content-libraries fallback
  return (
    <div className={base}>
      <div className="w-full bg-background/90 rounded-xl p-4 shadow-xl text-left space-y-2">
        <div className="text-xs font-semibold text-foreground mb-2 flex items-center gap-2"><BookOpen size={12} className="text-primary" /> Content Library</div>
        {[
          { type: "Blog", title: "Why GTM Teams Switch to Orbit", tag: "Published" },
          { type: "WP", title: "2026 B2B Competitive Intelligence Report", tag: "Draft" },
          { type: "CS", title: "How TechFlow Grew Pipeline 40%", tag: "Active" },
        ].map((a, i) => (
          <div key={i} className="flex items-center gap-2 p-2 bg-muted/50 rounded-lg">
            <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded font-mono">{a.type}</span>
            <span className="text-[10px] text-foreground flex-1 truncate">{a.title}</span>
            <span className="text-[10px] text-muted-foreground">{a.tag}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Landing() {
  usePageTracking("/");
  const [activeCapability, setActiveCapability] = useState("intelligence");
  const [activePillar, setActivePillar] = useState("intelligence");
  const currentCapability = capabilities.find(c => c.id === activeCapability) || capabilities[0];
  const currentPillar = platformPillars.find(p => p.id === activePillar) || platformPillars[0];

  return (
    <PublicLayout>
      <SEOHead
        title="Orbit — AI-Powered GTM Engine | Synozur"
        description="Orbit unifies competitive intelligence, campaign delivery, and AI sales prospecting. Know your market, reach your audience, and build pipeline—without switching tools."
        path="/"
        jsonLd={landingJsonLd}
      />
      <article>
      {/* Hero Section */}
      <section aria-label="Hero" className="relative overflow-hidden py-24 md:py-32 px-6 min-h-[85vh] flex items-center justify-center">
        <div 
          className="absolute inset-0 z-0 select-none bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: "url('/images/hero-background.png')" }}
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
            <Gem size={16} />
            <span>Go-to-Market Intelligence Platform</span>
          </div>
          
          <h1 className="text-5xl md:text-6xl font-bold tracking-tight mb-6 leading-tight">
            Your GTM engine.<br />
            <span className="text-primary">From intelligence to pipeline.</span>
          </h1>
          
          <p className="text-xl text-muted-foreground mb-10 max-w-3xl mx-auto leading-relaxed">
            Orbit unifies competitive intelligence, multi-channel campaign delivery, and AI-powered sales prospecting—so GTM teams can know their market, reach their audience, and build pipeline without switching tools.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
            <Link href="/auth/signup" className="bg-primary hover:bg-primary/90 text-white px-8 py-4 rounded-lg text-lg font-medium transition-all shadow-lg shadow-primary/25 flex items-center justify-center gap-2">
              Start your 60-day trial <ArrowRight size={20} />
            </Link>
            <Link href="/auth/signin" className="bg-muted hover:bg-muted/80 text-primary px-8 py-4 rounded-lg text-lg font-medium transition-all">
              Log in
            </Link>
          </div>

          <p className="text-sm text-muted-foreground mb-12">
            No credit card required. No sales call needed. Full access for 60 days.
          </p>

          {/* Trust Badges */}
          <div className="flex flex-wrap justify-center gap-6 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <Shield size={16} className="text-primary" />
              <span>SOC 2 Type II</span>
            </div>
            <div className="flex items-center gap-2">
              <Users size={16} className="text-primary" />
              <span>Microsoft Entra SSO</span>
            </div>
            <div className="flex items-center gap-2">
              <Shield size={16} className="text-primary" />
              <span>Role-based access</span>
            </div>
            <div className="flex items-center gap-2">
              <Brain size={16} className="text-primary" />
              <span>Claude AI powered</span>
            </div>
            <div className="flex items-center gap-2">
              <Cpu size={16} className="text-primary" />
              <span>Azure AI Foundry</span>
            </div>
            <div className="flex items-center gap-2">
              <FileText size={16} className="text-primary" />
              <span>Audit trails</span>
            </div>
          </div>
        </div>
      </section>

      {/* Platform Pillars - The Big Three */}
      <section aria-label="Platform Pillars" className="py-24 px-6 bg-card/30 border-y border-border">
        <div className="max-w-6xl mx-auto">
          <p className="text-sm font-medium text-primary uppercase tracking-widest text-center mb-4">The Platform</p>
          <h2 className="text-3xl font-bold text-center mb-6">Four pillars of GTM excellence</h2>
          <p className="text-center text-muted-foreground mb-16 max-w-2xl mx-auto">
            Most tools stop at data. Orbit gives you a complete operating system—from market intelligence to campaign delivery to pipeline generation to product alignment.
          </p>
          
          {/* Pillar Selector */}
          <div className="flex flex-wrap justify-center gap-4 mb-12">
            {platformPillars.map((pillar) => (
              <button
                key={pillar.id}
                onClick={() => setActivePillar(pillar.id)}
                className={cn(
                  "px-6 py-3 rounded-xl font-medium transition-all flex items-center gap-3",
                  activePillar === pillar.id
                    ? "bg-primary text-white shadow-lg shadow-primary/25"
                    : "bg-muted hover:bg-muted/80 text-foreground"
                )}
              >
                <pillar.icon size={20} />
                {pillar.title}
              </button>
            ))}
          </div>

          {/* Pillar Content */}
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <p className="text-primary font-medium mb-2">{currentPillar.tagline}</p>
              <h3 className="text-2xl font-bold mb-4">{currentPillar.title}</h3>
              <p className="text-muted-foreground leading-relaxed mb-6">{currentPillar.description}</p>
              <ul className="space-y-3">
                {currentPillar.features.map((feature, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <CheckCircle2 size={18} className="text-primary flex-shrink-0" />
                    <span className="text-sm">{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
            <PillarPreview id={currentPillar.id} />
          </div>
        </div>
      </section>

      {/* Built on Synozur Framework */}
      <section aria-label="Built on Synozur Framework" className="py-16 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-lg text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground">Built on proven GTM methodology.</span>{" "}
            Orbit reflects how real marketing, sales, and product teams work together—refined through decades of go-to-market consulting by Synozur. It's not just software; it's a system.
          </p>
          <div className="flex flex-wrap justify-center gap-4 mt-6 text-sm">
            <a href="https://www.synozur.com/case-studies" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">View case studies</a>
            <span className="text-muted-foreground">|</span>
            <a href="https://orion.synozur.com/gtm" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Take the GTM Maturity Assessment</a>
          </div>
        </div>
      </section>

      {/* How It Works - The Flow */}
      <section aria-label="How It Works" className="py-24 px-6 bg-card/30 border-y border-border">
        <div className="max-w-5xl mx-auto">
          <p className="text-sm font-medium text-primary uppercase tracking-widest text-center mb-4">How It Works</p>
          <h2 className="text-3xl font-bold text-center mb-16">Intelligence that flows into pipeline</h2>
          
          <div className="relative">
            {/* Connection Line */}
            <div className="hidden md:block absolute top-12 left-[10%] right-[10%] h-0.5 bg-gradient-to-r from-primary/20 via-primary to-primary/20" />
            
            <div className="grid md:grid-cols-5 gap-6">
              {[
                { step: 1, icon: Radar, title: "Monitor", desc: "Track competitor websites, messaging, and market movements automatically" },
                { step: 2, icon: Brain, title: "Analyze", desc: "Claude AI surfaces positioning gaps, opportunities, and competitive intelligence briefings" },
                { step: 3, icon: Megaphone, title: "Campaign", desc: "Generate briefs, content, and email campaigns — all in one editorial calendar" },
                { step: 4, icon: Globe, title: "Publish", desc: "Deliver emails directly, post to LinkedIn, X, Facebook, and Bluesky from Orbit" },
                { step: 5, icon: UserSearch, title: "Prospect", desc: "Find ICP contacts, draft AI outreach in your voice, and sync to HubSpot automatically" }
              ].map((item) => (
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
              Start your 60-day trial <ArrowRight size={18} />
            </Link>
            <p className="text-xs text-muted-foreground mt-3">No credit card required</p>
          </div>
        </div>
      </section>

      {/* What's New */}
      <section className="py-24 px-6" data-testid="section-whats-new">
        <div className="max-w-6xl mx-auto">
          <p className="text-sm font-medium text-primary uppercase tracking-widest text-center mb-4">What's New</p>
          <h2 className="text-3xl font-bold text-center mb-6">Recently shipped capabilities</h2>
          <p className="text-center text-muted-foreground mb-16 max-w-2xl mx-auto">
            Orbit keeps evolving. Here are the latest features powering your go-to-market teams.
          </p>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: MailCheck,
                title: "Email Campaign Delivery",
                desc: "Send campaigns directly from Orbit. Recipient lists, scheduling, open and click tracking, unsubscribe management, and HubSpot contact sync — all built in."
              },
              {
                icon: Globe,
                title: "Social Direct Publishing",
                desc: "Publish posts directly to LinkedIn, X/Twitter, Facebook, and Bluesky from Orbit's social calendar. No manual copy-paste — schedule, send, and track from one place."
              },
              {
                icon: UserSearch,
                title: "AI Sales Prospecting",
                desc: "Find ICP-matched contacts via Apollo, draft personalised outreach in your own voice, manage multi-touch cadences, and sync every interaction back to HubSpot automatically."
              },
              {
                icon: Repeat2,
                title: "Multi-Format Content Engine",
                desc: "One campaign brief generates blog posts, whitepapers, case studies, landing page copy, video scripts, and Polaris podcast outlines. Repurpose any asset into another format with one click."
              },
              {
                icon: LineChart,
                title: "SEO & Share of Voice",
                desc: "Track keyword rankings for your brand and every competitor. Weekly SERP snapshots, share-of-voice scoring, and ranking movement alerts so your content strategy stays ahead."
              },
              {
                icon: CalendarDays,
                title: "Editorial Calendar & Distribution Planner",
                desc: "Full campaign lifecycle in one view — briefs, themes, content queue, email scheduling, and social publishing. One-click distribution routes each asset to the right channel automatically."
              }
            ].map((feature, i) => (
              <div key={i} className="p-6 rounded-2xl bg-card border border-border hover:border-primary/30 transition-all" data-testid={`card-whats-new-${i}`}>
                <feature.icon size={28} className="text-primary mb-4" />
                <h3 className="font-semibold mb-3">{feature.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Capabilities - Tabbed Section */}
      <section id="capabilities" aria-label="Capabilities" className="py-24 px-6 bg-card/30 border-y border-border">
        <div className="max-w-6xl mx-auto">
          <p className="text-sm font-medium text-primary uppercase tracking-widest text-center mb-4">Capabilities</p>
          <h2 className="text-3xl font-bold text-center mb-16">Everything you need to compete and win</h2>
          
          {/* Capability Tabs */}
          <div className="flex flex-wrap justify-center gap-2 mb-12">
            {capabilities.map((cap) => (
              <button
                key={cap.id}
                onClick={() => setActiveCapability(cap.id)}
                className={cn(
                  "px-4 py-2 rounded-lg text-sm font-medium transition-all",
                  activeCapability === cap.id
                    ? "bg-primary text-white"
                    : "bg-muted hover:bg-muted/80 text-foreground"
                )}
              >
                {cap.label}
              </button>
            ))}
          </div>

          {/* Capability Content */}
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h3 className="text-2xl font-bold mb-4">{currentCapability.title}</h3>
              <p className="text-muted-foreground leading-relaxed">{currentCapability.description}</p>
            </div>
            <CapabilityPreview id={currentCapability.id} icon={currentCapability.icon} />
          </div>
        </div>
      </section>

      {/* Three Outcomes */}
      <section aria-label="Outcomes" className="py-24 px-6 bg-card/30 border-y border-border">
        <div className="max-w-5xl mx-auto">
          <p className="text-sm font-medium text-primary uppercase tracking-widest text-center mb-4">Outcomes</p>
          <h2 className="text-3xl font-bold text-center mb-16">What you'll achieve</h2>
          
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                icon: Eye,
                title: "See clearly",
                desc: "Know how every competitor positions themselves, where they're gaining ground, and exactly where your advantage lies."
              },
              {
                icon: Send,
                title: "Reach your audience",
                desc: "Run email campaigns, publish social posts, and push blog drafts directly from Orbit—no extra tools, no copy-paste."
              },
              {
                icon: TrendingUp,
                title: "Build pipeline",
                desc: "Find ICP prospects, send AI-personalised outreach in your own voice, and let Orbit sync every touchpoint to HubSpot."
              }
            ].map((outcome, i) => (
              <div key={i} className="text-center p-8 rounded-2xl bg-background border border-border">
                <outcome.icon size={40} className="mx-auto mb-4 text-primary" />
                <h3 className="text-xl font-bold mb-3">{outcome.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{outcome.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Who It's For */}
      <section aria-label="Who It's For" className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <p className="text-sm font-medium text-primary uppercase tracking-widest text-center mb-4">Who It's For</p>
          <h2 className="text-3xl font-bold text-center mb-16">Built for the entire GTM team</h2>
          
          <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-6">
            {[
              {
                icon: BarChart3,
                title: "Marketing Leaders",
                desc: "Campaign orchestration, multi-format content generation, email delivery, social publishing, editorial calendar, and SEO share-of-voice tracking"
              },
              {
                icon: UserSearch,
                title: "Sales & SDR Teams",
                desc: "ICP prospecting, AI-drafted outreach in your own voice, multi-touch cadence management, battlecards, and HubSpot sync"
              },
              {
                icon: Layers,
                title: "Product Managers",
                desc: "Market-driven roadmap prioritisation, competitive feature gap tracking, and AI-powered recommendations grounded in real intelligence"
              },
              {
                icon: MapPin,
                title: "GTM Consultants",
                desc: "Multi-client competitive analysis, GTM assessment frameworks, relationship intelligence reports, and fully branded PDF deliverables"
              }
            ].map((role, i) => (
              <div key={i} className="p-6 rounded-xl bg-card border border-border text-center">
                <role.icon size={28} className="mx-auto mb-3 text-primary" />
                <h3 className="font-semibold text-sm mb-2">{role.title}</h3>
                <p className="text-xs text-muted-foreground">{role.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How Orbit is Different */}
      <section aria-label="Why Orbit" className="py-24 px-6 bg-card/30 border-y border-border">
        <div className="max-w-5xl mx-auto">
          <p className="text-sm font-medium text-primary uppercase tracking-widest text-center mb-4">Why Orbit</p>
          <h2 className="text-3xl font-bold text-center mb-4">Not another dashboard. A GTM operating system.</h2>
          <p className="text-center text-muted-foreground mb-16 max-w-2xl mx-auto">
            Other tools hand you data and leave the rest to you. Orbit takes you from market intelligence all the way to sent emails, published posts, and booked meetings.
          </p>
          
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                title: "Intelligence + Execution",
                desc: "Most tools stop at insight. Orbit goes the full distance — from competitive monitoring to campaign delivery to pipeline outreach, all connected in one workflow."
              },
              {
                title: "Grounded in your voice and brand",
                desc: "Upload positioning docs, brand guidelines, and writing samples. Every AI-generated asset — email, post, outreach, brief — is tailored to who you are and how you sound."
              },
              {
                title: "No channel left behind",
                desc: "Email delivery, social publishing, blog drafts, HubSpot sync — Orbit covers every outbound channel so your team doesn't have to jump between five tools to ship one campaign."
              }
            ].map((item, i) => (
              <div key={i} className="p-6 rounded-xl bg-background border border-border">
                <h3 className="font-semibold mb-3">{item.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Enterprise Ready */}
      <section aria-label="Enterprise Grade" className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <p className="text-sm font-medium text-primary uppercase tracking-widest mb-4">Enterprise Grade</p>
              <h2 className="text-3xl font-bold mb-6">Enterprise-ready by design</h2>
              <p className="text-muted-foreground mb-8">
                Built for organizations that take security, compliance, and governance seriously. Multi-tenant isolation, SSO, and audit trails come standard—with SharePoint Embedded data residency and Azure AI Foundry for enterprise-grade AI.
              </p>
              <div className="space-y-4">
                {[
                  "SOC 2 Type II certified",
                  "Microsoft Entra ID SSO",
                  "Role-based access control",
                  "Multi-tenant isolation",
                  "SharePoint Embedded data residency",
                  "Azure AI Foundry multi-model support",
                  "Encryption in transit and at rest",
                  "Complete audit logging",
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
              <div className="grid grid-cols-2 gap-6">
                {[
                  { label: "Multi-market support", desc: "Manage multiple clients/brands" },
                  { label: "Consultant access", desc: "Cross-tenant collaboration" },
                  { label: "Branded reports", desc: "White-label PDF exports" },
                  { label: "API access", desc: "Integration ready" }
                ].map((feature, i) => (
                  <div key={i}>
                    <Gem size={16} className="text-primary mb-2" />
                    <p className="font-medium text-sm">{feature.label}</p>
                    <p className="text-xs text-muted-foreground">{feature.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Export & Portability */}
      <section aria-label="Export and Portability" className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-sm font-medium text-primary uppercase tracking-widest mb-4">Export & Portability</p>
            <h2 className="text-3xl font-bold mb-6">Take your intelligence everywhere</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Orbit makes it easy to export data for collaboration, presentations, and digital visioning tools like Mural or Miro.
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: FileDown,
                category: "PDF Reports",
                items: ["Competitive Analysis Report", "Battlecard PDFs", "Full Analysis Report", "Product-Scoped Reports"]
              },
              {
                icon: Table,
                category: "CSV Exports",
                items: ["Gap Analysis", "Strategic Recommendations", "AI Roadmap Suggestions", "Product Features", "Roadmap Items"]
              },
              {
                icon: Download,
                category: "Markdown & Word",
                items: ["GTM Plans", "Messaging Frameworks", "Executive Summaries", "Market Export"]
              }
            ].map((exportType, i) => (
              <div key={i} className="p-6 rounded-xl bg-card border border-border">
                <exportType.icon size={28} className="text-primary mb-4" />
                <h3 className="font-semibold mb-4">{exportType.category}</h3>
                <ul className="space-y-2">
                  {exportType.items.map((item, j) => (
                    <li key={j} className="flex items-center gap-2 text-sm text-muted-foreground">
                      <CheckCircle2 size={14} className="text-primary flex-shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Preview */}
      <section aria-label="Pricing Preview" className="py-24 px-6 bg-card/30 border-y border-border">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-sm font-medium text-primary uppercase tracking-widest mb-4">Get Started</p>
          <h2 className="text-3xl font-bold mb-6">Start with a 60-day free trial</h2>
          <p className="text-muted-foreground mb-10 max-w-2xl mx-auto">
            Full access to Orbit's competitive intelligence, marketing planning, and product management capabilities. No credit card required.
          </p>
          
          <div className="grid md:grid-cols-3 gap-6 mb-12">
            {[
              { plan: "Free", desc: "Basic competitive monitoring", features: ["1 competitor", "1 analysis/month", "Core features"] },
              { plan: "Pro", desc: "Full intelligence suite", features: ["Up to 10 competitors", "Unlimited analysis", "Marketing Projects"], highlight: true },
              { plan: "Enterprise", desc: "Complete GTM platform", features: ["Unlimited competitors", "Product Management", "Multi-market support"] }
            ].map((tier, i) => (
              <div key={i} className={cn(
                "p-6 rounded-xl border",
                tier.highlight 
                  ? "bg-primary/5 border-primary/30" 
                  : "bg-background border-border"
              )}>
                <h3 className="font-bold text-lg mb-1">{tier.plan}</h3>
                <p className="text-sm text-muted-foreground mb-4">{tier.desc}</p>
                <ul className="space-y-2 text-sm">
                  {tier.features.map((f, j) => (
                    <li key={j} className="flex items-center gap-2">
                      <CheckCircle2 size={14} className="text-primary" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          
          <Link href="/auth/signup" className="inline-flex bg-primary hover:bg-primary/90 text-white px-8 py-4 rounded-lg text-lg font-medium transition-all shadow-lg shadow-primary/25 items-center gap-2">
            Start your 60-day trial <ArrowRight size={20} />
          </Link>
          <p className="text-sm text-muted-foreground mt-4">Questions? Contact us at <a href="mailto:contactus@synozur.com" className="text-primary hover:underline">contactus@synozur.com</a></p>
        </div>
      </section>

      {/* Final CTA */}
      <section aria-label="Call to Action" className="py-24 px-6 relative overflow-hidden">
        <div 
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage: "url('/images/orbit-background.png')",
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-background/60" />
        <div className="max-w-4xl mx-auto text-center relative z-10">
          <h2 className="text-4xl font-bold mb-6">Ready to transform your GTM?</h2>
          <p className="text-xl text-muted-foreground mb-10">
            Join teams who compete with intelligence, plan with precision, and build what wins.
          </p>
          <Link href="/auth/signup" className="inline-flex bg-primary hover:bg-primary/90 text-white px-8 py-4 rounded-lg text-lg font-medium transition-all shadow-lg shadow-primary/25 items-center gap-2">
            Start your 60-day trial <ArrowRight size={20} />
          </Link>
          <p className="text-sm text-muted-foreground mt-4">No credit card required. Full access for 60 days.</p>
        </div>
      </section>
      </article>
    </PublicLayout>
  );
}
