import React from "react";
import PublicLayout from "@/components/layout/PublicLayout";
import { Link } from "wouter";
import { ArrowRight, CheckCircle2, BarChart2, Shield, Zap } from "lucide-react";

export default function Landing() {
  return (
    <PublicLayout>
      {/* Hero Section */}
      <section className="relative overflow-hidden py-20 md:py-32 px-6">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/20 via-background to-background pointer-events-none" />
        
        <div className="max-w-4xl mx-auto text-center relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6 animate-fade-in-up">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
            </span>
            Orbit v0.1 (beta)
          </div>
          
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6 bg-clip-text text-transparent bg-gradient-to-r from-white via-white to-white/70 animate-fade-in-up delay-100">
            Marketing Intelligence, <br />
            <span className="text-primary">Decoded.</span>
          </h1>
          
          <p className="text-xl text-muted-foreground mb-10 max-w-2xl mx-auto animate-fade-in-up delay-200">
            Orbit analyzes your positioning against competitors, identifies gaps, and generates AI-driven recommendations to help you win.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center animate-fade-in-up delay-300">
            <Link href="/auth/signup">
              <a className="bg-primary hover:bg-primary/90 text-white px-8 py-4 rounded-lg text-lg font-medium transition-all shadow-lg shadow-primary/25 flex items-center gap-2">
                Start Free Trial <ArrowRight size={20} />
              </a>
            </Link>
            <Link href="/app">
              <a className="bg-muted hover:bg-muted/80 text-foreground px-8 py-4 rounded-lg text-lg font-medium transition-all">
                View Demo
              </a>
            </Link>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-24 px-6 bg-card/30 border-y border-border">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold mb-4">Why Orbit?</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Stop guessing. Start knowing. Orbit gives you the data-driven confidence to outmaneuver the competition.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                icon: BarChart2,
                title: "Competitive Analysis",
                desc: "Deep dive into competitor messaging, value props, and positioning strategies."
              },
              {
                icon: Zap,
                title: "AI Recommendations",
                desc: "Get actionable, outcome-driven advice on how to improve your messaging instantly."
              },
              {
                icon: Shield,
                title: "Change Monitoring",
                desc: "Never miss a beat. We track competitor website changes and alert you immediately."
              }
            ].map((feature, i) => (
              <div key={i} className="p-8 rounded-2xl bg-card border border-border hover:border-primary/50 transition-colors group">
                <div className="w-12 h-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                  <feature.icon size={24} />
                </div>
                <h3 className="text-xl font-semibold mb-3">{feature.title}</h3>
                <p className="text-muted-foreground leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Social Proof / Trust */}
      <section className="py-20 px-6 text-center">
        <p className="text-sm font-medium text-muted-foreground uppercase tracking-widest mb-8">Trusted by forward-thinking teams</p>
        <div className="flex flex-wrap justify-center gap-8 md:gap-16 opacity-50 grayscale hover:grayscale-0 transition-all duration-500">
           {/* Placeholders for logos */}
           <div className="text-xl font-bold">Acme Corp</div>
           <div className="text-xl font-bold">Globex</div>
           <div className="text-xl font-bold">Soylent</div>
           <div className="text-xl font-bold">Initech</div>
        </div>
      </section>
      
      {/* CTA */}
      <section className="py-24 px-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-primary/5" />
        <div className="max-w-4xl mx-auto text-center relative z-10">
          <h2 className="text-4xl font-bold mb-6">Ready to launch?</h2>
          <p className="text-xl text-muted-foreground mb-10">
            Join the Orbit beta today and start outsmarting your competition.
          </p>
           <Link href="/auth/signup">
              <a className="inline-flex bg-primary hover:bg-primary/90 text-white px-8 py-4 rounded-lg text-lg font-medium transition-all shadow-lg shadow-primary/25 items-center gap-2">
                Get Started for Free <ArrowRight size={20} />
              </a>
            </Link>
        </div>
      </section>
    </PublicLayout>
  );
}
