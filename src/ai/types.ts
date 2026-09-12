/**
 * Tipos e interfaces para proveedores de Inteligencia Artificial
 */

export interface ChatMessage {
  role: 'user' | 'assistant';
  senderName: string;
  text: string;
  timestamp: number;
}

export interface GenerateReplyOptions {
  maxTokens?: number;
  systemPrompt?: string;
  userGender?: 'male' | 'female' | null;
  isReplyingToBotJoke?: boolean;
}

export interface AIProvider {
  readonly name: string;
  generateReply(
    prompt: string,
    history: ChatMessage[],
    options?: GenerateReplyOptions
  ): Promise<string>;
}
