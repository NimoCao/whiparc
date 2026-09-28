// Shared API-response shapes used by multiple pages/components (dashboard,
// workspace, project settings) so they don't drift into incompatible
// locally-declared duplicates.

export interface Project {
  id: string;
  team_id: string;
  name: string;
  description: string;
  visibility: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  user_role: string;
}

export interface Team {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  created_at: string;
}

// Mirrors apps/api/templates.go's Template struct. nodes_json/edges_json/
// viewport_json are only populated on the single-template detail response
// (GET /api/templates/{id}), never on the list response.
export interface Template {
  id: string;
  source_project_id?: string;
  author_user_id: string;
  author_name?: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  install_count: number;
  created_at: string;
  updated_at: string;
  nodes_json?: string;
  edges_json?: string;
  viewport_json?: string;
}

export interface TemplateListResponse {
  templates: Template[];
  total: number;
  limit: number;
  offset: number;
}

// Mirrors apps/api/main.go's PipelineRun struct. runType/target/triggeredBy
// are null for runs that predate the migration adding them (see
// obsidian_memory/08.6) — those render "—" rather than inventing
// plausible-looking values.
export interface PipelineRun {
  id: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';
  logs: string;
  canvas: string;
  runType: string | null;
  target: string | null;
  triggeredBy: { id: string; name: string; email: string } | null;
  createdAt: string;
  updatedAt: string;
}

// A PipelineRun annotated with the project it belongs to — the shape
// useAggregatedRuns (lib/useAggregatedRuns.ts) returns after fanning out
// GET /api/projects/{id}/runs across every project.
export interface RunRow extends PipelineRun {
  projectId: string;
  projectName: string;
}

// Mirrors apps/api/activity.go's ActivityEvent struct (GET /api/activity).
// projectId/projectName/actorId/actorName are all nullable because the
// underlying project or user may have been deleted since the event was
// recorded — the event itself still renders, just without that detail.
export interface ActivityEvent {
  id: string;
  projectId: string | null;
  projectName: string | null;
  actorId: string | null;
  actorName: string | null;
  kind: string;
  payload: Record<string, string>;
  createdAt: string;
}
