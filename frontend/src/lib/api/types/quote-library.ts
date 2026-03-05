export type QuoteAttributionDisplay = "DISPLAYED" | "HIDDEN" | "OBFUSCATED";

export interface QuoteLibraryItem {
  id: string;
  tier: "AUTO" | "CURATED";
  quote_text: string;
  confidence_score: number;
  created_at: string;
  curated_at: string | null;
  curation_note: string | null;
  account: {
    id: string;
    name: string | null;
  } | null;
  call: {
    id: string;
    title: string | null;
    occurred_at: string;
  } | null;
  is_starred: boolean;
  curated_by: {
    id: string;
    name: string | null;
    email: string | null;
  } | null;
  source: {
    available: boolean;
    mode: "RAW" | "PROXY";
    url: string | null;
  };
}

export interface QuoteLibraryResponse {
  attribution_display: QuoteAttributionDisplay;
  quotes: QuoteLibraryItem[];
}

export interface QuoteSourceSegmentResponse {
  quote_id: string;
  mode: "RAW" | "SCRUBBED";
  call: {
    id: string;
    title: string | null;
    occurred_at: string;
  } | null;
  source: {
    chunk_id: string | null;
    start_ms: number | null;
    end_ms: number | null;
    text: string;
  };
  transcript_url: string | null;
}
