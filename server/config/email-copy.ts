// Centralized Email Copy Configuration
// All email text content is managed here for easy maintenance and updates

export const EMAIL_CONFIG = {
  branding: {
    productName: 'Orbit',
    companyName: 'The Synozur Alliance',
    supportEmail: 'contactus@synozur.com',
    productUrl: 'https://orbit.synozur.com',
    appUrl: 'https://orbit.synozur.com/app',
    headerImageUrl: 'https://orbit.synozur.com/images/email-header.jpg',
  },
  
  expiry: {
    verificationLink: '24 hours',
    inviteLink: '7 days',
    passwordResetLink: '1 hour',
  },
};

// Helper to interpolate variables in templates
export function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(vars[key] ?? ''));
}

// ============================================
// VERIFICATION EMAIL
// ============================================
export const VERIFICATION_EMAIL = {
  subject: 'Verify your email address - Orbit by Synozur',
  heading: 'Verify your email address',
  greeting: (name: string) => `Hi <span class="highlight">${name}</span>,`,
  body: `Thank you for signing up for Orbit! To complete your registration and set up your organization, please verify your email address by clicking the button below:`,
  buttonText: 'Verify Email Address',
  linkInstructions: 'Or copy and paste this link into your browser:',
  expiryNotice: `This verification link will expire in ${EMAIL_CONFIG.expiry.verificationLink}.`,
  postVerification: `Once verified, you'll be set up as the administrator for your organization and can start tracking competitors and generating AI-powered insights.`,
  disclaimer: `If you didn't create an account with Orbit, you can safely ignore this email.`,
  
  plainText: (name: string, verificationLink: string) => `
Hi ${name},

Thank you for signing up for Orbit! To complete your registration and set up your organization, please verify your email address by clicking the link below:

${verificationLink}

This verification link will expire in ${EMAIL_CONFIG.expiry.verificationLink}.

Once verified, you'll be set up as the administrator for your organization and can start tracking competitors and generating AI-powered insights.

If you didn't create an account with Orbit, you can safely ignore this email.

© ${new Date().getFullYear()} ${EMAIL_CONFIG.branding.companyName}, LLC. All rights reserved.
  `.trim(),
};

// ============================================
// WELCOME EMAIL
// ============================================
export const WELCOME_EMAIL = {
  subject: (companyName: string) => `Welcome to Orbit - ${companyName} is ready!`,
  heading: (name: string) => `Welcome to Orbit, ${name}!`,
  body: (companyName: string) => `Your email has been verified and <span class="highlight">${companyName}</span> is now set up on Orbit. As the organization administrator, you can invite team members and manage your competitive intelligence.`,
  nextStepsIntro: `Here's what you can do next:`,
  features: [
    {
      title: '1. Add Competitors',
      description: 'Enter competitor URLs and Orbit will automatically analyze their positioning and messaging.',
    },
    {
      title: '2. Upload Your Positioning Docs',
      description: 'Add your messaging guidelines, brand docs, or pitch decks for AI-powered comparison.',
    },
    {
      title: '3. Run AI Analysis',
      description: 'Let Claude analyze your positioning vs competitors and identify gaps and opportunities.',
    },
  ],
  buttonText: 'Get Started',
  
  plainText: (name: string, companyName: string) => 
    `Welcome to Orbit, ${name}! Your email has been verified and ${companyName} is now set up. Get started at ${EMAIL_CONFIG.branding.appUrl}`,
};

// ============================================
// TEAM INVITE EMAIL
// ============================================
export const TEAM_INVITE_EMAIL = {
  subject: (inviterName: string, companyName: string) => `${inviterName} invited you to join ${companyName} on Orbit`,
  heading: (companyName: string) => `You've been invited to join ${companyName} on Orbit`,
  body: (inviterName: string) => `<span class="highlight">${inviterName}</span> has invited you to join their team on Orbit, the AI-powered competitive intelligence platform.`,
  capabilitiesIntro: `As a team member, you'll be able to:`,
  features: [
    {
      title: 'Track Competitors',
      description: 'Monitor competitor websites, social media, and messaging in real-time.',
    },
    {
      title: 'Access AI Insights',
      description: 'Get AI-powered recommendations and gap analysis powered by Claude.',
    },
    {
      title: 'Generate Reports',
      description: 'Create branded PDF reports for stakeholders and leadership.',
    },
  ],
  buttonText: 'Accept Invitation',
  linkInstructions: 'Or copy and paste this link into your browser:',
  expiryNotice: `This invitation link will expire in ${EMAIL_CONFIG.expiry.inviteLink}.`,
  
  plainText: (inviterName: string, companyName: string, inviteLink: string) =>
    `${inviterName} has invited you to join ${companyName} on Orbit. Accept your invitation: ${inviteLink}`,
};

// ============================================
// USER PROVISIONED WELCOME EMAIL (Entra ID)
// ============================================
export const USER_PROVISIONED_EMAIL = {
  subject: (companyName: string) => `You've been added to ${companyName} on Orbit`,
  heading: 'Welcome to Orbit!',
  greeting: (name: string) => `Hi <span class="highlight">${name}</span>,`,
  body: (addedByName: string, companyName: string, role: string) => 
    `<span class="highlight">${addedByName}</span> has added you to <span class="highlight">${companyName}</span>'s team on Orbit, our AI-powered competitive intelligence platform. Your role has been set to <span class="highlight">${role}</span>.`,
  gettingStartedTitle: 'Getting Started',
  gettingStartedBody: 'Since your organization uses Microsoft Entra ID for sign-in, you can access Orbit using your work account. Simply click the button below and sign in with your Microsoft credentials:',
  buttonText: 'Sign In to Orbit',
  capabilitiesTitle: 'What can you do in Orbit?',
  features: [
    {
      title: 'Track Competitors',
      description: 'Monitor competitor websites, social media presence, and messaging strategies in real-time.',
    },
    {
      title: 'AI-Powered Analysis',
      description: 'Get intelligent recommendations and gap analysis powered by Claude AI to strengthen your positioning.',
    },
    {
      title: 'Battle Cards',
      description: 'Access dynamically generated competitive battle cards with key differentiators and talk tracks.',
    },
    {
      title: 'Generate Reports',
      description: 'Create branded PDF reports for stakeholders, leadership, and sales teams.',
    },
  ],
  helpText: (guideLink: string) => `<strong>Need help?</strong> Check out our <a href="${guideLink}" class="link" style="font-size: 15px;">User Guide</a> for step-by-step instructions on using Orbit effectively.`,
  disclaimer: 'If you have any questions, reach out to your administrator or contact support.',
  
  plainText: (name: string, addedByName: string, companyName: string, role: string, loginLink: string, guideLink: string) => `
Hi ${name},

${addedByName} has added you to ${companyName}'s team on Orbit, our AI-powered competitive intelligence platform. Your role has been set to ${role}.

Getting Started:
Since your organization uses Microsoft Entra ID for sign-in, you can access Orbit using your work account. Simply visit ${loginLink} and sign in with your Microsoft credentials.

What can you do in Orbit?
- Track Competitors: Monitor competitor websites, social media presence, and messaging strategies.
- AI-Powered Analysis: Get intelligent recommendations and gap analysis powered by Claude AI.
- Battle Cards: Access dynamically generated competitive battle cards with key differentiators.
- Generate Reports: Create branded PDF reports for stakeholders and leadership.

Need help? Check out our User Guide at ${guideLink}

If you have any questions, reach out to your administrator or contact support.

© ${new Date().getFullYear()} ${EMAIL_CONFIG.branding.companyName}, LLC. All rights reserved.
  `.trim(),
};

// ============================================
// PASSWORD RESET EMAIL
// ============================================
export const PASSWORD_RESET_EMAIL = {
  subject: 'Reset your password - Orbit by Synozur',
  heading: 'Reset your password',
  greeting: (name: string) => `Hi <span class="highlight">${name}</span>,`,
  body: 'We received a request to reset your password for your Orbit account. Click the button below to create a new password:',
  buttonText: 'Reset Password',
  linkInstructions: 'Or copy and paste this link into your browser:',
  expiryNotice: `This link will expire in ${EMAIL_CONFIG.expiry.passwordResetLink} for security reasons.`,
  disclaimer: `If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.`,
  
  plainText: (name: string, resetLink: string) =>
    `Hi ${name}, Reset your Orbit password: ${resetLink}. This link expires in ${EMAIL_CONFIG.expiry.passwordResetLink}.`,
};

// ============================================
// TRIAL REMINDER EMAILS
// ============================================
export const TRIAL_REMINDER_EMAILS = {
  day7: {
    subject: (name: string) => `How's your first week with Orbit, ${name}?`,
    heading: 'Your First Week with Orbit',
    greeting: (name: string) => `Hi <span class="highlight">${name}</span>,`,
    intro: `You've been exploring Orbit for a week now! We hope you're discovering valuable insights about your competitive landscape.`,
    tipsTitle: 'Quick tips to get more value:',
    features: [
      {
        title: 'Add more competitors',
        description: 'The more competitors you track, the richer your competitive intelligence becomes.',
      },
      {
        title: 'Upload positioning documents',
        description: 'Add your brand guidelines or pitch decks to get AI-powered gap analysis.',
      },
      {
        title: 'Generate a report',
        description: 'Create a branded PDF report to share insights with your team or leadership.',
      },
    ],
    closing: (daysRemaining: number) => `You have <span class="highlight">${daysRemaining} days</span> remaining in your trial. Make the most of it!`,
    includeContactCta: false,
  },
  
  day30: {
    subject: (name: string) => `You're halfway through your Orbit trial, ${name}`,
    heading: 'Halfway Through Your Trial',
    greeting: (name: string) => `Hi <span class="highlight">${name}</span>,`,
    intro: `You've reached the midpoint of your 60-day Orbit trial! By now, you should have a solid understanding of how your competitive landscape looks.`,
    tipsTitle: 'Have you tried these features yet?',
    features: [
      {
        title: 'AI Battle Cards',
        description: 'Generate competitive battle cards with key differentiators and talk tracks for your sales team.',
      },
      {
        title: 'Change Monitoring',
        description: 'Track when competitors update their websites or social media presence.',
      },
      {
        title: 'Side-by-Side Comparison',
        description: 'See how your messaging stacks up against each competitor.',
      },
    ],
    closing: (daysRemaining: number) => `You have <span class="highlight">${daysRemaining} days</span> remaining to explore everything Orbit has to offer.`,
    includeContactCta: false,
  },
  
  day46: {
    subject: '14 days left in your Orbit trial',
    heading: 'Your Trial Ends in 14 Days',
    greeting: (name: string) => `Hi <span class="highlight">${name}</span>,`,
    intro: (companyName: string) => `Your Orbit trial for <span class="highlight">${companyName}</span> will end in <span class="highlight">14 days</span>. After your trial expires, your account will transition to our Free tier with limited functionality.`,
    tipsTitle: 'What happens after your trial?',
    features: [
      {
        title: 'Free Tier Limitations',
        description: `You'll be limited to 1 competitor and 1 analysis. Premium features like battle cards and change monitoring will be unavailable.`,
      },
      {
        title: 'Your Data is Safe',
        description: 'All your existing analysis, reports, and competitor data will remain accessible.',
      },
    ],
    includeContactCta: true,
  },
  
  day53: {
    subject: '7 days left - Your Orbit trial is ending soon',
    heading: 'Only 7 Days Left',
    greeting: (name: string) => `Hi <span class="highlight">${name}</span>,`,
    intro: (companyName: string) => `Your Orbit trial for <span class="highlight">${companyName}</span> expires in just <span class="highlight">7 days</span>. This is a great time to generate any reports or battle cards you'd like to keep.`,
    tipsTitle: 'Before your trial ends:',
    features: [
      {
        title: 'Download Reports',
        description: 'Generate and download any PDF reports you want to keep for your records.',
      },
      {
        title: 'Export Battle Cards',
        description: 'Save your competitive battle cards before transitioning to the Free tier.',
      },
    ],
    includeContactCta: true,
  },
  
  day57: {
    subject: '3 days left - Your Orbit trial is almost over',
    heading: 'Only 3 Days Remaining',
    greeting: (name: string) => `Hi <span class="highlight">${name}</span>,`,
    intro: (companyName: string) => `Your Orbit trial for <span class="highlight">${companyName}</span> ends in <span class="highlight">3 days</span>. After that, your account will automatically transition to the Free tier.`,
    closing: `If you've found value in Orbit's competitive intelligence capabilities, we'd love to continue working with you.`,
    includeContactCta: true,
  },
  
  day59: {
    subject: 'Tomorrow: Your Orbit trial expires',
    heading: 'Your Trial Ends Tomorrow',
    greeting: (name: string) => `Hi <span class="highlight">${name}</span>,`,
    intro: (companyName: string) => `This is a final reminder that your Orbit trial for <span class="highlight">${companyName}</span> expires <span class="highlight">tomorrow</span>.`,
    postTrialNote: `After your trial ends, you'll still have access to Orbit on our Free tier, but with limited functionality (1 competitor, 1 analysis).`,
    closing: `If you want to continue using all of Orbit's features, reach out to us today.`,
    includeContactCta: true,
  },
  
  day60: {
    subject: 'Your Orbit trial has ended',
    heading: 'Your Trial Has Expired',
    greeting: (name: string) => `Hi <span class="highlight">${name}</span>,`,
    intro: (companyName: string) => `Your 60-day Orbit trial for <span class="highlight">${companyName}</span> has ended. Your account has been transitioned to the Free tier.`,
    transitionNote: `Your account has been transitioned to our <span class="highlight">Free tier</span>. You can still access Orbit with limited functionality:`,
    tipsTitle: 'What this means:',
    features: [
      {
        title: 'Limited Access',
        description: 'You can now track 1 competitor and run 1 analysis. Premium features are no longer available.',
      },
      {
        title: 'Data Preserved',
        description: 'All your existing data, reports, and analysis remain accessible in read-only mode.',
      },
    ],
    closing: `We'd love to hear about your experience and how we can better serve your competitive intelligence needs.`,
    includeContactCta: true,
  },
  
  // Contact CTA shown in final 14 days
  contactCta: {
    title: 'Ready to upgrade?',
    body: `If you'd like to continue using Orbit's full competitive intelligence capabilities, we'd be happy to discuss how we can support your organization.`,
    description: (contactEmail: string) => `Contact us at <a href="mailto:${contactEmail}" class="link" style="font-size: 14px;">${contactEmail}</a> to discuss upgrading to a Pro or Enterprise plan.`,
  },
  
  // Common elements
  loginButton: 'Log in to Orbit',
  footerContact: (contactEmail: string) => `If you have any questions, contact us at <a href="mailto:${contactEmail}" class="link">${contactEmail}</a>.`,
  
  // Plain text templates for trial reminders
  plainText: {
    general: (name: string, heading: string, daysRemaining: number, companyName: string, loginLink: string, contactEmail: string, includeContactCta: boolean) => {
      const contactText = includeContactCta 
        ? `\n\nTo continue using Orbit's full features, contact us at ${contactEmail}.`
        : '';
      return `Hi ${name},\n\n${heading}\n\nYou have ${daysRemaining} days remaining in your Orbit trial for ${companyName}.${contactText}\n\nLog in: ${loginLink}\n\nContact: ${contactEmail}`;
    },
  },
};

// ============================================
// WEEKLY DIGEST EMAIL
// ============================================
export const WEEKLY_DIGEST_EMAIL = {
  subject: (companyName: string) => `Weekly Competitive Intelligence Update - ${companyName}`,
  heading: 'Your Weekly Competitive Update',
  greeting: (name: string) => `Hi <span class="highlight">${name}</span>,`,
  intro: `Here's what changed in your competitive landscape this week:`,
  noChangesHeading: 'All Quiet This Week',
  noChangesMessage: `No significant competitor changes were detected this week. We'll keep monitoring and alert you when something important happens.`,
  changesFoundHeading: (count: number) => `${count} Update${count === 1 ? '' : 's'} Detected`,
  websiteChangeLabel: 'Website Change',
  socialUpdateLabel: 'Social Update',
  blogPostLabel: 'Blog Post',
  buttonText: 'View Full Details',
  unsubscribeText: 'Manage your notification preferences',
  footerMessage: `You're receiving this email because you opted in to weekly competitive intelligence digests.`,
  plainText: (name: string, companyName: string, changesSummary: string, loginLink: string, settingsLink: string) => 
    `Hi ${name},\n\nYour Weekly Competitive Update for ${companyName}\n\n${changesSummary}\n\nView full details: ${loginLink}\n\nTo unsubscribe from weekly digests, update your preferences: ${settingsLink}`,
};

// ============================================
// COMPETITOR ALERT EMAIL (FUTURE)
// ============================================
export const COMPETITOR_ALERT_EMAIL = {
  subject: (competitorName: string) => `Alert: ${competitorName} has made significant changes`,
  heading: (competitorName: string) => `Competitor Update: ${competitorName}`,
  greeting: (name: string) => `Hi <span class="highlight">${name}</span>,`,
  intro: (competitorName: string) => `We detected significant changes on <span class="highlight">${competitorName}</span>'s website:`,
  buttonText: 'View Changes',
  unsubscribeText: 'Manage your alert preferences',
};
