// SendGrid Email Service - Using Replit SendGrid Integration
// Email styling inspired by Vega by The Synozur Alliance
import sgMail from '@sendgrid/mail';

let connectionSettings: any;

async function getCredentials() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=sendgrid',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  if (!connectionSettings || (!connectionSettings.settings.api_key || !connectionSettings.settings.from_email)) {
    throw new Error('SendGrid not connected');
  }
  return { apiKey: connectionSettings.settings.api_key, email: connectionSettings.settings.from_email };
}

async function getUncachableSendGridClient() {
  const { apiKey, email } = await getCredentials();
  sgMail.setApiKey(apiKey);
  return {
    client: sgMail,
    fromEmail: email
  };
}

export interface EmailOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

export async function sendEmail(options: EmailOptions): Promise<boolean> {
  try {
    const { client, fromEmail } = await getUncachableSendGridClient();
    
    await client.send({
      to: options.to,
      from: fromEmail,
      subject: options.subject,
      text: options.text || '',
      html: options.html || options.text || '',
    });
    
    console.log(`Email sent successfully to ${options.to}`);
    return true;
  } catch (error: any) {
    console.error('Failed to send email:', error.message);
    return false;
  }
}

// Standard email header image URL
const EMAIL_HEADER_IMAGE_URL = 'https://storage.googleapis.com/replit-objstore-7732f445-e623-487e-959c-af350317396c/public/email-header.jpg';

// Common email template wrapper with Vega-inspired Synozur branding
export function wrapEmailContent(content: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; 
      background-color: #0f0f0f; 
      color: #ffffff; 
      margin: 0; 
      padding: 0;
      -webkit-font-smoothing: antialiased;
    }
    .email-wrapper {
      background-color: #0f0f0f;
      padding: 40px 20px;
    }
    .container { 
      max-width: 600px; 
      margin: 0 auto; 
      background: linear-gradient(180deg, #1a1a2e 0%, #16162a 100%);
      border-radius: 16px; 
      overflow: hidden;
      border: 1px solid rgba(129, 15, 251, 0.2);
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
    }
    .header-image {
      width: 100%;
      display: block;
      height: auto;
    }
    .header {
      background: linear-gradient(135deg, #1a1a2e 0%, #0f0f1a 100%);
      padding: 32px 40px;
      text-align: center;
      border-bottom: 1px solid rgba(129, 15, 251, 0.15);
    }
    .header-logo {
      display: inline-block;
    }
    .logo-orbit {
      font-size: 32px;
      font-weight: 700;
      background: linear-gradient(135deg, #818CF8 0%, #A78BFA 50%, #C084FC 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin: 0;
      letter-spacing: -0.5px;
    }
    .logo-tagline {
      color: #6B7280;
      font-size: 12px;
      margin: 6px 0 0 0;
      letter-spacing: 0.5px;
    }
    .content { 
      padding: 40px; 
    }
    h1 { 
      color: #ffffff; 
      font-size: 24px; 
      font-weight: 600;
      margin: 0 0 24px 0; 
      line-height: 1.3;
    }
    p { 
      color: #9CA3AF; 
      line-height: 1.7; 
      margin: 0 0 20px 0;
      font-size: 15px;
    }
    .button-container {
      text-align: center;
      margin: 32px 0;
    }
    .button { 
      display: inline-block; 
      background: linear-gradient(135deg, #818CF8 0%, #A78BFA 50%, #C084FC 100%);
      color: #ffffff !important; 
      text-decoration: none; 
      padding: 16px 36px; 
      border-radius: 10px; 
      font-weight: 600; 
      font-size: 15px;
      letter-spacing: 0.3px;
      transition: all 0.2s ease;
      box-shadow: 0 4px 14px rgba(129, 15, 251, 0.35);
    }
    .button:hover { 
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(129, 15, 251, 0.45);
    }
    .feature-list {
      margin: 28px 0;
    }
    .feature { 
      background: rgba(129, 15, 251, 0.08);
      border: 1px solid rgba(129, 15, 251, 0.15);
      padding: 20px; 
      border-radius: 12px; 
      margin-bottom: 14px; 
    }
    .feature-title { 
      color: #ffffff; 
      font-weight: 600; 
      margin: 0 0 6px 0;
      font-size: 15px;
    }
    .feature-desc { 
      color: #9CA3AF; 
      font-size: 14px; 
      margin: 0;
      line-height: 1.5;
    }
    .divider {
      height: 1px;
      background: linear-gradient(90deg, transparent 0%, rgba(129, 15, 251, 0.3) 50%, transparent 100%);
      margin: 32px 0;
    }
    .footer { 
      padding: 28px 40px;
      background: #0f0f1a;
      border-top: 1px solid rgba(129, 15, 251, 0.1);
      text-align: center;
    }
    .footer p {
      color: #6B7280;
      font-size: 12px;
      margin: 0 0 8px 0;
    }
    .footer a {
      color: #818CF8;
      text-decoration: none;
    }
    .link { 
      color: #818CF8;
      word-break: break-all;
      font-size: 13px;
    }
    .highlight {
      color: #ffffff;
      font-weight: 500;
    }
    .muted {
      color: #6B7280;
    }
  </style>
</head>
<body>
  <div class="email-wrapper">
    <div class="container">
      <img src="${EMAIL_HEADER_IMAGE_URL}" alt="Synozur Alliance" class="header-image" />
      <div class="header">
        <div class="header-logo">
          <h2 class="logo-orbit">Orbit</h2>
          <p class="logo-tagline">by The Synozur Alliance</p>
        </div>
      </div>
      <div class="content">
        ${content}
      </div>
      <div class="footer">
        <p>© ${new Date().getFullYear()} The Synozur Alliance, LLC. All rights reserved.</p>
        <p><a href="https://orbit.synozur.com">orbit.synozur.com</a></p>
      </div>
    </div>
  </div>
</body>
</html>
  `;
}

export async function sendVerificationEmail(
  email: string, 
  name: string, 
  verificationToken: string,
  baseUrl: string
): Promise<boolean> {
  const verificationLink = `${baseUrl}/api/auth/verify-email?token=${verificationToken}`;
  
  const content = `
    <h1>Verify your email address</h1>
    
    <p>Hi <span class="highlight">${name}</span>,</p>
    
    <p>Thank you for signing up for Orbit! To complete your registration and set up your organization, please verify your email address by clicking the button below:</p>
    
    <div class="button-container">
      <a href="${verificationLink}" class="button">Verify Email Address</a>
    </div>
    
    <div class="divider"></div>
    
    <p class="muted">Or copy and paste this link into your browser:</p>
    <p class="link">${verificationLink}</p>
    
    <p class="muted" style="margin-top: 24px;">This verification link will expire in 24 hours.</p>
    
    <p>Once verified, you'll be set up as the administrator for your organization and can start tracking competitors and generating AI-powered insights.</p>
    
    <p class="muted" style="font-size: 13px; margin-top: 32px;">If you didn't create an account with Orbit, you can safely ignore this email.</p>
  `;

  const text = `
Hi ${name},

Thank you for signing up for Orbit! To complete your registration and set up your organization, please verify your email address by clicking the link below:

${verificationLink}

This verification link will expire in 24 hours.

Once verified, you'll be set up as the administrator for your organization and can start tracking competitors and generating AI-powered insights.

If you didn't create an account with Orbit, you can safely ignore this email.

© ${new Date().getFullYear()} The Synozur Alliance, LLC. All rights reserved.
  `;

  return sendEmail({
    to: email,
    subject: 'Verify your email address - Orbit by Synozur',
    html: wrapEmailContent(content),
    text
  });
}

export async function sendWelcomeEmail(email: string, name: string, companyName: string): Promise<boolean> {
  const content = `
    <h1>Welcome to Orbit, ${name}!</h1>
    
    <p>Your email has been verified and <span class="highlight">${companyName}</span> is now set up on Orbit. As the organization administrator, you can invite team members and manage your competitive intelligence.</p>
    
    <p style="color: #ffffff; font-weight: 500; margin-top: 28px;">Here's what you can do next:</p>
    
    <div class="feature-list">
      <div class="feature">
        <div class="feature-title">1. Add Competitors</div>
        <p class="feature-desc">Enter competitor URLs and Orbit will automatically analyze their positioning and messaging.</p>
      </div>
      
      <div class="feature">
        <div class="feature-title">2. Upload Your Positioning Docs</div>
        <p class="feature-desc">Add your messaging guidelines, brand docs, or pitch decks for AI-powered comparison.</p>
      </div>
      
      <div class="feature">
        <div class="feature-title">3. Run AI Analysis</div>
        <p class="feature-desc">Let Claude analyze your positioning vs competitors and identify gaps and opportunities.</p>
      </div>
    </div>
    
    <div class="button-container">
      <a href="https://orbit.synozur.com/app" class="button">Get Started</a>
    </div>
  `;

  return sendEmail({
    to: email,
    subject: `Welcome to Orbit - ${companyName} is ready!`,
    html: wrapEmailContent(content),
    text: `Welcome to Orbit, ${name}! Your email has been verified and ${companyName} is now set up. Get started at https://orbit.synozur.com/app`
  });
}

export async function sendTeamInviteEmail(
  email: string, 
  inviterName: string, 
  companyName: string, 
  inviteToken: string,
  baseUrl: string
): Promise<boolean> {
  const inviteLink = `${baseUrl}/accept-invite?token=${inviteToken}`;
  
  const content = `
    <h1>You've been invited to join ${companyName} on Orbit</h1>
    
    <p><span class="highlight">${inviterName}</span> has invited you to join their team on Orbit, the AI-powered competitive intelligence platform.</p>
    
    <p>As a team member, you'll be able to:</p>
    
    <div class="feature-list">
      <div class="feature">
        <div class="feature-title">Track Competitors</div>
        <p class="feature-desc">Monitor competitor websites, social media, and messaging in real-time.</p>
      </div>
      
      <div class="feature">
        <div class="feature-title">Access AI Insights</div>
        <p class="feature-desc">Get AI-powered recommendations and gap analysis powered by Claude.</p>
      </div>
      
      <div class="feature">
        <div class="feature-title">Generate Reports</div>
        <p class="feature-desc">Create branded PDF reports for stakeholders and leadership.</p>
      </div>
    </div>
    
    <div class="button-container">
      <a href="${inviteLink}" class="button">Accept Invitation</a>
    </div>
    
    <div class="divider"></div>
    
    <p class="muted">Or copy and paste this link into your browser:</p>
    <p class="link">${inviteLink}</p>
    
    <p class="muted" style="margin-top: 24px;">This invitation link will expire in 7 days.</p>
  `;

  return sendEmail({
    to: email,
    subject: `${inviterName} invited you to join ${companyName} on Orbit`,
    html: wrapEmailContent(content),
    text: `${inviterName} has invited you to join ${companyName} on Orbit. Accept your invitation: ${inviteLink}`
  });
}

export async function sendUserProvisionedWelcomeEmail(
  email: string, 
  name: string, 
  companyName: string,
  role: string,
  addedByName: string,
  baseUrl: string
): Promise<boolean> {
  const loginLink = `${baseUrl}/auth/signin`;
  const guideLink = `${baseUrl}/app/guide`;
  
  const content = `
    <h1>Welcome to Orbit!</h1>
    
    <p>Hi <span class="highlight">${name}</span>,</p>
    
    <p><span class="highlight">${addedByName}</span> has added you to <span class="highlight">${companyName}</span>'s team on Orbit, our AI-powered competitive intelligence platform. Your role has been set to <span class="highlight">${role}</span>.</p>
    
    <p style="color: #ffffff; font-weight: 500; margin-top: 28px;">Getting Started</p>
    
    <p>Since your organization uses Microsoft Entra ID for sign-in, you can access Orbit using your work account. Simply click the button below and sign in with your Microsoft credentials:</p>
    
    <div class="button-container">
      <a href="${loginLink}" class="button">Sign In to Orbit</a>
    </div>
    
    <div class="divider"></div>
    
    <p style="color: #ffffff; font-weight: 500;">What can you do in Orbit?</p>
    
    <div class="feature-list">
      <div class="feature">
        <div class="feature-title">Track Competitors</div>
        <p class="feature-desc">Monitor competitor websites, social media presence, and messaging strategies in real-time.</p>
      </div>
      
      <div class="feature">
        <div class="feature-title">AI-Powered Analysis</div>
        <p class="feature-desc">Get intelligent recommendations and gap analysis powered by Claude AI to strengthen your positioning.</p>
      </div>
      
      <div class="feature">
        <div class="feature-title">Battle Cards</div>
        <p class="feature-desc">Access dynamically generated competitive battle cards with key differentiators and talk tracks.</p>
      </div>
      
      <div class="feature">
        <div class="feature-title">Generate Reports</div>
        <p class="feature-desc">Create branded PDF reports for stakeholders, leadership, and sales teams.</p>
      </div>
    </div>
    
    <div class="divider"></div>
    
    <p><strong>Need help?</strong> Check out our <a href="${guideLink}" class="link" style="font-size: 15px;">User Guide</a> for step-by-step instructions on using Orbit effectively.</p>
    
    <p class="muted" style="font-size: 13px; margin-top: 32px;">If you have any questions, reach out to your administrator or contact support.</p>
  `;

  const text = `
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

© ${new Date().getFullYear()} The Synozur Alliance, LLC. All rights reserved.
  `;

  return sendEmail({
    to: email,
    subject: `You've been added to ${companyName} on Orbit`,
    html: wrapEmailContent(content),
    text
  });
}

export async function sendPasswordResetEmail(
  email: string, 
  name: string, 
  resetToken: string,
  baseUrl: string
): Promise<boolean> {
  const resetLink = `${baseUrl}/reset-password?token=${resetToken}`;
  
  const content = `
    <h1>Reset your password</h1>
    
    <p>Hi <span class="highlight">${name}</span>,</p>
    
    <p>We received a request to reset your password for your Orbit account. Click the button below to create a new password:</p>
    
    <div class="button-container">
      <a href="${resetLink}" class="button">Reset Password</a>
    </div>
    
    <div class="divider"></div>
    
    <p class="muted">Or copy and paste this link into your browser:</p>
    <p class="link">${resetLink}</p>
    
    <p class="muted" style="margin-top: 24px;">This link will expire in 1 hour for security reasons.</p>
    
    <p class="muted" style="font-size: 13px; margin-top: 32px;">If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.</p>
  `;

  return sendEmail({
    to: email,
    subject: 'Reset your password - Orbit by Synozur',
    html: wrapEmailContent(content),
    text: `Hi ${name}, Reset your Orbit password: ${resetLink}. This link expires in 1 hour.`
  });
}

// Trial Reminder Email Templates
// 60-day trial with reminders at: day 7, day 30, day 46 (14 left), day 53 (7 left), day 57 (3 left), day 59 (1 left), day 60 (expired)

export type TrialReminderType = 'day7' | 'day30' | 'day46' | 'day53' | 'day57' | 'day59' | 'day60';

interface TrialReminderParams {
  email: string;
  name: string;
  companyName: string;
  daysRemaining: number;
  baseUrl: string;
}

export async function sendTrialReminderEmail(
  params: TrialReminderParams,
  reminderType: TrialReminderType
): Promise<boolean> {
  const { email, name, companyName, daysRemaining, baseUrl } = params;
  const loginLink = `${baseUrl}/auth`;
  const contactEmail = 'contactus@synozur.com';
  
  let subject: string;
  let heading: string;
  let bodyContent: string;
  let includeContactCta: boolean = false;
  
  switch (reminderType) {
    case 'day7':
      subject = `How's your first week with Orbit, ${name}?`;
      heading = `Your First Week with Orbit`;
      bodyContent = `
        <p>Hi <span class="highlight">${name}</span>,</p>
        
        <p>You've been exploring Orbit for a week now! We hope you're discovering valuable insights about your competitive landscape.</p>
        
        <p style="color: #ffffff; font-weight: 500; margin-top: 28px;">Quick tips to get more value:</p>
        
        <div class="feature-list">
          <div class="feature">
            <div class="feature-title">Add more competitors</div>
            <p class="feature-desc">The more competitors you track, the richer your competitive intelligence becomes.</p>
          </div>
          
          <div class="feature">
            <div class="feature-title">Upload positioning documents</div>
            <p class="feature-desc">Add your brand guidelines or pitch decks to get AI-powered gap analysis.</p>
          </div>
          
          <div class="feature">
            <div class="feature-title">Generate a report</div>
            <p class="feature-desc">Create a branded PDF report to share insights with your team or leadership.</p>
          </div>
        </div>
        
        <p style="margin-top: 24px;">You have <span class="highlight">${daysRemaining} days</span> remaining in your trial. Make the most of it!</p>
      `;
      break;
      
    case 'day30':
      subject = `You're halfway through your Orbit trial, ${name}`;
      heading = `Halfway Through Your Trial`;
      bodyContent = `
        <p>Hi <span class="highlight">${name}</span>,</p>
        
        <p>You've reached the midpoint of your 60-day Orbit trial! By now, you should have a solid understanding of how your competitive landscape looks.</p>
        
        <p style="color: #ffffff; font-weight: 500; margin-top: 28px;">Have you tried these features yet?</p>
        
        <div class="feature-list">
          <div class="feature">
            <div class="feature-title">AI Battle Cards</div>
            <p class="feature-desc">Generate competitive battle cards with key differentiators and talk tracks for your sales team.</p>
          </div>
          
          <div class="feature">
            <div class="feature-title">Change Monitoring</div>
            <p class="feature-desc">Track when competitors update their websites or social media presence.</p>
          </div>
          
          <div class="feature">
            <div class="feature-title">Side-by-Side Comparison</div>
            <p class="feature-desc">See how your messaging stacks up against each competitor.</p>
          </div>
        </div>
        
        <p style="margin-top: 24px;">You have <span class="highlight">${daysRemaining} days</span> remaining to explore everything Orbit has to offer.</p>
      `;
      break;
      
    case 'day46':
      subject = `14 days left in your Orbit trial`;
      heading = `Your Trial Ends in 14 Days`;
      includeContactCta = true;
      bodyContent = `
        <p>Hi <span class="highlight">${name}</span>,</p>
        
        <p>Your Orbit trial for <span class="highlight">${companyName}</span> will end in <span class="highlight">14 days</span>. After your trial expires, your account will transition to our Free tier with limited functionality.</p>
        
        <p style="color: #ffffff; font-weight: 500; margin-top: 28px;">What happens after your trial?</p>
        
        <div class="feature-list">
          <div class="feature">
            <div class="feature-title">Free Tier Limitations</div>
            <p class="feature-desc">You'll be limited to 1 competitor and 1 analysis. Premium features like battle cards and change monitoring will be unavailable.</p>
          </div>
          
          <div class="feature">
            <div class="feature-title">Your Data is Safe</div>
            <p class="feature-desc">All your existing analysis, reports, and competitor data will remain accessible.</p>
          </div>
        </div>
      `;
      break;
      
    case 'day53':
      subject = `7 days left - Your Orbit trial is ending soon`;
      heading = `Only 7 Days Left`;
      includeContactCta = true;
      bodyContent = `
        <p>Hi <span class="highlight">${name}</span>,</p>
        
        <p>Your Orbit trial for <span class="highlight">${companyName}</span> expires in just <span class="highlight">7 days</span>. This is a great time to generate any reports or battle cards you'd like to keep.</p>
        
        <p style="color: #ffffff; font-weight: 500; margin-top: 28px;">Before your trial ends:</p>
        
        <div class="feature-list">
          <div class="feature">
            <div class="feature-title">Download your reports</div>
            <p class="feature-desc">Generate and save PDF reports for your records before transitioning to the Free tier.</p>
          </div>
          
          <div class="feature">
            <div class="feature-title">Review your insights</div>
            <p class="feature-desc">Take note of key recommendations and action items from your competitive analysis.</p>
          </div>
        </div>
      `;
      break;
      
    case 'day57':
      subject = `3 days left - Your Orbit trial is almost over`;
      heading = `3 Days Remaining`;
      includeContactCta = true;
      bodyContent = `
        <p>Hi <span class="highlight">${name}</span>,</p>
        
        <p>Your Orbit trial for <span class="highlight">${companyName}</span> ends in <span class="highlight">3 days</span>. After that, your account will automatically transition to the Free tier.</p>
        
        <p style="margin-top: 24px;">If you've found value in Orbit's competitive intelligence capabilities, we'd love to continue working with you.</p>
      `;
      break;
      
    case 'day59':
      subject = `Tomorrow: Your Orbit trial expires`;
      heading = `Your Trial Ends Tomorrow`;
      includeContactCta = true;
      bodyContent = `
        <p>Hi <span class="highlight">${name}</span>,</p>
        
        <p>This is your final reminder: Your Orbit trial for <span class="highlight">${companyName}</span> expires <span class="highlight">tomorrow</span>.</p>
        
        <p style="margin-top: 24px;">After your trial ends, you'll still have access to Orbit on our Free tier, but with limited functionality (1 competitor, 1 analysis).</p>
        
        <p style="margin-top: 24px;">If you want to continue using all of Orbit's features, reach out to us today.</p>
      `;
      break;
      
    case 'day60':
      subject = `Thank you for trying Orbit`;
      heading = `Thank You for Trying Orbit`;
      includeContactCta = true;
      bodyContent = `
        <p>Hi <span class="highlight">${name}</span>,</p>
        
        <p>Your 60-day Orbit trial for <span class="highlight">${companyName}</span> has ended. We hope you found valuable insights about your competitive landscape during your trial.</p>
        
        <p style="margin-top: 24px;">Your account has been transitioned to our <span class="highlight">Free tier</span>. You can still access Orbit with limited functionality:</p>
        
        <div class="feature-list">
          <div class="feature">
            <div class="feature-title">Free Tier Access</div>
            <p class="feature-desc">Track 1 competitor with basic analysis capabilities. Your existing data remains accessible.</p>
          </div>
        </div>
        
        <p style="margin-top: 24px;">We'd love to hear about your experience and how we can better serve your competitive intelligence needs.</p>
      `;
      break;
  }
  
  const contactCtaHtml = includeContactCta ? `
    <div class="divider"></div>
    
    <p style="color: #ffffff; font-weight: 500;">Continue with Orbit</p>
    
    <p>If you'd like to continue using Orbit's full competitive intelligence capabilities, we'd be happy to discuss how we can support your organization. Establish a client relationship with Synozur to maintain access to all features.</p>
    
    <p style="margin-top: 16px;">
      <strong>Contact us:</strong> <a href="mailto:${contactEmail}" class="link">${contactEmail}</a>
    </p>
  ` : '';
  
  const content = `
    <h1>${heading}</h1>
    
    ${bodyContent}
    
    ${contactCtaHtml}
    
    <div class="button-container">
      <a href="${loginLink}" class="button">Log in to Orbit</a>
    </div>
    
    <p class="muted" style="font-size: 13px; margin-top: 32px;">If you have any questions, contact us at <a href="mailto:${contactEmail}" class="link">${contactEmail}</a>.</p>
  `;
  
  const plainTextContact = includeContactCta 
    ? `\n\nTo continue using Orbit's full features, establish a client relationship with Synozur. Contact us at ${contactEmail}.`
    : '';
  
  const text = `Hi ${name},\n\n${heading}\n\nYou have ${daysRemaining} days remaining in your Orbit trial for ${companyName}.${plainTextContact}\n\nLog in: ${loginLink}\n\nContact: ${contactEmail}`;

  return sendEmail({
    to: email,
    subject,
    html: wrapEmailContent(content),
    text
  });
}
