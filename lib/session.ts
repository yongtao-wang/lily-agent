export interface FileRef {
  filename: string;
  path: string;
  mimeType: string;
  sizeBytes: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  attachments?: FileRef[];
  createdAt: number;
}

export interface Session {
  id: string;
  stageId?: string;
  messages: ChatMessage[];
  files: FileRef[];
  escalated: boolean;
  createdAt: number;
}

const sessions = new Map<string, Session>();

export function getOrCreateSession(id: string): Session {
  let s = sessions.get(id);
  if (!s) {
    s = {
      id,
      messages: [],
      files: [],
      escalated: false,
      createdAt: Date.now(),
    };
    sessions.set(id, s);
  }
  return s;
}

export function getSession(id: string): Session | undefined {
  return sessions.get(id);
}

export function setStage(id: string, stageId: string | undefined): void {
  const s = getOrCreateSession(id);
  s.stageId = stageId;
}

export function appendMessage(id: string, msg: ChatMessage): void {
  const s = getOrCreateSession(id);
  s.messages.push(msg);
}

export function appendFiles(id: string, files: FileRef[]): void {
  const s = getOrCreateSession(id);
  s.files.push(...files);
}

export function markEscalated(id: string): void {
  const s = getOrCreateSession(id);
  s.escalated = true;
}

export function getRecentMessages(id: string, n: number): ChatMessage[] {
  const s = sessions.get(id);
  if (!s) return [];
  return s.messages.slice(-n);
}
