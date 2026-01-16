import React from "react";
import { Link } from "wouter";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans">
      <header className="h-20 px-6 md:px-12 flex items-center justify-between border-b border-border sticky top-0 z-50 bg-background/80 backdrop-blur-md">
        <Link href="/">
          <a className="font-bold text-2xl tracking-tight flex items-center gap-3 hover:opacity-90 transition-opacity">
            <img 
              src="/brand/synozur-mark.png" 
              alt="Synozur" 
              className="w-10 h-10 object-contain"
            />
            <span>Orbit</span>
          </a>
        </Link>
        
        <nav className="hidden md:flex items-center gap-8">
          <Link href="/"><a className="text-sm font-medium hover:text-primary transition-colors">Product</a></Link>
          <Link href="/pricing"><a className="text-sm font-medium hover:text-primary transition-colors">Pricing</a></Link>
          <Link href="/auth/signin"><a className="text-sm font-medium hover:text-primary transition-colors">Sign In</a></Link>
          <Link href="/auth/signup">
            <a className="bg-primary hover:bg-primary/90 text-white px-5 py-2.5 rounded-full text-sm font-medium transition-all shadow-lg shadow-primary/20 hover:shadow-primary/30">
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

      <footer className="bg-card py-16 px-6 md:px-12 border-t border-border">
        <div className="max-w-7xl mx-auto grid md:grid-cols-4 gap-12">
          <div className="md:col-span-2">
            <div className="font-bold text-2xl mb-6 flex items-center gap-3">
               <img 
                  src="/brand/synozur-mark.png" 
                  alt="Synozur" 
                  className="w-8 h-8 object-contain"
                />
              Orbit
            </div>
            <p className="text-muted-foreground text-sm max-w-sm leading-relaxed">
              The AI-driven marketing intelligence platform for The Synozur Alliance. Empowering teams to win with data-backed positioning.
            </p>
          </div>
          <div>
            <h4 className="font-semibold mb-6">Product</h4>
            <ul className="space-y-3 text-sm text-muted-foreground">
              <li><Link href="#"><a className="hover:text-primary transition-colors">Features</a></Link></li>
              <li><Link href="/pricing"><a className="hover:text-primary transition-colors">Pricing</a></Link></li>
              <li><Link href="#"><a className="hover:text-primary transition-colors">Roadmap</a></Link></li>
              <li><Link href="#"><a className="hover:text-primary transition-colors">Changelog</a></Link></li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold mb-6">Legal & Company</h4>
            <ul className="space-y-3 text-sm text-muted-foreground">
              <li><a href="https://www.synozur.com" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">About Synozur</a></li>
              <li><a href="https://www.synozur.com/services/go-to-market-transformation" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">GTM Services</a></li>
              <li><Link href="#"><a className="hover:text-primary transition-colors">Privacy Policy</a></Link></li>
              <li><Link href="#"><a className="hover:text-primary transition-colors">Terms of Service</a></Link></li>
              <li><Link href="#"><a className="hover:text-primary transition-colors">Security</a></Link></li>
              <li><Link href="#"><a className="hover:text-primary transition-colors">Contact Support</a></Link></li>
            </ul>
          </div>
        </div>
        <div className="max-w-7xl mx-auto mt-16 pt-8 border-t border-border">
          <div className="mb-8">
            <h4 className="font-semibold mb-4">Legal</h4>
            <div className="text-sm text-muted-foreground space-y-3">
              <p>© 2025 The Synozur Alliance, LLC. All rights reserved.</p>
              <p>"Synozur" and "The Synozur Alliance" are trademarks of The Synozur Alliance, LLC.</p>
              <p className="leading-relaxed">
                Disclaimer: Information provided on this site is presented "as is" without any express or implied warranties. 
                This is a preliminary release, and access or availability is not guaranteed. By using this site, you signify 
                your consent to these terms and acknowledge that your usage is subject to Synozur's Data Gathering and Privacy Policy.
              </p>
            </div>
          </div>
          <div className="flex flex-col md:flex-row justify-between items-center text-sm text-muted-foreground pt-6 border-t border-border/50">
            <p>Published by The Synozur Alliance LLC. All Rights Reserved © 2025.</p>
            <div className="mt-4 md:mt-0 flex gap-6">
               <Link href="#"><a className="hover:text-primary transition-colors">Privacy</a></Link>
               <Link href="#"><a className="hover:text-primary transition-colors">Terms</a></Link>
               <Link href="#"><a className="hover:text-primary transition-colors">Cookies</a></Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
