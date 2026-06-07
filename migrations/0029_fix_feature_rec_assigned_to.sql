ALTER TABLE "feature_recommendations" ADD COLUMN IF NOT EXISTS "assigned_to_user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "feature_rec_assigned_to_idx" ON "feature_recommendations" USING btree ("assigned_to_user_id");
