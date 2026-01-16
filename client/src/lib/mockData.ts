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
  ],
  gaps: [
    { area: "Pricing Transparency", observation: "Competitor A lists pricing, we do not.", impact: "High" },
    { area: "Integration Ecosystem", observation: "Competitor B has 50+ integrations listed.", impact: "Medium" },
  ]
};

export const mockActivity = [
  { id: 1, type: "change", competitor: "Competitor A", description: "Changed homepage headline from 'Best CRM' to 'AI-Powered CRM'", date: "Today, 9:00 AM", impact: "High" },
  { id: 2, type: "new_page", competitor: "Competitor B", description: "Launched new 'Enterprise' pricing page", date: "Yesterday", impact: "Medium" },
  { id: 3, type: "change", competitor: "Competitor A", description: "Removed 'Free Tier' from pricing table", date: "2 days ago", impact: "High" },
];

export const mockRecommendations = [
  { id: 1, title: "Emphasize AI Automation", description: "Competitor A is pivoting to AI messaging. We should highlight our unique 'Human-in-the-loop' feature to differentiate.", impact: "High", area: "Homepage" },
  { id: 2, title: "Add Security Certification Badges", description: "Competitor B is heavily signaling trust with SOC2 badges above the fold. We should match this.", impact: "Medium", area: "Footer" },
  { id: 3, title: "Create 'Migration Guide' Content", description: "Users are complaining about Competitor C's lock-in. Create a guide on easy migration.", impact: "Low", area: "Blog" },
];

export const mockReports = [
  { id: 1, name: "Q1 Competitive Landscape", date: "Jan 15, 2026", type: "PDF" },
  { id: 2, name: "Competitor A Deep Dive", date: "Dec 20, 2025", type: "PDF" },
];

export const mockUsers = [
  { id: 1, name: "John Doe", email: "john@acme.com", role: "Tenant Admin", status: "Active", lastActive: "Just now", avatar: "JD" },
  { id: 2, name: "Sarah Smith", email: "sarah@acme.com", role: "Standard User", status: "Active", lastActive: "2 hours ago", avatar: "SS" },
  { id: 3, name: "Mike Johnson", email: "mike@acme.com", role: "Standard User", status: "Invited", lastActive: "-", avatar: "MJ" },
];
