import { storage } from '../storage';
import { sendTrialReminderEmail, TrialReminderType } from './email-service';
import { Tenant, User } from '@shared/schema';

const TRIAL_DURATION_DAYS = 60;

export interface TrialReminderSchedule {
  dayFromStart: number;
  daysRemaining: number;
  reminderType: TrialReminderType;
}

export const TRIAL_REMINDER_SCHEDULE: TrialReminderSchedule[] = [
  { dayFromStart: 7, daysRemaining: 53, reminderType: 'day7' },
  { dayFromStart: 30, daysRemaining: 30, reminderType: 'day30' },
  { dayFromStart: 46, daysRemaining: 14, reminderType: 'day46' },
  { dayFromStart: 53, daysRemaining: 7, reminderType: 'day53' },
  { dayFromStart: 57, daysRemaining: 3, reminderType: 'day57' },
  { dayFromStart: 59, daysRemaining: 1, reminderType: 'day59' },
  { dayFromStart: 60, daysRemaining: 0, reminderType: 'day60' },
];

export function calculateTrialEndDate(startDate: Date): Date {
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + TRIAL_DURATION_DAYS);
  return endDate;
}

export function getDaysIntoTrial(trialStartDate: Date): number {
  const now = new Date();
  const diffTime = now.getTime() - trialStartDate.getTime();
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

export function getDaysRemaining(trialEndsAt: Date): number {
  const now = new Date();
  const diffTime = trialEndsAt.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
}

export function getNextReminderType(daysIntoTrial: number, lastReminderSent: string | null): TrialReminderType | null {
  const lastSentIndex = lastReminderSent 
    ? TRIAL_REMINDER_SCHEDULE.findIndex(s => s.reminderType === lastReminderSent)
    : -1;
  
  for (let i = 0; i < TRIAL_REMINDER_SCHEDULE.length; i++) {
    const schedule = TRIAL_REMINDER_SCHEDULE[i];
    
    if (i <= lastSentIndex) {
      continue;
    }
    
    const nextScheduleDay = (i < TRIAL_REMINDER_SCHEDULE.length - 1) 
      ? TRIAL_REMINDER_SCHEDULE[i + 1].dayFromStart 
      : schedule.dayFromStart + 1;
    
    if (daysIntoTrial >= schedule.dayFromStart && daysIntoTrial < nextScheduleDay) {
      return schedule.reminderType;
    }
  }
  
  return null;
}

export async function backfillTrialDatesForExistingTenants(): Promise<number> {
  let backfilled = 0;
  try {
    const allTenants = await storage.getAllTenants();
    const tenantsNeedingBackfill = allTenants.filter(t => 
      t.plan === 'trial' && 
      (t.trialStartDate === null || t.trialEndsAt === null)
    );
    
    for (const tenant of tenantsNeedingBackfill) {
      const trialStartDate = tenant.createdAt || new Date();
      const trialEndsAt = calculateTrialEndDate(trialStartDate);
      
      await storage.updateTenant(tenant.id, {
        trialStartDate,
        trialEndsAt,
      });
      
      console.log(`Backfilled trial dates for tenant ${tenant.domain} (start: ${trialStartDate.toISOString()})`);
      backfilled++;
    }
  } catch (error) {
    console.error('Error backfilling trial dates:', error);
  }
  return backfilled;
}

export async function processTrialReminders(baseUrl: string): Promise<{ processed: number; errors: number }> {
  let processed = 0;
  let errors = 0;
  
  try {
    await backfillTrialDatesForExistingTenants();
    
    const allTenants = await storage.getAllTenants();
    const trialTenants = allTenants.filter(t => 
      t.plan === 'trial' && 
      t.trialStartDate !== null && 
      t.trialEndsAt !== null
    );
    
    for (const tenant of trialTenants) {
      try {
        const daysIntoTrial = getDaysIntoTrial(tenant.trialStartDate!);
        const daysRemaining = getDaysRemaining(tenant.trialEndsAt!);
        
        if (daysRemaining <= 0) {
          await expireTrialAndSendFinalEmail(tenant, baseUrl);
          processed++;
          continue;
        }
        
        const nextReminder = getNextReminderType(daysIntoTrial, tenant.lastTrialReminderSent);
        
        if (nextReminder) {
          const admins = await getTenantAdmins(tenant.domain);
          
          for (const admin of admins) {
            const success = await sendTrialReminderEmail(
              {
                email: admin.email,
                name: admin.name || admin.email.split('@')[0],
                companyName: tenant.name,
                daysRemaining,
                baseUrl,
              },
              nextReminder
            );
            
            if (success) {
              console.log(`Sent ${nextReminder} reminder to ${admin.email} for tenant ${tenant.domain}`);
            } else {
              console.error(`Failed to send ${nextReminder} reminder to ${admin.email}`);
            }
          }
          
          await storage.updateTenant(tenant.id, {
            lastTrialReminderSent: nextReminder,
          });
          
          processed++;
        }
      } catch (error) {
        console.error(`Error processing trial reminder for tenant ${tenant.domain}:`, error);
        errors++;
      }
    }
  } catch (error) {
    console.error('Error fetching tenants for trial reminders:', error);
    errors++;
  }
  
  return { processed, errors };
}

async function expireTrialAndSendFinalEmail(tenant: Tenant, baseUrl: string): Promise<void> {
  const admins = await getTenantAdmins(tenant.domain);
  
  for (const admin of admins) {
    await sendTrialReminderEmail(
      {
        email: admin.email,
        name: admin.name || admin.email.split('@')[0],
        companyName: tenant.name,
        daysRemaining: 0,
        baseUrl,
      },
      'day60'
    );
  }
  
  await storage.updateTenant(tenant.id, {
    plan: 'free',
    lastTrialReminderSent: 'day60',
    competitorLimit: 1,
    analysisLimit: 1,
  });
  
  console.log(`Trial expired for tenant ${tenant.domain} - reverted to free plan`);
}

async function getTenantAdmins(domain: string): Promise<User[]> {
  const users = await storage.getUsersByDomain(domain);
  return users.filter(u => u.role === 'Domain Admin' || u.role === 'Global Admin');
}

export async function initializeTrialForTenant(tenantId: string): Promise<Tenant> {
  const now = new Date();
  const trialEndsAt = calculateTrialEndDate(now);
  
  return await storage.updateTenant(tenantId, {
    trialStartDate: now,
    trialEndsAt,
    plan: 'trial',
  });
}

export function getTrialStatus(tenant: Tenant): {
  isOnTrial: boolean;
  daysRemaining: number;
  daysElapsed: number;
  expirationDate: Date | null;
} {
  if (tenant.plan !== 'trial' || !tenant.trialStartDate || !tenant.trialEndsAt) {
    return {
      isOnTrial: false,
      daysRemaining: 0,
      daysElapsed: 0,
      expirationDate: null,
    };
  }
  
  return {
    isOnTrial: true,
    daysRemaining: getDaysRemaining(tenant.trialEndsAt),
    daysElapsed: getDaysIntoTrial(tenant.trialStartDate),
    expirationDate: tenant.trialEndsAt,
  };
}
