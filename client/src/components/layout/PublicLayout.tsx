import React from "react";
import { Link } from "wouter";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="h-16 px-6 md:px-12 flex items-center justify-between border-b border-border sticky top-0 z-50 bg-background/80 backdrop-blur-md">
        <Link href="/">
          <a className="font-bold text-2xl tracking-tight flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-white font-bold">
              O
            </div>
            <span>Orbit</span>
          </a>
        </Link>
        
        <nav className="hidden md:flex items-center gap-8">
          <Link href="/"><a className="text-sm font-medium hover:text-primary transition-colors">Product</a></Link>
          <Link href="/pricing"><a className="text-sm font-medium hover:text-primary transition-colors">Pricing</a></Link>
          <Link href="/auth/signin"><a className="text-sm font-medium hover:text-primary transition-colors">Sign In</a></Link>
          <Link href="/auth/signup">
            <a className="bg-primary hover:bg-primary/90 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors shadow-lg shadow-primary/20">
              Get Started
            </a>
          </Link>
        </nav>

        <div className="md:hidden">
            <Link href="/auth/signin">
             <a className="text-sm font-medium hover:text-primary transition-colors">Sign In</a>
            </Link>
        </div>
      </header>

      <main className="flex-1">
        {children}
      </main>

      <footer className="bg-card py-12 px-6 md:px-12 border-t border-border">
        <div className="max-w-6xl mx-auto grid md:grid-cols-4 gap-8">
          <div className="md:col-span-2">
            <div className="font-bold text-xl mb-4 flex items-center gap-2">
               <div className="w-6 h-6 rounded bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-white text-xs font-bold">
                O
              </div>
              Orbit
            </div>
            <p className="text-muted-foreground text-sm max-w-sm">
              The AI-driven marketing intelligence platform for The Synozur Alliance.
            </p>
          </div>
          <div>
            <h4 className="font-semibold mb-4">Product</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><Link href="#"><a className="hover:text-foreground">Features</a></Link></li>
              <li><Link href="/pricing"><a className="hover:text-foreground">Pricing</a></Link></li>
              <li><Link href="#"><a className="hover:text-foreground">Roadmap</a></Link></li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold mb-4">Company</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><Link href="#"><a className="hover:text-foreground">About</a></Link></li>
              <li><Link href="#"><a className="hover:text-foreground">Contact</a></Link></li>
              <li><Link href="#"><a className="hover:text-foreground">Privacy</a></Link></li>
            </ul>
          </div>
        </div>
        <div className="max-w-6xl mx-auto mt-12 pt-8 border-t border-border text-center text-sm text-muted-foreground">
          Published by The Synozur Alliance LLC. All Rights Reserved © 2026.
        </div>
      </footer>
    </div>
  );
}
