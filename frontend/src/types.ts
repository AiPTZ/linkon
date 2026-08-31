export type CampaignStatus =
  | "DRAFT"
  | "IMPORTING"
  | "RUNNING"
  | "PAUSED"
  | "LIMIT_HIT"
  | "COMPLETED"
  | "ERROR";

export type UserRole = "ADMIN" | "USER";

export type UserStatus = "PENDING" | "ACTIVE" | "BLOCKED";

export interface AuthUser {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  status: UserStatus;
}

export interface AdminUser extends AuthUser {
  whatsapp: string | null;
  status: UserStatus;
  createdAt: string;
  _count?: { accounts: number; campaigns: number; extractions: number };
}

export type AccountStatus =
  | "CONNECTING"
  | "OK"
  | "CHECKPOINT"
  | "DISCONNECTED"
  | "ERROR"
  | "STOPPED"
  | "CREDENTIALS"
  | "PERMISSIONS"
  | "PENDING_LINKEDIN"
  | "REJECTED";

export type LeadStatus =
  | "PENDING"
  | "INVITED"
  | "ACCEPTED"
  | "RESPONDED"
  | "ERROR"
  | "COMPLETED";

export type BlockType =
  | "start"
  | "invite"
  | "message"
  | "wait"
  | "on_accept"
  | "on_reply"
  | "condition"
  | "stop";

export interface FlowNode {
  id: string;
  type: BlockType;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  label?: string;
}

export interface Flow {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface Account {
  id: string;
  unipileAccountId: string;
  provider: string;
  username: string | null;
  authMethod: string;
  status: AccountStatus;
  checkpointType: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { campaigns: number };
  campaigns?: Pick<Campaign, "id" | "name" | "status">[];
  user?: { id: string; username: string | null } | null;
}

export interface KnowledgeBaseEntry {
  q: string;
  a: string;
}

export interface ChatbotKnowledgeBase {
  product: string;
  faq: KnowledgeBaseEntry[];
  prices: string[];
  differentiators: string[];
  objections: string[];
}

export type ChatbotMode = "RULES" | "LLM";
export type InitialMessageMode = "TEMPLATE" | "AI";

export interface NativeAgent {
  id: string;
  accountId: string;
  enabled: boolean;
  knowledgeBase: string;
  tone: string;
  transferMessage: string;
  replyDelayMin: number;
  replyDelayMax: number;
  maxTurns: number;
  replyDailyLimit: number;
  replyWeeklyLimit: number;
  initialMessageMode: InitialMessageMode;
  initialTemplate: string;
  schedulingEnabled: boolean;
  meetingDurationMin: number;
  meetingTitle: string;
}

export interface AgentConfig {
  enabled: boolean;
  knowledgeBase: ChatbotKnowledgeBase;
  tone: string;
  transferMessage: string;
  replyDelayMin: number;
  replyDelayMax: number;
  maxTurns: number;
  replyDailyLimit: number;
  replyWeeklyLimit: number;
  initialMessageMode: InitialMessageMode;
  initialTemplate: string;
  schedulingEnabled: boolean;
  meetingDurationMin: number;
  meetingTitle: string;
}

export interface AgentPayload {
  enabled?: boolean;
  knowledgeBase?: ChatbotKnowledgeBase;
  tone?: string;
  transferMessage?: string;
  replyDelayMin?: number;
  replyDelayMax?: number;
  maxTurns?: number;
  replyDailyLimit?: number;
  replyWeeklyLimit?: number;
  initialMessageMode?: InitialMessageMode;
  initialTemplate?: string;
  schedulingEnabled?: boolean;
  meetingDurationMin?: number;
  meetingTitle?: string;
}

export interface AgentAccountListItem {
  account: { id: string; username: string | null; unipileAccountId: string; status: string };
  agent: NativeAgent | null;
}

export interface Campaign {
  id: string;
  name: string;
  mode: "SEARCH" | "SWEEP" | "DISPARO";
  searchUrl: string;
  status: CampaignStatus;
  accountId: string;
  account: { id: string; username: string | null; status: AccountStatus };
  inviteMessage: string;
  dailyLimit: number;
  weeklyLimit: number;
  minDelayMin: number;
  maxDelayMin: number;
  workStartHour: number;
  workEndHour: number;
  flow: string;
  invitesSentToday: number;
  dateOfInviteCount: string | null;
  invitesSentWeek: number;
  weekStartDate: string | null;
  maxLeads: number;
  agentEnabled: boolean;
  nextInviteAt: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { leads: number };
  stats?: Record<string, number>;
}

export interface Lead {
  id: string;
  campaignId: string;
  providerId: string;
  publicIdentifier: string | null;
  name: string | null;
  headline: string | null;
  profileUrl: string | null;
  status: LeadStatus;
  selected: boolean;
  invitedAt: string | null;
  acceptedAt: string | null;
  lastMessageAt: string | null;
  lastMessageText: string | null;
  emails: string | null;
  phones: string | null;
  contactScrapedAt: string | null;
  nextInviteAt: string | null;
  currentBlockId: string | null;
  replyCount: number;
  errorCode: string | null;
  createdAt: string;
}

export interface LogEvent {
  id: string;
  campaignId: string | null;
  leadId: string | null;
  accountId: string | null;
  type: string;
  level: "INFO" | "WARN" | "ERROR";
  message: string;
  payload: string | null;
  createdAt: string;
}

export interface ContactScrapeStats {
  total: number;
  scraped: number;
  withContact: number;
  withEmail: number;
  withPhone: number;
  pending: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ConfigInfo {
  unipileDsnConfigured: boolean;
  unipileAccessTokenConfigured: boolean;
  webhookPublicUrl: string;
  webhookPublicUrlConfigured: boolean;
  webhooks: {
    id: string;
    source: string;
    requestUrl: string;
    createdAt: string;
  }[];
}

export interface HealthInfo {
  ok: boolean;
  timestamp: string;
  redis: boolean;
  unipileConfigured: boolean;
  accounts: number;
  campaigns: number;
}

export interface RelationsPreview {
  total: number;
  capped: boolean;
  sample: { name: string | null; headline: string | null; publicProfileUrl: string | null }[];
  account: { id: string; username: string | null };
}

export interface CampaignPayload {
  name: string;
  mode?: "SEARCH" | "SWEEP" | "DISPARO";
  searchUrl?: string;
  accountId: string;
  inviteMessage?: string;
  dailyLimit?: number;
  weeklyLimit?: number;
  minDelayMin?: number;
  maxDelayMin?: number;
  workStartHour?: number;
  workEndHour?: number;
  maxLeads?: number;
  agentEnabled?: boolean;
  flow?: Flow;
}

export interface Notification {
  id: string;
  accountId: string | null;
  campaignId: string | null;
  type: string;
  level: "INFO" | "WARN" | "ERROR";
  message: string;
  payload: string | null;
  read: boolean;
  createdAt: string;
}

export type ExtractionStatus = "PROCESSING" | "COMPLETED" | "FAILED";

export interface Extraction {
  id: string;
  name: string;
  searchUrl: string;
  accountId: string;
  account: { id: string; username: string | null };
  status: ExtractionStatus;
  maxResults: number;
  totalFound: number;
  processed: number;
  withContact: number;
  error: string | null;
  leadsCount: number;
  createdAt: string;
  updatedAt: string;
  user?: { id: string; username: string | null } | null;
}

export interface ExtractedLead {
  id: string;
  extractionId: string;
  providerId: string;
  publicIdentifier: string | null;
  name: string | null;
  headline: string | null;
  profileUrl: string | null;
  emails: string | null;
  phones: string | null;
  socials: string | null;
  networkDistance: string | null;
  scrapedAt: string | null;
  createdAt: string;
}

export interface NotificationsResponse {
  items: Notification[];
  unread: number;
}

export type ConversationStatus = "BOT" | "NEEDS_HUMAN" | "HUMAN" | "CLOSED";
export type MessageRole = "LEAD" | "BOT" | "HUMAN" | "SYSTEM";

export interface ConversationSummary {
  id: string;
  status: ConversationStatus;
  lastMessageAt: string;
  lastMessage: string | null;
  unread: number;
  lead: { name: string | null; headline: string | null; profileUrl: string | null } | null;
  campaign: { id: string; name: string; mode: "SEARCH" | "SWEEP" | "DISPARO" } | null;
  account: { username: string | null };
  booking: { startTime: string; meetLink: string | null } | null;
}

export interface InboxListResponse {
  items: ConversationSummary[];
  needsHuman: number;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  messageId: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  createdAt: string;
}
