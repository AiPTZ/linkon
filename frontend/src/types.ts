export type CampaignStatus =
  | "DRAFT"
  | "IMPORTING"
  | "RUNNING"
  | "PAUSED"
  | "LIMIT_HIT"
  | "COMPLETED"
  | "ERROR";

export type AccountStatus =
  | "CONNECTING"
  | "OK"
  | "CHECKPOINT"
  | "DISCONNECTED"
  | "ERROR"
  | "STOPPED"
  | "CREDENTIALS"
  | "PERMISSIONS";

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
}

export interface ChatbotRule {
  matchType: "contains" | "keywords" | "regex";
  pattern: string;
  reply: string;
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
  chatbotEnabled: boolean;
  chatbotRules: string;
  chatbotDefaultReply: string;
  chatbotReplyDelayMin: number;
  chatbotReplyDelayMax: number;
  chatbotStopKeywords: string;
  maxRepliesPerLead: number;
  flow: string;
  invitesSentToday: number;
  dateOfInviteCount: string | null;
  invitesSentWeek: number;
  weekStartDate: string | null;
  maxLeads: number;
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
  chatbotEnabled?: boolean;
  chatbotRules?: ChatbotRule[];
  chatbotDefaultReply?: string;
  chatbotReplyDelayMin?: number;
  chatbotReplyDelayMax?: number;
  chatbotStopKeywords?: string[];
  maxRepliesPerLead?: number;
  maxLeads?: number;
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

export interface NotificationsResponse {
  items: Notification[];
  unread: number;
}
