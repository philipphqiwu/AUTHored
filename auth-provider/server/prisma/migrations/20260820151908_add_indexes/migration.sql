-- CreateIndex
CREATE INDEX "access_tokens_token_hash_idx" ON "access_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "access_tokens_user_id_idx" ON "access_tokens"("user_id");

-- CreateIndex
CREATE INDEX "access_tokens_application_id_idx" ON "access_tokens"("application_id");

-- CreateIndex
CREATE INDEX "access_tokens_sso_session_id_idx" ON "access_tokens"("sso_session_id");

-- CreateIndex
CREATE INDEX "access_tokens_status_idx" ON "access_tokens"("status");

-- CreateIndex
CREATE INDEX "application_group_policies_application_id_idx" ON "application_group_policies"("application_id");

-- CreateIndex
CREATE INDEX "application_group_policies_group_id_idx" ON "application_group_policies"("group_id");

-- CreateIndex
CREATE INDEX "application_redirect_uris_application_id_idx" ON "application_redirect_uris"("application_id");

-- CreateIndex
CREATE INDEX "audit_logs_event_type_idx" ON "audit_logs"("event_type");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_application_id_idx" ON "audit_logs"("application_id");

-- CreateIndex
CREATE INDEX "audit_logs_session_id_idx" ON "audit_logs"("session_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "authorization_codes_code_hash_idx" ON "authorization_codes"("code_hash");

-- CreateIndex
CREATE INDEX "authorization_codes_user_id_idx" ON "authorization_codes"("user_id");

-- CreateIndex
CREATE INDEX "authorization_codes_application_id_idx" ON "authorization_codes"("application_id");

-- CreateIndex
CREATE INDEX "authorization_codes_sso_session_id_idx" ON "authorization_codes"("sso_session_id");

-- CreateIndex
CREATE INDEX "event_deliveries_event_id_idx" ON "event_deliveries"("event_id");

-- CreateIndex
CREATE INDEX "event_deliveries_application_id_idx" ON "event_deliveries"("application_id");

-- CreateIndex
CREATE INDEX "event_deliveries_status_idx" ON "event_deliveries"("status");

-- CreateIndex
CREATE INDEX "event_deliveries_next_retry_at_idx" ON "event_deliveries"("next_retry_at");

-- CreateIndex
CREATE INDEX "events_status_idx" ON "events"("status");

-- CreateIndex
CREATE INDEX "events_event_type_idx" ON "events"("event_type");

-- CreateIndex
CREATE INDEX "events_user_id_idx" ON "events"("user_id");

-- CreateIndex
CREATE INDEX "events_created_at_idx" ON "events"("created_at");

-- CreateIndex
CREATE INDEX "sso_sessions_user_id_idx" ON "sso_sessions"("user_id");

-- CreateIndex
CREATE INDEX "sso_sessions_session_token_hash_idx" ON "sso_sessions"("session_token_hash");

-- CreateIndex
CREATE INDEX "sso_sessions_status_idx" ON "sso_sessions"("status");

-- CreateIndex
CREATE INDEX "user_groups_user_id_idx" ON "user_groups"("user_id");

-- CreateIndex
CREATE INDEX "user_groups_group_id_idx" ON "user_groups"("group_id");
