export interface DashboardStats {
  totalPages: number;
  publishedPages: number;
  draftPages: number;
  totalViews: number;
}

export interface DashboardPageSummary {
  id: string;
  title: string;
  slug: string;
  status: string;
  lifecycleStage: "DRAFT" | "IN_REVIEW" | "APPROVED" | "PUBLISHED";
  visibility: string;
  viewCount: number;
  accountName: string;
  createdByName: string;
  createdByEmail: string;
  publishedAt: string | null;
  updatedAt: string;
}

export interface DashboardCreator {
  userId: string;
  name: string | null;
  email: string;
}

export interface ContentQueueItem {
  asset_type: "story" | "landing_page";
  asset_id: string;
  title: string;
  account: {
    id: string;
    name: string;
  };
  creator: {
    id: string;
    name: string | null;
    email: string;
  } | null;
  stage: "DRAFT" | "IN_REVIEW" | "APPROVED" | "PUBLISHED";
  updated_at: string;
  published_at: string | null;
  latest_page_id: string | null;
  archived: boolean;
}

export interface MyQueueBuckets {
  draft: ContentQueueItem[];
  in_review: ContentQueueItem[];
  approved: ContentQueueItem[];
  published_recent: ContentQueueItem[];
}

export interface MyQueueCounts {
  draft: number;
  in_review: number;
  approved: number;
  published_recent: number;
}
