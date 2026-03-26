import type { Express } from "express";
import { randomBytes } from "crypto";
import bcrypt from "bcrypt";
import { storage } from "../storage";
import { getRequestContext, ContextError } from "../context";
import { checkFeatureAccessAsync } from "../services/plan-policy";
import { insertUserSchema } from "@shared/schema";
import { fromError } from "zod-validation-error";
import { syncNewAccountToHubSpot } from "../services/hubspot-service";
import { sendDigestNowForUser } from "../services/scheduled-jobs";

export function registerAuthRoutes(app: Express) {
  
  app.post("/api/register", async (req, res) => {
    try {
      const parsed = insertUserSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: fromError(parsed.error).toString() });
      }

      const { email, password, name, company, companySize, jobTitle, industry, country, avatar } = parsed.data;
      
      // Validate required demographic fields
      const requiredDemographics = { company, companySize, jobTitle, industry, country };
      for (const [field, value] of Object.entries(requiredDemographics)) {
        if (!value || !value.trim()) {
          return res.status(400).json({ error: `${field} is required` });
        }
      }
      
      // Check if user already exists
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ error: "User already exists with this email" });
      }

      // Determine role based on business logic
      // SECURITY: Consultant and Global Admin are privileged roles assigned only by existing admins
      // Domain Admin is auto-assigned to the FIRST user who creates a new tenant (self-service account owner)
      const domain = email.split("@")[1].toLowerCase();
      
      // Check if tenant already exists for this domain
      const existingTenantForDomain = await storage.getTenantByDomain(domain);
      
      // If no tenant exists, check if domain is blocked
      if (!existingTenantForDomain) {
        const isBlocked = await storage.isdomainBlocked(domain);
        if (isBlocked) {
          return res.status(403).json({ 
            error: "This email domain is not allowed for self-registration. Please contact your administrator to set up your organization." 
          });
        }
      }
      
      // First user for a new domain becomes Domain Admin (can configure their account)
      // Subsequent users get Standard User role
      let role = existingTenantForDomain ? "Standard User" : "Domain Admin";

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Create user first
      const user = await storage.createUser({
        email,
        password: hashedPassword,
        name,
        company,
        companySize,
        jobTitle,
        industry,
        country,
        avatar,
        role
      });

      // Create tenant for this domain if it doesn't exist (after user creation to ensure consistency)
      if (!existingTenantForDomain) {
        const trialStartDate = new Date();
        const trialEndsAt = new Date(trialStartDate);
        trialEndsAt.setDate(trialEndsAt.getDate() + 60);
        
        const newTenant = await storage.createTenant({
          domain,
          name: company,
          plan: "trial",
          status: "active",
          trialStartDate,
          trialEndsAt,
          userCount: 0,
          competitorLimit: 3,
          analysisLimit: 5,
        });
        
        // Create default market for the new tenant
        await storage.createMarket({
          tenantId: newTenant.id,
          name: "Default",
          description: `Default market for ${company}`,
          isDefault: true,
          status: "active",
          createdBy: user.id,
        });
      }

      // Sync to HubSpot CRM (async, don't block signup)
      const nameParts = name.split(' ');
      const firstName = nameParts[0] || name;
      const lastName = nameParts.slice(1).join(' ') || '';
      syncNewAccountToHubSpot({
        email,
        firstName,
        lastName,
        companyName: company,
        companyDomain: domain,
        jobTitle: jobTitle || undefined,
        industry: industry || undefined,
        companySize: companySize || undefined,
        country: country || undefined,
        plan: 'trial',
      }).catch(err => console.error('[HubSpot] Background sync failed:', err));

      // Set session
      req.session.userId = user.id;

      // Don't send password back
      const { password: _, ...userWithoutPassword } = user;
      res.json(userWithoutPassword);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/login", async (req, res) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
      }

      const user = await storage.getUserByEmail(email);
      if (!user) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      if (user.authProvider === "entra") {
        return res.status(401).json({ error: "Please use Microsoft SSO to sign in" });
      }

      const validPassword = await bcrypt.compare(password, user.password);
      if (!validPassword) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      req.session.userId = user.id;

      const { password: _, ...userWithoutPassword } = user;
      res.json(userWithoutPassword);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: "Could not log out" });
      }
      res.json({ success: true });
    });
  });

  // Forgot password - request reset link
  app.post("/api/auth/forgot-password", async (req, res) => {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({ error: "Email is required" });
      }

      const user = await storage.getUserByEmail(email);
      
      // Always return success to prevent email enumeration attacks
      if (!user) {
        return res.json({ success: true, message: "If an account exists, a reset link has been sent" });
      }

      // SSO users can't reset password through this flow
      if (user.authProvider === "entra") {
        return res.json({ success: true, message: "If an account exists, a reset link has been sent" });
      }

      // Generate reset token
      const token = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await storage.createPasswordResetToken({
        token,
        userId: user.id,
        email: user.email,
        expiresAt,
      });

      // Send email
      const protocol = req.headers["x-forwarded-proto"] || "http";
      const host = req.headers.host;
      const baseUrl = `${protocol}://${host}`;

      const { sendPasswordResetEmail } = await import("../services/email-service");
      await sendPasswordResetEmail(user.email, user.name, token, baseUrl);

      res.json({ success: true, message: "If an account exists, a reset link has been sent" });
    } catch (error: any) {
      console.error("[Forgot Password] Error:", error);
      res.status(500).json({ error: "Failed to process request" });
    }
  });

  // Reset password - verify token and set new password
  app.post("/api/auth/reset-password", async (req, res) => {
    try {
      const { token, newPassword } = req.body;

      if (!token || !newPassword) {
        return res.status(400).json({ error: "Token and new password are required" });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters" });
      }

      const resetToken = await storage.getPasswordResetToken(token);
      
      if (!resetToken) {
        return res.status(400).json({ error: "Invalid or expired reset link" });
      }

      if (resetToken.used) {
        return res.status(400).json({ error: "This reset link has already been used" });
      }

      if (new Date() > resetToken.expiresAt) {
        return res.status(400).json({ error: "Reset link has expired" });
      }

      // Hash and update password
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await storage.updateUser(resetToken.userId, { password: hashedPassword });

      // Mark token as used
      await storage.markPasswordResetTokenUsed(token);

      res.json({ success: true, message: "Password has been reset successfully" });
    } catch (error: any) {
      console.error("[Reset Password] Error:", error);
      res.status(500).json({ error: "Failed to reset password" });
    }
  });

  // Change password for local auth users
  app.patch("/api/me/password", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // SSO users cannot change password here
      if (user.authProvider === "entra") {
        return res.status(400).json({ error: "SSO users must change password through their identity provider" });
      }

      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: "Current password and new password are required" });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({ error: "New password must be at least 6 characters" });
      }

      // Verify current password
      const validPassword = await bcrypt.compare(currentPassword, user.password);
      if (!validPassword) {
        return res.status(401).json({ error: "Current password is incorrect" });
      }

      // Hash and update new password
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await storage.updateUser(user.id, { password: hashedPassword });

      res.json({ success: true, message: "Password updated successfully" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/me", async (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const user = await storage.getUser(req.session.userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const { password: _, ...userWithoutPassword } = user;
    res.json(userWithoutPassword);
  });

  // Update user demographics (for SSO profile completion)
  app.patch("/api/me/demographics", async (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    try {
      const { jobTitle, industry, companySize, country } = req.body;

      // Validate required fields
      if (!jobTitle || !industry || !companySize || !country) {
        return res.status(400).json({ error: "All fields are required" });
      }

      const updatedUser = await storage.updateUser(req.session.userId, {
        jobTitle,
        industry,
        companySize,
        country,
      });

      if (!updatedUser) {
        return res.status(404).json({ error: "User not found" });
      }

      const { password: _, ...userWithoutPassword } = updatedUser;
      res.json(userWithoutPassword);
    } catch (error: any) {
      console.error("Error updating user demographics:", error);
      res.status(500).json({ error: "Failed to update profile" });
    }
  });

  // Update user notification preferences (weekly digest opt-in/out)
  app.patch("/api/me/notifications", async (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    try {
      const { weeklyDigestEnabled, alertsEnabled, alertThreshold, alertEmailEnabled } = req.body;

      const updates: Record<string, any> = {};

      if (typeof weeklyDigestEnabled === "boolean") {
        updates.weeklyDigestEnabled = weeklyDigestEnabled;
      }

      const hasAlertUpdates = typeof alertsEnabled === "boolean" || typeof alertThreshold === "string" || typeof alertEmailEnabled === "boolean";
      if (hasAlertUpdates) {
        const user = await storage.getUser(req.session.userId);
        if (!user) return res.status(404).json({ error: "User not found" });
        const domain = user.email.split("@")[1]?.toLowerCase();
        const tenant = domain ? await storage.getTenantByDomain(domain) : null;
        if (!tenant) return res.status(400).json({ error: "Tenant not found" });
        const gateResult = await checkFeatureAccessAsync(tenant.plan, "competitorAlerts");
        if (!gateResult.allowed) {
          return res.status(403).json({ error: gateResult.reason, upgradeRequired: true, requiredPlan: gateResult.requiredPlan });
        }
      }

      if (typeof alertsEnabled === "boolean") {
        updates.alertsEnabled = alertsEnabled;
      }
      if (typeof alertThreshold === "string" && ["high", "medium", "all"].includes(alertThreshold)) {
        updates.alertThreshold = alertThreshold;
      }
      if (typeof alertEmailEnabled === "boolean") {
        updates.alertEmailEnabled = alertEmailEnabled;
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No valid notification preferences provided" });
      }

      const updatedUser = await storage.updateUser(req.session.userId, updates);

      if (!updatedUser) {
        return res.status(404).json({ error: "User not found" });
      }

      const { password: _, ...userWithoutPassword } = updatedUser;
      res.json(userWithoutPassword);
    } catch (error: any) {
      console.error("Error updating notification preferences:", error);
      res.status(500).json({ error: "Failed to update notification preferences" });
    }
  });

  app.post("/api/me/digest/send-now", async (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    try {
      const result = await sendDigestNowForUser(req.session.userId);
      if (result.success) {
        res.json({ message: "Weekly digest email sent successfully" });
      } else {
        res.status(400).json({ error: result.error });
      }
    } catch (error: any) {
      console.error("Error sending digest on demand:", error);
      res.status(500).json({ error: "Failed to send digest email" });
    }
  });


}
