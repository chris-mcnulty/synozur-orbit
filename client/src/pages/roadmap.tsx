import React from "react";
import PublicLayout from "@/components/layout/PublicLayout";
import SEOHead from "@/components/SEOHead";
import { Link } from "wouter";
import { ArrowLeft, CheckCircle2, Clock, Circle, Rocket, Calendar, Target } from "lucide-react";

type Status = "completed" | "in-progress" | "planned";

interface RoadmapItem {
  title: string;
  description: string;
  status: Status;
  items?: string[];
}

interface RoadmapSection {
  title: string;
  timeline: string;
  icon: React.ReactNode;
  items: RoadmapItem[];
}

const roadmap: RoadmapSection[] = [
  {
    title: "Recently Shipped",
    timeline: "Summer 2026",
    icon: <Rocket className="w-5 h-5" />,
    items: [
      {
        title: "Strategic Intelligence Stack",
        description: "Quantified market strategy: ranked segments, GTM heatmap, and end-to-end market studies",
        status: "completed",
        items: [
          "Market Segments with Census-grounded TAM/SAM/SOM sizing, needs maps, and priority ranking",
          "Opportunity Matrix — segment × need × channel heatmap with ROI scores and whitespace flags",
          "Market Study Wizard with autonomous competitor discovery and branded PDF export"
        ]
      },
      {
        title: "Master Marketing Calendar",
        description: "One calendar across social, email, and briefs — with an AI Content Advisor",
        status: "completed"
      },
      {
        title: "Direct Social Publishing",
        description: "One-click social connections and direct X publishing with images",
        status: "completed",
        items: ["Unified post editor across all surfaces", "Multi-channel fan-out from a single draft"]
      },
      {
        title: "Email Newsletters with A/B Testing",
        description: "Section-based responsive composition, list/segment sends, and compliance guardrails",
        status: "completed"
      },
      {
        title: "Website Content Import & Repurposing",
        description: "Pull blog posts, events, and case studies from your site; repurpose any asset into a batch of formats",
        status: "completed"
      }
    ]
  },
  {
    title: "Completed Foundations",
    timeline: "Already Available",
    icon: <CheckCircle2 className="w-5 h-5" />,
    items: [
      {
        title: "Value-Chain Navigation & Home",
        description: "Research → Product → Marketing → Sales areas with a global Home page and Orbit Score",
        status: "completed"
      },
      {
        title: "Competitive Intelligence Core",
        description: "Competitor monitoring, web crawling, change alerts, AI analysis, battlecards, and branded PDF reports",
        status: "completed"
      },
      {
        title: "Content Execution Stack",
        description: "Editorial Calendar with AI briefs, multi-format copywriter, SEO/AEO optimizer, and Content Pipeline board",
        status: "completed"
      },
      {
        title: "Conference Social Promotion",
        description: "Anchor and per-session posts with composited hero graphics",
        status: "completed"
      },
      {
        title: "Marketing Performance",
        description: "Closed-loop report tying content to conversions via tracked links and GA4",
        status: "completed"
      },
      {
        title: "Enterprise Platform",
        description: "Microsoft Entra ID SSO, multi-tenant isolation, HubSpot two-way integration, Microsoft Planner sync, support ticketing",
        status: "completed"
      }
    ]
  },
  {
    title: "On the Horizon",
    timeline: "Late 2026",
    icon: <Target className="w-5 h-5" />,
    items: [
      {
        title: "Deeper Market Study Research",
        description: "Study-time website crawling and per-competitor enrichment for richer discovery",
        status: "in-progress"
      },
      {
        title: "Source Library & Provenance",
        description: "Scored source library with claim-level citations across intelligence artifacts",
        status: "planned"
      },
      {
        title: "Collaboration Features",
        description: "Shared annotations, comments, and team workspaces",
        status: "planned"
      },
      {
        title: "Outcome Metrics & ROI Dashboard",
        description: "Google Analytics integration, Orbit Index, and industry benchmarks",
        status: "planned"
      },
      {
        title: "Billing Integration",
        description: "Self-serve plan management and payment processing",
        status: "planned"
      }
    ]
  }
];

function getStatusIcon(status: Status) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="w-5 h-5 text-green-500" />;
    case "in-progress":
      return <Clock className="w-5 h-5 text-yellow-500" />;
    case "planned":
      return <Circle className="w-5 h-5 text-muted-foreground" />;
  }
}

function getStatusLabel(status: Status) {
  switch (status) {
    case "completed":
      return "Completed";
    case "in-progress":
      return "In Progress";
    case "planned":
      return "Planned";
  }
}

function getStatusColor(status: Status) {
  switch (status) {
    case "completed":
      return "bg-green-500/10 text-green-500 border-green-500/20";
    case "in-progress":
      return "bg-yellow-500/10 text-yellow-500 border-yellow-500/20";
    case "planned":
      return "bg-muted text-muted-foreground border-border";
  }
}

export default function Roadmap() {
  return (
    <PublicLayout>
      <SEOHead
        title="Product Roadmap"
        description="See what's coming next for Orbit. Completed features, in-progress work, and planned capabilities for the GTM intelligence platform."
        path="/roadmap"
      />
      <section className="py-16 px-6">
        <div className="max-w-4xl mx-auto">
          <Link href="/about" className="text-sm text-muted-foreground hover:text-primary inline-flex items-center gap-2 mb-8">
            <ArrowLeft size={16} /> Back to About
          </Link>
          
          <div className="mb-12">
            <h1 className="text-4xl font-bold mb-4">Product Roadmap</h1>
            <p className="text-muted-foreground text-lg">
              See what we've built and what's coming next for Orbit.
            </p>
          </div>

          <div className="space-y-16">
            {roadmap.map((section) => (
              <div key={section.title}>
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                    {section.icon}
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold">{section.title}</h2>
                    <p className="text-sm text-muted-foreground">{section.timeline}</p>
                  </div>
                </div>

                <div className="grid gap-4">
                  {section.items.map((item) => (
                    <div 
                      key={item.title} 
                      className="bg-card border border-border rounded-xl p-6 hover:border-primary/30 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-4 mb-2">
                        <div className="flex items-start gap-3">
                          {getStatusIcon(item.status)}
                          <div>
                            <h3 className="font-semibold">{item.title}</h3>
                            <p className="text-sm text-muted-foreground mt-1">{item.description}</p>
                          </div>
                        </div>
                        <span className={`text-xs px-2 py-1 rounded-full border flex-shrink-0 ${getStatusColor(item.status)}`}>
                          {getStatusLabel(item.status)}
                        </span>
                      </div>

                      {item.items && (
                        <ul className="mt-4 ml-8 space-y-1">
                          {item.items.map((subItem, index) => (
                            <li key={index} className="text-sm text-muted-foreground flex items-center gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-primary/50" />
                              {subItem}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-16 p-6 bg-card/50 border border-border rounded-xl text-center">
            <Calendar className="w-8 h-8 text-primary mx-auto mb-3" />
            <h3 className="font-semibold mb-2">Have a feature request?</h3>
            <p className="text-sm text-muted-foreground mb-4">
              We'd love to hear what features would help your team the most.
            </p>
            <a 
              href="https://www.synozur.com/contact" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-primary hover:underline text-sm font-medium"
            >
              Contact us with your ideas
            </a>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
