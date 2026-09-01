import type { ChatMessage, ModelInfo, ProviderConfig, ProviderId } from './types';

declare global {
  interface Window {
    jarvis: {
      getSettings: () => Promise<{ providers: ProviderConfig[]; voice: string; voiceProfile: 'natural' | 'classic' | 'deep'; language: string; wakeWord: boolean; voiceEnabled: boolean; assistantName: string; userName: string; legacyKeys: { CohereAPIKey?: string; GroqAPIKey?: string; HuggingFaceAPIKey?: string } }>;
      setSettings: (input: { providers?: ProviderConfig[]; voice?: string; voiceProfile?: 'natural' | 'classic' | 'deep'; language?: string; wakeWord?: boolean; voiceEnabled?: boolean; assistantName?: string; userName?: string; legacyKeys?: { CohereAPIKey?: string; GroqAPIKey?: string; HuggingFaceAPIKey?: string } }) => Promise<void>;
      faceProfiles: () => Promise<Array<{ id: string; displayName: string; relation: 'operator' | 'family'; greeting: string; facts: { age?: number | null; work?: string; notes?: string }; embeddings: number[][]; voiceEmbeddings: number[][]; createdAt: string; updatedAt: string }>>;
      saveFaceProfile: (profile: { id?: string; displayName: string; relation: 'operator' | 'family'; greeting?: string; facts?: { age?: number | null; work?: string; notes?: string }; embeddings: number[][]; voiceEmbeddings?: number[][] }) => Promise<any>;
      deleteFaceProfile: (id: string) => Promise<boolean>;
      clearFaceProfiles: () => Promise<boolean>;
      listModels: (provider: ProviderConfig) => Promise<ModelInfo[]>;
      diagnostics: () => Promise<any>;
      networkStatus: () => Promise<any>;
      deviceIdentity: () => Promise<any>;
      requestTelemetry: () => Promise<void>;
      onSystemTelemetry: (callback: (payload: { diagnostics?: any; network?: any; identity?: any; collectedAt?: string }) => void) => () => void;
      adb: (command: string) => Promise<{ ok: boolean; stdout: string; stderr: string; code: number }>;
      adbStatus: () => Promise<{ installed: boolean; available: boolean; output: string; devices: string[] }>;
      currentLocation: () => Promise<any>;
      weather: (latitude: number, longitude: number) => Promise<any>;
      searchLocation: (query: string) => Promise<Array<{ display_name: string; lat: string; lon: string; type?: string }>>;
      systemLogs: () => Promise<{ source: string; lines: string[] }>;
      query: (input: { query: string; providers: ProviderConfig[]; preferred?: ProviderId; history?: ChatMessage[] }) => Promise<{ kind: string; answer: string; provider: string; attempts: string[]; images?: string[] }>;
      pythonCapability: (input: { operation: string; payload?: Record<string, any> }) => Promise<any>;
      voiceEmbed: (audioBase64: string) => Promise<number[]>;
      voiceStatus: () => Promise<{ nativeListen: boolean; piper: boolean; kokoro: boolean; edge: boolean; note: string }>;
      sttStart: (language?: string) => Promise<{ available: boolean; running?: boolean; reason?: string }>;
      sttStatus: () => Promise<{ running: boolean; script: string }>;
      sttStop: () => Promise<boolean>;
      onSttTranscript: (callback: (payload: { text: string; confidence?: number }) => void) => () => void;
      onSttError: (callback: (message: string) => void) => () => void;
      speak: (input: { text: string; voice: string; language?: string; voiceProfile?: 'natural' | 'classic' | 'deep' }) => Promise<{ source: string; file?: string; dataUrl?: string; error?: string }>;
      openUrl: (url: string) => Promise<unknown>;
      requestElevation: () => Promise<boolean>;
      minimize: () => Promise<void>;
      maximize: () => Promise<void>;
      close: () => Promise<void>;
    };
  }
}
export {};
