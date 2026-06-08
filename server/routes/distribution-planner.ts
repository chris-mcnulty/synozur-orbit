import type { Express } from "express";
import { db } from "../db";
import { editorialCalendars, type InsertMarketingTask } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { getRequestContext } from "../context";
import { guardFeature, toContextFilter } from "./helpers";
import { storage } from "../storage";
import { planDistribution } from "../services/distribution-planner-service";

const VALID_ACTIVITY_GROUPS = ["Themes", "Digital", "Outbound", "Partners", "Events"];

export function registerDistributionPlannerRoutes(app: Express) {
  // Recommend a distribution schedule for a calendar's briefs. When `planId`
  // is provided, also materialize the schedule as tasks in that marketing plan
  // (which then rides the existing Microsoft Planner sync).
  app.post("/api/editorial-calendars/:id/distribution-plan", async (req, res) => {
    try {
      if (!(await guardFeature(req, res, "distributionPlanner"))) return;
      const ctx = await getRequestContext(req);

      const [calendar] = await db
        .select()
        .from(editorialCalendars)
        .where(
          and(
            eq(editorialCalendars.id, req.params.id),
            eq(editorialCalendars.tenantDomain, ctx.tenantDomain),
            eq(editorialCalendars.marketId, ctx.marketId),
          ),
        );
      if (!calendar) return res.status(404).json({ error: "Calendar not found" });

      const { periodStart, periodEnd, skipWeekends, statuses, planId, tzOffsetMinutes } = req.body ?? {};
      const activityGroup = VALID_ACTIVITY_GROUPS.includes(req.body?.activityGroup)
        ? req.body.activityGroup
        : "Digital";

      const { schedule } = await planDistribution({
        tenantDomain: ctx.tenantDomain,
        calendarId: calendar.id,
        periodStart: periodStart ? new Date(periodStart) : undefined,
        periodEnd: periodEnd ? new Date(periodEnd) : undefined,
        skipWeekends: typeof skipWeekends === "boolean" ? skipWeekends : undefined,
        statuses: Array.isArray(statuses) ? statuses : undefined,
        tzOffsetMinutes: typeof tzOffsetMinutes === "number" ? tzOffsetMinutes : undefined,
      });

      if (schedule.length === 0) {
        return res.status(409).json({ error: "No schedulable briefs in this calendar." });
      }

      // Preview only.
      if (!planId) {
        return res.json({ schedule, committed: false });
      }

      // Materialize into the marketing planner.
      const plan = await storage.getMarketingPlan(planId, toContextFilter(ctx));
      if (!plan) return res.status(404).json({ error: "Marketing plan not found" });

      const tasks: InsertMarketingTask[] = schedule.map((s) => ({
        planId: plan.id,
        title: s.title,
        description: `Editorial calendar "${calendar.name}" · ${s.format} · channel: ${s.channel} · publish ${s.scheduledAt.slice(0, 10)}`,
        activityGroup,
        timeframe: s.timeframe,
        priority: "Medium",
        status: "suggested",
        aiGenerated: true,
        dueDate: new Date(s.scheduledAt),
      }));

      const created = await storage.createMarketingTasks(tasks, toContextFilter(ctx));

      res.status(201).json({
        schedule,
        committed: true,
        plan: { id: plan.id, name: plan.name },
        tasksCreated: created.length,
      });
    } catch (err: any) {
      console.error("[distribution-plan]", err);
      res.status(500).json({ error: err.message || "Failed to plan distribution" });
    }
  });
}
