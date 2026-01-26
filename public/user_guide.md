# Synozur Orbit User Guide

## Table of Contents
1. [Overview](#overview)
2. [Getting Started](#getting-started)
3. [User Roles & Permissions](#user-roles--permissions)
4. [Core Features](#core-features)
5. [Understanding Orbit Scores](#understanding-orbit-scores)
6. [Managing Competitors](#managing-competitors)
7. [Running Analysis](#running-analysis)
8. [Battlecards & Reports](#battlecards--reports)
9. [Client Projects](#client-projects)
10. [Marketing Planner](#marketing-planner)
11. [Team Management](#team-management)
12. [Settings & Configuration](#settings--configuration)
13. [Administrator Guide](#administrator-guide)
14. [Troubleshooting & FAQs](#troubleshooting--faqs)

---

## Overview

### What is Synozur Orbit?

Synozur Orbit is an AI-powered go-to-market intelligence platform designed to help organizations understand their competitive landscape, plan marketing activities, and align product development with market reality. The platform unifies three core pillars:

- **Competitive Intelligence**: Analyze competitors, identify positioning gaps, and generate battlecards
- **Marketing Planner**: AI-powered quarterly and annual marketing planning with activity-based organization
- **Product Management**: Roadmap prioritization aligned with competitive market intelligence

### Key Capabilities

- **Automated Competitor Tracking**: Monitor competitor websites, social media, and product changes
- **AI-Powered Analysis**: Get intelligent competitive positioning analysis and gap identification
- **Strategic Recommendations**: Receive AI-generated insights for messaging, positioning, and go-to-market strategy
- **Sales Enablement**: Generate battlecards to prepare your sales team for competitive conversations
- **Marketing Planning**: Create and manage marketing plans with AI-suggested activities (Enterprise)
- **Project Management**: Organize complex multi-competitor, multi-product analyses
- **Professional Reporting**: Export branded PDF reports for stakeholders
- **Change Monitoring**: Automatic detection of competitor website updates, social media activity, and blog posts

### Who Should Use Orbit?

- **Marketing Teams**: Understand competitive positioning and identify messaging opportunities
- **Sales Teams**: Prepare for competitive deals with up-to-date battlecards
- **Product Teams**: Track competitor product changes and feature developments
- **Executive Leadership**: Monitor competitive landscape and strategic threats
- **Marketing Agencies**: Manage competitive analysis for multiple clients

---

## Getting Started

### Creating Your Account

1. **Navigate to the signup page** at `/auth/signup`
2. **Enter your information**:
   - Email address
   - Password (minimum 6 characters)
   - Full name
   - Company name
   - Company size
   - Job title
   - Industry
   - Country
3. **Click "Create Account"**

**What Happens Next:**
- Your account is created as a **Standard User**
- A tenant (organization) is automatically created based on your email domain
- If you're the first user from your domain, you're **automatically promoted to Domain Admin**
- You'll receive a welcome email
- Your account information is synced to HubSpot CRM (for Synozur tracking)
- Your organization starts with a **60-day trial period** of the Enterprise plan

### Understanding Your Trial Period

New organizations automatically receive a **60-day trial** of the Enterprise plan:

**Trial Benefits:**
- Full access to all Enterprise features
- Unlimited competitors and analyses
- Marketing Planner access
- Team collaboration features

**Trial Reminders:**
You'll receive email reminders about your trial status at key milestones:
- **Day 7**: Welcome and feature overview
- **Day 30**: Mid-trial check-in (30 days remaining)
- **Day 46**: Upgrade reminder (14 days remaining)
- **Day 53**: Upgrade reminder (7 days remaining)
- **Day 57**: Urgent reminder (3 days remaining)
- **Day 59**: Final reminder (1 day remaining)
- **Day 60**: Trial expired notification

**What Happens When Trial Expires:**
- Your account automatically reverts to the **Free plan**
- Limited to 1 competitor and 1 analysis per month
- Contact sales@synozur.com to upgrade to Pro or Enterprise

**Note:** The final 14 days of reminder emails include contact information (contactus@synozur.com) for establishing a client relationship and exploring paid plans.

### Joining an Existing Organization

If someone from your organization invites you:

1. **Check your email** for the invitation link
2. **Click the invitation link** (valid for 7 days)
3. **Create your password**
4. **Accept the invitation**

You'll automatically join your organization's tenant with the role assigned by the person who invited you.

### First Steps After Login

1. **Set up your company profile** (optional but recommended)
   - Go to Dashboard
   - Add your company's website and positioning information
   - This helps AI provide more accurate competitive analysis

2. **Add your first competitor**
   - Navigate to Competitors page
   - Click "Add Competitor"
   - Enter competitor's website URL
   - Optionally add LinkedIn and Instagram URLs

3. **Run your first analysis**
   - Select your competitor
   - Click "Quick Refresh" for basic data or "Full Analysis" for AI insights
   - Review the results in the Analysis page

---

## User Roles & Permissions

Orbit uses a role-based access control (RBAC) system with four distinct roles:

### Standard User (Default Role)

**Capabilities:**
- Add and manage competitors (within their tenant)
- Run analysis on competitors
- View recommendations and activity logs
- Create and manage assessments
- Upload grounding documents
- Generate reports
- View projects (if invited)

**Limitations:**
- Cannot manage team members
- Cannot change organization settings
- Can only see competitors and data within their own organization

**Typical Use Cases:** Marketing analysts, sales team members, product managers

### Domain Admin

**All Standard User capabilities, plus:**

**Team Management:**
- View all team members in the organization
- Invite new team members
- Assign roles to team members (Standard User or Domain Admin)
- Remove team members from the organization
- Promote or demote users between Standard User and Domain Admin

**Organization Settings:**
- Configure tenant name, logo, and favicon
- Set primary and secondary brand colors
- Configure monitoring frequency (daily, weekly, or disabled)
- Enable/configure Microsoft Entra ID (Azure AD) SSO
- Manage social media monitoring settings

**Plan Management:**
- View current plan limits (competitors, analyses, team members)
- See usage against limits

**Limitations:**
- Cannot access other organizations' data
- User invitation limits based on plan (e.g., Trial: 1 admin, 2 standard users)

**Typical Use Cases:** Marketing directors, department heads, organization administrators

### Global Admin (Synozur Staff Only)

**All Domain Admin capabilities across all tenants, plus:**

**Cross-Tenant Access:**
- View and manage any organization's data
- Access all competitors and projects across all tenants
- Modify users from any domain

**System Administration:**
- View all tenants and their usage metrics
- Manually trigger scheduled jobs (website crawls, social monitoring)
- View job execution status and logs
- Access global grounding documents (Synozur brand guidelines, methodology)
- Manage domain blocklist for signup restrictions

**Limitations:**
- None - full platform access

**Identification:** Must have @synozur.com email address

### Consultant (Synozur Staff & Partners)

**Read-Only Cross-Tenant Access:**
- View competitors and analysis from any organization
- Access projects across all tenants
- View activity logs and recommendations

**Limitations:**
- Cannot create, edit, or delete any data
- Cannot manage teams
- Cannot change settings
- Read-only access only

**Typical Use Cases:** Synozur consultants, auditors, support team members who need visibility into client data

---

## Core Features

### Overview Page

The Overview page (located at `/app`) is your home page and central dashboard when you log in:

**What You'll See:**

**Quick Stats:**
- Total competitors tracked
- Recent activity count
- Open recommendations
- Active projects

**Onboarding Checklist:**
- Guided steps for new users
- Track setup progress
- Dismissable once complete

**Recent Activity:**
- Latest competitor updates
- Website changes
- Social media posts
- Analysis completions

**Competitive Positioning Chart:**
- Visual representation of your competitive landscape
- Innovation vs. Market Presence quadrants
- Click any competitor to view details

**Action Items:**
- Priority recommendations
- Pending analyses
- Recent competitor changes requiring attention

**AI Insights Section:**
- Action item assignment controls
- Accept or dismiss recommendations
- Track follow-ups and implementation

**"Rebuild All" Button (Admins):**
- Admins can trigger a complete refresh of all competitive intelligence
- Re-crawls all competitor websites
- Updates all analysis data
- Use quarterly or when major market changes occur
- **Note:** The "Regenerate All" operation now preserves manual research. Competitors with manually entered research (source === "manual") are not overwritten, protecting hand-entered data for companies that block web crawlers.

### Dashboard (Legacy)

The Dashboard provides additional views and historical data:
- Priority recommendations
- Pending analyses
- Recent competitor changes requiring attention

### Activity Log

Track all changes and updates across your competitive landscape:

**Activity Types:**
- **Website Crawls**: When competitor websites were scanned
- **Social Media Updates**: New posts from LinkedIn or Instagram
- **Website Changes**: AI-summarized differences in competitor websites
- **Blog Posts**: New blog articles detected
- **Analysis Completions**: When AI analysis was completed
- **Competitor Additions**: New competitors added to tracking

**Filtering:**
- Filter by competitor
- Filter by activity type
- Sort by date (newest/oldest first)

**Details:**
Each activity entry shows:
- Activity type and description
- Timestamp
- Associated competitor
- AI-generated summary (for changes)
- Link to view full details

---

## Understanding Orbit Scores

### What is the Orbit Score?

The **Orbit Score** is a composite metric (0-100) that measures a company's overall competitive positioning. It combines multiple data points to give you a single, actionable number for comparing competitors and tracking changes over time.

### Score Components

The overall Orbit Score is calculated from four main components:

| Component | Weight | Description |
|-----------|--------|-------------|
| **Innovation Score** | 35% | How differentiated and fresh the messaging is |
| **Market Presence** | 35% | Visibility and establishment in the market |
| **Content Activity** | 15% | How actively they publish and update content |
| **Social Engagement** | 15% | Social media reach and interaction |

### Innovation Score (35% of total)

Measures how unique and differentiated a company's positioning is:

- **Keyword Diversity** (20%): Variety of unique keywords in messaging. More diverse keywords indicate broader topic coverage.
- **Key Message Count** (25%): Number of distinct value propositions. Companies with clear, multiple messages score higher.
- **Content Freshness** (20%): Based on how recently the analysis was updated. Full score within 7 days, decaying over 30 days.
- **Blog Activity** (20%): Recent blog posts indicate thought leadership. More posts = higher score.
- **Analysis Completeness** (15%): Depth of AI analysis data available.

### Market Presence Score (35% of total)

Measures visibility and establishment in the market. This score **adapts** based on available data:

**When social data is available:**
- Social Followers (25%): LinkedIn/Instagram follower counts (logarithmic scale)
- Social Engagement (20%): Posts, reactions, comments
- Website Depth (20%): Pages crawled and content volume
- Content Richness (20%): Combination of keyword diversity and key messages
- Brand Consistency (15%): Analysis completeness plus clear messaging presence

**When social data is NOT available:**
- Website Depth (35%): Pages crawled and content volume
- Content Richness (35%): Keyword diversity and key messages
- Brand Consistency (30%): Analysis completeness plus clear messaging

*Note: Social data uses a logarithmic scale, meaning the difference between 100 and 1,000 followers counts as much as the difference between 10,000 and 100,000.*

### Content Activity Score (15% of total)

Measures how actively a company publishes and maintains content:

- **Content Freshness** (40%): How recently the website was analyzed
- **Blog Activity** (35%): Frequency and recency of blog posts
- **Website Completeness** (25%): Number of pages crawled

### Social Engagement Score (15% of total)

Measures social media reach and interaction:

- **Social Followers** (50%): Combined LinkedIn and Instagram followers
- **Social Engagement** (50%): Combined posts, reactions, and comments

### Reading the Market Positioning Chart

The scatter plot on your dashboard displays competitors on two axes:

- **X-axis (Innovation Score)**: How unique and differentiated the positioning is
- **Y-axis (Market Presence)**: How visible and established in the market

**Interpreting Quadrants:**

| Quadrant | Position | What It Means |
|----------|----------|---------------|
| **Top-Right** | High Innovation + High Presence | Strong competitors - well-positioned and visible |
| **Top-Left** | Low Innovation + High Presence | Established but generic - may be vulnerable to differentiated challengers |
| **Bottom-Right** | High Innovation + Low Presence | Innovative disruptors - watch these for rapid growth |
| **Bottom-Left** | Low Innovation + Low Presence | Weaker competitors - less immediate threat |

### How to Improve Your Score

To increase your Orbit Score:

1. **Run analyses regularly** - Keep content freshness high by running monthly analyses
2. **Add social media links** - Adding LinkedIn and Instagram URLs provides more data points
3. **Monitor blog activity** - Companies with active blogs score higher on innovation
4. **Complete your profile** - Ensure all analysis fields are populated

### Score Calculation Notes

- All scores are calculated on a 0-100 scale with 2 decimal precision
- Scores update automatically when you run analyses
- The system uses logarithmic scaling for follower counts (prevents mega-companies from dominating)
- Companies without social data are still scored fairly using adaptive weights
- Scores are relative - they help compare competitors, not provide absolute benchmarks

---

## Managing Competitors

### Adding a Competitor

1. **Navigate to the Competitors page** (`/app/competitors`)
2. **Click "Add Competitor" button**
3. **Fill in the form**:
   - **Website URL** (required): Competitor's main website
   - **LinkedIn URL** (optional): Company LinkedIn page
   - **Instagram URL** (optional): Company Instagram account
   - **Client Project** (optional): Associate with a specific project
4. **Click "Add Competitor"**

**What Happens Next:**
- Orbit automatically crawls the website
- Logo and favicon are captured
- Homepage screenshot is taken
- Social media links are validated
- Basic company information is extracted

### Viewing Competitor Details

Click any competitor to see their full profile:

**Overview Tab:**
- Company logo and screenshot
- Website URL with quick link
- Social media links
- Last crawl timestamp
- Analysis status

**Website Content Tab:**
- Homepage content
- About page
- Products/Services page
- Latest blog posts
- Full crawled content

**Analysis Tab:**
- AI-generated competitive positioning summary
- Value propositions identified
- Target audience analysis
- Key messaging themes
- Strengths and weaknesses

**Battlecard Tab:**
- Generate company vs. company battlecards
- Our advantages vs. this competitor
- Common objections and responses
- Sales talk tracks
- Edit and customize battlecard content

**Activity Tab:**
- All changes detected for this competitor
- Social media updates
- Website changes with diffs
- Blog post activity

### Competitor Actions

**Quick Refresh:**
- Updates website content only
- Fast operation (no AI analysis)
- Free for all plans

**Full Analysis:**
- Complete AI-powered competitive analysis
- Requires Pro or Enterprise plan
- Counts against monthly analysis limit

**Monitor Now:**
- Trigger immediate competitor monitoring
- Check for website changes
- Scan social media for updates
- Requires Pro or Enterprise plan

**Edit Competitor:**
- Update LinkedIn or Instagram URLs
- Change project association
- Update metadata

**Delete Competitor:**
- Removes competitor from tracking
- Deletes all associated analysis data
- Cannot be undone

### Adding Blog/RSS Feeds

For competitors that block web crawlers but have accessible blogs or RSS feeds:

1. **Navigate to the Competitors page**
2. **Click the competitor dropdown menu**
3. **Select "Add Blog/RSS Feed"**
4. **Enter the blog URL or RSS feed URL**:
   - Supports RSS feeds (application/rss+xml)
   - Supports Atom feeds (application/atom+xml)
   - Supports direct blog page HTML parsing
5. **Click "Test Feed"** to verify the URL can be parsed
6. **Click "Save"** if test is successful

**What Happens Next:**
- Orbit monitors the feed for new posts
- When new blog posts are detected, activity entries are created
- AI can analyze blog content for competitive insights
- Useful for companies with blocked crawlers but public blogs

**Supported Feed Types:**
- Standard RSS 2.0 feeds
- Atom feeds
- Blog pages with structured post HTML

**Troubleshooting:**
- If testing fails, verify the URL is publicly accessible
- Try the RSS feed URL directly (often `/rss` or `/feed`)
- Check if the blog requires authentication

### Competitor Limits by Plan

- **Trial**: Up to 3 competitors
- **Free**: 1 competitor
- **Pro**: Unlimited competitors
- **Enterprise**: Unlimited competitors

---

## Running Analysis

### Types of Analysis

#### Quick Refresh
- **Purpose**: Update competitor website content without AI analysis
- **Speed**: Fast (30 seconds - 2 minutes)
- **Cost**: Free for all plans
- **What It Does**:
  - Re-crawls competitor website
  - Updates homepage, about, services, and blog content
  - Captures new screenshots
  - Detects new blog posts
  - No AI-powered analysis

**When to Use:**
- Check if a competitor updated their website
- Refresh content before viewing battlecards
- Regular monitoring without using analysis credits

#### Full Analysis
- **Purpose**: Complete AI-powered competitive intelligence
- **Speed**: Moderate (2-5 minutes)
- **Cost**: Counts against monthly analysis limit (Pro/Enterprise only)
- **What It Does**:
  - Everything in Quick Refresh
  - AI analysis of positioning and messaging
  - Gap analysis vs. your company
  - Strategic recommendations generation
  - Competitive strengths/weaknesses identification

**When to Use:**
- Initial competitor research
- Quarterly competitive reviews
- Before major product launches
- Strategic planning sessions

#### Full Analysis with Social Monitoring
- **Purpose**: Complete analysis including social media tracking
- **Speed**: Moderate (3-7 minutes)
- **Cost**: Requires Pro/Enterprise plan with social monitoring enabled
- **What It Does**:
  - Everything in Full Analysis
  - LinkedIn post scanning and summarization
  - Instagram post analysis
  - AI-generated social media insights
  - Activity trend detection

**When to Use:**
- Active competitive campaigns
- Social media strategy development
- Real-time competitive monitoring
- Marketing campaign analysis

### Understanding Analysis Results

After running an analysis, you'll see:

**Competitive Positioning:**
- Value proposition summary
- Target audience identification
- Positioning statement
- Key differentiators

**Messaging Analysis:**
- Primary messaging themes
- Tone and voice assessment
- Call-to-action patterns
- Pain points addressed

**Gap Analysis:**
- Where you differ from competitors
- Opportunities for differentiation
- Potential weaknesses
- Strategic recommendations

**Recommendations:**
- Specific actions to improve positioning
- Messaging adjustments
- Product positioning opportunities
- Go-to-market strategy suggestions

### Analysis Limits by Plan

- **Trial**: 5 analyses per month
- **Free**: 1 analysis per month
- **Pro**: Unlimited analyses
- **Enterprise**: Unlimited analyses

---

## Battlecards & Reports

### Company Battlecards

Battlecards prepare your sales team for competitive conversations:

**Accessing Battlecards:**
1. Navigate to Competitor Detail page
2. Click the "Battlecard" tab
3. View or edit the battlecard content

**Battlecard Sections:**

**1. Overview:**
- Competitor company summary
- Target market and positioning
- Key products/services

**2. Our Advantages:**
- Where your solution is stronger
- Unique differentiators
- Competitive edge points

**3. Their Strengths:**
- What the competitor does well
- Areas where they're strong
- Features to be aware of

**4. Common Objections:**
- Typical competitor claims
- Suggested responses
- How to reframe the conversation

**5. Talk Tracks:**
- Opening statements
- Discovery questions
- Closing strategies

**Editing Battlecards:**
- Click "Edit" button
- Modify any section
- Add custom notes
- Save changes

**Note:** Battlecards are automatically generated using AI when you run a Full Analysis. You can always edit them to add your team's insights and real-world experiences.

### Exporting Battlecards

Share battlecards with your sales team in multiple formats:

**Export Options:**

1. **Copy to Clipboard**
   - Click the "Copy" button
   - Formatted text with emojis and sections
   - Ready to paste into Slack, email, or documents
   - Preserves formatting for most applications

2. **Download as PDF**
   - Click "Download PDF"
   - Professional layout with Synozur branding
   - Purple gradient design
   - Print-ready format
   - Ideal for sales meetings and presentations

3. **Download as Text**
   - Click "Download TXT"
   - Plain text format (.txt file)
   - Use in Word, PowerPoint, or any document editor
   - No formatting, maximum compatibility

**Available For:**
- Company-level battlecards (competitor vs. your company)
- Product-level battlecards (competitor product vs. your product)

### Product Battlecards

For project-based product analysis:

**Features:**
- Feature-by-feature comparison
- Product capabilities matrix
- Pricing comparison (if available)
- Target audience alignment

**Access:**
- Available in Client Projects (Pro/Enterprise)
- Navigate to Project Detail page
- View product battlecards for each competitor product

### Generating PDF Reports

**Create Professional Reports:**

1. **Navigate to Reports page** (`/app/reports`)
2. **Choose report scope**:
   - **Baseline Report**: Your company vs. all tracked competitors
   - **Project Report**: Specific client project analysis
3. **Click "Generate Report"**
4. **Wait for generation** (30-60 seconds)
5. **Download PDF**

### One-Click Full Report Generation

For projects, you can generate all content sections with a single click:

**How It Works:**

1. **Navigate to a Project detail page**
2. **Click "Generate Full Report"** button in the project header
3. **Wait for orchestration** (~1 minute)
   - Progress indicator shows generation status
   - All 5 AI content sections created in parallel:
     - Gap Analysis
     - Strategic Recommendations
     - Competitive Summary
     - Go-to-Market (GTM) Plan
     - Messaging Framework
   - Competitor scores are calculated automatically

**What Happens Next:**
- Results card displays success/failure count for each section
- All project tabs refresh automatically with new content
- If all sections complete successfully, comprehensive markdown export auto-downloads
- You can review individual sections or re-generate specific ones if needed

**Benefits:**
- Save time with single-click generation
- Parallel processing for faster results
- Complete project analysis in ~1 minute
- Auto-download for immediate sharing

**Requirements:**
- Pro or Enterprise plan
- Project with at least one competitor
- Active AI analysis capability

### Standard Report Generation

**Report Contents:**

**Executive Summary:**
- Competitive landscape overview
- Key findings
- Strategic recommendations

**Competitor Profiles:**
- Individual competitor analysis
- Positioning summaries
- Recent changes and updates

**Gap Analysis:**
- Side-by-side comparison
- Messaging differences
- Positioning opportunities

**Recommendations:**
- Strategic actions
- Messaging improvements
- Product positioning suggestions

**Branding:**
- Synozur branded headers/footers
- Your organization's colors (Enterprise plan)
- Professional formatting
- Dark mode optimized design

**Report Access:**
- Baseline reports: All users
- Project reports: Project owner or Global Admin only

---

## Client Projects

### Overview

Client Projects (Pro/Enterprise plans) enable managing complex competitive analyses for multiple clients or internal initiatives.

**Project Types:**
1. **Company Analysis**: Comparing company vs. company positioning
2. **Product Analysis**: Comparing product vs. product features and capabilities

### Creating a Project

1. **Navigate to Projects page** (`/app/projects`)
2. **Click "New Project"**
3. **Fill in project details**:
   - Project name (e.g., "Q1 2026 Competitive Review")
   - Client name
   - Client domain (optional)
   - Description
   - Analysis type (company or product)
   - Notification preferences
4. **Click "Create Project"**

### Managing Project Competitors

**Adding Competitors to a Project:**

1. Open project detail page
2. Navigate to "Competitors" section
3. Click "Add Competitor"
4. Select existing competitor or create new one
5. Competitor is linked to project

**Benefits:**
- Organize competitors by project/client
- Generate project-specific reports
- Track project-level insights
- Isolate analysis for specific initiatives

### Product-Level Analysis

For product analysis projects:

**Setting Baseline Product:**
1. Click "Add Baseline Product"
2. Enter your product name
3. Add product description
4. Define key features
5. Save baseline

**Adding Competitor Products:**
1. Click "Add Competitor Product"
2. Enter competitor product name
3. Select associated competitor company
4. Add product details
5. Save competitor product

**AI-Suggested Products:**
- Orbit automatically suggests competitor products based on analysis
- Review and accept suggestions
- AI identifies comparable offerings

### Project Deliverables

Each project can generate:

**1. Product Battlecards:**
- Feature-by-feature comparison matrix
- Capabilities assessment
- Pricing comparison (if available)
- Target audience analysis

**2. Go-to-Market (GTM) Plan:**
- Target customer roles and personas
- Distribution channels
- Pricing strategy
- Marketing tactics
- Budget recommendations
- Timeline and milestones

**3. Messaging Framework:**
- Brand positioning statement
- Value propositions by audience segment
- Messaging pillars
- Proof points
- Call-to-action recommendations

**4. Project Reports:**
- Comprehensive PDF report scoped to project
- All project competitors included
- Analysis specific to project goals

### Exporting Project Assets

**Download Options:**
- **Markdown**: Text-based format for further editing
- **Word Document**: Microsoft Word .docx format
- **PDF Report**: Professional branded report

**What's Included:**
- All deliverables (battlecards, GTM plan, messaging framework)
- Competitive analysis summaries
- Recommendations
- Supporting data and insights

---

## Marketing Planner

### Overview

The Marketing Planner (Enterprise plan only) transforms competitive insights into actionable marketing plans. Create quarterly, half-year, or annual marketing plans organized around proven activity categories.

**Key Features:**
- **Timeframe Selection**: Choose quarterly (Q1-Q4), half-year (H1/H2), or annual planning periods
- **Activity Categories**: 19 marketing activity types organized into logical groups
- **Task Management**: Create, assign, and track marketing tasks with priority levels
- **AI Suggestions**: Get AI-generated task recommendations based on competitive intelligence (coming soon)

### Accessing Marketing Planner

1. **Navigate to Marketing Planner** in the left navigation (Diamond icon)
2. **Enterprise plan required**: Non-Enterprise users see an upgrade prompt

**Note:** Marketing Planner is only visible for Enterprise plan tenants.

### Creating a Marketing Plan

1. **Click "New Plan"** on the Marketing Planner page
2. **Fill in plan details**:
   - Plan name (e.g., "2026 Annual Marketing Plan")
   - Timeframe (Quarterly, Half-Year, or Annual)
   - Description (optional)
   - Focus area (optional)
   - Year (defaults to current year)
3. **Click "Create Plan"**

### Activity Categories

Marketing tasks are organized into 19 activity categories across 5 groups:

**Brand & Thought Leadership:**
- Thematic Campaigns
- Thought Leadership Content

**Digital Marketing:**
- Website & Landing Pages
- SEO & Content Marketing
- Paid Digital Advertising
- Email Marketing
- Social Media Marketing

**Outbound & Sales Enablement:**
- Outbound Campaigns
- Sales Enablement Materials
- Customer Marketing

**Partnerships & Channel:**
- Partner Marketing
- Channel Programs
- Co-Marketing Initiatives

**Events & Community:**
- Industry Events
- Webinars & Virtual Events
- User Conferences
- Community Building
- Analyst Relations
- PR & Media Relations

### Managing Tasks

**Adding Tasks:**
1. Open a marketing plan
2. Click "Add Task"
3. Enter task details:
   - Title
   - Activity category
   - Timeframe (which quarter/period)
   - Priority (High, Medium, Low)
   - Description (optional)
4. Click "Save"

**Task Status Workflow:**
- **Suggested**: AI-recommended task (pending acceptance)
- **Planned**: Accepted and scheduled
- **In Progress**: Currently being worked on
- **Completed**: Task finished
- **Cancelled**: Task removed from plan

**Editing Tasks:**
- Click on any task to edit its details
- Change status, priority, or reassign to different timeframes
- Add due dates and assignees

### Multi-Market Support

For Enterprise tenants with multi-market enabled:
- Each market has its own set of marketing plans
- Plans are scoped to the currently active market
- Switch markets using the market selector to see different plans

---

## Team Management

### Inviting Team Members

**Prerequisites:** Domain Admin or Global Admin role

**Steps:**
1. **Navigate to Users page** (`/app/users`)
2. **Click "Invite User"**
3. **Fill in invitation form**:
   - Email address
   - Assign role (Standard User or Domain Admin)
   - Optional: Add personal message
4. **Click "Send Invitation"**

**What Happens:**
- Invitation email sent to recipient
- Token-based link valid for 7 days
- Recipient creates password and joins tenant
- You'll see invitation status in Users page

**Invitation Limits:**
- Based on your plan (e.g., Trial: 1 admin, 2 standard users)
- Cannot exceed plan limits
- Upgrade plan to invite more users

### Managing Team Members

**View Team:**
- Users page shows all members
- See role, status, and last activity
- Filter by role or status

**Organization Filter (Global Admins):**
- Global Admins can filter users by organization using the dropdown in the Team Members section
- Select "All Organizations" to view users across all tenants
- Select a specific organization to filter the user list
- User counts update dynamically based on the selected filter

**Change User Role:**
1. Find user in list
2. Click role dropdown
3. Select new role (Standard User ↔ Domain Admin)
4. Confirm change

**Note:** You cannot change someone to Global Admin (Synozur staff only).

**Remove User:**
1. Click remove icon next to user
2. Confirm removal
3. User immediately loses access

**Warning:** Removed users' data (competitors they created, projects they own) is not automatically deleted. Reassign ownership before removing if needed.

### Managing Pending Invitations

**View Invitations:**
- Shows all pending, accepted, expired, and revoked invitations
- See when invitation was sent and expiration date

**Revoke Invitation:**
1. Find pending invitation
2. Click "Revoke"
3. Invitation link becomes invalid
4. Recipient cannot use the link

**Resend Invitation:**
- If invitation expired, send a new one
- Use same email and role
- New 7-day expiration period

---

## Settings & Configuration

### Personal Settings

**Change Password:**
1. Navigate to Settings page
2. Click "Personal" tab
3. Enter current password
4. Enter new password (minimum 6 characters)
5. Confirm new password
6. Click "Update Password"

**Theme Toggle:**
1. Navigate to Settings page
2. Toggle between Dark Mode and Light Mode
3. Preference is saved automatically

**Note:** For SSO users (Microsoft Entra ID), password change is not available. Manage passwords through your organization's SSO provider.

### Organization Settings (Domain Admin Only)

**Branding:**
1. Navigate to Settings page
2. Click "Organization" tab
3. Upload logo (Enterprise plan)
4. Upload favicon (Enterprise plan)
5. Set primary color (Enterprise plan)
6. Set secondary color (Enterprise plan)
7. Click "Save Changes"

**Monitoring Configuration:**
1. Set monitoring frequency:
   - **Daily**: Check competitors daily for changes
   - **Weekly**: Check competitors weekly
   - **Disabled**: No automatic monitoring
2. Enable/disable social media monitoring (Pro/Enterprise)
3. Click "Save Changes"

**Note:** Social monitoring is a premium feature requiring Pro or Enterprise plan.

### Microsoft Entra ID (Azure AD) SSO

**Enable Tenant-Level SSO** (Domain Admin only):

**Prerequisites:**
- Azure AD tenant with app registration
- Client ID from Azure app registration
- Client Secret from Azure app registration
- Tenant ID from Azure portal

**Configuration Steps:**
1. Navigate to Settings > Organization tab
2. Scroll to "Single Sign-On" section
3. Enter Azure Entra Client ID
4. Enter Azure Entra Tenant ID
5. Enter Azure Entra Client Secret
6. Enable "Azure Entra SSO"
7. Click "Save SSO Configuration"

**User Experience:**
- Users see "Sign in with Microsoft" button on login page
- First-time SSO users are auto-provisioned
- Existing users with matching email are linked
- Password login disabled for SSO users

**Security Notes:**
- Client Secret is encrypted in database
- SSO users cannot change password in Orbit
- Password management handled by Azure AD

---

## Administrator Guide

### Domain Admin Responsibilities

As a Domain Admin, you're responsible for:

1. **Team Management**
   - Inviting appropriate team members
   - Assigning correct roles based on responsibilities
   - Removing users who leave the organization
   - Managing invitation lifecycle

2. **Organization Configuration**
   - Setting up branding (if Enterprise plan)
   - Configuring monitoring frequencies
   - Enabling SSO (if desired)
   - Monitoring plan usage

3. **Usage Monitoring**
   - Track competitor count vs. limit
   - Monitor analysis usage vs. limit
   - Ensure team size within plan limits
   - Request plan upgrades when needed

4. **Data Governance**
   - Ensure appropriate access controls
   - Review team member activities
   - Maintain data quality (remove outdated competitors)
   - Organize projects appropriately

### Global Admin Capabilities

**For Synozur Staff Only:**

**System Dashboard:**
- View all tenants and their status
- See usage metrics across platform
- Monitor system health
- Track API usage

**Manual Job Triggers:**
- Force website crawl for any competitor
- Trigger social media monitoring
- Run batch analysis jobs
- View job execution logs

**Cross-Tenant Operations:**
- Access any organization's data
- Assist with customer support issues
- Audit data quality
- Resolve access issues

**User Management:**
- Manually adjust user roles
- Assign Global Admin status
- Override plan limits (temporarily)
- Resolve authentication issues

**Domain Blocklist:**
- Block email domains from self-registration
- Prevent spam/bot signups
- Manage allowed domains
- Review blocklist effectiveness

### AI Usage Tracker (Global Admin Only)

**For Synozur Staff Only:**

The AI Usage Tracker provides comprehensive monitoring of AI API usage across all tenants:

**Accessing the Tracker:**
1. Navigate to the Admin section (Global Admin only)
2. Click "AI Usage Tracker"
3. View real-time statistics and historical data

**Dashboard Statistics:**

**Summary Cards:**
- **Total Requests**: Total number of AI API calls across all tenants
- **Estimated Costs**: Calculated total cost based on token usage and model pricing
- **Average Daily Usage**: Mean number of requests per day
- **Most-Used Operations**: Top operation types (e.g., competitor analysis, battlecard generation)

**Visual Analytics:**

1. **Daily Usage Bar Chart**
   - Shows AI requests for the last 14 days
   - Identify usage spikes and trends
   - Hover to see exact counts per day

2. **Usage by Operation Pie Chart**
   - Breakdown of AI calls by operation type
   - See which features consume most AI resources
   - Examples: analysis, recommendations, battlecards, etc.

**Recent Activity Table:**
- **Operation Details**: Type of AI operation performed
- **Model Names**: Which AI model was used (e.g., Claude Sonnet)
- **Token Usage**: Input and output tokens consumed
- **Costs**: Estimated cost per operation
- **Tenant Attribution**: Which organization made the request
- **Timestamp**: When the request occurred

**Database Tracking:**
- All AI API calls are logged to database
- Tracks provider, model, tokens, and costs
- Enables historical analysis and billing

**Use Cases:**
- Monitor platform-wide AI costs
- Identify high-usage tenants for billing
- Detect unusual usage patterns
- Plan infrastructure and budget
- Optimize AI model selection

**Scheduled Updates:**
- Data refreshes in real-time as requests occur
- Charts update automatically
- Historical data retained for analysis

### Plan Management

**Understanding Plans:**

**Trial Plan (Default for New Signups):**
- 3 competitors
- 5 analyses per month
- 1 Domain Admin
- 2 Standard Users
- No social monitoring
- No team collaboration
- 14-day trial period (future feature)

**Free Plan:**
- 1 competitor
- 1 analysis per month
- 1 Standard User only
- No social monitoring
- No team collaboration

**Pro Plan:**
- Unlimited competitors
- Unlimited analyses
- Social monitoring enabled
- Website change monitoring
- Client projects
- Team collaboration (configurable limits)
- Basic branding

**Enterprise Plan:**
- Everything in Pro
- Custom competitor limits
- Custom user limits
- Full branding customization
- Tenant-level SSO
- Dedicated support
- Custom integrations

**Upgrading Plans:**
- Contact Synozur sales team
- Plans can be upgraded anytime
- Immediate access to new features
- No data migration needed

### Monitoring & Analytics

**Available Metrics:**
- Total competitors tracked
- Analyses run (monthly/all-time)
- Active projects
- Team member count
- Storage usage
- API call volume (Global Admin)

**Activity Monitoring:**
- Review activity log for unusual patterns
- Track competitor changes
- Monitor team member actions
- Identify stale data

**Usage Optimization:**
- Remove inactive competitors
- Archive completed projects
- Run analyses strategically
- Educate team on best practices

---

## Troubleshooting & FAQs

### Authentication Issues

**Q: I forgot my password. How do I reset it?**
A: Currently, password reset must be handled by your Domain Admin. Contact your administrator to reset your password. (Self-service password reset is a planned feature.)

**Q: The SSO login isn't working.**
A: 
1. Verify SSO is enabled by your Domain Admin
2. Ensure you're using your work email address
3. Check with your IT department that Azure AD is configured correctly
4. Contact your Domain Admin to verify SSO settings

**Q: I received an invitation link but it says "Invalid or expired."**
A: Invitation links expire after 7 days. Contact the person who invited you and ask them to send a new invitation.

**Q: Can I use the same email for multiple organizations?**
A: No. Each email address can only belong to one organization (tenant) in Orbit. If you need access to multiple organizations, use different email addresses.

### Competitor Tracking Issues

**Q: The website crawl is failing for my competitor.**
A: 
- Ensure the URL is correct and accessible
- Some websites block automated crawling
- Check if the competitor site is temporarily down
- Try again in a few hours
- Contact support if issue persists

**Q: The competitor's logo/screenshot isn't appearing.**
A: 
- Some sites block image extraction
- Try running "Quick Refresh" to re-capture assets
- Logo may not be available if competitor doesn't have a favicon
- Screenshots capture may fail if site has anti-bot protection

**Q: Social media monitoring isn't finding posts.**
A: 
1. Verify social media URLs are correct (must be company pages, not personal profiles)
2. Ensure social monitoring is enabled (Pro/Enterprise only)
3. Check monitoring frequency settings
4. Some social networks limit public data access
5. Posts may be private or restricted

**Q: I added a competitor but don't see any data.**
A: The initial crawl takes 1-3 minutes. Refresh the page after a few minutes. If still no data, check the activity log for crawl errors.

### Analysis Issues

**Q: Analysis is taking a very long time.**
A: Full analyses can take 2-5 minutes, especially with social monitoring. If it's been more than 10 minutes, refresh the page and try again.

**Q: I'm getting "Analysis limit reached" error.**
A: You've used all your monthly analyses based on your plan. Either wait until next month or upgrade your plan for unlimited analyses.

**Q: The analysis results don't seem accurate.**
A: 
1. Ensure your company profile is set up correctly
2. Upload grounding documents to provide context to the AI
3. Run "Quick Refresh" to ensure latest competitor data
4. Analysis quality improves with more data over time

**Q: Can I delete and re-run an analysis?**
A: Analyses count against your monthly limit when run. Deleting and re-running will use additional credits. Edit your analysis or wait for the monthly reset.

### Project Issues

**Q: I can't create projects. The option is grayed out.**
A: Client Projects require Pro or Enterprise plan. Check your plan on the Settings page or contact your Domain Admin about upgrading.

**Q: I can't see projects created by my teammates.**
A: Projects are currently scoped to the owner. Project sharing is a planned feature. For now, projects can be accessed by the owner and Global Admins only.

**Q: How do I move a competitor from one project to another?**
A: Edit the competitor and change the associated project in the dropdown menu.

### Team Management Issues

**Q: I can't invite more team members.**
A: You've reached your plan's user limit. Check Settings > Plan to see limits. Upgrade your plan or remove inactive users to free up seats.

**Q: A team member left the company. What happens to their data?**
A: When you remove a user, their account is deleted but their data (competitors, projects) remains. Manually delete or reassign data as needed before removing the user.

**Q: Can I transfer project ownership?**
A: Project ownership transfer is not currently available. Global Admins can access all projects. This feature is planned for a future release.

### Report Generation Issues

**Q: PDF report generation is failing.**
A: 
1. Ensure you have at least one competitor with completed analysis
2. Try generating a report with fewer competitors
3. Clear your browser cache
4. Contact support if issue persists

**Q: The report doesn't include all competitors.**
A: 
- Baseline reports include all competitors with completed analysis
- Project reports only include competitors linked to that project
- Competitors without analysis data are excluded

**Q: Can I customize the report template?**
A: Report templates are standard across all users. Custom branding (logo, colors) is available for Enterprise plans. Custom report templates are not currently supported.

### Performance & Technical Issues

**Q: The application is loading slowly.**
A: 
1. Check your internet connection
2. Clear browser cache and cookies
3. Try a different browser
4. Disable browser extensions
5. Contact support if issue persists

**Q: I'm seeing a "Session expired" error.**
A: Your login session has timed out. Click "Sign In" to log back in. Sessions expire after 24 hours of inactivity.

**Q: The page is showing old data.**
A: 
1. Refresh the page (Ctrl+R or Cmd+R)
2. Clear browser cache
3. Check activity log to confirm when last update occurred
4. Run "Quick Refresh" on competitors to update data

### Data & Privacy Questions

**Q: Who can see my competitors and analysis?**
A: 
- Standard Users: Only see data within their organization (tenant)
- Domain Admins: See all data within their organization
- Global Admins: Can see data across all organizations (Synozur staff only)
- Consultants: Read-only access across organizations (Synozur staff only)

**Q: Is my data secure?**
A: 
- All data is encrypted in transit (HTTPS)
- Passwords are hashed using bcrypt
- SSO secrets are encrypted in database
- Access is role-based and tenant-isolated
- Regular security audits performed

**Q: Can I export all my data?**
A: 
- Individual reports can be exported as PDF
- Projects can be exported as Markdown or Word
- Full data export API is planned for future release
- Contact support for bulk data requests

**Q: How long is data retained?**
A: 
- Active data: Retained indefinitely while account is active
- Deleted competitors: Permanently removed
- Activity logs: Retained for audit purposes
- Account deletion: Contact support to delete all data

### Feature Requests & Support

**Q: I have an idea for a new feature. Where do I submit it?**
A: Contact Synozur support with your feature request. Common requests are tracked in the product backlog.

**Q: Is there a mobile app?**
A: Not currently. Orbit is a web application optimized for desktop browsers. Mobile app is planned for future release.

**Q: Can Orbit integrate with our CRM?**
A: HubSpot integration is planned. Other CRM integrations (Salesforce, etc.) are on the roadmap. Contact Synozur sales for integration requests.

**Q: How do I get support?**
A: 
- **Standard Support**: Email support@synozur.com
- **Enterprise Support**: Dedicated support contact provided
- **In-App Help**: Look for help icons throughout the application

### Billing Questions

**Q: How do I upgrade my plan?**
A: Contact Synozur sales team at sales@synozur.com to discuss plan options and pricing.

**Q: What happens when my trial expires?**
A: Your account is automatically downgraded to the Free plan (1 competitor, 1 analysis per month). You'll receive reminder emails at days 7, 30, 46, 53, 57, 59, and 60 of your trial. Contact contactus@synozur.com or sales@synozur.com to upgrade before your trial ends.

**Q: When will I receive trial reminder emails?**
A: You'll receive reminders at the following milestones:
- Day 7: Welcome and feature overview
- Day 30: Mid-trial check-in (30 days remaining)
- Day 46: Upgrade reminder (14 days remaining)
- Day 53: Upgrade reminder (7 days remaining)
- Day 57: Urgent reminder (3 days remaining)
- Day 59: Final reminder (1 day remaining)
- Day 60: Trial expired notification

**Q: Can I downgrade my plan?**
A: Yes, contact Synozur support to downgrade. Note that downgrading may result in loss of access to certain features and data.

**Q: Do unused analyses roll over to the next month?**
A: No, analysis credits reset monthly and do not roll over. Upgrade to Pro/Enterprise for unlimited analyses.

---

## Appendices

### Glossary

**Analysis**: AI-powered competitive intelligence assessment of a competitor's positioning, messaging, and strategy.

**Battlecard**: Sales enablement document providing competitive comparison, objection handling, and talk tracks.

**Company Profile**: Your organization's baseline information used for competitive comparisons.

**Competitor**: An organization you're tracking for competitive intelligence.

**Consultant**: Read-only role for Synozur staff with cross-tenant access.

**Domain Admin**: Organization administrator with team management and settings access.

**Global Admin**: Synozur platform administrator with full cross-tenant access.

**Grounding Document**: Internal documents (PDFs, Word files) providing context to AI for more accurate analysis.

**GTM Plan**: Go-to-market strategy document generated for projects.

**Project**: Organized collection of competitors and analysis for a specific initiative or client.

**Quick Refresh**: Fast competitor data update without AI analysis.

**Standard User**: Default user role with basic competitive intelligence access.

**Tenant**: Organization or company instance within Orbit (based on email domain).

### Keyboard Shortcuts

- **Ctrl+K / Cmd+K**: Open command palette (if available)
- **Ctrl+R / Cmd+R**: Refresh page
- **Esc**: Close dialogs and modals

### Browser Compatibility

**Recommended Browsers:**
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

**Not Supported:**
- Internet Explorer
- Opera Mini
- Older browser versions

### System Requirements

- **Internet Connection**: Required for all functionality
- **Screen Resolution**: Minimum 1280x720, recommended 1920x1080
- **JavaScript**: Must be enabled
- **Cookies**: Must be enabled for authentication

### Getting Help

**Documentation:**
- This User Guide (user_guide.MD)
- In-app tooltips and help icons
- Changelog (changelog.md) for new features

**Support Channels:**
- Email: support@synozur.com
- Enterprise customers: Dedicated support contact
- Sales inquiries: sales@synozur.com

**Training Resources:**
- Video tutorials (coming soon)
- Webinars (scheduled quarterly)
- Best practices guides (available on request)

---

## Conclusion

Synozur Orbit empowers your team with AI-driven competitive intelligence, enabling data-informed strategic decisions. Whether you're in marketing, sales, product, or leadership, Orbit provides the insights you need to stay ahead of your competition.

**Next Steps:**
1. Complete your company profile setup
2. Add your top 3 competitors
3. Run your first full analysis
4. Generate your first battlecard
5. Invite your team members

**Need Help?** Contact Synozur support at support@synozur.com

---

*Document Version: 1.1*  
*Last Updated: January 2026*  
*For the latest updates, see changelog.md*
