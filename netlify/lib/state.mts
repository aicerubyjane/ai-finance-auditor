// Small persisted state that the Python app kept in memory: the active day sheet
// and the Telegram bot's per-chat conversation step. Stored in Netlify Blobs.
import { getStore } from "@netlify/blobs";

const store = () => getStore({ name: "finance-auditor", consistency: "strong" });

export async function getActiveSheetSetting(): Promise<string> {
  try {
    return (await store().get("active-sheet", { type: "text" })) || "";
  } catch (e) {
    console.warn("Gagal membaca active-sheet:", e);
    return "";
  }
}

export async function setActiveSheetSetting(name: string): Promise<void> {
  await store().set("active-sheet", name);
}

export type BotSession = { state: string | null; data: Record<string, any> };

export async function getBotSession(userId: string): Promise<BotSession> {
  const s = await store().get(`bot-session/${userId}`, { type: "json" });
  return (s as BotSession) || { state: null, data: {} };
}

export async function saveBotSession(userId: string, session: BotSession): Promise<void> {
  if (!session.state) await store().delete(`bot-session/${userId}`);
  else await store().setJSON(`bot-session/${userId}`, session);
}
