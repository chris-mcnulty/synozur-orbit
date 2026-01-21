import React, { useState } from "react";
import PublicLayout from "@/components/layout/PublicLayout";
import { Link } from "wouter";
import { ArrowRight, CheckCircle2, Shield, Zap, Target, BarChart3, FileText, Brain, Users, TrendingUp, Clock, Eye, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePageTracking } from "@/hooks/use-page-tracking";

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
    id: "reporting",
    label: "Reporting",
    title: "Share insights across the org",
    description: "Export branded PDF reports for leadership, sales enablement, or board presentations. Track positioning changes over time with assessment snapshots.",
    image: "/images/capabilities/reporting.png"
  }
];

export default function Landing() {
  usePageTracking("/");
  const [activeCapability, setActiveCapability] = useState("intelligence");
  const currentCapability = capabilities.find(c => c.id === activeCapability) || capabilities[0];

  return (
    <PublicLayout>
      {/* Hero Section */}
      <section className="relative overflow-hidden py-24 md:py-32 px-6 min-h-[85vh] flex items-center justify-center">
        <div 
          className="absolute inset-0 z-0 select-none bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: "url('/images/hero-background.png')" }}
        />
        <div className="absolute inset-0 z-0 bg-gradient-to-b from-background/30 via-background/70 to-background" />
        
        <div className="max-w-4xl mx-auto text-center relative z-10">
          <h1 className="text-5xl md:text-6xl font-bold tracking-tight mb-6 leading-tight">
            Win on positioning<br />
            <span className="text-primary">not guesswork.</span>
          </h1>
          
          <p className="text-xl text-muted-foreground mb-10 max-w-2xl mx-auto leading-relaxed">
            Orbit is an AI-driven marketing intelligence platform that analyzes your competitive landscape and generates actionable positioning recommendations.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
            <Link href="/auth/signup" className="bg-primary hover:bg-primary/90 text-white px-8 py-4 rounded-lg text-lg font-medium transition-all shadow-lg shadow-primary/25 flex items-center justify-center gap-2">
              Get started now <ArrowRight size={20} />
            </Link>
            <Link href="/auth/signin" className="bg-muted hover:bg-muted/80 text-primary px-8 py-4 rounded-lg text-lg font-medium transition-all">
              Log in
            </Link>
          </div>

          <p className="text-sm text-muted-foreground mb-12">
            Start using Orbit today — no purchase, no credit card, and no sales call required.
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
              <FileText size={16} className="text-primary" />
              <span>Audit trails</span>
            </div>
          </div>
        </div>
      </section>

      {/* Built on Synozur Framework */}
      <section className="py-16 px-6 bg-card/30 border-y border-border">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-lg text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground">Built on our proven GTM intelligence framework.</span>{" "}
            Orbit is built on methodologies developed by Synozur through decades of go-to-market consulting work. It reflects how real marketing and sales teams understand competitive positioning—refined through hands-on work with dozens of organizations.
          </p>
          <p className="text-sm text-muted-foreground mt-4">
            See how this approach has been applied in practice:{" "}
            <a href="https://www.synozur.com/case-studies" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">View case studies</a>
          </p>
        </div>
      </section>

      {/* First 15 Minutes */}
      <section className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-16">What you'll do in your first 15 minutes</h2>
          
          <div className="grid md:grid-cols-4 gap-8">
            {[
              { step: 1, title: "Add your competitors", desc: "Enter competitor URLs and Orbit crawls their websites automatically" },
              { step: 2, title: "Upload your positioning docs", desc: "Add your messaging guidelines, brand docs, or pitch decks" },
              { step: 3, title: "Run AI analysis", desc: "Claude analyzes your positioning vs competitors in real-time" },
              { step: 4, title: "Get recommendations", desc: "See gaps, opportunities, and specific messaging improvements" }
            ].map((item) => (
              <div key={item.step} className="text-center">
                <div className="w-12 h-12 rounded-full bg-primary text-white flex items-center justify-center text-xl font-bold mx-auto mb-4">
                  {item.step}
                </div>
                <h3 className="font-semibold mb-2">{item.title}</h3>
                <p className="text-sm text-muted-foreground">{item.desc}</p>
              </div>
            ))}
          </div>

          <div className="text-center mt-12">
            <Link href="/auth/signup" className="inline-flex bg-primary hover:bg-primary/90 text-white px-6 py-3 rounded-lg font-medium transition-all items-center gap-2">
              Get started now <ArrowRight size={18} />
            </Link>
            <p className="text-xs text-muted-foreground mt-3">No credit card required</p>
          </div>
        </div>
      </section>

      {/* Capabilities - Tabbed Section */}
      <section className="py-24 px-6 bg-card/30 border-y border-border">
        <div className="max-w-6xl mx-auto">
          <p className="text-sm font-medium text-primary uppercase tracking-widest text-center mb-4">Capabilities</p>
          <h2 className="text-3xl font-bold text-center mb-16">Discover how Orbit puts intelligence to work</h2>
          
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
      <section className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <p className="text-sm font-medium text-primary uppercase tracking-widest text-center mb-4">What You'll Achieve</p>
          <h2 className="text-3xl font-bold text-center mb-16">Three outcomes that matter</h2>
          
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                icon: Eye,
                title: "See",
                desc: "Understand exactly how competitors position themselves—messaging, value props, target audience, and tone."
              },
              {
                icon: Target,
                title: "Differentiate",
                desc: "Identify gaps in your positioning and opportunities to stand out in crowded markets."
              },
              {
                icon: TrendingUp,
                title: "Win",
                desc: "Arm sales with battlecards, improve conversion with better messaging, and track competitive changes over time."
              }
            ].map((outcome, i) => (
              <div key={i} className="text-center p-8 rounded-2xl bg-card border border-border">
                <outcome.icon size={40} className="mx-auto mb-4 text-primary" />
                <h3 className="text-xl font-bold mb-3">{outcome.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{outcome.desc}</p>
              </div>
            ))}
          </div>

          <div className="text-center mt-12">
            <Link href="/auth/signup" className="inline-flex bg-primary hover:bg-primary/90 text-white px-6 py-3 rounded-lg font-medium transition-all items-center gap-2">
              Get started now <ArrowRight size={18} />
            </Link>
            <p className="text-xs text-muted-foreground mt-3">No credit card required. Be set up in minutes.</p>
          </div>
        </div>
      </section>

      {/* How Orbit is Different */}
      <section className="py-24 px-6 bg-card/30 border-y border-border">
        <div className="max-w-5xl mx-auto">
          <p className="text-sm font-medium text-primary uppercase tracking-widest text-center mb-4">Why Orbit</p>
          <h2 className="text-3xl font-bold text-center mb-4">How Orbit is Different</h2>
          <p className="text-center text-muted-foreground mb-16 max-w-2xl mx-auto">
            Unlike generic competitive intelligence tools, Orbit combines AI analysis with your own positioning documents to deliver actionable insights.
          </p>
          
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                title: "Not just monitoring",
                desc: "We don't just track changes—we analyze what they mean for your positioning and recommend responses."
              },
              {
                title: "AI that grounds in your context",
                desc: "Upload your positioning docs, brand guidelines, and messaging. AI recommendations are tailored to who you are."
              },
              {
                title: "Built for GTM teams",
                desc: "Battlecards, assessment snapshots, and exportable reports designed for real sales and marketing workflows."
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

      {/* Is Orbit Right For You */}
      <section className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-16">Is Orbit right for you?</h2>
          
          <div className="grid md:grid-cols-2 gap-12">
            <div className="p-8 rounded-2xl bg-card border border-primary/30">
              <h3 className="font-bold text-lg mb-6 text-primary">Built for</h3>
              <ul className="space-y-4">
                {[
                  "Marketing leaders who need competitive positioning clarity",
                  "Sales teams who want data-driven battlecards",
                  "Product marketers tracking competitive messaging",
                  "GTM consultants running multi-client competitive analysis"
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <CheckCircle2 size={18} className="text-primary mt-0.5 flex-shrink-0" />
                    <span className="text-sm">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            
            <div className="p-8 rounded-2xl bg-muted/30 border border-border">
              <h3 className="font-bold text-lg mb-6 text-muted-foreground">Not designed for</h3>
              <ul className="space-y-4 text-muted-foreground">
                {[
                  "Real-time social media monitoring",
                  "SEO keyword tracking",
                  "Ad spend intelligence",
                  "Generic web scraping"
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm">
                    <span className="text-muted-foreground">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="text-center mt-12">
            <Link href="/auth/signup" className="inline-flex bg-primary hover:bg-primary/90 text-white px-6 py-3 rounded-lg font-medium transition-all items-center gap-2">
              Get started now <ArrowRight size={18} />
            </Link>
            <p className="text-xs text-muted-foreground mt-3">No credit card required. Be set up in minutes.</p>
          </div>
        </div>
      </section>

      {/* Five Integrated Modules */}
      <section className="py-24 px-6 bg-card/30 border-y border-border">
        <div className="max-w-5xl mx-auto">
          <p className="text-sm font-medium text-primary uppercase tracking-widest text-center mb-4">The Platform</p>
          <h2 className="text-3xl font-bold text-center mb-16">Five integrated modules</h2>
          
          <div className="grid md:grid-cols-5 gap-6">
            {[
              { icon: Target, title: "Company Profile", desc: "Your baseline positioning and website" },
              { icon: Users, title: "Competitors", desc: "Track and analyze competitor websites" },
              { icon: Brain, title: "AI Analysis", desc: "Claude-powered competitive insights" },
              { icon: Lightbulb, title: "Recommendations", desc: "Actionable positioning improvements" },
              { icon: FileText, title: "Battlecards", desc: "Sales enablement materials" }
            ].map((module, i) => (
              <div key={i} className="text-center p-6 rounded-xl bg-background border border-border">
                <module.icon size={28} className="mx-auto mb-3 text-primary" />
                <h3 className="font-semibold text-sm mb-2">{module.title}</h3>
                <p className="text-xs text-muted-foreground">{module.desc}</p>
              </div>
            ))}
          </div>

          <div className="text-center mt-12 pt-8 border-t border-border">
            <p className="text-sm text-muted-foreground mb-6">
              <span className="font-medium text-foreground">Powered by Claude AI</span> | Grounding documents | Multi-tenant isolation
            </p>
            <Link href="/auth/signup" className="inline-flex bg-primary hover:bg-primary/90 text-white px-6 py-3 rounded-lg font-medium transition-all items-center gap-2">
              Get started now <ArrowRight size={18} />
            </Link>
            <p className="text-xs text-muted-foreground mt-3">No credit card required. Be set up in minutes.</p>
          </div>
        </div>
      </section>

      {/* Enterprise Ready */}
      <section className="py-24 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-sm font-medium text-primary uppercase tracking-widest mb-4">Enterprise Grade</p>
          <h2 className="text-3xl font-bold mb-12">Enterprise-ready by design</h2>
          
          <div className="flex flex-wrap justify-center gap-8 text-sm">
            {[
              "SOC 2 Type II",
              "Encryption in transit and at rest",
              "Microsoft Entra SSO + RBAC",
              "Audit logging",
              "Multi-tenant isolation"
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-2">
                <CheckCircle2 size={16} className="text-primary" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-24 px-6 bg-gradient-to-b from-card/50 to-background border-t border-border">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl font-bold mb-6">Ready to win on positioning?</h2>
          <p className="text-xl text-muted-foreground mb-10">
            Join marketing teams who compete with clarity—not guesswork.
          </p>
          <Link href="/auth/signup" className="inline-flex bg-primary hover:bg-primary/90 text-white px-8 py-4 rounded-lg text-lg font-medium transition-all shadow-lg shadow-primary/25 items-center gap-2">
            Get started now <ArrowRight size={20} />
          </Link>
          <p className="text-sm text-muted-foreground mt-4">No credit card required. Be set up in minutes.</p>
        </div>
      </section>
    </PublicLayout>
  );
}

/*
=============================================================================
GRAPHICS NEEDED TO ENRICH THIS HOME PAGE
=============================================================================

1. HERO SECTION
   - hero-background.png: Abstract space/orbit themed background (existing)
   - Optional: Animated orbit/satellite illustration

2. CAPABILITIES SECTION SCREENSHOTS (5 images)
   - /images/capabilities/market-intelligence.png: Screenshot of competitor list with analysis data
   - /images/capabilities/ai-analysis.png: Screenshot of AI analysis results
   - /images/capabilities/recommendations.png: Screenshot of recommendations page
   - /images/capabilities/battlecards.png: Mockup of competitive battlecard with Harvey Balls
   - /images/capabilities/reporting.png: Screenshot of PDF report or assessment view

3. TRUST/SOCIAL PROOF
   - Customer logos (if available)
   - SOC 2 Type II badge

4. MODULE ICONS (optional custom)
   - Custom icons for each of the 5 modules if desired over Lucide icons

5. VIDEO
   - 2-minute walkthrough video (like Vega has)
   - Video thumbnail/poster image

6. BRAND ASSETS
   - synozur-mark.png: Already exists
   - orbit-logo.png: Product logo if different from mark

7. ENTERPRISE SECTION
   - Security/compliance badge illustrations
   - Partner logos (Microsoft, etc.)

8. OPTIONAL ENHANCEMENTS
   - Animated GIF showing AI analysis in action
   - Before/after positioning comparison illustration
   - Competitor landscape visualization graphic
   - Battlecard preview mockup
=============================================================================
*/
