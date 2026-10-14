// JSON shapes returned by the Margin API (dates arrive as ISO strings).

export type User = { id: string; email: string; displayName: string };

export type Capabilities = { ai: boolean; semanticSearch: boolean; serverTranscription: boolean; maxUploadMb: number };

export type Me = { user: User | null; registrationOpen: boolean; capabilities: Capabilities };

export type ModuleSummary = {
  id: string;
  code: string | null;
  name: string;
  color: string;
  archived: boolean;
  description: string | null;
  documentCount: number;
  conversationCount: number;
  nextDeadline: string | null;
};

export type Module = {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  coordinator: string | null;
  lecturers: string[];
  color: string;
  archived: boolean;
  profileSummary: string | null;
  profileUpdatedAt: string | null;
};

export type ConversationSummary = {
  id: string;
  title: string;
  kind: string;
  moduleId: string | null;
  pinned: boolean;
  archived: boolean;
  updatedAt: string;
};

export type WorkingContext = { goal?: string; done?: string[]; remaining?: string[]; next?: string; updatedAt?: string };

export type Conversation = ConversationSummary & { workingContext: WorkingContext; summary: string | null };

export type Citation = {
  ref: string;
  kind: "document" | "memory" | "message";
  documentId?: string;
  sectionId?: string;
  memoryId?: string;
  title: string;
  location?: string;
  page?: number | null;
  excerpt: string;
};

export type Message = {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  attachments: string[];
  citations: Citation[];
  status: "complete" | "streaming" | "stopped" | "error";
  error: string | null;
  model: string | null;
  inputMode: "text" | "voice";
  createdAt: string;
};

export type DocumentMetadata = {
  title?: string;
  moduleCodeHints?: string[];
  detectedDates?: { date: string; label: string; excerpt: string; location?: string }[];
  keyPoints?: string[];
  learningOutcomes?: string[];
  gradingCriteria?: string[];
  wordLimit?: string;
  referencingStyle?: string;
  extraction?: { method: string; warnings: string[] };
  relatedDocuments?: { id: string; filename: string; relation: string }[];
  suggestedModuleId?: string | null;
};

export type DocumentSummary = {
  id: string;
  moduleId: string | null;
  conversationId: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  kind: string;
  status: "queued" | "processing" | "ready" | "partial" | "failed";
  statusDetail: string | null;
  pageCount: number | null;
  summary: string | null;
  metadata: DocumentMetadata;
  isOwnWriting: boolean;
  createdAt: string;
  processedAt: string | null;
};

export type DocumentSection = { id: string; ordinal: number; location: string | null; page: number | null; heading: string | null; content: string };

export type Memory = {
  id: string;
  category: "profile" | "preference" | "module" | "assignment" | "general" | "working";
  moduleId: string | null;
  conversationId: string | null;
  content: string;
  status: "active" | "proposed" | "archived";
  origin: "extracted" | "user" | "onboarding";
  confidence: number;
  stability: "stable" | "temporary";
  expiresAt: string | null;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Deadline = {
  id: string;
  moduleId: string | null;
  title: string;
  dueAt: string;
  allDay: boolean;
  kind: "assignment" | "exam" | "milestone" | "other";
  status: "suggested" | "confirmed" | "done" | "dismissed";
  sourceDocumentId: string | null;
  sourceExcerpt: string | null;
  notes: string | null;
};

export type Task = {
  id: string;
  moduleId: string | null;
  title: string;
  details: string | null;
  doneWhen: string | null;
  dueAt: string | null;
  status: "todo" | "doing" | "done";
  priority: "essential" | "optional";
  estimateMinutes: number | null;
  createdAt: string;
};

export type NextStep = { title: string; reason: string; action: { label: string; href?: string; prompt?: string; moduleId?: string | null } };

export type Dashboard = {
  nextStep: NextStep;
  modules: { id: string; code: string | null; name: string; color: string; documentCount: number }[];
  deadlines: Deadline[];
  tasks: Task[];
  recentConversations: { id: string; title: string; updatedAt: string; moduleId: string | null }[];
  processing: { id: string; filename: string; status: string; statusDetail: string | null }[];
  counts: { documents: number; suggestedDeadlines: number; proposedMemories: number };
  onboarding: { completedSteps: string[]; skippedSteps: string[]; dismissed?: boolean };
};

export type StudentProfile = {
  userId: string;
  university: string | null;
  programme: string | null;
  yearOfStudy: string | null;
  semester: string | null;
  learningPrefs: { explanationStyle?: string; detailLevel?: "brief" | "balanced" | "detailed"; supports?: string[]; notes?: string };
  assistanceLevel: "guided" | "collaborative" | "drafting";
  accessibilityNotes: string | null;
  onboarding: { completedSteps: string[]; skippedSteps: string[]; dismissed?: boolean };
  settings: Record<string, unknown>;
};

export type WritingProfileData = {
  summary: string;
  voice: string[];
  vocabulary: string[];
  sentenceStructure: string[];
  organisation: string[];
  argumentation: string[];
  formality: string;
  preferredTransitions: string[];
  phrasesToKeep: string[];
  avoid: string[];
  improvementGoals: string[];
  uncertainties: string[];
};

export type WritingProfile = {
  id: string;
  context: string;
  profile: WritingProfileData | null;
  sampleCount: number;
  wordCount: number;
  confidence: "low" | "medium" | "high";
  userNotes: string | null;
  enabled: boolean;
  version: number;
  updatedAt: string;
  statsDescription: string[];
};

export type WritingSample = {
  id: string;
  title: string;
  context: string;
  origin: string;
  isSpoken: boolean;
  wordCount: number;
  exclusionNotes: string | null;
  documentId: string | null;
  createdAt: string;
};
