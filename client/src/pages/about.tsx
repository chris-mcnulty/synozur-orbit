import React from "react";
import PublicLayout from "@/components/layout/PublicLayout";
import { Link } from "wouter";
import { ArrowRight, Target, Users, Lightbulb, Shield, Award, Globe, FileText, Map } from "lucide-react";

export default function About() {
  return (
    <PublicLayout>
      {/* Hero Section */}
      <section className="relative overflow-hidden py-24 md:py-32 px-6">
        <div className="absolute inset-0 z-0 bg-gradient-to-b from-primary/5 via-background to-background" />
        
        <div className="max-w-4xl mx-auto text-center relative z-10">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-6 leading-tight">
            About <span className="text-primary">Orbit</span>
          </h1>
          
          <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto leading-relaxed">
            Orbit is the AI-powered competitive intelligence platform from The Synozur Alliance, 
            helping marketing and sales teams understand their market position and win more deals.
          </p>
        </div>
      </section>

      {/* Mission Section */}
      <section className="py-16 px-6 bg-card/30 border-y border-border">
        <div className="max-w-4xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl font-bold mb-6">Our Mission</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                We believe every organization deserves access to world-class competitive intelligence. 
                Too often, understanding your market position requires expensive consultants or 
                time-consuming manual research.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Orbit democratizes competitive analysis by combining AI-powered automation with 
                proven go-to-market methodologies developed through decades of consulting work.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-card p-6 rounded-xl border border-border">
                <Target className="w-8 h-8 text-primary mb-3" />
                <h3 className="font-semibold mb-2">Precision</h3>
                <p className="text-sm text-muted-foreground">AI-powered analysis for accurate insights</p>
              </div>
              <div className="bg-card p-6 rounded-xl border border-border">
                <Lightbulb className="w-8 h-8 text-primary mb-3" />
                <h3 className="font-semibold mb-2">Actionable</h3>
                <p className="text-sm text-muted-foreground">Recommendations you can implement today</p>
              </div>
              <div className="bg-card p-6 rounded-xl border border-border">
                <Shield className="w-8 h-8 text-primary mb-3" />
                <h3 className="font-semibold mb-2">Secure</h3>
                <p className="text-sm text-muted-foreground">Enterprise-grade security and privacy</p>
              </div>
              <div className="bg-card p-6 rounded-xl border border-border">
                <Globe className="w-8 h-8 text-primary mb-3" />
                <h3 className="font-semibold mb-2">Scalable</h3>
                <p className="text-sm text-muted-foreground">From startups to enterprises</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* About Synozur Section */}
      <section className="py-24 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-6">Built by The Synozur Alliance</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Orbit is developed by The Synozur Alliance, a consulting firm specializing in 
              go-to-market transformation for technology companies.
            </p>
          </div>

          <div className="bg-card rounded-2xl border border-border p-8 md:p-12">
            <div className="flex items-start gap-6 mb-8">
              <img 
                src="/brand/synozur-mark.png" 
                alt="Synozur" 
                className="w-16 h-16 object-contain"
              />
              <div>
                <h3 className="text-xl font-bold mb-2">The Synozur Alliance</h3>
                <p className="text-muted-foreground">
                  Go-to-Market Transformation Consultants
                </p>
              </div>
            </div>

            <div className="space-y-4 text-muted-foreground leading-relaxed">
              <p>
                With decades of experience helping B2B technology companies refine their positioning, 
                messaging, and competitive strategy, Synozur has distilled proven methodologies into 
                the Orbit platform.
              </p>
              <p>
                Our approach combines rigorous competitive analysis frameworks with modern AI capabilities, 
                giving your team the same caliber of insights that Fortune 500 companies receive from 
                top-tier consultancies.
              </p>
            </div>

            <div className="mt-8 pt-8 border-t border-border">
              <div className="grid md:grid-cols-3 gap-6 text-center">
                <div>
                  <div className="text-3xl font-bold text-primary mb-1">20+</div>
                  <div className="text-sm text-muted-foreground">Years of GTM Experience</div>
                </div>
                <div>
                  <div className="text-3xl font-bold text-primary mb-1">100+</div>
                  <div className="text-sm text-muted-foreground">Clients Served</div>
                </div>
                <div>
                  <div className="text-3xl font-bold text-primary mb-1">$2B+</div>
                  <div className="text-sm text-muted-foreground">Pipeline Influenced</div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8 text-center">
            <a 
              href="https://www.synozur.com" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-primary hover:underline font-medium inline-flex items-center gap-2"
            >
              Learn more about Synozur <ArrowRight size={16} />
            </a>
          </div>
        </div>
      </section>

      {/* The Synozur Ecosystem */}
      <section className="py-16 px-6 bg-card/30 border-y border-border">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-6">Part of the Synozur Ecosystem</h2>
          <p className="text-muted-foreground mb-12 max-w-2xl mx-auto">
            Orbit works alongside other Synozur applications to provide a complete 
            go-to-market operating system for your organization.
          </p>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-card p-8 rounded-xl border border-border text-left">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Award className="w-5 h-5 text-primary" />
                </div>
                <h3 className="font-bold text-lg">Vega</h3>
              </div>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Strategy and OKR platform that serves as the identity provider for the Synozur ecosystem. 
                Align your team around strategic objectives and track progress.
              </p>
            </div>

            <div className="bg-card p-8 rounded-xl border border-border text-left">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Users className="w-5 h-5 text-primary" />
                </div>
                <h3 className="font-bold text-lg">Orion</h3>
              </div>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Multi-model maturity assessment platform with AI-powered recommendations. 
                Evaluate organizational capabilities and identify improvement opportunities.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Changelog & Roadmap Section */}
      <section className="py-16 px-6">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold mb-6 text-center">Stay Updated</h2>
          <p className="text-muted-foreground mb-12 text-center max-w-2xl mx-auto">
            Track our progress and see what's coming next for Orbit.
          </p>

          <div className="grid md:grid-cols-2 gap-6">
            <Link href="/changelog" className="block group">
              <div className="bg-card p-8 rounded-xl border border-border hover:border-primary/50 transition-colors h-full">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                    <FileText className="w-5 h-5 text-primary" />
                  </div>
                  <h3 className="font-bold text-lg">Changelog</h3>
                </div>
                <p className="text-muted-foreground text-sm leading-relaxed mb-4">
                  A detailed history of all updates, improvements, and new features we've shipped.
                </p>
                <span className="text-primary text-sm font-medium inline-flex items-center gap-1 group-hover:gap-2 transition-all">
                  View changelog <ArrowRight size={14} />
                </span>
              </div>
            </Link>

            <Link href="/roadmap" className="block group">
              <div className="bg-card p-8 rounded-xl border border-border hover:border-primary/50 transition-colors h-full">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                    <Map className="w-5 h-5 text-primary" />
                  </div>
                  <h3 className="font-bold text-lg">Product Roadmap</h3>
                </div>
                <p className="text-muted-foreground text-sm leading-relaxed mb-4">
                  See what we're working on and what's coming next for Orbit.
                </p>
                <span className="text-primary text-sm font-medium inline-flex items-center gap-1 group-hover:gap-2 transition-all">
                  View roadmap <ArrowRight size={14} />
                </span>
              </div>
            </Link>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-6">Ready to transform your competitive intelligence?</h2>
          <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
            Start using Orbit today and discover how AI-powered analysis can help you 
            understand your market position and win more deals.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link 
              href="/auth/signup" 
              className="bg-primary hover:bg-primary/90 text-white px-8 py-4 rounded-lg text-lg font-medium transition-all shadow-lg shadow-primary/25 flex items-center justify-center gap-2"
            >
              Get started now <ArrowRight size={20} />
            </Link>
            <a 
              href="https://www.synozur.com/contact" 
              target="_blank"
              rel="noopener noreferrer"
              className="bg-muted hover:bg-muted/80 text-foreground px-8 py-4 rounded-lg text-lg font-medium transition-all"
            >
              Contact Synozur
            </a>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
