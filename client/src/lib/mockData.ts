export const mockCompetitors = [
  { id: 1, name: "Competitor A", url: "https://competitor-a.com", lastCrawl: "2 hours ago", status: "Active" },
  { id: 2, name: "Competitor B", url: "https://competitor-b.com", lastCrawl: "1 day ago", status: "Active" },
  { id: 3, name: "Competitor C", url: "https://competitor-c.com", lastCrawl: "3 days ago", status: "Active" },
];

export const mockAnalysis = {
  themes: [
    { theme: "AI-First Automation", us: "High", competitorA: "Medium", competitorB: "Low" },
    { theme: "Enterprise Security", us: "Medium", competitorA: "High", competitorB: "Medium" },
    { theme: "Ease of Use", us: "High", competitorA: "Low", competitorB: "High" },
    { theme: "Customer Support", us: "Medium", competitorA: "High", competitorB: "Low" },
    { theme: "Global Scale", us: "Low", competitorA: "High", competitorB: "High" },
    { theme: "Data Privacy", us: "High", competitorA: "Medium", competitorB: "Medium" },
  ],
  gaps: [
    { area: "Pricing Transparency", observation: "Competitor A lists pricing, we do not.", impact: "High" },
    { area: "Integration Ecosystem", observation: "Competitor B has 50+ integrations listed.", impact: "Medium" },
    { area: "Self-Service Onboarding", observation: "Competitor A allows full self-service signup. We require sales contact.", impact: "High" },
    { area: "API Documentation", observation: "Competitor C has comprehensive API docs. Ours are gated.", impact: "Medium" },
  ],
  messaging: [
    { category: "Value Proposition", us: "Unlock your potential", competitorA: "Automate everything", competitorB: "Secure your future" },
    { category: "Primary CTA", us: "Request Demo", competitorA: "Start Free Trial", competitorB: "Contact Sales" },
    { category: "Target Audience", us: "Enterprise IT", competitorA: "SMB Founders", competitorB: "CISO / Security Teams" },
    { category: "Tone", us: "Professional, Trustworthy", competitorA: "Innovative, Fast", competitorB: "Serious, Reliable" },
  ]
};

export const mockActivity = [
  { id: 1, type: "change", competitor: "Competitor A", description: "Changed homepage headline from 'Best CRM' to 'AI-Powered CRM'", date: "Today, 9:00 AM", impact: "High" },
  { id: 2, type: "new_page", competitor: "Competitor B", description: "Launched new 'Enterprise' pricing page", date: "Yesterday", impact: "Medium" },
  { id: 3, type: "change", competitor: "Competitor A", description: "Removed 'Free Tier' from pricing table", date: "2 days ago", impact: "High" },
  { id: 4, type: "change", competitor: "Competitor C", description: "Updated 'Terms of Service' page", date: "3 days ago", impact: "Low" },
  { id: 5, type: "new_page", competitor: "Competitor A", description: "Added 'Case Studies' section to navigation", date: "4 days ago", impact: "Medium" },
];

export const mockRecommendations = [
  { id: 1, title: "Emphasize AI Automation", description: "Competitor A is pivoting to AI messaging. We should highlight our unique 'Human-in-the-loop' feature to differentiate.", impact: "High", area: "Homepage" },
  { id: 2, title: "Add Security Certification Badges", description: "Competitor B is heavily signaling trust with SOC2 badges above the fold. We should match this.", impact: "Medium", area: "Footer" },
  { id: 3, title: "Create 'Migration Guide' Content", description: "Users are complaining about Competitor C's lock-in. Create a guide on easy migration.", impact: "Low", area: "Blog" },
  { id: 4, title: "Launch Self-Service Trial", description: "Competitor A's self-service model is reducing friction. Consider a 14-day free trial pilot.", impact: "High", area: "Pricing" },
];

export const mockReports = [
  { id: 1, name: "Q1 Competitive Landscape", date: "Jan 15, 2026", type: "PDF", size: "2.4 MB", author: "John Doe", status: "Ready" },
  { id: 2, name: "Competitor A Deep Dive", date: "Dec 20, 2025", type: "PDF", size: "1.8 MB", author: "Sarah Smith", status: "Ready" },
  { id: 3, name: "Weekly Intelligence Brief", date: "Jan 08, 2026", type: "PDF", size: "0.9 MB", author: "System", status: "Ready" },
  { id: 4, name: "Market Positioning Audit", date: "Nov 15, 2025", type: "PDF", size: "3.1 MB", author: "John Doe", status: "Archived" },
];

export const mockUsers = [
  { id: 1, name: "John Doe", email: "john@acme.com", role: "Tenant Admin", status: "Active", lastActive: "Just now", avatar: "JD" },
  { id: 2, name: "Sarah Smith", email: "sarah@acme.com", role: "Standard User", status: "Active", lastActive: "2 hours ago", avatar: "SS" },
  { id: 3, name: "Mike Johnson", email: "mike@acme.com", role: "Standard User", status: "Invited", lastActive: "-", avatar: "MJ" },
];
