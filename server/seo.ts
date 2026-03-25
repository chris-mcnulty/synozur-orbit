import type { Express, Request, Response, NextFunction } from "express";

const PUBLIC_PAGES = [
  { path: "/", changefreq: "weekly", priority: "1.0" },
  { path: "/about", changefreq: "monthly", priority: "0.6" },
  { path: "/pricing", changefreq: "monthly", priority: "0.8" },
  { path: "/changelog", changefreq: "weekly", priority: "0.5" },
  { path: "/roadmap", changefreq: "monthly", priority: "0.5" },
];

const PUBLIC_PATH_SET = new Set(PUBLIC_PAGES.map(p => p.path));

const BOT_USER_AGENTS = [
  "googlebot", "bingbot", "slurp", "duckduckbot", "baiduspider",
  "yandexbot", "sogou", "facebot", "ia_archiver", "twitterbot",
  "linkedinbot", "embedly", "quora link preview", "showyoubot",
  "outbrain", "pinterest", "applebot", "semrushbot", "ahrefsbot",
];

const PAGE_META: Record<string, { title: string; description: string }> = {
  "/": {
    title: "Orbit — AI-Powered Go-to-Market Intelligence Platform | Synozur",
    description: "Orbit unifies competitive intelligence, marketing planning, and product management. AI-powered analysis, battlecards, and GTM planning for teams that compete to win.",
  },
  "/about": {
    title: "About Orbit — AI Competitive Intelligence by Synozur",
    description: "Learn about Orbit, the AI-driven competitive intelligence platform from The Synozur Alliance. Changelog, backlog, and product roadmap.",
  },
  "/pricing": {
    title: "Pricing — Orbit Competitive Intelligence Platform",
    description: "Simple, transparent pricing for Orbit. Start with a 60-day free trial. Plans for individuals, teams, and enterprises. No credit card required.",
  },
  "/changelog": {
    title: "Changelog — Orbit Platform Updates",
    description: "See the latest updates, improvements, and new features shipped in Orbit. A complete history of platform changes.",
  },
  "/roadmap": {
    title: "Product Roadmap — Orbit by Synozur",
    description: "See what's coming next for Orbit. Completed features, in-progress work, and planned capabilities for the GTM intelligence platform.",
  },
};

function getBaseUrl(req?: Request): string {
  if (process.env.REPLIT_INTERNAL_APP_DOMAIN) {
    return `https://${process.env.REPLIT_INTERNAL_APP_DOMAIN}`;
  }
  if (process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  }
  if (req) {
    const host = req.get("x-forwarded-host") || req.get("host");
    if (host) {
      const proto = req.get("x-forwarded-proto") || req.protocol || "https";
      return `${proto}://${host}`;
    }
  }
  return "";
}

function isBot(userAgent: string): boolean {
  const ua = userAgent.toLowerCase();
  return BOT_USER_AGENTS.some(bot => ua.includes(bot));
}

function normalizePath(path: string): string {
  if (path !== "/" && path.endsWith("/")) {
    return path.slice(0, -1);
  }
  return path;
}

function generatePrerenderedHtml(path: string, baseUrl: string): string {
  const meta = PAGE_META[path] || PAGE_META["/"];
  const canonicalUrl = `${baseUrl}${path}`;

  const jsonLd = path === "/" ? `
    <script type="application/ld+json">
    ${JSON.stringify([
      {
        "@context": "https://schema.org",
        "@type": "Organization",
        "name": "The Synozur Alliance",
        "url": "https://www.synozur.com",
        "logo": `${baseUrl}/brand/synozur-horizontal.png`,
        "contactPoint": {
          "@type": "ContactPoint",
          "email": "contactus@synozur.com",
          "contactType": "sales"
        },
        "sameAs": ["https://www.synozur.com"]
      },
      {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        "name": "Orbit",
        "applicationCategory": "BusinessApplication",
        "operatingSystem": "Web",
        "description": "AI-powered go-to-market intelligence platform that unifies competitive intelligence, marketing planning, and product management.",
        "offers": {
          "@type": "Offer",
          "price": "0",
          "priceCurrency": "USD",
          "description": "60-day free trial with full access"
        },
        "author": {
          "@type": "Organization",
          "name": "The Synozur Alliance"
        },
        "featureList": [
          "AI-powered competitive analysis",
          "Competitive battlecards",
          "Marketing planning",
          "Product roadmap management",
          "PDF report generation",
          "Microsoft Entra SSO",
          "Multi-tenant architecture"
        ]
      }
    ])}
    </script>` : "";

  const pageContent = getPageContent(path);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${meta.title}</title>
  <meta name="description" content="${meta.description}" />
  <link rel="canonical" href="${canonicalUrl}" />
  <meta property="og:title" content="${meta.title}" />
  <meta property="og:description" content="${meta.description}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${canonicalUrl}" />
  <meta property="og:image" content="${baseUrl}/og-image.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:site" content="@replit" />
  <meta name="twitter:title" content="${meta.title}" />
  <meta name="twitter:description" content="${meta.description}" />
  <meta name="twitter:image" content="${baseUrl}/og-image.png" />
  ${jsonLd}
</head>
<body>
  <div id="root">
    ${pageContent}
  </div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>`;
}

function getPageContent(path: string): string {
  switch (path) {
    case "/":
      return `
        <header>
          <nav aria-label="Main navigation">
            <a href="/">Synozur | Orbit</a>
            <a href="/">Product</a>
            <a href="/pricing">Pricing</a>
            <a href="/auth/signin">Sign In</a>
            <a href="/auth/signup">Get Started</a>
          </nav>
        </header>
        <main>
          <article>
            <section aria-label="Hero">
              <img src="/brand/orbit-logo-white.png" alt="Orbit — Go-to-Market Intelligence Platform by Synozur" />
              <p>Go-to-Market Intelligence Platform</p>
              <h1>From insight to action <span>in one platform</span></h1>
              <p>Orbit unifies competitive intelligence, marketing planning, and product management—giving GTM teams the clarity to compete, plan, and build with confidence.</p>
              <a href="/auth/signup">Start your 60-day trial</a>
              <a href="/auth/signin">Log in</a>
              <p>No credit card required. No sales call needed. Full access for 60 days.</p>
              <ul>
                <li>SOC 2 Type II</li>
                <li>Microsoft Entra SSO</li>
                <li>Role-based access</li>
                <li>Claude AI powered</li>
                <li>Azure AI Foundry</li>
                <li>Audit trails</li>
              </ul>
            </section>

            <section aria-label="Platform Pillars">
              <h2>Three pillars of GTM excellence</h2>
              <p>Most tools give you data. Orbit gives you a complete system—from understanding your market to planning your response to building what wins.</p>
              <h3>Competitive Intelligence</h3>
              <p>Know your battlefield. AI-powered analysis of competitor positioning, messaging, and market movements. Track changes, identify gaps, and stay ahead of the competition.</p>
              <ul>
                <li>Automated competitor monitoring</li>
                <li>Claude-powered positioning analysis</li>
                <li>Messaging gap identification</li>
                <li>Competitive battlecards</li>
              </ul>
              <h3>Marketing Planner</h3>
              <p>Plan with precision. Transform competitive insights into actionable marketing plans. Quarterly, half-year, and annual planning with AI-generated task recommendations—plus direct generation of social posts and email campaigns.</p>
              <ul>
                <li>AI-suggested marketing activities</li>
                <li>Quarterly &amp; annual planning</li>
                <li>Social post &amp; email campaign generation</li>
                <li>Activity-based organization</li>
                <li>Progress tracking</li>
              </ul>
              <h3>Product Management</h3>
              <p>Build what matters. Align product development with market reality. Manage roadmaps, track competitive features, and prioritize based on intelligence—not intuition.</p>
              <ul>
                <li>Product roadmap management</li>
                <li>Competitive feature tracking</li>
                <li>Market-driven prioritization</li>
                <li>Release planning</li>
              </ul>
            </section>

            <section aria-label="Built on Synozur Framework">
              <p><strong>Built on proven GTM methodology.</strong> Orbit reflects how real marketing, sales, and product teams work together—refined through decades of go-to-market consulting by Synozur. It's not just software; it's a system.</p>
              <a href="https://www.synozur.com/case-studies">View case studies</a>
              <a href="https://orion.synozur.com/gtm">Take the GTM Maturity Assessment</a>
            </section>

            <section aria-label="How It Works">
              <h2>Intelligence that flows into action</h2>
              <h3>Monitor</h3>
              <p>Track competitor websites, messaging, and market changes automatically</p>
              <h3>Analyze</h3>
              <p>Claude AI identifies positioning gaps and competitive opportunities</p>
              <h3>Plan</h3>
              <p>Generate marketing plans with AI-suggested activities and timelines</p>
              <h3>Execute</h3>
              <p>Generate social posts, email campaigns, and align product roadmaps with market intelligence</p>
              <a href="/auth/signup">Start your 60-day trial</a>
            </section>

            <section aria-label="What's New">
              <h2>Recently shipped capabilities</h2>
              <p>Orbit keeps evolving. Here are the latest features powering your go-to-market teams.</p>
              <h3>Marketing Assets — Social Posts</h3>
              <p>AI-generated social content with platform-specific formatting for LinkedIn, Twitter/X, and Facebook. Choose your tone and extract Saturn-parity content automatically.</p>
              <h3>Marketing Assets — Email Newsletters</h3>
              <p>Platform-targeted email generation for Outlook, Dynamics 365, HubSpot Marketing, and HubSpot 1:1. Includes tone control, CTA fields, and platform-specific coaching tips.</p>
              <h3>SharePoint Embedded Support</h3>
              <p>Enterprise data residency via SharePoint Embedded containers through Microsoft Graph API. Keep your sensitive data within your own tenant.</p>
              <h3>Microsoft Azure AI Foundry</h3>
              <p>Multi-model support including GPT-5.4 via Azure OpenAI, plus Claude, Mistral, Cohere, Llama, and other models via Foundry's Model-as-a-Service inference API.</p>
              <h3>Consortia ID / Partner Program</h3>
              <p>Microsoft Content AI Partner Program membership and consortia-level identification for enterprise customers and partners.</p>
              <h3>Insight Analytics</h3>
              <p>AI usage tracking dashboard with tenant-level cost attribution and page-level engagement analytics. Understand how your organization uses AI.</p>
            </section>

            <section id="capabilities" aria-label="Capabilities">
              <h2>Everything you need to compete and win</h2>
              <h3>Market Intelligence</h3>
              <p>Know your competitive landscape. Orbit continuously monitors competitor websites, extracting key messaging, value propositions, and positioning changes. Get real-time insights into how your market is evolving.</p>
              <h3>AI Analysis</h3>
              <p>Understand what sets you apart. Claude-powered analysis compares your positioning against competitors, identifying gaps in your messaging and opportunities to differentiate.</p>
              <h3>Recommendations</h3>
              <p>Get actionable guidance. AI-generated recommendations tailored to your industry and audience.</p>
              <h3>Battlecards</h3>
              <p>Arm your sales team. Generate competitive battlecards with Harvey Ball scoring, qualitative comparisons, and sales challenge questions.</p>
              <h3>Marketing Planner</h3>
              <p>Plan your GTM activities. Transform insights into action with AI-powered marketing planning.</p>
              <h3>Product Roadmap</h3>
              <p>Prioritize with market context. Align product development with competitive reality. Track feature gaps, manage your roadmap, and make data-driven prioritization decisions.</p>
              <h3>Reporting</h3>
              <p>Share insights across the org. Export branded PDF reports for leadership, sales enablement, or board presentations.</p>
              <h3>Social &amp; Email</h3>
              <p>Generate marketing assets in seconds. Create platform-specific social posts for LinkedIn, Twitter/X, and Facebook. Generate email newsletters targeting Outlook, Dynamics 365, HubSpot Marketing, or HubSpot 1:1.</p>
              <h3>Content &amp; Brand Libraries</h3>
              <p>Organize your brand and content assets. Manage content libraries with filtering, grouping, and asset cards.</p>
              <h3>AI Flexibility</h3>
              <p>Multi-provider AI with Azure Foundry. Choose the right AI model for every task.</p>
            </section>

            <section aria-label="Outcomes">
              <h2>What you'll achieve</h2>
              <h3>See clearly</h3>
              <p>Understand exactly how competitors position themselves—and where you have the advantage.</p>
              <h3>Act decisively</h3>
              <p>Transform intelligence into marketing plans and product priorities—not just reports.</p>
              <h3>Win consistently</h3>
              <p>Arm teams with battlecards, align roadmaps to market reality, and outmaneuver the competition.</p>
            </section>

            <section aria-label="Who It's For">
              <h2>Built for the entire GTM team</h2>
              <h3>Marketing Leaders</h3>
              <p>Competitive positioning, messaging strategy, and campaign planning</p>
              <h3>Sales Teams</h3>
              <p>Battlecards, competitive objection handling, and deal intelligence</p>
              <h3>Product Managers</h3>
              <p>Roadmap prioritization, feature gap analysis, and market context</p>
              <h3>GTM Consultants</h3>
              <p>Multi-client analysis, assessment frameworks, and branded deliverables</p>
            </section>

            <section aria-label="Why Orbit">
              <h2>Not another dashboard. A decision engine.</h2>
              <p>Most competitive tools stop at data collection. Orbit connects intelligence to planning to execution—so every decision is grounded in market reality.</p>
            </section>

            <section aria-label="Enterprise Grade">
              <h2>Enterprise-ready by design</h2>
              <p>Built for organizations that take security, compliance, and governance seriously. Multi-tenant isolation, SSO, and audit trails come standard—with SharePoint Embedded data residency and Azure AI Foundry for enterprise-grade AI.</p>
              <ul>
                <li>SOC 2 Type II certified</li>
                <li>Microsoft Entra ID SSO</li>
                <li>Role-based access control</li>
                <li>Multi-tenant isolation</li>
                <li>SharePoint Embedded data residency</li>
                <li>Azure AI Foundry multi-model support</li>
                <li>Encryption in transit and at rest</li>
                <li>Complete audit logging</li>
                <li>Microsoft Content AI Partner Program</li>
              </ul>
            </section>

            <section aria-label="Export and Portability">
              <h2>Take your intelligence everywhere</h2>
              <p>Orbit makes it easy to export data for collaboration, presentations, and digital visioning tools like Mural or Miro.</p>
              <h3>PDF Reports</h3>
              <ul><li>Competitive Analysis Report</li><li>Battlecard PDFs</li><li>Full Analysis Report</li><li>Product-Scoped Reports</li></ul>
              <h3>CSV Exports</h3>
              <ul><li>Gap Analysis</li><li>Strategic Recommendations</li><li>AI Roadmap Suggestions</li><li>Product Features</li><li>Roadmap Items</li></ul>
              <h3>Markdown &amp; Word</h3>
              <ul><li>GTM Plans</li><li>Messaging Frameworks</li><li>Executive Summaries</li><li>Market Export</li></ul>
            </section>

            <section aria-label="Pricing Preview">
              <h2>Start with a 60-day free trial</h2>
              <p>Full access to Orbit's competitive intelligence, marketing planning, and product management capabilities. No credit card required.</p>
              <h3>Free</h3><p>Basic competitive monitoring. 1 competitor, 1 analysis/month, Core features.</p>
              <h3>Pro</h3><p>Full intelligence suite. Up to 10 competitors, Unlimited analysis, Marketing Planner.</p>
              <h3>Enterprise</h3><p>Complete GTM platform. Unlimited competitors, Product Management, Multi-market support.</p>
              <a href="/auth/signup">Start your 60-day trial</a>
              <p>Questions? Contact us at <a href="mailto:contactus@synozur.com">contactus@synozur.com</a></p>
            </section>

            <section aria-label="Call to Action">
              <h2>Ready to transform your GTM?</h2>
              <p>Join teams who compete with intelligence, plan with precision, and build what wins.</p>
              <a href="/auth/signup">Start your 60-day trial</a>
              <p>No credit card required. Full access for 60 days.</p>
            </section>
          </article>
        </main>
        <footer>
          <p>Synozur | Orbit — The AI-driven marketing intelligence platform for The Synozur Alliance. Empowering teams to win with data-backed positioning.</p>
          <nav aria-label="Product links">
            <a href="/#capabilities">Features</a>
            <a href="/pricing">Pricing</a>
            <a href="/roadmap">Roadmap</a>
            <a href="/changelog">Changelog</a>
          </nav>
          <nav aria-label="Company links">
            <a href="https://www.synozur.com">About Synozur</a>
            <a href="https://www.synozur.com/services/go-to-market-transformation">GTM Services</a>
            <a href="https://www.synozur.com/privacy">Privacy Policy</a>
            <a href="https://www.synozur.com/terms">Terms of Service</a>
            <a href="https://www.synozur.com/contact">Contact Support</a>
          </nav>
          <p>&copy; 2026 The Synozur Alliance, LLC. All rights reserved.</p>
        </footer>`;
    case "/about":
      return `
        <header>
          <nav aria-label="Main navigation">
            <a href="/">Synozur | Orbit</a>
            <a href="/">Product</a>
            <a href="/pricing">Pricing</a>
            <a href="/auth/signin">Sign In</a>
            <a href="/auth/signup">Get Started</a>
          </nav>
        </header>
        <main>
          <section aria-label="About">
            <h1>About <span>Orbit</span></h1>
            <p>AI-powered competitive intelligence platform from The Synozur Alliance.</p>
          </section>
          <section aria-label="Changelog">
            <h2>Changelog</h2>
            <p>A detailed history of all updates, improvements, and new features.</p>
            <h3>v0.1.0 — January 17, 2026</h3>
            <h4>Authentication &amp; Security</h4>
            <ul>
              <li>Microsoft Entra ID SSO integration with OAuth 2.0</li>
              <li>Role-based access control (Global Admin, Domain Admin, Standard User)</li>
              <li>Session-based authentication with secure cookies</li>
              <li>Password login with bcrypt hashing</li>
            </ul>
            <h4>Multi-Tenant Architecture</h4>
            <ul>
              <li>Tenant isolation by email domain</li>
              <li>Automatic role assignment for first users</li>
              <li>Tenant usage limits and plan management</li>
            </ul>
            <h4>Competitive Intelligence</h4>
            <ul>
              <li>Competitor URL tracking and management</li>
              <li>AI-powered competitive analysis with Claude</li>
              <li>Gap analysis between your positioning and competitors</li>
              <li>AI-generated recommendations</li>
            </ul>
            <h4>Document Management</h4>
            <ul>
              <li>Grounding document upload (PDF, DOCX)</li>
              <li>Company profile baselining</li>
              <li>Text extraction for AI analysis</li>
            </ul>
            <h4>User Interface</h4>
            <ul>
              <li>Modern dashboard with key metrics</li>
              <li>Dark/light mode toggle</li>
              <li>Synozur brand styling</li>
              <li>Responsive design for all devices</li>
            </ul>
          </section>
          <section aria-label="Backlog">
            <h2>Backlog</h2>
            <p>Features and improvements we're tracking for future releases.</p>
          </section>
          <section aria-label="Roadmap">
            <h2>Roadmap</h2>
            <p>Our product vision and planned milestones. Check the backlog tab for upcoming features.</p>
          </section>
        </main>
        <footer>
          <p>Synozur | Orbit — The AI-driven marketing intelligence platform for The Synozur Alliance.</p>
          <nav aria-label="Product links">
            <a href="/#capabilities">Features</a>
            <a href="/pricing">Pricing</a>
            <a href="/roadmap">Roadmap</a>
            <a href="/changelog">Changelog</a>
          </nav>
          <nav aria-label="Company links">
            <a href="https://www.synozur.com">About Synozur</a>
            <a href="https://www.synozur.com/services/go-to-market-transformation">GTM Services</a>
            <a href="https://www.synozur.com/privacy">Privacy Policy</a>
            <a href="https://www.synozur.com/terms">Terms of Service</a>
            <a href="https://www.synozur.com/contact">Contact Support</a>
          </nav>
          <p>&copy; 2026 The Synozur Alliance, LLC. All rights reserved.</p>
          <p>"Synozur" and "The Synozur Alliance" are trademarks of The Synozur Alliance, LLC.</p>
        </footer>`;
    case "/pricing":
      return `
        <header>
          <nav aria-label="Main navigation">
            <a href="/">Synozur | Orbit</a>
            <a href="/">Product</a>
            <a href="/pricing">Pricing</a>
            <a href="/auth/signin">Sign In</a>
            <a href="/auth/signup">Get Started</a>
          </nav>
        </header>
        <main>
          <section aria-label="Pricing">
            <h1>Simple, transparent pricing</h1>
            <p>Start with a 60-day free trial. Upgrade when you're ready.</p>
          </section>
          <section aria-label="Plan comparison">
            <h2>Trial Plan</h2>
            <p>Free — 60 days full access</p>
            <ul>
              <li>3 competitors tracked</li>
              <li>5 AI analyses per month</li>
              <li>3 team members</li>
              <li>Competitor website monitoring</li>
              <li>Claude AI-powered analysis</li>
              <li>Sales battlecards</li>
              <li>AI recommendations</li>
              <li>Branded PDF reports</li>
            </ul>
            <a href="/auth/signup">Start Trial</a>

            <h2>Free Plan</h2>
            <p>Free — Basic competitive monitoring</p>
            <ul>
              <li>1 competitor tracked</li>
              <li>1 AI analysis per month</li>
              <li>1 team member</li>
              <li>Competitor website monitoring</li>
              <li>Claude AI-powered analysis</li>
            </ul>
            <a href="/auth/signup">Get Started</a>

            <h2>Pro Plan</h2>
            <p>Synozur client only — Full intelligence suite</p>
            <ul>
              <li>10 competitors tracked</li>
              <li>Unlimited AI analyses</li>
              <li>10 team members</li>
              <li>Competitor website monitoring</li>
              <li>Claude AI-powered analysis</li>
              <li>Sales battlecards</li>
              <li>AI recommendations</li>
              <li>Branded PDF reports</li>
              <li>Social media monitoring</li>
              <li>Client projects</li>
              <li>Microsoft Entra SSO</li>
              <li>Priority support</li>
            </ul>
            <a href="mailto:contactus@synozur.com">Contact Us</a>

            <h2>Enterprise Plan</h2>
            <p>Synozur client only — Complete GTM platform</p>
            <ul>
              <li>Unlimited competitors tracked</li>
              <li>Unlimited AI analyses</li>
              <li>Unlimited team members</li>
              <li>Competitor website monitoring</li>
              <li>Claude AI-powered analysis</li>
              <li>Sales battlecards</li>
              <li>AI recommendations</li>
              <li>Branded PDF reports</li>
              <li>Social media monitoring</li>
              <li>Client projects</li>
              <li>Marketing Planner</li>
              <li>Product Management</li>
              <li>Multi-market support</li>
              <li>Microsoft Entra SSO</li>
              <li>Custom branding</li>
              <li>API access</li>
              <li>Priority support</li>
            </ul>
            <a href="mailto:contactus@synozur.com">Contact Us</a>
          </section>
          <section aria-label="Contact">
            <p>Questions about which plan is right for you?</p>
            <a href="mailto:contactus@synozur.com">Contact us at contactus@synozur.com</a>
          </section>
        </main>
        <footer>
          <p>Synozur | Orbit — The AI-driven marketing intelligence platform for The Synozur Alliance.</p>
          <nav aria-label="Product links">
            <a href="/#capabilities">Features</a>
            <a href="/pricing">Pricing</a>
            <a href="/roadmap">Roadmap</a>
            <a href="/changelog">Changelog</a>
          </nav>
          <nav aria-label="Company links">
            <a href="https://www.synozur.com">About Synozur</a>
            <a href="https://www.synozur.com/services/go-to-market-transformation">GTM Services</a>
            <a href="https://www.synozur.com/privacy">Privacy Policy</a>
            <a href="https://www.synozur.com/terms">Terms of Service</a>
            <a href="https://www.synozur.com/contact">Contact Support</a>
          </nav>
          <p>&copy; 2026 The Synozur Alliance, LLC. All rights reserved.</p>
          <p>"Synozur" and "The Synozur Alliance" are trademarks of The Synozur Alliance, LLC.</p>
        </footer>`;
    case "/changelog":
      return `
        <header>
          <nav aria-label="Main navigation">
            <a href="/">Synozur | Orbit</a>
            <a href="/">Product</a>
            <a href="/pricing">Pricing</a>
            <a href="/auth/signin">Sign In</a>
            <a href="/auth/signup">Get Started</a>
          </nav>
        </header>
        <main>
          <a href="/about">Back to About</a>
          <h1>Changelog</h1>
          <p>A history of updates, improvements, and new features in Orbit.</p>
          <h2>v0.1.0 — January 17, 2026</h2>
          <h3>Authentication &amp; Security</h3>
          <ul>
            <li>Microsoft Entra ID SSO integration with OAuth 2.0</li>
            <li>Role-based access control (Global Admin, Domain Admin, Standard User)</li>
            <li>Session-based authentication with secure cookies</li>
            <li>Password login with bcrypt hashing</li>
          </ul>
          <h3>Multi-Tenant Architecture</h3>
          <ul>
            <li>Tenant isolation by email domain</li>
            <li>Automatic role assignment for first users</li>
            <li>Tenant usage limits and plan management</li>
          </ul>
          <h3>Competitive Intelligence</h3>
          <ul>
            <li>Competitor URL tracking and management</li>
            <li>AI-powered competitive analysis with Claude</li>
            <li>Gap analysis between your positioning and competitors</li>
            <li>AI-generated recommendations</li>
          </ul>
          <h3>Document Management</h3>
          <ul>
            <li>Grounding document upload (PDF, DOCX)</li>
            <li>Company profile baselining</li>
            <li>Text extraction for AI analysis</li>
          </ul>
          <h3>User Interface</h3>
          <ul>
            <li>Modern dashboard with key metrics</li>
            <li>Dark/light mode toggle</li>
            <li>Synozur brand styling</li>
            <li>Responsive design for all devices</li>
          </ul>
        </main>
        <footer>
          <p>Synozur | Orbit — The AI-driven marketing intelligence platform for The Synozur Alliance.</p>
          <nav aria-label="Product links">
            <a href="/#capabilities">Features</a>
            <a href="/pricing">Pricing</a>
            <a href="/roadmap">Roadmap</a>
            <a href="/changelog">Changelog</a>
          </nav>
          <nav aria-label="Company links">
            <a href="https://www.synozur.com">About Synozur</a>
            <a href="https://www.synozur.com/services/go-to-market-transformation">GTM Services</a>
            <a href="https://www.synozur.com/privacy">Privacy Policy</a>
            <a href="https://www.synozur.com/terms">Terms of Service</a>
            <a href="https://www.synozur.com/contact">Contact Support</a>
          </nav>
          <p>&copy; 2026 The Synozur Alliance, LLC. All rights reserved.</p>
          <p>"Synozur" and "The Synozur Alliance" are trademarks of The Synozur Alliance, LLC.</p>
        </footer>`;
    case "/roadmap":
      return `
        <header>
          <nav aria-label="Main navigation">
            <a href="/">Synozur | Orbit</a>
            <a href="/">Product</a>
            <a href="/pricing">Pricing</a>
            <a href="/auth/signin">Sign In</a>
            <a href="/auth/signup">Get Started</a>
          </nav>
        </header>
        <main>
          <a href="/about">Back to About</a>
          <h1>Product Roadmap</h1>
          <p>See what we've built and what's coming next for Orbit.</p>
          <h2>Completed — Already Available</h2>
          <ul>
            <li>Microsoft Entra ID SSO — Enterprise single sign-on integration</li>
            <li>Multi-Tenant Architecture — Secure tenant isolation with role-based access</li>
            <li>AI-Powered Analysis — Claude-powered competitive analysis and recommendations</li>
            <li>Document Upload — PDF and DOCX support for grounding documents</li>
            <li>Dark/Light Mode — Theme toggle with system preference support</li>
          </ul>
          <h2>Coming Soon — Q1 2026</h2>
          <ul>
            <li>PDF Report Generation — Export branded PDF reports for stakeholders (In Progress)</li>
            <li>Web Crawling Service — Automated competitor website monitoring (In Progress)</li>
            <li>Competitor Change Alerts — Get notified when competitors update their messaging (Planned)</li>
            <li>Trial &amp; Feature Gating — 14-day free trial with tier-based features (Planned)</li>
          </ul>
          <h2>On the Horizon — Q2-Q4 2026</h2>
          <ul>
            <li>Competitive Battlecards — Generate sales enablement battlecards with Harvey Ball scoring</li>
            <li>Email Notifications — Automated alerts for competitor changes and trial updates</li>
            <li>Team Collaboration — Shared annotations, comments, and team workspaces</li>
            <li>HubSpot Integration — Sync competitors and push insights to your CRM</li>
            <li>Google SSO — Additional single sign-on option for Google Workspace users</li>
          </ul>
          <h3>Have a feature request?</h3>
          <p>We'd love to hear what features would help your team the most.</p>
          <a href="https://www.synozur.com/contact">Contact us with your ideas</a>
        </main>
        <footer>
          <p>Synozur | Orbit — The AI-driven marketing intelligence platform for The Synozur Alliance.</p>
          <nav aria-label="Product links">
            <a href="/#capabilities">Features</a>
            <a href="/pricing">Pricing</a>
            <a href="/roadmap">Roadmap</a>
            <a href="/changelog">Changelog</a>
          </nav>
          <nav aria-label="Company links">
            <a href="https://www.synozur.com">About Synozur</a>
            <a href="https://www.synozur.com/services/go-to-market-transformation">GTM Services</a>
            <a href="https://www.synozur.com/privacy">Privacy Policy</a>
            <a href="https://www.synozur.com/terms">Terms of Service</a>
            <a href="https://www.synozur.com/contact">Contact Support</a>
          </nav>
          <p>&copy; 2026 The Synozur Alliance, LLC. All rights reserved.</p>
          <p>"Synozur" and "The Synozur Alliance" are trademarks of The Synozur Alliance, LLC.</p>
        </footer>`;
    default:
      return `<main><h1>Orbit</h1></main>`;
  }
}

export function registerSEORoutes(app: Express) {
  app.get("/robots.txt", (req: Request, res: Response) => {
    const baseUrl = getBaseUrl(req);

    const robotsTxt = `User-agent: *
Allow: /
Allow: /about
Allow: /pricing
Allow: /changelog
Allow: /roadmap
Disallow: /app/
Disallow: /auth/
Disallow: /api/

${baseUrl ? `Sitemap: ${baseUrl}/sitemap.xml` : ""}
`.trim();

    res.type("text/plain").send(robotsTxt);
  });

  app.get("/sitemap.xml", (req: Request, res: Response) => {
    const baseUrl = getBaseUrl(req);
    const lastmod = new Date().toISOString().split("T")[0];

    const urls = PUBLIC_PAGES.map(page => `
  <url>
    <loc>${baseUrl}${page.path}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>`).join("");

    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

    res.type("application/xml").send(sitemap);
  });
}

export function crawlerPrerender(req: Request, res: Response, next: NextFunction) {
  const userAgent = req.get("user-agent") || "";
  const path = normalizePath(req.path);

  if (!PUBLIC_PATH_SET.has(path)) {
    return next();
  }

  if (!isBot(userAgent)) {
    return next();
  }

  const baseUrl = getBaseUrl(req);
  const html = generatePrerenderedHtml(path, baseUrl);
  res.status(200).set({ "Content-Type": "text/html" }).end(html);
}
