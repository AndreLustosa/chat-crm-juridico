export interface ConversationSummary {
  id: string;
  leadId: string;
  contactName: string;
  contactPhone: string;
  channel: string;
  status: string;
  lastMessage: string;
  lastMessageAt: string;
  assignedAgentId?: string | null;
  assignedAgentName: string | null;
  aiMode: boolean;
  profile_picture_url?: string | null;
  inboxId?: string | null;
  legalArea?: string | null;
  assignedLawyerId?: string | null;
  assignedLawyerName?: string | null;
  originAssignedUserId?: string | null;
  originAssignedUserName?: string | null;
  leadStage?: string | null;
}

export interface MessageItem {
  id: string;
  conversation_id: string;
  external_message_id?: string | null;
  direction: 'in' | 'out';
  type: string;
  text: string | null;
  status: string;
  created_at: string;
  reply_to_id?: string | null;
  reply_to_text?: string | null;
  media?: { original_url?: string; mime_type?: string; duration?: number | null; original_name?: string | null } | null;
}
