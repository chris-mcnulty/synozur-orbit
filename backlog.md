# Orbit MVP Feature Backlog

## Priority 1: Critical (Must Have for Launch)

### 1.1 SSO Authentication (Microsoft Entra ID + Google)
**Status**: Microsoft Entra ID implemented, Google pending
**Spec Requirement**: "SSO integration with Microsoft Entra ID (Azure AD) and Google"
- [x] Microsoft Entra ID OAuth 2.0 flow with @azure/msal-node
- [x] SSO users linked via `entraId` field, `authProvider: "entra"`
- [x] Password login blocked for SSO users
- [ ] Google SSO (optional, not critical for enterprise)
**Effort**: Remaining: Low (Google SSO only)

### 1.2 PDF Report Generation & Export
**Status**: Reports table exists, no generation
**Spec Requirement**: "Download a PDF report...formatted with Synozur's branding"
- [ ] Server-side PDF generation (puppeteer or pdfkit)
- [ ] Branded template with company logo
- [ ] Include analysis findings, recommendations, competitor comparison
- [ ] Download endpoint for generated reports
**Effort**: Medium

### 1.4 Web Crawling Service
**Status**: Basic URL fetch exists, no robust crawling
**Spec Requirement**: "Crawl and scrape competitor websites...homepage, about page, product/service pages"
- [ ] Background job for website content extraction
- [ ] Target key pages: homepage, about, services/products
- [ ] Extract text content for AI analysis
- [ ] Store crawled content with timestamps
**Effort**: Medium

### 1.5 Competitor Change Monitoring
**Status**: Social media monitoring implemented (LinkedIn/Instagram), website monitoring pending
**Spec Requirement**: "Daily or weekly schedule...detect significant updates"
- [x] Social media monitoring (LinkedIn, Instagram) with AI summarization
- [x] Diff detection between crawl snapshots
- [x] AI summarization of changes using Claude
- [x] Store changes in activity log
- [x] Premium feature gating (free tier blocked)
- [x] On-demand monitoring via UI button
- [ ] Scheduled job (cron) for periodic crawling
- [ ] Website content change monitoring
**Effort**: Medium (remaining: scheduled jobs)

---

## Priority 2: Important (Required for Launch)

### 2.1 Email Notification Service
**Status**: Not implemented
**Spec Requirement**: "Notification service for email alerts (trial onboarding, competitor updates)"
- [ ] Email service integration (SendGrid/Resend)
- [ ] Trial welcome and expiration emails
- [ ] Weekly competitor update digest
- [ ] Alert emails for significant changes
**Effort**: Medium

### 2.2 Dark/Light Mode Toggle
**Status**: Dark mode default, no toggle
**Spec Requirement**: "Dark Mode and Light Mode toggle"
- [x] User preference toggle in settings
- [x] Persist preference in user record or localStorage
- [x] CSS variable switching for theme
**Effort**: Low

### 2.3 Tenant Admin Features ✅
**Status**: Implemented
**Spec Requirement**: "Tenant Admin manages organization's account – inviting team members"
- [x] Team invite flow with token-based acceptance
- [x] User management (view/update roles/remove members)
- [x] Tenant settings page (branding, monitoring frequency)
- [x] RBAC enforcement for Domain Admin and Global Admin
**Effort**: Medium - COMPLETED

### 2.4 Side-by-Side Messaging Comparison
**Status**: Analysis exists, not side-by-side format
**Spec Requirement**: "Side-by-side analysis of client's website vs each competitor"
- [ ] Visual comparison table in UI
- [ ] Highlight differences in messaging
- [ ] Key themes and positioning extraction
**Effort**: Low-Medium

---

## Priority 3: Nice to Have (Can Ship Without)

### 3.1 Marketing Site Enhancements
**Status**: Landing page exists
**Spec Requirement**: "Promotional homepage with screenshots, 'Start Free Trial' CTA"
- [ ] Add product screenshots
- [ ] Trust badges and testimonials
- [ ] Video walkthrough
- [ ] Clear 14-day trial messaging

### 3.2 Expert Review Upsell
**Status**: Not implemented
**Spec Requirement**: "Expert Review CTA for Synozur consultant review"
- [ ] In-app CTA to request consultant review
- [ ] Contact form or scheduling link
- [ ] Messaging about Synozur services

### 3.3 Recommendation Feedback Loop
**Status**: Not implemented
**Spec Requirement**: "Users can mark recommendations as 'not relevant'"
- [ ] Thumbs up/down on recommendations
- [ ] AI learning from feedback

### 3.4 Trial & Feature Gating System
**Status**: Schema exists, no enforcement
**Spec Requirement**: "14-day free trial, then Free tier with limited functionality"
- [ ] Add `trialStartDate` and `trialEndsAt` to tenants
- [ ] Implement trial countdown and expiration logic
- [ ] Feature gating middleware on API routes
- [ ] UI upgrade prompts when hitting limits (3 competitors, 5 analyses)
- [ ] Free tier: basic analysis only, no AI recommendations
**Effort**: Medium

---

## Post-MVP Roadmap (Year One)

### Competitive Battlecards (Q1 Post-Launch)
Generate competitive battlecards for sales enablement:
- [ ] Critical Capabilities Matrix with Harvey Ball scoring (●○◐◑)
- [ ] Qualitative comparison narrative
- [ ] Sales challenge questions with responses
- [ ] Exportable PDF battlecard

### Real-Time Competitor Alerts (Q1)
- [ ] Real-time notifications for competitor changes
- [ ] Social media monitoring (LinkedIn)
- [ ] Customizable alert preferences
- [ ] Weekly digest emails

### CRM Integration - HubSpot (Q2)
- [ ] Competitor sync from HubSpot
- [ ] Push Orbit insights back to CRM
- [ ] Lead generation insights

### Advanced AI Features (Q2-Q3)
- [ ] Sentiment and tone analysis
- [ ] Multi-language support
- [ ] Custom AI tuning with user goals

### Collaboration Features (Q3)
- [ ] Shared annotations/comments
- [ ] Vega integration (recommendations → tasks)
- [ ] Team usage analytics

### Outcome Metrics & ROI Dashboard (Q4)
- [ ] Google Analytics integration
- [ ] Orbit Score / Index
- [ ] Industry benchmarks

### Billing Integration
- [ ] Stripe integration for payment processing
- [ ] Plan upgrade/downgrade flows
- [ ] Usage-based billing
