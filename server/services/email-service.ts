// SendGrid Email Service - Using Replit SendGrid Integration
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

export async function sendVerificationEmail(
  email: string, 
  name: string, 
  verificationToken: string,
  baseUrl: string
): Promise<boolean> {
  const verificationLink = `${baseUrl}/api/auth/verify-email?token=${verificationToken}`;
  
  const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0a0a0a; color: #ffffff; margin: 0; padding: 40px 20px; }
    .container { max-width: 600px; margin: 0 auto; background: #1a1a1a; border-radius: 12px; padding: 40px; border: 1px solid #333; }
    .logo { text-align: center; margin-bottom: 30px; }
    .logo img { height: 48px; }
    h1 { color: #ffffff; font-size: 24px; margin-bottom: 20px; }
    p { color: #a0a0a0; line-height: 1.6; margin-bottom: 20px; }
    .button { display: inline-block; background: linear-gradient(135deg, #810FFB, #E60CB3); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; margin: 20px 0; }
    .button:hover { opacity: 0.9; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #333; text-align: center; color: #666; font-size: 12px; }
    .link { color: #810FFB; word-break: break-all; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">
      <h2 style="color: #810FFB; margin: 0;">Orbit</h2>
      <p style="color: #666; margin: 5px 0 0 0; font-size: 12px;">by The Synozur Alliance</p>
    </div>
    
    <h1>Verify your email address</h1>
    
    <p>Hi ${name},</p>
    
    <p>Thank you for signing up for Orbit! To complete your registration and set up your organization, please verify your email address by clicking the button below:</p>
    
    <div style="text-align: center;">
      <a href="${verificationLink}" class="button">Verify Email Address</a>
    </div>
    
    <p>Or copy and paste this link into your browser:</p>
    <p class="link">${verificationLink}</p>
    
    <p>This verification link will expire in 24 hours.</p>
    
    <p>Once verified, you'll be set up as the administrator for your organization and can start tracking competitors and generating AI-powered insights.</p>
    
    <div class="footer">
      <p>© ${new Date().getFullYear()} The Synozur Alliance, LLC. All rights reserved.</p>
      <p>If you didn't create an account with Orbit, you can safely ignore this email.</p>
    </div>
  </div>
</body>
</html>
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
    html,
    text
  });
}

export async function sendWelcomeEmail(email: string, name: string, companyName: string): Promise<boolean> {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0a0a0a; color: #ffffff; margin: 0; padding: 40px 20px; }
    .container { max-width: 600px; margin: 0 auto; background: #1a1a1a; border-radius: 12px; padding: 40px; border: 1px solid #333; }
    .logo { text-align: center; margin-bottom: 30px; }
    h1 { color: #ffffff; font-size: 24px; margin-bottom: 20px; }
    p { color: #a0a0a0; line-height: 1.6; margin-bottom: 20px; }
    .button { display: inline-block; background: linear-gradient(135deg, #810FFB, #E60CB3); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; margin: 20px 0; }
    .feature { background: #252525; padding: 16px; border-radius: 8px; margin-bottom: 12px; }
    .feature-title { color: #ffffff; font-weight: 600; margin-bottom: 4px; }
    .feature-desc { color: #888; font-size: 14px; margin: 0; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #333; text-align: center; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">
      <h2 style="color: #810FFB; margin: 0;">Orbit</h2>
      <p style="color: #666; margin: 5px 0 0 0; font-size: 12px;">by The Synozur Alliance</p>
    </div>
    
    <h1>Welcome to Orbit, ${name}!</h1>
    
    <p>Your email has been verified and ${companyName} is now set up on Orbit. As the organization administrator, you can invite team members and manage your competitive intelligence.</p>
    
    <p><strong>Here's what you can do next:</strong></p>
    
    <div class="feature">
      <div class="feature-title">1. Add Competitors</div>
      <p class="feature-desc">Enter competitor URLs and Orbit will automatically analyze their positioning.</p>
    </div>
    
    <div class="feature">
      <div class="feature-title">2. Upload Your Positioning Docs</div>
      <p class="feature-desc">Add your messaging guidelines, brand docs, or pitch decks for comparison.</p>
    </div>
    
    <div class="feature">
      <div class="feature-title">3. Run AI Analysis</div>
      <p class="feature-desc">Let Claude analyze your positioning vs competitors in real-time.</p>
    </div>
    
    <div style="text-align: center;">
      <a href="https://orbit.synozur.com/app" class="button">Get Started</a>
    </div>
    
    <div class="footer">
      <p>© ${new Date().getFullYear()} The Synozur Alliance, LLC. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
  `;

  return sendEmail({
    to: email,
    subject: `Welcome to Orbit - ${companyName} is ready!`,
    html,
    text: `Welcome to Orbit, ${name}! Your email has been verified and ${companyName} is now set up. Get started at https://orbit.synozur.com/app`
  });
}
