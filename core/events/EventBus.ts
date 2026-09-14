import type { EventName, JarvisEvent } from "../contracts/types.js";

type EventHandler<T = unknown> = (event: JarvisEvent<T>) => void | Promise<void>;

export class EventBus {
  private readonly handlers = new Map<EventName, Set<EventHandler>>();

  on<T>(name: EventName, handler: EventHandler<T>): () => void {
    let handlers = this.handlers.get(name);

    if (!handlers) {
      handlers = new Set();
      this.handlers.set(name, handlers);
    }

    handlers.add(handler as EventHandler);

    return () => {
      handlers?.delete(handler as EventHandler);

      if (handlers && handlers.size === 0) {
        this.handlers.delete(name);
      }
    };
  }

  async emit<T>(
    name: EventName,
    payload?: T,
    metadata: {
      requestId?: string;
      taskId?: string;
    } = {}
  ): Promise<void> {
    const event: JarvisEvent<T> = {
      id: crypto.randomUUID(),
      name,
      timestamp: new Date().toISOString(),
      ...metadata,
      payload,
    };

    const handlers = this.handlers.get(name);

    if (!handlers) {
      return;
    }

    await Promise.all(
      [...handlers].map((handler) => Promise.resolve(handler(event)))
    );
  }

  clear(): void {
    this.handlers.clear();
  }
}
