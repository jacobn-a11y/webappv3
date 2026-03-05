export interface AnalyticsData {
  summary: {
    totalCalls: number;
    totalAccounts: number;
    totalTranscriptHours: number;
    overallResolutionRate: number;
    totalQuotes: number;
    totalPageViews: number;
  };
  callsPerWeek: Array<{ weekStart: string; count: number }>;
  funnelDistribution: Array<{ stage: string; count: number }>;
  topAccounts: Array<{ accountName: string; callCount: number }>;
  entityResolutionOverTime: Array<{ weekStart: string; rate: number; resolvedCalls: number; totalCalls: number }>;
  topTopics: Array<{ label: string; count: number; funnelStage: string }>;
  quoteLeaderboard: Array<{ accountName: string; quoteCount: number }>;
  topPagesByViews: Array<{ title: string; slug: string; viewCount: number; publishedAt: string | null }>;
  viewsOverTime: Array<{ weekStart: string; totalViews: number; pagesPublished: number }>;
}

export interface RevOpsKpiData {
  window_days: number;
  pipeline_influence: {
    influenced_accounts: number;
    accounts_with_pipeline_events: number;
    influence_rate_percent: number;
  };
  conversion_by_stage: Array<{ stage_name: string | null; count: number }>;
  win_loss: {
    closed_won: number;
    closed_lost: number;
    win_rate_percent: number;
  };
  persona_objections: {
    transcript_level_objection_mentions: number;
    top_objection_topics: Array<{ topic: string; count: number }>;
  };
  competitor_mentions: {
    transcript_level_competitor_mentions: number;
  };
  attribution_links: {
    linked_calls: number;
    linked_stories: number;
    linked_opportunity_events: number;
    linked_campaigns: number;
    note: string;
  };
  executive_summary: string[];
}
