-- Add unique constraint on CallParticipant (callId, email) to prevent participant dedup race
CREATE UNIQUE INDEX IF NOT EXISTS "call_participant_call_email" ON "call_participants"("callId", "email");

-- Add unique constraint on SalesforceEvent (accountId, opportunityId, stageName) to prevent dedup race
CREATE UNIQUE INDEX IF NOT EXISTS "salesforce_event_account_opp_stage" ON "salesforce_events"("accountId", "opportunityId", "stageName");
