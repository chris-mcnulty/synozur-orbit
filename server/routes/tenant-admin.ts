import type { Express } from "express";
import { randomUUID } from "crypto";
import bcrypt from "bcrypt";
import { storage } from "../storage";
import { getRequestContext, ContextError } from "../context";
import { toContextFilter, hasAdminAccess } from "./helpers";
import { calculateScores, calculateBaselineScore, getCurrentWeeklyPeriod, type ScoreBreakdown } from "../services/scoring-service";
import { getPlanFeatures, getPlanFeaturesAsync, getTenantCompetitorCount, getMonthlyAnalysisCount } from "../services/plan-policy";

export function registerTenantAdminRoutes(app: Express) {
  // ==================== TENANT ADMIN - TEAM MANAGEMENT ====================

  // Get team members for current tenant (Domain Admin or Global Admin)
  app.get("/api/team/members", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Only Domain Admin or Global Admin can view team
      if (user.role !== "Domain Admin" && user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied - Admin only" });
      }

      const domain = user.email.split("@")[1];
      const members = await storage.getUsersByDomain(domain);
      
      res.json(members.map(u => {
        const { password: _, ...userWithoutPassword } = u;
        return userWithoutPassword;
      }));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update team member role (Domain Admin or Global Admin)
  app.patch("/api/team/members/:userId/role", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const currentUser = await storage.getUser(req.session.userId);
      if (!currentUser) {
        return res.status(404).json({ error: "User not found" });
      }

      if (currentUser.role !== "Domain Admin" && currentUser.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied - Admin only" });
      }

      const targetUser = await storage.getUser(req.params.userId);
      if (!targetUser) {
        return res.status(404).json({ error: "Target user not found" });
      }

      // Verify same domain (only Synozur Global Admins can modify cross-tenant)
      const currentDomain = currentUser.email.split("@")[1];
      const targetDomain = targetUser.email.split("@")[1];
      const isSynozurAdmin = currentUser.role === "Global Admin" && currentDomain === "synozur.com";
      if (!isSynozurAdmin && currentDomain !== targetDomain) {
        return res.status(403).json({ error: "Cannot modify users from another tenant" });
      }

      const { role } = req.body;
      const validRoles = ["Standard User", "Domain Admin"];
      if (!role || !validRoles.includes(role)) {
        return res.status(400).json({ error: "Invalid role. Must be 'Standard User' or 'Domain Admin'" });
      }

      // Cannot demote self
      if (targetUser.id === currentUser.id && role !== currentUser.role) {
        return res.status(400).json({ error: "Cannot change your own role" });
      }

      // Cannot promote to Global Admin (only via database)
      if (role === "Global Admin") {
        return res.status(400).json({ error: "Cannot promote to Global Admin" });
      }

      const updated = await storage.updateUser(req.params.userId, { role });
      const { password: _, ...userWithoutPassword } = updated;
      res.json(userWithoutPassword);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Toggle email verification (Domain Admin or Global Admin)
  app.patch("/api/team/members/:userId/verification", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const currentUser = await storage.getUser(req.session.userId);
      if (!currentUser) {
        return res.status(404).json({ error: "User not found" });
      }

      if (currentUser.role !== "Domain Admin" && currentUser.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied - Admin only" });
      }

      const targetUser = await storage.getUser(req.params.userId);
      if (!targetUser) {
        return res.status(404).json({ error: "Target user not found" });
      }

      // Verify same domain (only Synozur Global Admins can modify cross-tenant)
      const currentDomain = currentUser.email.split("@")[1];
      const targetDomain = targetUser.email.split("@")[1];
      const isSynozurAdmin = currentUser.role === "Global Admin" && currentDomain === "synozur.com";
      if (!isSynozurAdmin && currentDomain !== targetDomain) {
        return res.status(403).json({ error: "Cannot modify users from another tenant" });
      }

      // Cannot modify self
      if (targetUser.id === currentUser.id) {
        return res.status(400).json({ error: "Cannot change your own verification status" });
      }

      const { emailVerified } = req.body;
      if (typeof emailVerified !== "boolean") {
        return res.status(400).json({ error: "emailVerified must be a boolean" });
      }

      const updated = await storage.updateUser(req.params.userId, { emailVerified });
      const { password: _, ...userWithoutPassword } = updated;
      res.json(userWithoutPassword);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Remove team member (Domain Admin or Global Admin)
  app.delete("/api/team/members/:userId", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const currentUser = await storage.getUser(req.session.userId);
      if (!currentUser) {
        return res.status(404).json({ error: "User not found" });
      }

      if (currentUser.role !== "Domain Admin" && currentUser.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied - Admin only" });
      }

      const targetUser = await storage.getUser(req.params.userId);
      if (!targetUser) {
        return res.status(404).json({ error: "Target user not found" });
      }

      // Cannot delete self
      if (targetUser.id === currentUser.id) {
        return res.status(400).json({ error: "Cannot remove yourself" });
      }

      // Verify same domain (only Synozur Global Admins can modify cross-tenant)
      const currentDomain = currentUser.email.split("@")[1];
      const targetDomain = targetUser.email.split("@")[1];
      const isSynozurAdmin = currentUser.role === "Global Admin" && currentDomain === "synozur.com";
      if (!isSynozurAdmin && currentDomain !== targetDomain) {
        return res.status(403).json({ error: "Cannot remove users from another tenant" });
      }

      // Cannot remove Domain Admin (must demote first)
      if (targetUser.role === "Domain Admin" && currentUser.role !== "Global Admin") {
        return res.status(400).json({ error: "Cannot remove Domain Admin. Demote first." });
      }

      await storage.deleteUser(req.params.userId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== TENANT ADMIN - ENTRA ID USER PROVISIONING ====================

  // Search Entra ID users from Microsoft Graph API
  app.get("/api/team/entra/search", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const currentUser = await storage.getUser(req.session.userId);
      if (!currentUser) {
        return res.status(404).json({ error: "User not found" });
      }

      if (currentUser.role !== "Domain Admin" && currentUser.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied - Admin only" });
      }

      const query = req.query.q as string;
      if (!query || query.length < 2) {
        return res.status(400).json({ error: "Search query must be at least 2 characters" });
      }

      const { searchEntraUsers, isGraphApiConfigured } = await import("../services/entra-graph-service");
      
      if (!isGraphApiConfigured()) {
        return res.status(503).json({ error: "Microsoft Graph API is not configured. Please contact Synozur support." });
      }

      // Use active tenant context for Global Admins, otherwise use user's email domain
      let tenant;
      if (currentUser.role === "Global Admin" && req.session.activeTenantId) {
        tenant = await storage.getTenant(req.session.activeTenantId);
        console.log(`[Entra Search] Global Admin using active tenant context: ${tenant?.domain}, Azure Tenant ID: ${tenant?.entraTenantId}`);
      } else {
        const userDomain = currentUser.email.split("@")[1];
        tenant = await storage.getTenantByDomain(userDomain);
        console.log(`[Entra Search] Using user domain tenant: ${tenant?.domain}, Azure Tenant ID: ${tenant?.entraTenantId}`);
      }
      
      if (!tenant?.entraTenantId) {
        console.log(`[Entra Search] No Azure Tenant ID configured for tenant: ${tenant?.domain}`);
        return res.status(400).json({ 
          error: "Azure Tenant ID is not configured for this organization. Please contact your administrator to set up Entra ID integration." 
        });
      }

      console.log(`[Entra Search] Searching for "${query}" in Azure tenant: ${tenant.entraTenantId}`);
      const result = await searchEntraUsers(query, tenant.entraTenantId);
      
      if (result.error) {
        return res.status(500).json({ error: result.error });
      }

      res.json(result.users);
    } catch (error: any) {
      console.error("Entra search error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Check if Entra ID is configured (admin only)
  app.get("/api/team/entra/status", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const currentUser = await storage.getUser(req.session.userId);
      if (!currentUser) {
        return res.status(404).json({ error: "User not found" });
      }

      if (currentUser.role !== "Domain Admin" && currentUser.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied - Admin only" });
      }

      const { isGraphApiConfigured } = await import("../services/entra-graph-service");
      
      // Check if base credentials are configured
      if (!isGraphApiConfigured()) {
        return res.json({ configured: false, reason: "platform" });
      }
      
      // Use active tenant context for Global Admins, otherwise use user's email domain
      let tenant;
      if (currentUser.role === "Global Admin" && req.session.activeTenantId) {
        tenant = await storage.getTenant(req.session.activeTenantId);
      } else {
        const userDomain = currentUser.email.split("@")[1];
        tenant = await storage.getTenantByDomain(userDomain);
      }
      
      if (!tenant?.entraTenantId) {
        return res.json({ configured: false, reason: "tenant" });
      }
      
      res.json({ configured: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get admin consent URL for a tenant (to grant Graph API permissions)
  app.get("/api/team/entra/admin-consent-url", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const currentUser = await storage.getUser(req.session.userId);
      if (!currentUser) {
        return res.status(404).json({ error: "User not found" });
      }

      if (currentUser.role !== "Domain Admin" && currentUser.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied - Admin only" });
      }

      const clientId = process.env.ENTRA_CLIENT_ID;
      if (!clientId) {
        return res.status(503).json({ error: "Entra ID not configured" });
      }

      // Use active tenant context for Global Admins, otherwise use user's email domain
      let tenant;
      if (currentUser.role === "Global Admin" && req.session.activeTenantId) {
        tenant = await storage.getTenant(req.session.activeTenantId);
      } else {
        const userDomain = currentUser.email.split("@")[1];
        tenant = await storage.getTenantByDomain(userDomain);
      }
      
      if (!tenant?.entraTenantId) {
        return res.status(400).json({ error: "Azure Tenant ID is not configured for this organization" });
      }

      // Construct the admin consent URL
      const redirectUri = `${req.protocol}://${req.get("host")}/team`;
      const adminConsentUrl = `https://login.microsoftonline.com/${tenant.entraTenantId}/adminconsent?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}`;

      res.json({ 
        url: adminConsentUrl,
        tenantId: tenant.entraTenantId,
        tenantDomain: tenant.domain
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Provision user directly from Entra ID
  app.post("/api/team/entra/provision", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const currentUser = await storage.getUser(req.session.userId);
      if (!currentUser) {
        return res.status(404).json({ error: "User not found" });
      }

      if (currentUser.role !== "Domain Admin" && currentUser.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied - Admin only" });
      }

      const { entraUserId, email, displayName, jobTitle, role, sendWelcomeEmail } = req.body;

      if (!email || !displayName) {
        return res.status(400).json({ error: "Email and display name are required" });
      }

      const validRoles = ["Standard User", "Domain Admin"];
      if (role && !validRoles.includes(role)) {
        return res.status(400).json({ error: "Invalid role. Must be 'Standard User' or 'Domain Admin'" });
      }

      // Validate domain access
      const currentDomain = currentUser.email.split("@")[1];
      const newUserDomain = email.split("@")[1];
      if (currentDomain !== newUserDomain && currentUser.role !== "Global Admin") {
        return res.status(400).json({ error: `User must have an @${currentDomain} email address` });
      }

      // Check if user already exists
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ error: "User already exists with this email" });
      }

      // Get tenant info based on new user's domain (not current user's domain for cross-tenant provisioning)
      const tenant = await storage.getTenantByDomain(newUserDomain);
      if (!tenant) {
        return res.status(400).json({ error: `No tenant found for domain @${newUserDomain}. The tenant must be created first.` });
      }

      // Create user with SSO marker (no password needed for Entra users)
      const avatar = displayName.charAt(0).toUpperCase();
      const newUser = await storage.createUser({
        email,
        password: "__SSO_USER__", // Marker for SSO-only users (never used for login)
        name: displayName,
        role: role || "Standard User",
        company: tenant.name,
        companySize: "",
        jobTitle: jobTitle || "",
        industry: "",
        country: "",
        avatar,
        emailVerified: true, // SSO users are pre-verified
        status: "active",
        entraId: entraUserId || null,
        authProvider: "entra", // Mark as SSO user
      });

      // Update tenant user count
      await storage.updateTenant(tenant.id, { 
        userCount: (tenant.userCount || 0) + 1 
      });

      // Send welcome email if requested
      if (sendWelcomeEmail) {
        const { sendUserProvisionedWelcomeEmail } = await import("../services/email-service");
        const baseUrl = process.env.REPLIT_DEV_DOMAIN 
          ? `https://${process.env.REPLIT_DEV_DOMAIN}`
          : "https://orbit.synozur.com";
        
        await sendUserProvisionedWelcomeEmail(
          email,
          displayName,
          tenant.name,
          role || "Standard User",
          currentUser.name,
          baseUrl
        );
      }

      const { password: _, ...userWithoutPassword } = newUser;
      res.json(userWithoutPassword);
    } catch (error: any) {
      console.error("Entra provision error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== TENANT ADMIN - INVITATIONS ====================

  // Get pending invites for current tenant
  app.get("/api/team/invites", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      if (user.role !== "Domain Admin" && user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied - Admin only" });
      }

      const domain = user.email.split("@")[1];
      const invites = await storage.getTenantInvitesByDomain(domain);
      res.json(invites);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Send team invite
  app.post("/api/team/invites", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      if (user.role !== "Domain Admin" && user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied - Admin only" });
      }

      const { email, role } = req.body;
      if (!email || !email.includes("@")) {
        return res.status(400).json({ error: "Valid email required" });
      }

      const domain = user.email.split("@")[1];
      const inviteeDomain = email.split("@")[1];
      
      // Must invite users to same domain
      if (inviteeDomain !== domain) {
        return res.status(400).json({ error: `Invitees must have an @${domain} email address` });
      }

      // Check if user already exists
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ error: "User already exists with this email" });
      }

      // Check for existing pending invite
      const existingInvites = await storage.getTenantInvitesByDomain(domain);
      const pendingInvite = existingInvites.find(i => i.email === email && i.status === "pending");
      if (pendingInvite) {
        return res.status(400).json({ error: "Invite already pending for this email" });
      }

      const validRoles = ["Standard User", "Domain Admin"];
      const invitedRole = validRoles.includes(role) ? role : "Standard User";

      // Check user role limits
      const tenant = await storage.getTenantByDomain(domain);
      if (tenant) {
        const tenantUsers = await storage.getUsersByDomain(domain);
        const adminUserLimit = (tenant as any).adminUserLimit ?? 1;
        const readWriteUserLimit = (tenant as any).readWriteUserLimit ?? 2;
        const readOnlyUserLimit = (tenant as any).readOnlyUserLimit ?? 5;
        
        // Count existing users by role
        const adminCount = tenantUsers.filter(u => u.role === "Domain Admin" || u.role === "Global Admin").length;
        const standardCount = tenantUsers.filter(u => u.role === "Standard User").length;
        
        // Also count pending invites
        const pendingInvites = existingInvites.filter(i => i.status === "pending");
        const pendingAdmins = pendingInvites.filter(i => i.invitedRole === "Domain Admin").length;
        const pendingStandard = pendingInvites.filter(i => i.invitedRole === "Standard User").length;
        
        if (invitedRole === "Domain Admin") {
          if (adminCount + pendingAdmins >= adminUserLimit) {
            return res.status(400).json({ 
              error: `Admin user limit (${adminUserLimit}) reached for this tenant. Upgrade your plan to add more admin users.` 
            });
          }
        } else {
          // Standard User - check read-write limit (Standard Users are read-write by default)
          if (standardCount + pendingStandard >= readWriteUserLimit) {
            return res.status(400).json({ 
              error: `Read-write user limit (${readWriteUserLimit}) reached for this tenant. Upgrade your plan to add more users.` 
            });
          }
        }
      }

      // Generate token
      const token = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      const invite = await storage.createTenantInvite({
        token,
        email,
        tenantDomain: domain,
        invitedRole,
        invitedBy: user.id,
        status: "pending",
        expiresAt,
      });

      // TODO: Send invite email with token link
      // For now, return the invite with token for testing
      res.json({ ...invite, inviteLink: `/auth/accept-invite?token=${token}` });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Revoke invite
  app.delete("/api/team/invites/:id", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      if (user.role !== "Domain Admin" && user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied - Admin only" });
      }

      const invite = await storage.getTenantInvite(req.params.id);
      if (!invite) {
        return res.status(404).json({ error: "Invite not found" });
      }

      const domain = user.email.split("@")[1];
      if (invite.tenantDomain !== domain && user.role !== "Global Admin") {
        return res.status(403).json({ error: "Cannot revoke invites from another tenant" });
      }

      await storage.updateTenantInvite(req.params.id, { status: "revoked" });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Accept invite (public endpoint for invitee)
  app.post("/api/team/invites/accept", async (req, res) => {
    try {
      const { token, password, name } = req.body;
      
      if (!token) {
        return res.status(400).json({ error: "Token required" });
      }
      if (!password || password.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters" });
      }
      if (!name || !name.trim()) {
        return res.status(400).json({ error: "Name required" });
      }

      const invite = await storage.getTenantInviteByToken(token);
      if (!invite) {
        return res.status(404).json({ error: "Invite not found" });
      }

      if (invite.status !== "pending") {
        return res.status(400).json({ error: "Invite is no longer valid" });
      }

      if (new Date() > new Date(invite.expiresAt)) {
        await storage.updateTenantInvite(invite.id, { status: "expired" });
        return res.status(400).json({ error: "Invite has expired" });
      }

      // Check if user already exists
      const existingUser = await storage.getUserByEmail(invite.email);
      if (existingUser) {
        return res.status(400).json({ error: "User already exists" });
      }

      // Get tenant info
      const tenant = await storage.getTenantByDomain(invite.tenantDomain);
      if (!tenant) {
        return res.status(400).json({ error: "Tenant not found" });
      }

      // Re-check user role limits at acceptance time (limits may have changed since invite)
      const tenantUsers = await storage.getUsersByDomain(invite.tenantDomain);
      const adminUserLimit = (tenant as any).adminUserLimit ?? 1;
      const readWriteUserLimit = (tenant as any).readWriteUserLimit ?? 2;
      
      const adminCount = tenantUsers.filter(u => u.role === "Domain Admin" || u.role === "Global Admin").length;
      const standardCount = tenantUsers.filter(u => u.role === "Standard User").length;
      
      if (invite.invitedRole === "Domain Admin") {
        if (adminCount >= adminUserLimit) {
          return res.status(400).json({ 
            error: `Admin user limit (${adminUserLimit}) reached. Contact your administrator.` 
          });
        }
      } else {
        if (standardCount >= readWriteUserLimit) {
          return res.status(400).json({ 
            error: `User limit (${readWriteUserLimit}) reached. Contact your administrator.` 
          });
        }
      }

      // Hash password and create user
      const hashedPassword = await bcrypt.hash(password, 10);
      const avatar = name.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2);

      const newUser = await storage.createUser({
        email: invite.email,
        password: hashedPassword,
        name: name.trim(),
        role: invite.invitedRole,
        company: tenant.name,
        companySize: "",
        jobTitle: "",
        industry: "",
        country: "",
        avatar,
        emailVerified: true,
        status: "active",
      });

      // Mark invite as accepted
      await storage.updateTenantInvite(invite.id, { 
        status: "accepted",
        acceptedAt: new Date(),
      });

      // Update tenant user count
      await storage.updateTenant(tenant.id, { 
        userCount: tenant.userCount + 1 
      });

      // Set session
      req.session.userId = newUser.id;

      const { password: _, ...userWithoutPassword } = newUser;
      res.json(userWithoutPassword);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== TENANT ADMIN - SETTINGS ====================

  // Get dashboard scores with calculated values for baseline and competitors
  app.get("/api/dashboard/scores", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);
      
      // Get baseline company profile
      const companyProfile = await storage.getCompanyProfileByContext(toContextFilter(ctx));
      
      // Get competitors
      const competitors = await storage.getCompetitorsByContext(toContextFilter(ctx));
      
      // Calculate baseline scores using dedicated baseline function
      let baselineScores: ScoreBreakdown | null = null;
      let baselineTrend: { previousScore: number; delta: number; direction: string } | null = null;
      
      if (companyProfile) {
        baselineScores = calculateBaselineScore({
          description: companyProfile.description,
          crawlData: companyProfile.crawlData as any,
          blogSnapshot: companyProfile.blogSnapshot as any,
          linkedInEngagement: companyProfile.linkedInEngagement as any,
          instagramEngagement: companyProfile.instagramEngagement as any,
          lastCrawl: companyProfile.lastCrawl,
          analysisData: companyProfile.analysisData as any,
        });
        
        // Get trend data from score history
        const previousScore = await storage.getLatestScoreForEntity("baseline", companyProfile.id);
        if (previousScore) {
          const delta = Math.round((baselineScores.overallScore - previousScore.overallScore) * 100) / 100;
          baselineTrend = {
            previousScore: previousScore.overallScore,
            delta,
            direction: delta > 0 ? "up" : delta < 0 ? "down" : "stable"
          };
        }
      }
      
      // Calculate competitor scores
      const competitorScores = competitors.map(c => {
        const analysisData = c.analysisData as any;
        const scores = calculateScores(
          analysisData,
          c.linkedInEngagement as any,
          c.instagramEngagement as any,
          c.crawlData as any,
          c.blogSnapshot as any,
          c.lastCrawl ? new Date(c.lastCrawl) : null
        );
        return {
          id: c.id,
          name: c.name,
          ...scores,
        };
      });
      
      // Calculate market average
      const avgInnovation = competitorScores.length > 0
        ? competitorScores.reduce((sum, c) => sum + c.innovationScore, 0) / competitorScores.length
        : 50;
      const avgMarketPresence = competitorScores.length > 0
        ? competitorScores.reduce((sum, c) => sum + c.marketPresenceScore, 0) / competitorScores.length
        : 50;
      const avgOverall = competitorScores.length > 0
        ? competitorScores.reduce((sum, c) => sum + c.overallScore, 0) / competitorScores.length
        : 50;
      
      // Calculate delta vs market average
      const baselineOverall = baselineScores?.overallScore || 0;
      const deltaVsMarket = baselineOverall - avgOverall;
      const deltaPercent = avgOverall > 0 ? Math.round((deltaVsMarket / avgOverall) * 100) : 0;
      
      // Save score history for baseline (once per period to avoid duplicates)
      if (companyProfile && baselineScores) {
        try {
          const existingScore = await storage.getLatestScoreForEntity("baseline", companyProfile.id);
          const currentPeriod = getCurrentWeeklyPeriod(); // YYYY-Wxx format
          const existingPeriod = existingScore?.period || null;
          
          // Only save if no history exists yet OR we're in a new period
          if (!existingScore || existingPeriod !== currentPeriod) {
            await storage.createScoreHistory({
              entityType: "baseline",
              entityId: companyProfile.id,
              entityName: companyProfile.companyName || "Your Company",
              tenantDomain: ctx.tenantDomain,
              marketId: ctx.marketId,
              innovationScore: Math.round(baselineScores.innovationScore),
              marketPresenceScore: Math.round(baselineScores.marketPresenceScore),
              contentActivityScore: Math.round(baselineScores.contentActivityScore),
              socialEngagementScore: Math.round(baselineScores.socialEngagementScore),
              overallScore: Math.round(baselineScores.overallScore),
              period: currentPeriod,
              scoreBreakdown: baselineScores.factors,
            });
            console.log(`[Score History] Saved baseline score for period ${currentPeriod}: ${baselineScores.overallScore}`);
          }
        } catch (historyError) {
          console.error("[Score History] Failed to save baseline score:", historyError);
          // Non-blocking - continue even if history save fails
        }
      }
      
      res.json({
        baseline: baselineScores ? {
          name: companyProfile?.companyName || 'Your Company',
          id: companyProfile?.id,
          ...baselineScores,
          trend: baselineTrend,
        } : null,
        competitors: competitorScores,
        marketAverages: {
          innovationScore: Math.round(avgInnovation * 100) / 100,
          marketPresenceScore: Math.round(avgMarketPresence * 100) / 100,
          overallScore: Math.round(avgOverall * 100) / 100,
        },
        deltaVsMarket: {
          absolute: Math.round(deltaVsMarket * 100) / 100,
          percent: deltaPercent,
        },
      });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("Dashboard scores error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get basic tenant info (plan, premium status) for any authenticated user
  app.get("/api/tenant/info", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const tenant = await storage.getTenant(ctx.tenantId);
      
      if (!tenant) {
        const defaultFeatures = getPlanFeatures("trial");
        return res.json({ plan: "trial", isPremium: false, features: defaultFeatures, usage: { competitorCount: 0, monthlyAnalysisCount: 0 } });
      }

      const domain = tenant.domain;
      const isPremium = tenant.plan === "pro" || tenant.plan === "professional" || tenant.plan === "enterprise" || tenant.plan === "unlimited";
      const features = await getPlanFeaturesAsync(tenant.plan);
      
      const [competitorCount, monthlyAnalysisCount] = await Promise.all([
        getTenantCompetitorCount(domain),
        getMonthlyAnalysisCount(domain),
      ]);
      
      res.json({
        plan: tenant.plan,
        isPremium,
        name: tenant.name,
        features,
        usage: {
          competitorCount,
          monthlyAnalysisCount,
        },
        limits: {
          competitorLimit: features.competitorLimit as number,
          analysisLimit: features.analysisLimit as number,
        },
      });
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Get current tenant settings (Domain Admin or Global Admin)
  app.get("/api/tenant/settings", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const domain = user.email.split("@")[1];
      const tenant = await storage.getTenantByDomain(domain);
      
      if (!tenant) {
        return res.status(404).json({ error: "Tenant not found" });
      }

      res.json(tenant);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update tenant settings (Domain Admin or Global Admin)
  app.patch("/api/tenant/settings", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      if (user.role !== "Domain Admin" && user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied - Admin only" });
      }

      const domain = user.email.split("@")[1];
      const tenant = await storage.getTenantByDomain(domain);
      
      if (!tenant) {
        return res.status(404).json({ error: "Tenant not found" });
      }

      const hexColorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
      const validFrequencies = ["daily", "weekly", "disabled"];
      
      const { name, logoUrl, faviconUrl, primaryColor, secondaryColor, monitoringFrequency, entraClientId, entraTenantId, entraClientSecret, entraEnabled } = req.body;
      const updateData: Record<string, any> = {};
      
      if (name && typeof name === "string" && name.trim()) {
        updateData.name = name.trim();
      }
      if (logoUrl !== undefined) {
        updateData.logoUrl = logoUrl || null;
      }
      if (faviconUrl !== undefined) {
        updateData.faviconUrl = faviconUrl || null;
      }
      if (primaryColor && hexColorRegex.test(primaryColor)) {
        updateData.primaryColor = primaryColor;
      }
      if (secondaryColor && hexColorRegex.test(secondaryColor)) {
        updateData.secondaryColor = secondaryColor;
      }
      if (monitoringFrequency && validFrequencies.includes(monitoringFrequency)) {
        updateData.monitoringFrequency = monitoringFrequency;
      }
      // Tenant-level Entra ID configuration (Domain Admin editable)
      if (entraClientId !== undefined) {
        updateData.entraClientId = entraClientId?.trim() || null;
      }
      if (entraTenantId !== undefined) {
        updateData.entraTenantId = entraTenantId?.trim() || null;
      }
      if (entraClientSecret !== undefined) {
        updateData.entraClientSecret = entraClientSecret?.trim() || null;
      }
      if (typeof entraEnabled === "boolean") {
        updateData.entraEnabled = entraEnabled;
      }

      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ error: "No valid fields to update" });
      }

      const updated = await storage.updateTenant(tenant.id, updateData);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });


}
