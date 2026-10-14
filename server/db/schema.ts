/**
 * Drizzle table definitions. The SQL migrations in ./migrations are the source of
 * truth for the physical schema (they also create generated tsvector columns and
 * indexes that are only queried through raw SQL, so those columns are omitted here).
 */
import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  real,
  jsonb,
  customType,
} from "drizzle-orm/pg-core";

/** Dimension-less pgvector column — lets us switch embedding models without a schema change. */
export const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector";
  },
  toDriver(value) {
    return `[${value.join(",")}]`;
  },
  fromDriver(value) {
    return typeof value === "string" ? (JSON.parse(value) as number[]) : (value as number[]);
  },
});

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  createdAt: createdAt(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(), // sha256(token) — the raw token only ever lives in the cookie
  userId: uuid("user_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  userAgent: text("user_agent"),
  createdAt: createdAt(),
});

export type LearningPrefs = {
  explanationStyle?: string; // e.g. "examples first", "step by step"
  detailLevel?: "brief" | "balanced" | "detailed";
  supports?: string[]; // e.g. ["one-next-step", "chunked-explanations", "focus-timer"]
  notes?: string;
};

export type OnboardingState = {
  completedSteps: string[];
  skippedSteps: string[];
  dismissed?: boolean;
};

export const studentProfiles = pgTable("student_profiles", {
  userId: uuid("user_id").primaryKey(),
  university: text("university"),
  programme: text("programme"),
  yearOfStudy: text("year_of_study"),
  semester: text("semester"),
  learningPrefs: jsonb("learning_prefs").$type<LearningPrefs>().notNull().default({}),
  assistanceLevel: text("assistance_level").notNull().default("collaborative"), // guided | collaborative | drafting
  accessibilityNotes: text("accessibility_notes"),
  onboarding: jsonb("onboarding").$type<OnboardingState>().notNull().default({ completedSteps: [], skippedSteps: [] }),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: updatedAt(),
});

export const modules = pgTable("modules", {
  id: id(),
  userId: uuid("user_id").notNull(),
  code: text("code"),
  name: text("name").notNull(),
  description: text("description"),
  coordinator: text("coordinator"),
  lecturers: jsonb("lecturers").$type<string[]>().notNull().default([]),
  color: text("color").notNull().default("teal"),
  archived: boolean("archived").notNull().default(false),
  profileSummary: text("profile_summary"),
  profileUpdatedAt: timestamp("profile_updated_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type WorkingContext = {
  goal?: string;
  done?: string[];
  remaining?: string[];
  next?: string;
  updatedAt?: string;
};

export const conversations = pgTable("conversations", {
  id: id(),
  userId: uuid("user_id").notNull(),
  title: text("title").notNull().default("New conversation"),
  moduleId: uuid("module_id"),
  kind: text("kind").notNull().default("general"), // general | module | assignment | writing | exam | checkin
  pinned: boolean("pinned").notNull().default(false),
  archived: boolean("archived").notNull().default(false),
  workingContext: jsonb("working_context").$type<WorkingContext>().notNull().default({}),
  summary: text("summary"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type Citation = {
  ref: string; // "S1"
  kind: "document" | "memory" | "message";
  documentId?: string;
  sectionId?: string;
  memoryId?: string;
  title: string;
  location?: string; // "Page 3", "Slide 7"
  page?: number | null;
  excerpt: string;
};

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

export const messages = pgTable("messages", {
  id: id(),
  conversationId: uuid("conversation_id").notNull(),
  userId: uuid("user_id").notNull(),
  role: text("role").notNull(), // user | assistant
  content: text("content").notNull(),
  attachments: jsonb("attachments").$type<string[]>().notNull().default([]), // document ids
  citations: jsonb("citations").$type<Citation[]>().notNull().default([]),
  status: text("status").notNull().default("complete"), // complete | streaming | stopped | error
  error: text("error"),
  model: text("model"),
  usage: jsonb("usage").$type<Usage | null>(),
  inputMode: text("input_mode").notNull().default("text"), // text | voice
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export type DocumentMetadata = {
  title?: string;
  author?: string;
  moduleCodeHints?: string[];
  detectedDates?: { date: string; label: string; excerpt: string; location?: string }[];
  keyPoints?: string[];
  learningOutcomes?: string[];
  gradingCriteria?: string[];
  wordLimit?: string;
  referencingStyle?: string;
  extraction?: { method: string; warnings: string[] };
  relatedDocuments?: { id: string; filename: string; relation: "possible_revision" | "duplicate" }[];
  suggestedModuleId?: string | null;
};

export const documents = pgTable("documents", {
  id: id(),
  userId: uuid("user_id").notNull(),
  moduleId: uuid("module_id"),
  conversationId: uuid("conversation_id"),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  storageKey: text("storage_key").notNull(),
  kind: text("kind").notNull().default("unknown"),
  status: text("status").notNull().default("queued"), // queued | processing | ready | partial | failed
  statusDetail: text("status_detail"),
  pageCount: integer("page_count"),
  summary: text("summary"),
  metadata: jsonb("metadata").$type<DocumentMetadata>().notNull().default({}),
  duplicateOf: uuid("duplicate_of"),
  isOwnWriting: boolean("is_own_writing").notNull().default(false),
  createdAt: createdAt(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
});

export const documentSections = pgTable("document_sections", {
  id: id(),
  documentId: uuid("document_id").notNull(),
  userId: uuid("user_id").notNull(),
  moduleId: uuid("module_id"),
  ordinal: integer("ordinal").notNull(),
  locationLabel: text("location_label"),
  pageStart: integer("page_start"),
  pageEnd: integer("page_end"),
  heading: text("heading"),
  content: text("content").notNull(),
  tokenEstimate: integer("token_estimate").notNull().default(0),
  embedding: vector("embedding"),
  embeddingModel: text("embedding_model"),
  createdAt: createdAt(),
});

export const jobs = pgTable("jobs", {
  id: id(),
  userId: uuid("user_id"),
  type: text("type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  status: text("status").notNull().default("queued"), // queued | running | done | failed
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
  lastError: text("last_error"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const memories = pgTable("memories", {
  id: id(),
  userId: uuid("user_id").notNull(),
  category: text("category").notNull(), // profile | preference | module | assignment | general | working
  moduleId: uuid("module_id"),
  conversationId: uuid("conversation_id"),
  sourceMessageId: uuid("source_message_id"),
  sourceDocumentId: uuid("source_document_id"),
  content: text("content").notNull(),
  status: text("status").notNull().default("active"), // active | proposed | archived
  origin: text("origin").notNull().default("extracted"), // extracted | user | onboarding
  confidence: real("confidence").notNull().default(0.8),
  stability: text("stability").notNull().default("stable"), // stable | temporary
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  pinned: boolean("pinned").notNull().default(false),
  supersededBy: uuid("superseded_by"),
  embedding: vector("embedding"),
  embeddingModel: text("embedding_model"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const deadlines = pgTable("deadlines", {
  id: id(),
  userId: uuid("user_id").notNull(),
  moduleId: uuid("module_id"),
  title: text("title").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  allDay: boolean("all_day").notNull().default(false),
  kind: text("kind").notNull().default("assignment"), // assignment | exam | milestone | other
  status: text("status").notNull().default("confirmed"), // suggested | confirmed | done | dismissed
  sourceDocumentId: uuid("source_document_id"),
  sourceExcerpt: text("source_excerpt"),
  notes: text("notes"),
  createdAt: createdAt(),
});

export const tasks = pgTable("tasks", {
  id: id(),
  userId: uuid("user_id").notNull(),
  moduleId: uuid("module_id"),
  title: text("title").notNull(),
  details: text("details"),
  doneWhen: text("done_when"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  status: text("status").notNull().default("todo"), // todo | doing | done
  priority: text("priority").notNull().default("essential"), // essential | optional
  estimateMinutes: integer("estimate_minutes"),
  sourceMessageId: uuid("source_message_id"),
  createdAt: createdAt(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export type StyleStats = {
  wordCount: number;
  sentenceCount: number;
  paragraphCount: number;
  avgSentenceLength: number;
  sentenceLengthStdDev: number;
  avgParagraphSentences: number;
  typeTokenRatio: number;
  avgWordLength: number;
  firstPersonRate: number; // per 1000 words
  contractionRate: number; // per 1000 words
  questionRate: number; // share of sentences
  hedgingRate: number; // per 1000 words
  passiveRate: number; // approx share of sentences
  topTransitions: { phrase: string; count: number }[];
  signaturePhrases: { phrase: string; count: number }[];
  sentenceOpeners: { phrase: string; count: number }[];
  punctuation: { semicolons: number; colons: number; dashes: number; parentheses: number; exclamations: number }; // per 1000 words
};

export const writingSamples = pgTable("writing_samples", {
  id: id(),
  userId: uuid("user_id").notNull(),
  documentId: uuid("document_id"),
  title: text("title").notNull(),
  context: text("context").notNull().default("general"), // essay | report | reflective | presentation | email | notes | general
  origin: text("origin").notNull().default("paste"), // upload | paste | calibration | dictation
  isSpoken: boolean("is_spoken").notNull().default(false),
  rawText: text("raw_text").notNull(),
  cleanText: text("clean_text").notNull(),
  exclusionNotes: text("exclusion_notes"),
  wordCount: integer("word_count").notNull().default(0),
  stats: jsonb("stats").$type<StyleStats | null>(),
  createdAt: createdAt(),
});

export const writingPassages = pgTable("writing_passages", {
  id: id(),
  sampleId: uuid("sample_id").notNull(),
  userId: uuid("user_id").notNull(),
  context: text("context").notNull(),
  content: text("content").notNull(),
  embedding: vector("embedding"),
  embeddingModel: text("embedding_model"),
  createdAt: createdAt(),
});

export type WritingProfileData = {
  summary: string;
  voice: string[]; // distinctive characteristics, each a concrete observation
  vocabulary: string[];
  sentenceStructure: string[];
  organisation: string[];
  argumentation: string[];
  formality: string;
  preferredTransitions: string[];
  phrasesToKeep: string[];
  avoid: string[]; // things that would NOT sound like the student
  improvementGoals: string[];
  uncertainties: string[];
};

export const writingProfiles = pgTable("writing_profiles", {
  id: id(),
  userId: uuid("user_id").notNull(),
  context: text("context").notNull().default("general"),
  profile: jsonb("profile").$type<WritingProfileData | null>(),
  stats: jsonb("stats").$type<StyleStats | null>(),
  sampleCount: integer("sample_count").notNull().default(0),
  wordCount: integer("word_count").notNull().default(0),
  confidence: text("confidence").notNull().default("low"), // low | medium | high
  userNotes: text("user_notes"), // the student's own corrections — highest priority
  enabled: boolean("enabled").notNull().default(true),
  version: integer("version").notNull().default(0),
  updatedAt: updatedAt(),
});

export const aiUsage = pgTable("ai_usage", {
  id: id(),
  userId: uuid("user_id"),
  purpose: text("purpose").notNull(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
  cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
  createdAt: createdAt(),
});
