import type { Pool } from "pg";
import type { RequestContext } from "../../context";
import type { OrbitAnswer, OrbitTurn, OrbitUsage } from "@shared/ask-orbit";
import { configuredAllowance } from "./grounding";
import { ASK_ORBIT_CONFIG } from "../../config/ask-orbit";

export class OrbitError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

const scope = "tenant_id=$1 AND market_id=$2 AND owner_id=$3";
const values = (ctx: RequestContext) => [ctx.tenantId, ctx.marketId, ctx.userId];
const turnColumns = "id,question,status,answer,error";

export class OrbitRepository {
  constructor(private pool: Pool, private allowance: number = ASK_ORBIT_CONFIG.monthlyAllowance) {}

  async usage(ctx: RequestContext): Promise<OrbitUsage> {
    const limit = configuredAllowance(this.allowance);
    const { rows } = await this.pool.query(`SELECT used FROM ask_orbit_monthly_usage
      WHERE tenant_id=$1 AND month=date_trunc('month',now() AT TIME ZONE 'UTC')::date`, [ctx.tenantId]);
    const used = rows[0]?.used || 0;
    return { limit, used, remaining: Math.max(0, limit - used), month: new Date().toISOString().slice(0, 7) };
  }

  async list(ctx: RequestContext) {
    return (await this.pool.query(`SELECT id,title,updated_at AS "updatedAt"
      FROM ask_orbit_conversations WHERE ${scope} ORDER BY updated_at DESC LIMIT 100`, values(ctx))).rows;
  }

  async create(ctx: RequestContext, title: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`orbit-owner:${ctx.tenantId}:${ctx.marketId}:${ctx.userId}`]);
      const count = await client.query(`SELECT count(*)::int AS n FROM ask_orbit_conversations WHERE ${scope}`, values(ctx));
      if (count.rows[0].n >= 100) throw new OrbitError("Delete an old conversation before creating another (100 maximum).", 409);
      const result = await client.query(`INSERT INTO ask_orbit_conversations(tenant_id,market_id,owner_id,title)
        VALUES($1,$2,$3,$4) RETURNING id,title`, [...values(ctx), title]);
      await client.query("COMMIT");
      return result.rows[0];
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async get(ctx: RequestContext, id: string): Promise<{ id: string; title: string; turns: OrbitTurn[] }> {
    const c = await this.pool.query(`SELECT id,title FROM ask_orbit_conversations WHERE ${scope} AND id=$4`, [...values(ctx), id]);
    if (!c.rowCount) throw new OrbitError("Conversation not found.", 404);
    // Recover interrupted workers without ever retrying a possibly billed call.
    await this.pool.query(`UPDATE ask_orbit_turns t SET status='failed',
      error='This attempt was interrupted. It was not automatically retried.',finished_at=now()
      FROM ask_orbit_conversations c WHERE t.conversation_id=c.id AND c.tenant_id=$1
      AND c.market_id=$2 AND c.owner_id=$3 AND c.id=$4 AND t.status='processing'
      AND t.created_at < now() - interval '150 seconds'`, [...values(ctx), id]);
    const turns = await this.pool.query<OrbitTurn>(`SELECT ${turnColumns} FROM ask_orbit_turns
      WHERE conversation_id IN (SELECT id FROM ask_orbit_conversations WHERE ${scope} AND id=$4)
      ORDER BY created_at,id LIMIT 100`, [...values(ctx), id]);
    return { ...c.rows[0], turns: turns.rows };
  }

  async rename(ctx: RequestContext, id: string, title: string) {
    const r = await this.pool.query(`UPDATE ask_orbit_conversations SET title=$5,updated_at=now()
      WHERE ${scope} AND id=$4 RETURNING id,title`, [...values(ctx), id, title]);
    if (!r.rowCount) throw new OrbitError("Conversation not found.", 404);
    return r.rows[0];
  }

  async delete(ctx: RequestContext, id: string) {
    const r = await this.pool.query(`DELETE FROM ask_orbit_conversations WHERE ${scope} AND id=$4`, [...values(ctx), id]);
    if (!r.rowCount) throw new OrbitError("Conversation not found.", 404);
  }

  async turn(ctx: RequestContext, conversation: string, id: string): Promise<OrbitTurn | undefined> {
    const r = await this.pool.query<OrbitTurn>(`SELECT t.id,t.question,t.status,t.answer,t.error
      FROM ask_orbit_turns t JOIN ask_orbit_conversations c ON c.id=t.conversation_id
      WHERE c.tenant_id=$1 AND c.market_id=$2 AND c.owner_id=$3 AND c.id=$4 AND t.id=$5`,
    [...values(ctx), conversation, id]);
    return r.rows[0];
  }

  async reserve(ctx: RequestContext, conversation: string, id: string, question: string) {
    const limit = configuredAllowance(this.allowance);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // One lock per tenant/month budget. Concurrent users/markets cannot overspend.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`ask-orbit:${ctx.tenantId}`]);
      const c = await client.query(`SELECT id FROM ask_orbit_conversations WHERE ${scope} AND id=$4 FOR UPDATE`, [...values(ctx), conversation]);
      if (!c.rowCount) throw new OrbitError("Conversation not found.", 404);
      const old = await client.query<OrbitTurn & { conversation_id: string }>(
        `SELECT ${turnColumns},conversation_id FROM ask_orbit_turns WHERE id=$1`, [id]);
      if (old.rowCount) {
        if (old.rows[0].conversation_id !== conversation || old.rows[0].question !== question) {
          throw new OrbitError("This request identifier has already been used.", 409);
        }
        await client.query("COMMIT");
        return { created: false, turn: old.rows[0] as OrbitTurn };
      }
      await client.query(`UPDATE ask_orbit_turns SET status='failed',error='This attempt was interrupted. It was not automatically retried.',finished_at=now()
        WHERE conversation_id=$1 AND status='processing' AND created_at < now() - interval '150 seconds'`, [conversation]);
      const state = await client.query(`SELECT count(*)::int AS n,
        count(*) FILTER (WHERE status='processing')::int AS busy FROM ask_orbit_turns WHERE conversation_id=$1`, [conversation]);
      if (state.rows[0].busy) throw new OrbitError("An answer is already being prepared in this conversation.", 409);
      if (state.rows[0].n >= 100) throw new OrbitError("Start a new conversation (100 questions maximum).", 409);
      await client.query(`INSERT INTO ask_orbit_monthly_usage(tenant_id,month,used)
        VALUES($1,date_trunc('month',now() AT TIME ZONE 'UTC')::date,0) ON CONFLICT DO NOTHING`, [ctx.tenantId]);
      const u = await client.query(`UPDATE ask_orbit_monthly_usage SET used=used+1
        WHERE tenant_id=$1 AND month=date_trunc('month',now() AT TIME ZONE 'UTC')::date AND used<$2 RETURNING used`, [ctx.tenantId, limit]);
      if (!u.rowCount) throw new OrbitError("Your organization has reached its monthly Ask Orbit allowance.", 429);
      const t = await client.query<OrbitTurn>(`INSERT INTO ask_orbit_turns(id,conversation_id,question)
        VALUES($1,$2,$3) RETURNING ${turnColumns}`, [id, conversation, question]);
      await client.query("UPDATE ask_orbit_conversations SET updated_at=now() WHERE id=$1", [conversation]);
      await client.query("COMMIT");
      return { created: true, turn: t.rows[0] };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async providerStarted(ctx: RequestContext, conversation: string, id: string) {
    const r = await this.pool.query(`UPDATE ask_orbit_turns SET provider_started=TRUE WHERE id=$5 AND status='processing'
      AND conversation_id IN (SELECT id FROM ask_orbit_conversations WHERE ${scope} AND id=$4) RETURNING id`,
    [...values(ctx), conversation, id]);
    return !!r.rowCount;
  }

  async finish(ctx: RequestContext, conversation: string, id: string, status: OrbitTurn["status"], answer: OrbitAnswer | null, error: string | null) {
    // A stop, deletion, worker recovery, or completed response always wins over
    // a late provider completion. Never resurrect a terminal turn.
    const r = await this.pool.query(`UPDATE ask_orbit_turns SET status=$6,answer=$7,error=$8,finished_at=now()
      WHERE id=$5 AND status='processing' AND conversation_id IN
      (SELECT id FROM ask_orbit_conversations WHERE ${scope} AND id=$4) RETURNING id`,
    [...values(ctx), conversation, id, status, answer ? JSON.stringify(answer) : null, error]);
    return !!r.rowCount;
  }
}
