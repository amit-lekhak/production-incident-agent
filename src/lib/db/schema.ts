import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const services = pgTable("services", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  slug: varchar("slug", { length: 80 }).notNull().unique(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const deployments = pgTable(
  "deployments",
  {
    id: serial("id").primaryKey(),
    serviceId: integer("service_id")
      .notNull()
      .references(() => services.id),
    sha: varchar("sha", { length: 40 }).notNull(),
    version: varchar("version", { length: 64 }).notNull(),
    status: varchar("status", { length: 32 }).notNull(), // active | rolled_back | pending
    summary: text("summary"),
    deployedAt: timestamp("deployed_at", { withTimezone: true }).notNull(),
    rolledBackAt: timestamp("rolled_back_at", { withTimezone: true }),
  },
  (t) => [
    index("deployments_service_idx").on(t.serviceId),
    uniqueIndex("deployments_sha_idx").on(t.sha),
  ],
);

export const commits = pgTable(
  "commits",
  {
    id: serial("id").primaryKey(),
    serviceId: integer("service_id")
      .notNull()
      .references(() => services.id),
    sha: varchar("sha", { length: 40 }).notNull(),
    message: text("message").notNull(),
    author: varchar("author", { length: 120 }).notNull(),
    filesChanged: jsonb("files_changed")
      .$type<string[]>()
      .notNull()
      .default([]),
    committedAt: timestamp("committed_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("commits_sha_idx").on(t.sha)],
);

export const alertRules = pgTable("alert_rules", {
  id: serial("id").primaryKey(),
  serviceId: integer("service_id")
    .notNull()
    .references(() => services.id),
  name: varchar("name", { length: 120 }).notNull(),
  metric: varchar("metric", { length: 80 }).notNull(),
  operator: varchar("operator", { length: 8 }).notNull(),
  threshold: doublePrecision("threshold").notNull(),
  windowSeconds: integer("window_seconds").notNull().default(60),
  enabled: boolean("enabled").notNull().default(true),
});

export const metricSamples = pgTable(
  "metric_samples",
  {
    id: serial("id").primaryKey(),
    serviceId: integer("service_id")
      .notNull()
      .references(() => services.id),
    name: varchar("name", { length: 80 }).notNull(),
    value: doublePrecision("value").notNull(),
    labels: jsonb("labels")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    sampledAt: timestamp("sampled_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("metric_samples_name_time_idx").on(t.name, t.sampledAt),
    index("metric_samples_service_time_idx").on(t.serviceId, t.sampledAt),
  ],
);

export const logLines = pgTable(
  "log_lines",
  {
    id: serial("id").primaryKey(),
    serviceId: integer("service_id")
      .notNull()
      .references(() => services.id),
    level: varchar("level", { length: 16 }).notNull(),
    message: text("message").notNull(),
    attrs: jsonb("attrs")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    loggedAt: timestamp("logged_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("log_lines_service_time_idx").on(t.serviceId, t.loggedAt)],
);

/** Simulated checkout request waterfalls (product data, not Langfuse). */
export const traces = pgTable(
  "traces",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    serviceId: integer("service_id")
      .notNull()
      .references(() => services.id),
    requestId: varchar("request_id", { length: 64 }).notNull(),
    rootSpan: varchar("root_span", { length: 120 }).notNull(),
    durationMs: integer("duration_ms").notNull(),
    status: varchar("status", { length: 24 }).notNull(),
    spans: jsonb("spans")
      .$type<
        Array<{
          name: string;
          durationMs: number;
          status: string;
          attrs?: Record<string, unknown>;
        }>
      >()
      .notNull()
      .default([]),
    tracedAt: timestamp("traced_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("traces_service_time_idx").on(t.serviceId, t.tracedAt)],
);

export const errorEvents = pgTable(
  "error_events",
  {
    id: serial("id").primaryKey(),
    serviceId: integer("service_id")
      .notNull()
      .references(() => services.id),
    fingerprint: varchar("fingerprint", { length: 120 }).notNull(),
    title: varchar("title", { length: 240 }).notNull(),
    message: text("message").notNull(),
    count: integer("count").notNull().default(1),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    deploySha: varchar("deploy_sha", { length: 40 }),
  },
  (t) => [index("error_events_service_idx").on(t.serviceId)],
);

export const dbTimings = pgTable(
  "db_timings",
  {
    id: serial("id").primaryKey(),
    serviceId: integer("service_id")
      .notNull()
      .references(() => services.id),
    queryName: varchar("query_name", { length: 120 }).notNull(),
    durationMs: integer("duration_ms").notNull(),
    rows: integer("rows").notNull().default(1),
    sampledAt: timestamp("sampled_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("db_timings_service_time_idx").on(t.serviceId, t.sampledAt)],
);

export const featureFlags = pgTable(
  "feature_flags",
  {
    id: serial("id").primaryKey(),
    serviceId: integer("service_id")
      .notNull()
      .references(() => services.id),
    key: varchar("key", { length: 80 }).notNull(),
    enabled: boolean("enabled").notNull().default(true),
    description: text("description"),
  },
  (t) => [uniqueIndex("feature_flags_service_key_idx").on(t.serviceId, t.key)],
);

export const activeFaults = pgTable("active_faults", {
  id: serial("id").primaryKey(),
  serviceId: integer("service_id")
    .notNull()
    .references(() => services.id),
  scenario: varchar("scenario", { length: 64 }).notNull(),
  deploySha: varchar("deploy_sha", { length: 40 }),
  config: jsonb("config")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  active: boolean("active").notNull().default(true),
  injectedAt: timestamp("injected_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  clearedAt: timestamp("cleared_at", { withTimezone: true }),
});

export const incidents = pgTable(
  "incidents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    serviceId: integer("service_id")
      .notNull()
      .references(() => services.id),
    alertRuleId: integer("alert_rule_id").references(() => alertRules.id),
    title: varchar("title", { length: 240 }).notNull(),
    status: varchar("status", { length: 40 }).notNull(),
    // detected | investigating | awaiting_review | acting | verifying | resolved | closed_rejected | needs_human
    severity: varchar("severity", { length: 24 }).notNull().default("high"),
    triggerMetric: varchar("trigger_metric", { length: 80 }),
    triggerValue: doublePrecision("trigger_value"),
    suspectDeploySha: varchar("suspect_deploy_sha", { length: 40 }),
    langfuseTraceId: varchar("langfuse_trace_id", { length: 80 }),
    needsHumanReason: text("needs_human_reason"),
    openedAt: timestamp("opened_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("incidents_status_idx").on(t.status),
    index("incidents_service_idx").on(t.serviceId),
  ],
);

export const incidentEvents = pgTable(
  "incident_events",
  {
    id: serial("id").primaryKey(),
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => incidents.id),
    kind: varchar("kind", { length: 64 }).notNull(),
    message: text("message").notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("incident_events_incident_idx").on(t.incidentId)],
);

export const hypotheses = pgTable("hypotheses", {
  id: serial("id").primaryKey(),
  incidentId: uuid("incident_id")
    .notNull()
    .references(() => incidents.id),
  rank: integer("rank").notNull(),
  causeType: varchar("cause_type", { length: 64 }).notNull(),
  suspectDeploy: varchar("suspect_deploy", { length: 40 }),
  supportingToolNames: jsonb("supporting_tool_names")
    .$type<string[]>()
    .notNull()
    .default([]),
  why: text("why").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const recommendations = pgTable("recommendations", {
  id: serial("id").primaryKey(),
  incidentId: uuid("incident_id")
    .notNull()
    .references(() => incidents.id),
  winningHypothesisId: integer("winning_hypothesis_id").references(
    () => hypotheses.id,
  ),
  confidence: integer("confidence").notNull(),
  evidence: jsonb("evidence")
    .$type<Array<{ tool: string; display: string; supports: boolean }>>()
    .notNull()
    .default([]),
  recommendedAction: varchar("recommended_action", { length: 40 }).notNull(),
  // rollback | disable_flag | restart | watch | page_human
  actionTarget: varchar("action_target", { length: 120 }).notNull(),
  summary: text("summary").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const reviews = pgTable("reviews", {
  id: serial("id").primaryKey(),
  incidentId: uuid("incident_id")
    .notNull()
    .references(() => incidents.id),
  recommendationId: integer("recommendation_id").references(
    () => recommendations.id,
  ),
  decision: varchar("decision", { length: 32 }), // approved | rejected | more_evidence | pending
  reviewer: varchar("reviewer", { length: 80 }).notNull().default("oncall"),
  note: text("note"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const actions = pgTable("actions", {
  id: serial("id").primaryKey(),
  incidentId: uuid("incident_id")
    .notNull()
    .references(() => incidents.id),
  kind: varchar("kind", { length: 40 }).notNull(),
  target: varchar("target", { length: 120 }).notNull(),
  status: varchar("status", { length: 24 }).notNull(), // pending | succeeded | failed
  result: jsonb("result")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  error: text("error"),
  executedAt: timestamp("executed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const postmortems = pgTable("postmortems", {
  id: uuid("id").defaultRandom().primaryKey(),
  incidentId: uuid("incident_id")
    .notNull()
    .references(() => incidents.id)
    .unique(),
  title: varchar("title", { length: 240 }).notNull(),
  summary: text("summary").notNull(),
  timeline: jsonb("timeline")
    .$type<Array<{ at: string; event: string }>>()
    .notNull()
    .default([]),
  rootCause: text("root_cause").notNull(),
  impact: text("impact").notNull(),
  resolution: text("resolution").notNull(),
  actionItems: jsonb("action_items").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
