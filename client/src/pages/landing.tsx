import React, { useState } from "react";
import PublicLayout from "@/components/layout/PublicLayout";
import { Link } from "wouter";
import { ArrowRight, CheckCircle2, Shield, Zap, Target, BarChart3, FileText, Brain, Users, TrendingUp, Clock, Eye, Lightbulb, Radar, CalendarDays, Layers, Rocket, MapPin, GitBranch, PieChart, Gem, Download, Table, FileDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePageTracking } from "@/hooks/use-page-tracking";

const platformPillars = [
  {
    id: "intelligence",
    icon: Radar,
    title: "Competitive Intelligence",
    tagline: "Know your battlefield",
    description: "AI-powered analysis of competitor positioning, messaging, and market movements. Track changes, identify gaps, and stay ahead of the competition.",
    features: [
      "Automated competitor monitoring",
      "Claude-powered positioning analysis",
      "Messaging gap identification",
      "Competitive battlecards"
    ]
  },
  {
    id: "marketing",
    icon: CalendarDays,
    title: "Marketing Planner",
    tagline: "Plan with precision",
    description: "Transform competitive insights into actionable marketing plans. Quarterly, half-year, and annual planning with AI-generated task recommendations.",
    features: [
      "AI-suggested marketing activities",
      "Quarterly & annual planning",
      "Activity-based organization",
      "Progress tracking"
    ]
  },
  {
    id: "product",
    icon: GitBranch,
    title: "Product Management",
    tagline: "Build what matters",
    description: "Align product development with market reality. Manage roadmaps, track competitive features, and prioritize based on intelligence—not intuition.",
    features: [
      "Product roadmap management",
      "Competitive feature tracking",
      "Market-driven prioritization",
      "Release planning"
    ]
  }
];

const capabilities = [
  {
    id: "intelligence",
    label: "Market Intelligence",
    title: "Know your competitive landscape",
    description: "Orbit continuously monitors competitor websites, extracting key messaging, value propositions, and positioning changes. Get real-time insights into how your market is evolving.",
    image: "/images/capabilities/market-intelligence.png"
  },
  {
    id: "analysis",
    label: "AI Analysis",
    title: "Understand what sets you apart",
    description: "Claude-powered analysis compares your positioning against competitors, identifying gaps in your messaging and opportunities to differentiate. See exactly where you're winning—and where you're vulnerable.",
    image: "/images/capabilities/ai-analysis.png"
  },
  {
    id: "recommendations",
    label: "Recommendations",
    title: "Get actionable guidance",
    description: "AI-generated recommendations tailored to your industry and audience. Move from insight to action with specific messaging improvements, positioning shifts, and competitive responses.",
    image: "/images/capabilities/recommendations.png"
  },
  {
    id: "battlecards",
    label: "Battlecards",
    title: "Arm your sales team",
    description: "Generate competitive battlecards with Harvey Ball scoring, qualitative comparisons, and sales challenge questions. Give your team the ammunition they need to win deals.",
    image: "/images/capabilities/battlecards.png"
  },
  {
    id: "planning",
    label: "Marketing Planner",
    title: "Plan your GTM activities",
    description: "Transform insights into action with AI-powered marketing planning. Generate quarterly, half-year, or annual marketing plans based on competitive intelligence and industry best practices.",
    image: "/images/capabilities/planning.png"
  },
  {
    id: "roadmap",
    label: "Product Roadmap",
    title: "Prioritize with market context",
    description: "Align product development with competitive reality. Track feature gaps, manage your roadmap, and make data-driven prioritization decisions based on market intelligence.",
    image: "/images/capabilities/roadmap.png"
  },
  {
    id: "reporting",
    label: "Reporting",
    title: "Share insights across the org",
    description: "Export branded PDF reports for leadership, sales enablement, or board presentations. Track positioning changes over time with assessment snapshots and share intelligence that drives decisions.",
    image: "/images/capabilities/reporting.png"
  }
];

export default function Landing() {
  usePageTracking("/");
  const [activeCapability, setActiveCapability] = useState("intelligence");
  const [activePillar, setActivePillar] = useState("intelligence");
  const currentCapability = capabilities.find(c => c.id === activeCapability) || capabilities[0];
  const currentPillar = platformPillars.find(p => p.id === activePillar) || platformPillars[0];

  return (
    <PublicLayout>
      {/* Hero Section */}
      <section className="relative overflow-hidden py-24 md:py-32 px-6 min-h-[85vh] flex items-center justify-center">
        <div 
          className="absolute inset-0 z-0 select-none bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: "url('/images/hero-background.png')" }}
        />
        <div className="absolute inset-0 z-0 bg-gradient-to-b from-background/30 via-background/70 to-background" />
        
        <div className="max-w-5xl mx-auto text-center relative z-10">
          <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-full text-sm font-medium mb-6">
            <Gem size={16} />
            <span>Go-to-Market Intelligence Platform</span>
          </div>
          
          <h1 className="text-5xl md:text-6xl font-bold tracking-tight mb-6 leading-tight">
            From insight to action<br />
            <span className="text-primary">in one platform</span>
          </h1>
          
          <p className="text-xl text-muted-foreground mb-10 max-w-3xl mx-auto leading-relaxed">
            Orbit unifies competitive intelligence, marketing planning, and product management—giving GTM teams the clarity to compete, plan, and build with confidence.
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
              <FileText size={16} className="text-primary" />
              <span>Audit trails</span>
            </div>
          </div>
        </div>
      </section>

      {/* Platform Pillars - The Big Three */}
      <section className="py-24 px-6 bg-card/30 border-y border-border">
        <div className="max-w-6xl mx-auto">
          <p className="text-sm font-medium text-primary uppercase tracking-widest text-center mb-4">The Platform</p>
          <h2 className="text-3xl font-bold text-center mb-6">Three pillars of GTM excellence</h2>
          <p className="text-center text-muted-foreground mb-16 max-w-2xl mx-auto">
            Most tools give you data. Orbit gives you a complete system—from understanding your market to planning your response to building what wins.
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
            <div className="bg-muted/50 rounded-xl p-8 aspect-video flex items-center justify-center border border-border">
              <div className="text-center">
                <currentPillar.icon size={48} className="mx-auto mb-4 text-primary/50" />
                <p className="text-sm text-muted-foreground">[Screenshot: {currentPillar.title}]</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Built on Synozur Framework */}
      <section className="py-16 px-6">
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
      <section className="py-24 px-6 bg-card/30 border-y border-border">
        <div className="max-w-5xl mx-auto">
          <p className="text-sm font-medium text-primary uppercase tracking-widest text-center mb-4">How It Works</p>
          <h2 className="text-3xl font-bold text-center mb-16">Intelligence that flows into action</h2>
          
          <div className="relative">
            {/* Connection Line */}
            <div className="hidden md:block absolute top-12 left-[12.5%] right-[12.5%] h-0.5 bg-gradient-to-r from-primary/20 via-primary to-primary/20" />
            
            <div className="grid md:grid-cols-4 gap-8">
              {[
                { step: 1, icon: Radar, title: "Monitor", desc: "Track competitor websites, messaging, and market changes automatically" },
                { step: 2, icon: Brain, title: "Analyze", desc: "Claude AI identifies positioning gaps and competitive opportunities" },
                { step: 3, icon: CalendarDays, title: "Plan", desc: "Generate marketing plans with AI-suggested activities and timelines" },
                { step: 4, icon: Rocket, title: "Execute", desc: "Align product roadmaps and campaigns with market intelligence" }
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

      {/* Capabilities - Tabbed Section */}
      <section className="py-24 px-6">
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
            <div className="bg-muted/50 rounded-xl p-8 aspect-video flex items-center justify-center border border-border">
              <p className="text-sm text-muted-foreground">[Screenshot: {currentCapability.label}]</p>
            </div>
          </div>
        </div>
      </section>

      {/* Three Outcomes */}
      <section className="py-24 px-6 bg-card/30 border-y border-border">
        <div className="max-w-5xl mx-auto">
          <p className="text-sm font-medium text-primary uppercase tracking-widest text-center mb-4">Outcomes</p>
          <h2 className="text-3xl font-bold text-center mb-16">What you'll achieve</h2>
          
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                icon: Eye,
                title: "See clearly",
                desc: "Understand exactly how competitors position themselves—and where you have the advantage."
              },
              {
                icon: Target,
                title: "Act decisively",
                desc: "Transform intelligence into marketing plans and product priorities—not just reports."
              },
              {
                icon: TrendingUp,
                title: "Win consistently",
                desc: "Arm teams with battlecards, align roadmaps to market reality, and outmaneuver the competition."
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
      <section className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <p className="text-sm font-medium text-primary uppercase tracking-widest text-center mb-4">Who It's For</p>
          <h2 className="text-3xl font-bold text-center mb-16">Built for the entire GTM team</h2>
          
          <div className="grid md:grid-cols-4 gap-6">
            {[
              {
                icon: BarChart3,
                title: "Marketing Leaders",
                desc: "Competitive positioning, messaging strategy, and campaign planning"
              },
              {
                icon: Users,
                title: "Sales Teams",
                desc: "Battlecards, competitive objection handling, and deal intelligence"
              },
              {
                icon: Layers,
                title: "Product Managers",
                desc: "Roadmap prioritization, feature gap analysis, and market context"
              },
              {
                icon: MapPin,
                title: "GTM Consultants",
                desc: "Multi-client analysis, assessment frameworks, and branded deliverables"
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
      <section className="py-24 px-6 bg-card/30 border-y border-border">
        <div className="max-w-5xl mx-auto">
          <p className="text-sm font-medium text-primary uppercase tracking-widest text-center mb-4">Why Orbit</p>
          <h2 className="text-3xl font-bold text-center mb-4">Not another dashboard. A decision engine.</h2>
          <p className="text-center text-muted-foreground mb-16 max-w-2xl mx-auto">
            Other tools stop at data collection. Orbit turns intelligence into plans, priorities, and action.
          </p>
          
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                title: "Intelligence + Action",
                desc: "We don't just show you competitors—we help you respond with marketing plans and roadmap priorities."
              },
              {
                title: "Grounded in your context",
                desc: "Upload positioning docs and brand guidelines. Every AI recommendation is tailored to who you are."
              },
              {
                title: "One platform, full workflow",
                desc: "From competitive monitoring to marketing planning to product roadmaps—it's all connected."
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
      <section className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <p className="text-sm font-medium text-primary uppercase tracking-widest mb-4">Enterprise Grade</p>
              <h2 className="text-3xl font-bold mb-6">Enterprise-ready by design</h2>
              <p className="text-muted-foreground mb-8">
                Built for organizations that take security, compliance, and governance seriously. Multi-tenant isolation, SSO, and audit trails come standard.
              </p>
              <div className="space-y-4">
                {[
                  "SOC 2 Type II certified",
                  "Microsoft Entra ID SSO",
                  "Role-based access control",
                  "Multi-tenant isolation",
                  "Encryption in transit and at rest",
                  "Complete audit logging"
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
      <section className="py-24 px-6">
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
      <section className="py-24 px-6 bg-card/30 border-y border-border">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-sm font-medium text-primary uppercase tracking-widest mb-4">Get Started</p>
          <h2 className="text-3xl font-bold mb-6">Start with a 60-day free trial</h2>
          <p className="text-muted-foreground mb-10 max-w-2xl mx-auto">
            Full access to Orbit's competitive intelligence, marketing planning, and product management capabilities. No credit card required.
          </p>
          
          <div className="grid md:grid-cols-3 gap-6 mb-12">
            {[
              { plan: "Free", desc: "Basic competitive monitoring", features: ["1 competitor", "1 analysis/month", "Core features"] },
              { plan: "Pro", desc: "Full intelligence suite", features: ["Up to 10 competitors", "Unlimited analysis", "Marketing Planner"], highlight: true },
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
      <section className="py-24 px-6 bg-gradient-to-b from-background to-card/50">
        <div className="max-w-4xl mx-auto text-center">
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
    </PublicLayout>
  );
}
