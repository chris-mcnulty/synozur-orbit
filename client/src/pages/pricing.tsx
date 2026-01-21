import React from "react";
import PublicLayout from "@/components/layout/PublicLayout";
import { Link } from "wouter";
import { ArrowRight, Check, Minus } from "lucide-react";
import { usePageTracking } from "@/hooks/use-page-tracking";

type FeatureAvailability = boolean | string;

interface PlanFeatures {
  [key: string]: FeatureAvailability;
}

interface Plan {
  name: string;
  price: string;
  description: string;
  features: PlanFeatures;
  highlight?: boolean;
  cta: string;
  ctaLink: string;
}

const plans: Plan[] = [
  {
    name: "Trial",
    price: "Free",
    description: "60 days full access",
    cta: "Start Trial",
    ctaLink: "/auth/signup",
    features: {
      competitors: "3",
      analyses: "5 / month",
      users: "3",
      competitorMonitoring: true,
      aiAnalysis: true,
      battlecards: true,
      recommendations: true,
      pdfReports: true,
      socialMonitoring: false,
      clientProjects: false,
      marketingPlanner: false,
      productManagement: false,
      multiMarket: false,
      ssoIntegration: false,
      customBranding: false,
      apiAccess: false,
      prioritySupport: false,
    },
  },
  {
    name: "Free",
    price: "Free",
    description: "Basic competitive monitoring",
    cta: "Get Started",
    ctaLink: "/auth/signup",
    features: {
      competitors: "1",
      analyses: "1 / month",
      users: "1",
      competitorMonitoring: true,
      aiAnalysis: true,
      battlecards: false,
      recommendations: false,
      pdfReports: false,
      socialMonitoring: false,
      clientProjects: false,
      marketingPlanner: false,
      productManagement: false,
      multiMarket: false,
      ssoIntegration: false,
      customBranding: false,
      apiAccess: false,
      prioritySupport: false,
    },
  },
  {
    name: "Pro",
    price: "Synozur client  only",
    description: "Full intelligence suite",
    cta: "Contact Us",
    ctaLink: "mailto:contactus@synozur.com",
    highlight: true,
    features: {
      competitors: "10",
      analyses: "Unlimited",
      users: "10",
      competitorMonitoring: true,
      aiAnalysis: true,
      battlecards: true,
      recommendations: true,
      pdfReports: true,
      socialMonitoring: true,
      clientProjects: true,
      marketingPlanner: false,
      productManagement: false,
      multiMarket: false,
      ssoIntegration: true,
      customBranding: false,
      apiAccess: false,
      prioritySupport: true,
    },
  },
  {
    name: "Enterprise",
    price: "Synozur client only",
    description: "Complete GTM platform",
    cta: "Contact Us",
    ctaLink: "mailto:contactus@synozur.com",
    features: {
      competitors: "Unlimited",
      analyses: "Unlimited",
      users: "Unlimited",
      competitorMonitoring: true,
      aiAnalysis: true,
      battlecards: true,
      recommendations: true,
      pdfReports: true,
      socialMonitoring: true,
      clientProjects: true,
      marketingPlanner: true,
      productManagement: true,
      multiMarket: true,
      ssoIntegration: true,
      customBranding: true,
      apiAccess: true,
      prioritySupport: true,
    },
  },
];

const featureLabels: { key: string; label: string; category: string }[] = [
  { key: "competitors", label: "Competitors tracked", category: "Limits" },
  { key: "analyses", label: "AI analyses", category: "Limits" },
  { key: "users", label: "Team members", category: "Limits" },
  { key: "competitorMonitoring", label: "Competitor website monitoring", category: "Competitive Intelligence" },
  { key: "aiAnalysis", label: "Claude AI-powered analysis", category: "Competitive Intelligence" },
  { key: "battlecards", label: "Sales battlecards", category: "Competitive Intelligence" },
  { key: "recommendations", label: "AI recommendations", category: "Competitive Intelligence" },
  { key: "pdfReports", label: "Branded PDF reports", category: "Competitive Intelligence" },
  { key: "socialMonitoring", label: "Social media monitoring", category: "Competitive Intelligence" },
  { key: "clientProjects", label: "Client projects", category: "Advanced Features" },
  { key: "marketingPlanner", label: "Marketing Planner", category: "Advanced Features" },
  { key: "productManagement", label: "Product Management", category: "Advanced Features" },
  { key: "multiMarket", label: "Multi-market support", category: "Advanced Features" },
  { key: "ssoIntegration", label: "Microsoft Entra SSO", category: "Enterprise" },
  { key: "customBranding", label: "Custom branding", category: "Enterprise" },
  { key: "apiAccess", label: "API access", category: "Enterprise" },
  { key: "prioritySupport", label: "Priority support", category: "Enterprise" },
];

const categories = ["Limits", "Competitive Intelligence", "Advanced Features", "Enterprise"];

function FeatureValue({ value }: { value: FeatureAvailability }) {
  if (typeof value === "string") {
    return <span className="text-sm font-medium">{value}</span>;
  }
  if (value === true) {
    return <Check className="w-5 h-5 text-primary mx-auto" />;
  }
  return <Minus className="w-5 h-5 text-muted-foreground/50 mx-auto" />;
}

export default function Pricing() {
  usePageTracking("/pricing");

  return (
    <PublicLayout>
      <section className="py-24 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h1 className="text-4xl md:text-5xl font-bold mb-6">
              Simple, transparent pricing
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Start with a 60-day free trial. Upgrade when you're ready.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="text-left p-4 bg-card border-b border-border sticky left-0 min-w-[200px]">
                    <span className="text-muted-foreground text-sm font-medium">Features</span>
                  </th>
                  {plans.map((plan) => (
                    <th
                      key={plan.name}
                      className={`p-4 text-center min-w-[160px] border-b ${
                        plan.highlight
                          ? "bg-primary/10 border-primary/30"
                          : "bg-card border-border"
                      }`}
                    >
                      <div className="space-y-2">
                        <p className="font-bold text-lg">{plan.name}</p>
                        <p className="text-xl font-bold text-primary">{plan.price}</p>
                        <p className="text-xs text-muted-foreground">{plan.description}</p>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {categories.map((category) => (
                  <React.Fragment key={category}>
                    <tr>
                      <td
                        colSpan={plans.length + 1}
                        className="p-4 bg-muted/30 text-sm font-semibold text-muted-foreground uppercase tracking-wider"
                      >
                        {category}
                      </td>
                    </tr>
                    {featureLabels
                      .filter((f) => f.category === category)
                      .map((feature) => (
                        <tr key={feature.key} className="border-b border-border/50">
                          <td className="p-4 text-sm bg-card sticky left-0">
                            {feature.label}
                          </td>
                          {plans.map((plan) => (
                            <td
                              key={`${plan.name}-${feature.key}`}
                              className={`p-4 text-center ${
                                plan.highlight ? "bg-primary/5" : ""
                              }`}
                            >
                              <FeatureValue value={plan.features[feature.key]} />
                            </td>
                          ))}
                        </tr>
                      ))}
                  </React.Fragment>
                ))}
                <tr>
                  <td className="p-6 bg-card sticky left-0"></td>
                  {plans.map((plan) => (
                    <td
                      key={`cta-${plan.name}`}
                      className={`p-6 text-center ${plan.highlight ? "bg-primary/5" : ""}`}
                    >
                      {plan.ctaLink.startsWith("mailto:") ? (
                        <a
                          href={plan.ctaLink}
                          className={`inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-medium transition-all ${
                            plan.highlight
                              ? "bg-primary text-white hover:bg-primary/90"
                              : "bg-muted hover:bg-muted/80"
                          }`}
                        >
                          {plan.cta}
                        </a>
                      ) : (
                        <Link
                          href={plan.ctaLink}
                          className={`inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-medium transition-all ${
                            plan.highlight
                              ? "bg-primary text-white hover:bg-primary/90"
                              : "bg-muted hover:bg-muted/80"
                          }`}
                        >
                          {plan.cta} <ArrowRight size={16} />
                        </Link>
                      )}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          <div className="mt-16 text-center">
            <p className="text-muted-foreground mb-4">
              Questions about which plan is right for you?
            </p>
            <a
              href="mailto:contactus@synozur.com"
              className="text-primary hover:underline font-medium"
            >
              Contact us at contactus@synozur.com
            </a>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
