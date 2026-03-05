import type { CallProvider } from "@prisma/client";

export const MERGE_BASE_URL = "https://api.merge.dev/api";
export const PAGE_SIZE = 100;

export interface MergePaginatedResponse<T> {
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface MergeAccountTokenResponse {
  account_token: string;
  integration: {
    name: string;
    slug: string;
    categories: string[];
  };
}

export interface MergeLinkedAccountInfo {
  id: string;
  integration: string;
  integration_slug: string;
  category: string;
  status: string;
  end_user_organization_name: string;
}

export interface MergeRecording {
  id: string;
  remote_id: string | null;
  name: string | null;
  recording_url: string | null;
  duration: number | null;
  start_time: string | null;
  participants: Array<{
    email: string | null;
    name: string | null;
    is_organizer: boolean | null;
  }> | null;
  transcript: string | null;
}

export interface MergeCRMContact {
  id: string;
  remote_id: string | null;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  email_addresses: Array<{
    email_address: string;
    email_address_type: string | null;
  }> | null;
  phone_numbers: Array<{
    phone_number: string;
    phone_number_type: string | null;
  }> | null;
  account: string | null;
  remote_data: Array<{
    path: string;
    data: Record<string, unknown>;
  }> | null;
}

export interface MergeCRMAccount {
  id: string;
  remote_id: string | null;
  name: string | null;
  domain: string | null;
  industry: string | null;
  number_of_employees: number | null;
  website: string | null;
}

export interface MergeCRMOpportunity {
  id: string;
  remote_id: string | null;
  name: string | null;
  amount: number | null;
  stage: string | null;
  close_date: string | null;
  status: string | null;
  account: string | null;
}

export function integrationSlugToProvider(slug: string): CallProvider {
  const map: Record<string, CallProvider> = {
    gong: "GONG",
    chorus: "CHORUS",
    zoom: "ZOOM",
    "google-meet": "GOOGLE_MEET",
    google_meet: "GOOGLE_MEET",
    teams: "TEAMS",
    "microsoft-teams": "TEAMS",
    fireflies: "FIREFLIES",
    dialpad: "DIALPAD",
    aircall: "AIRCALL",
    ringcentral: "RINGCENTRAL",
    salesloft: "SALESLOFT",
    outreach: "OUTREACH",
  };

  return map[slug.toLowerCase()] ?? "OTHER";
}
