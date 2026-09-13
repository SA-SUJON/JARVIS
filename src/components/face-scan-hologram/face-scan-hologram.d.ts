export interface MountStats {
  fps: number;
  lowQuality: boolean;
  nodes: number;
  edges: number;
  particles: number;
  dpr: number;
}

export interface MountTrackingData {
  blendshapes?: Array<{ categoryName: string; score: number }> | Record<string, number | { score: number }>;
  handLandmarks?: Array<Array<{ x: number; y: number; z: number }>>;
}

export interface HologramInstance {
  startScan: () => boolean;
  reset: () => void;
  getState: () => string;
  getStats: () => MountStats;
  applyTracking: (data: MountTrackingData) => void;
  destroy: () => void;
}

export interface MountOptions {
  coarseDuration?: number;
  pauseDuration?: number;
  scanDuration?: number;
  completeDuration?: number;
  hudRate?: number;
  idleParticles?: number;
  maxParticles?: number;
  onStateChange?: ((next: string, prev?: string) => void) | null;
}

export function mount(container: HTMLElement, options?: MountOptions): HologramInstance;

export default mount;
