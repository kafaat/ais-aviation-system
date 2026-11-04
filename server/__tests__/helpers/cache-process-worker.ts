// Real cache + real MySQL authority + real ioredis in an independently killable
// process. The parent acceptance owns all URLs, schema, prefix and sockets.
import {
  redisCacheService,
  type CacheGeneration,
} from "../../services/redis-cache.service";
import { closePool } from "../../db";

export type CacheCommand = {
  id: number;
  operation:
    | "connected"
    | "get"
    | "set"
    | "capture"
    | "fill"
    | "invalidate"
    | "clear"
    | "raw-get"
    | "raw-set"
    | "shutdown";
  namespace?: string;
  value?: unknown;
  token?: string;
};
const captures = new Map<string, CacheGeneration>();
process.on("message", async (message: CacheCommand) => {
  const namespace = message.namespace ?? "search";
  try {
    let value: unknown;
    switch (message.operation) {
      case "connected":
        value = redisCacheService.isConnected();
        break;
      case "get":
        value = await redisCacheService.get(namespace, { id: 1 });
        break;
      case "set":
        await redisCacheService.set(namespace, { id: 1 }, message.value, 300);
        break;
      case "capture":
        captures.set(
          message.token!,
          await redisCacheService.captureGeneration(namespace)
        );
        break;
      case "fill":
        await redisCacheService.set(
          namespace,
          { id: 1 },
          message.value,
          300,
          captures.get(message.token!)
        );
        break;
      case "invalidate":
        await redisCacheService.invalidateNamespace(namespace);
        break;
      case "clear":
        await redisCacheService.clearAll();
        break;
      case "raw-get":
        value = await redisCacheService.getRaw(namespace);
        break;
      case "raw-set":
        await redisCacheService.setRaw(namespace, message.value, 300);
        break;
      case "shutdown":
        await redisCacheService.shutdown();
        await closePool();
        break;
    }
    process.send?.({ id: message.id, value });
    if (message.operation === "shutdown") process.disconnect();
  } catch (error) {
    process.send?.({
      id: message.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
process.send?.({ ready: true });
