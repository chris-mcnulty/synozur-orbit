import React from "react";
import PublicLayout from "@/components/layout/PublicLayout";
import { Link } from "wouter";
import { ArrowLeft, CheckCircle2, Plus, Sparkles, Wrench, AlertTriangle, Shield } from "lucide-react";

const changelogEntries = [
  {
    version: "0.1.0",
    date: "January 17, 2026",
    sections: [
      {
        type: "added",
        items: [
          {
            category: "Authentication & Security",
            features: [
              "Microsoft Entra ID SSO integration with OAuth 2.0",
              "Role-based access control (Global Admin, Domain Admin, Standard User)",
              "Session-based authentication with secure cookies",
              "Password login with bcrypt hashing"
            ]
          },
          {
            category: "Multi-Tenant Architecture",
            features: [
              "Tenant isolation by email domain",
              "Automatic role assignment for first users",
              "Tenant usage limits and plan management"
            ]
          },
          {
            category: "Competitive Intelligence",
            features: [
              "Competitor URL tracking and management",
              "AI-powered competitive analysis with Claude",
              "Gap analysis between your positioning and competitors",
              "AI-generated recommendations"
            ]
          },
          {
            category: "Document Management",
            features: [
              "Grounding document upload (PDF, DOCX)",
              "Company profile baselining",
              "Text extraction for AI analysis"
            ]
          },
          {
            category: "User Interface",
            features: [
              "Modern dashboard with key metrics",
              "Dark/light mode toggle",
              "Synozur brand styling",
              "Responsive design for all devices"
            ]
          }
        ]
      }
    ]
  }
];

function getIcon(type: string) {
  switch (type) {
    case "added":
      return <Plus className="w-4 h-4" />;
    case "changed":
      return <Wrench className="w-4 h-4" />;
    case "fixed":
      return <CheckCircle2 className="w-4 h-4" />;
    case "security":
      return <Shield className="w-4 h-4" />;
    case "deprecated":
      return <AlertTriangle className="w-4 h-4" />;
    default:
      return <Sparkles className="w-4 h-4" />;
  }
}

function getTypeColor(type: string) {
  switch (type) {
    case "added":
      return "bg-green-500/10 text-green-500 border-green-500/20";
    case "changed":
      return "bg-blue-500/10 text-blue-500 border-blue-500/20";
    case "fixed":
      return "bg-purple-500/10 text-purple-500 border-purple-500/20";
    case "security":
      return "bg-red-500/10 text-red-500 border-red-500/20";
    case "deprecated":
      return "bg-yellow-500/10 text-yellow-500 border-yellow-500/20";
    default:
      return "bg-primary/10 text-primary border-primary/20";
  }
}

export default function Changelog() {
  return (
    <PublicLayout>
      <section className="py-16 px-6">
        <div className="max-w-4xl mx-auto">
          <Link href="/about" className="text-sm text-muted-foreground hover:text-primary inline-flex items-center gap-2 mb-8">
            <ArrowLeft size={16} /> Back to About
          </Link>
          
          <div className="mb-12">
            <h1 className="text-4xl font-bold mb-4">Changelog</h1>
            <p className="text-muted-foreground text-lg">
              A history of updates, improvements, and new features in Orbit.
            </p>
          </div>

          <div className="space-y-12">
            {changelogEntries.map((entry) => (
              <div key={entry.version} className="relative">
                <div className="flex items-center gap-4 mb-6">
                  <div className="bg-primary text-primary-foreground px-4 py-2 rounded-full font-bold">
                    v{entry.version}
                  </div>
                  <span className="text-muted-foreground">{entry.date}</span>
                </div>

                <div className="space-y-8 pl-4 border-l-2 border-border">
                  {entry.sections.map((section, sectionIndex) => (
                    <div key={sectionIndex} className="pl-6">
                      <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium border mb-4 ${getTypeColor(section.type)}`}>
                        {getIcon(section.type)}
                        <span className="capitalize">{section.type}</span>
                      </div>

                      <div className="space-y-6">
                        {section.items.map((item, itemIndex) => (
                          <div key={itemIndex}>
                            <h3 className="font-semibold mb-3">{item.category}</h3>
                            <ul className="space-y-2">
                              {item.features.map((feature, featureIndex) => (
                                <li key={featureIndex} className="flex items-start gap-3 text-muted-foreground">
                                  <CheckCircle2 className="w-4 h-4 text-primary mt-1 flex-shrink-0" />
                                  <span>{feature}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
