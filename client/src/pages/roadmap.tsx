import React from "react";
import PublicLayout from "@/components/layout/PublicLayout";
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
    title: "Completed",
    timeline: "Already Available",
    icon: <CheckCircle2 className="w-5 h-5" />,
    items: [
      {
        title: "Microsoft Entra ID SSO",
        description: "Enterprise single sign-on integration",
        status: "completed"
      },
      {
        title: "Multi-Tenant Architecture",
        description: "Secure tenant isolation with role-based access",
        status: "completed"
      },
      {
        title: "AI-Powered Analysis",
        description: "Claude-powered competitive analysis and recommendations",
        status: "completed"
      },
      {
        title: "Document Upload",
        description: "PDF and DOCX support for grounding documents",
        status: "completed"
      },
      {
        title: "Dark/Light Mode",
        description: "Theme toggle with system preference support",
        status: "completed"
      }
    ]
  },
  {
    title: "Coming Soon",
    timeline: "Q1 2026",
    icon: <Rocket className="w-5 h-5" />,
    items: [
      {
        title: "PDF Report Generation",
        description: "Export branded PDF reports for stakeholders",
        status: "in-progress",
        items: ["Synozur-branded templates", "Analysis summaries", "Recommendation exports"]
      },
      {
        title: "Web Crawling Service",
        description: "Automated competitor website monitoring",
        status: "in-progress",
        items: ["Homepage, about, and product page crawling", "Scheduled updates", "Change detection"]
      },
      {
        title: "Competitor Change Alerts",
        description: "Get notified when competitors update their messaging",
        status: "planned",
        items: ["Daily/weekly monitoring", "AI-powered change summaries", "Activity log integration"]
      },
      {
        title: "Trial & Feature Gating",
        description: "14-day free trial with tier-based features",
        status: "planned"
      }
    ]
  },
  {
    title: "On the Horizon",
    timeline: "Q2-Q4 2026",
    icon: <Target className="w-5 h-5" />,
    items: [
      {
        title: "Competitive Battlecards",
        description: "Generate sales enablement battlecards with Harvey Ball scoring",
        status: "planned"
      },
      {
        title: "Email Notifications",
        description: "Automated alerts for competitor changes and trial updates",
        status: "planned"
      },
      {
        title: "Team Collaboration",
        description: "Shared annotations, comments, and team workspaces",
        status: "planned"
      },
      {
        title: "HubSpot Integration",
        description: "Sync competitors and push insights to your CRM",
        status: "planned"
      },
      {
        title: "Google SSO",
        description: "Additional single sign-on option for Google Workspace users",
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
