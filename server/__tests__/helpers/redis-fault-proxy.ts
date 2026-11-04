import { createServer, connect, type Socket } from "node:net";

/** An owned loopback TCP partition; it never stops or resets the target Redis. */
export async function startRedisFaultProxy(targetURL: string) {
  const target = new URL(targetURL);
  if (
    target.protocol !== "redis:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)
  )
    throw new Error(
      "Redis fault proxy requires an explicit loopback Redis URL"
    );
  let offline = false;
  const sockets = new Set<Socket>();
  const server = createServer(client => {
    if (offline) {
      client.destroy();
      return;
    }
    const upstream = connect({
      host: target.hostname.replace(/^\[|\]$/g, ""),
      port: Number(target.port || 6379),
    });
    for (const socket of [client, upstream]) {
      sockets.add(socket);
      socket.on("error", () => {
        client.destroy();
        upstream.destroy();
      });
      socket.on("close", () => {
        sockets.delete(socket);
        client.destroy();
        upstream.destroy();
      });
    }
    client.pipe(upstream).pipe(client);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing proxy port");
  const url = new URL(target);
  url.hostname = "127.0.0.1";
  url.port = String(address.port);
  return {
    url: url.toString(),
    disconnect() {
      offline = true;
      for (const socket of sockets) socket.destroy();
    },
    reconnect() {
      offline = false;
    },
    async close() {
      offline = true;
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve()))
      );
    },
  };
}
