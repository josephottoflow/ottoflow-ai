// ─── Database schema types (mirrors Supabase tables) ─────────────────────────

export type ProjectStatus = "active" | "completed" | "draft" | "paused";
export type PipelineType = "content" | "video";
export type ContentStatus = "draft" | "approved" | "published" | "scheduled";
export type RenderStatus = "queued" | "rendering" | "done" | "failed";
export type ContentPlatform =
  | "linkedin"
  | "facebook"
  | "instagram"
  | "twitter"
  | "blog"
  | "email";

export type BrandStatus = "pending" | "researching" | "ready" | "failed";
export type ResearchJobStatus = "queued" | "running" | "done" | "failed";

// ─── BrandProfile — structured output of the Research agent ──────────────────

export interface BrandProfileService {
  name: string;
  description: string;
}
export interface BrandProfilePersona {
  name: string;
  role: string;
  goals: string[];
  pain_points: string[];
  channels: string[];
}
export interface BrandProfileVoice {
  tone: string[];                // ['authoritative','approachable']
  vocabulary_dos: string[];
  vocabulary_donts: string[];
  example_phrases: string[];
}
export interface BrandProfileAudience {
  demographics: string[];
  psychographics: string[];
  geographies: string[];
}
export interface BrandProfileICP {
  industries: string[];
  company_sizes: string[];       // ['SMB','Mid-market','Enterprise']
  roles: string[];
  pain_points: string[];
}

export interface BrandProfile {
  summary: string;
  positioning_statement: string;
  value_propositions: string[];
  services: BrandProfileService[];
  products: BrandProfileService[];
  offers: string[];
  brand_voice: BrandProfileVoice;
  audience: BrandProfileAudience;
  icp: BrandProfileICP;
  personas: BrandProfilePersona[];
  // Seed data the research agent emits alongside the profile.
  seed_keywords: string[];
  seed_competitors: string[];    // names only — the competitor agent enriches
}

// ─── Research job log entry ──────────────────────────────────────────────────

export interface ResearchLogEntry {
  ts: string;                    // ISO timestamp
  level: "info" | "warn" | "error" | "success";
  step: string;                  // matches DbBrandResearchJob.current_step values
  message: string;
  meta?: Record<string, unknown>;
}

// ─── Row types ────────────────────────────────────────────────────────────────

export interface DbProject {
  id: string;
  user_id: string;               // Clerk user id (text)
  name: string;
  type: PipelineType;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
  content_count: number;
  video_count: number;
  tags: string[];
  credits_used: number;
  brand_id: string | null;
}

export interface DbContentItem {
  id: string;
  project_id: string | null;
  platform: ContentPlatform;
  title: string;
  preview: string | null;
  body: string | null;
  status: ContentStatus;
  created_at: string;
  engagement: { likes: number; shares: number; comments: number } | null;
}

export interface DbRenderJob {
  id: string;
  project_id: string | null;
  name: string;
  status: RenderStatus;
  progress: number;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  template: string;
  output_path: string | null;
  output_url: string | null;
  error_message: string | null;
  prompt: string | null;
  meta: Record<string, unknown> | null;
}

export interface DbActivityItem {
  id: string;
  project_id: string | null;
  project_name: string | null;
  type:
    | "video_rendered"
    | "content_generated"
    | "project_created"
    | "approval"
    | "published"
    | "error"
    | "brand_researched";
  message: string;
  created_at: string;
  meta: Record<string, string> | null;
}

export interface DbBrand {
  id: string;
  user_id: string;
  name: string;
  website: string | null;
  industry: string | null;
  status: BrandStatus;
  profile: BrandProfile | null;
  brand_colors: Record<string, string> | null;
  logo_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbBrandResearchJob {
  id: string;
  brand_id: string;
  status: ResearchJobStatus;
  current_step: string | null;
  progress: number;
  logs: ResearchLogEntry[];
  error_message: string | null;
  bull_job_id: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface DbCompetitor {
  id: string;
  brand_id: string;
  name: string;
  website: string | null;
  summary: string | null;
  source: string | null;
  positioning: string | null;
  strengths: string[];
  weaknesses: string[];
  created_at: string;
}

export interface DbKeyword {
  id: string;
  brand_id: string;
  term: string;
  intent: string | null;
  search_volume: number | null;
  competition_score: number | null;
  trend_score: number | null;
  relevance_score: number | null;
  opportunity_score: number | null;
  created_at: string;
}

export interface DbContentPillar {
  id: string;
  brand_id: string;
  name: string;
  description: string | null;
  content_types: string[];
  example_topics: string[];
  priority: number;
  created_at: string;
}

// ─── Supabase Database definition ────────────────────────────────────────────
// Each table must include `Relationships: []` (or a proper relationship array)
// to satisfy postgrest-js's `GenericTable` constraint — without it the type
// resolver falls back to `never` and every `.insert()` looks like `never[]`.
// Insert/Update stay loose (Partial<Row>) so the deep inference doesn't choke.

type TableDef<Row> = {
  Row: Row;
  Insert: Partial<Row> & Record<string, unknown>;
  Update: Partial<Row>;
  Relationships: [];
};

export interface Database {
  public: {
    Tables: {
      projects:            TableDef<DbProject>;
      content_items:       TableDef<DbContentItem>;
      render_jobs:         TableDef<DbRenderJob>;
      activity:            TableDef<DbActivityItem>;
      brands:              TableDef<DbBrand>;
      brand_research_jobs: TableDef<DbBrandResearchJob>;
      competitors:         TableDef<DbCompetitor>;
      keywords:            TableDef<DbKeyword>;
      content_pillars:     TableDef<DbContentPillar>;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

// ─── API / UI types ───────────────────────────────────────────────────────────

export interface GenerateRequest {
  prompt: string;
  style?: string;
  provider?: "veo3" | "higgsfield" | "imagen3";
  sceneCount?: number;
  musicVibe?: string;
  renderVariant?: string;
  hookStyle?: string;
  projectId?: string;
}

export interface SSEEvent {
  type: "log" | "status" | "done" | "error";
  level?: "info" | "warn" | "error" | "success";
  message?: string;
  label?: string;
  pct?: number;
  videoUrl?: string;
  jobId?: string;
  error?: string;
}

export interface KPISummary {
  totalContent: number;
  totalVideos: number;
  creditsUsed: number;
  creditsTotal: number;
  activeProjects: number;
  publishedToday: number;
  renderQueue: number;
}

// One bucket in the daily analytics series (last 14 days).
export interface ChartPoint {
  date: string;     // formatted label e.g. "May 1"
  content: number;  // content_items created that day
  videos: number;   // render_jobs completed that day
  credits: number;  // approximated daily credit spend
}

export interface CreateBrandRequest {
  name: string;
  website: string;
  industry: string;
}
