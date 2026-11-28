import mysql, {
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import superjson from "superjson";
import { expect, test } from "./fixtures/base-test";
import { useBrowserSession } from "./fixtures/browser-session";
import { rpc, sqlRows } from "./fixtures/hardening";
import { disposableDatabaseUrl } from "./disposable-database";
import en from "../client/src/i18n/locales/en.json" with { type: "json" };

test.use({ trace: "off", video: "off", screenshot: "off" });

function isProcedure(url: string, procedure: string) {
  return (
    new URL(url).pathname.split("/").at(-1)?.split(",").includes(procedure) ===
    true
  );
}

test("restores a busy chat draft after a real admission rejection without changing saved conversation state", async ({
  page,
}) => {
  if (process.env.BUILT_IN_FORGE_API_KEY)
    throw new Error("Run this acceptance with the Forge provider key unset");
  await page.addInitScript(() => localStorage.setItem("i18nextLng", "en"));
  await useBrowserSession(page, "regular");
  const owner = await rpc(page).auth.me.query();
  if (!owner) throw new Error("The synthetic passenger session is required");

  let conversationId: number | undefined;
  let sends = 0;
  page.on("request", request => {
    if (
      request.method() === "POST" &&
      isProcedure(request.url(), "aiChat.sendMessage")
    )
      sends += 1;
  });

  try {
    await page.goto("/ai-chat");
    const starting = page.waitForResponse(response =>
      isProcedure(response.url(), "aiChat.startConversation")
    );
    await page
      .getByRole("button", { name: en.aiChat.startConversation })
      .click();
    const started = await starting;
    expect(started.ok()).toBe(true);
    const batch = await started.json();
    const result = superjson.deserialize<{
      conversationId: number;
      greeting: string;
    }>(batch[0].result.data);
    expect(Number.isSafeInteger(result.conversationId)).toBe(true);
    conversationId = result.conversationId;
    const log = page.getByRole("log", { name: en.aiChat.conversationLog });
    await expect(log).toContainText(result.greeting);

    // This setup shortcut represents an earlier accepted turn. It is not a
    // second browser send or proof of provider timing. The action under test
    // below uses the real browser, tRPC router, admission transaction and DB.
    const priorMessage = "Synthetic earlier accepted request";
    const setup = await mysql.createConnection(disposableDatabaseUrl());
    try {
      await setup.beginTransaction();
      const [conversations] = await setup.execute<RowDataPacket[]>(
        "SELECT status, messageCount, pendingMessageId, pendingUntil FROM chat_conversations WHERE id = ? AND userId = ? FOR UPDATE",
        [conversationId, owner.id]
      );
      expect(conversations).toHaveLength(1);
      expect(conversations[0]).toMatchObject({
        status: "active",
        messageCount: 1,
        pendingMessageId: null,
        pendingUntil: null,
      });
      const [messages] = await setup.execute<RowDataPacket[]>(
        "SELECT id, role FROM chat_messages WHERE conversationId = ? ORDER BY id",
        [conversationId]
      );
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe("assistant");
      const [pending] = await setup.execute<ResultSetHeader>(
        "INSERT INTO chat_messages (conversationId, role, content) VALUES (?, 'user', ?)",
        [conversationId, priorMessage]
      );
      const [claim] = await setup.execute<ResultSetHeader>(
        "UPDATE chat_conversations SET messageCount = messageCount + 1, pendingMessageId = ?, pendingUntil = CURRENT_TIMESTAMP(3) + INTERVAL 150 SECOND, lastMessageAt = CURRENT_TIMESTAMP(3) WHERE id = ? AND userId = ?",
        [pending.insertId, conversationId, owner.id]
      );
      expect(claim.affectedRows).toBe(1);
      await setup.commit();
    } catch (error) {
      await setup.rollback();
      throw error;
    } finally {
      await setup.end();
    }

    const snapshot = async () => {
      const [conversation, messages, suggestions] = await Promise.all([
        sqlRows(
          "SELECT id, status, messageCount, pendingMessageId, pendingUntil, lastMessageAt, updatedAt, CAST(context AS CHAR) AS contextJson FROM chat_conversations WHERE id = ? AND userId = ?",
          [conversationId!, owner.id]
        ),
        sqlRows(
          "SELECT id, role, content, CAST(metadata AS CHAR) AS metadataJson FROM chat_messages WHERE conversationId = ? ORDER BY id",
          [conversationId!]
        ),
        sqlRows(
          "SELECT id, messageId, flightId, totalPrice, selected FROM booking_suggestions WHERE conversationId = ? ORDER BY id",
          [conversationId!]
        ),
      ]);
      return { conversation, messages, suggestions };
    };
    const before = await snapshot();
    expect(before.messages).toHaveLength(2);
    expect(before.suggestions).toHaveLength(0);

    const draft = "Please compare flights for this rejected draft";
    const input = page.getByRole("textbox", { name: en.aiChat.messageLabel });
    await input.fill(draft);
    const rejecting = page.waitForResponse(response =>
      isProcedure(response.url(), "aiChat.sendMessage")
    );
    await page.getByRole("button", { name: en.aiChat.sendMessage }).click();
    const rejected = await rejecting;
    expect(rejected.status()).toBe(409);
    const rejectedBatch = await rejected.json();
    expect(rejectedBatch[0].error.json.data.code).toBe("CONFLICT");
    await expect(input).toHaveValue(draft);
    await expect(input).toBeEnabled();
    await expect(
      page.getByText(en.aiChat.sendBusy, { exact: true })
    ).toBeVisible();
    await expect(log).not.toContainText(draft);
    await expect(
      page.getByRole("button", { name: en.aiChat.stopWaiting })
    ).toHaveCount(0);
    expect(await snapshot()).toEqual(before);

    // History is a real read. A live pending turn is still only a user row;
    // refresh neither invents an assistant response nor triggers recovery.
    await page.getByRole("button", { name: en.aiChat.refreshHistory }).click();
    await expect(log).toContainText(priorMessage);
    await expect(input).toHaveValue(draft);
    await expect(log).not.toContainText(draft);
    expect(await snapshot()).toEqual(before);
    expect(sends).toBe(1);
  } finally {
    if (conversationId !== undefined) {
      const cleanup = await mysql.createConnection(disposableDatabaseUrl());
      try {
        await cleanup.beginTransaction();
        const [owned] = await cleanup.execute<RowDataPacket[]>(
          "SELECT id FROM chat_conversations WHERE id = ? AND userId = ? FOR UPDATE",
          [conversationId, owner.id]
        );
        if (owned.length) {
          await cleanup.execute(
            "DELETE FROM booking_suggestions WHERE conversationId = ?",
            [conversationId]
          );
          await cleanup.execute(
            "DELETE FROM chat_messages WHERE conversationId = ?",
            [conversationId]
          );
          await cleanup.execute(
            "DELETE FROM chat_conversations WHERE id = ? AND userId = ?",
            [conversationId, owner.id]
          );
        }
        await cleanup.commit();
      } catch (error) {
        await cleanup.rollback();
        throw error;
      } finally {
        await cleanup.end();
      }
    }
  }
});
