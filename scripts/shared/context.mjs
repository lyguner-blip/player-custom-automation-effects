import { EFFECT_MODULE_ID, MODULE_ID, MODULE_TITLE } from "../constants.mjs";

const recentEvents = [];
const duplicateEvents = new Map();

export function getRecentEvents() {
  return foundry.utils.deepClone(recentEvents);
}

export function setting(key) {
  return game.settings.get(MODULE_ID, key);
}

export function notify(type, message) {
  ui.notifications?.[type]?.(`${MODULE_TITLE} | ${message}`);
}

export function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function isMidiActive() {
  return Boolean(game.modules.get("midi-qol")?.active && globalThis.MidiQOL);
}

export function refreshSharedPanel() {
  const api = game.modules.get(EFFECT_MODULE_ID)?.api ?? globalThis.PlayerCustomCinematicEffects;
  api?.refreshPanel?.({ rerender: true, preserveScroll: true });
}

export function recordEvent(actor, item, target, state) {
  recentEvents.unshift({
    at: Date.now(),
    actorName: actor?.name ?? "未知角色",
    itemName: item?.name ?? "未知条目",
    targetName: target?.name ?? target?.document?.name ?? "未知目标",
    state
  });
  recentEvents.splice(8);
}

export function isDuplicateEvent(key, windowMs = 1400) {
  const now = Date.now();
  const previous = duplicateEvents.get(key) ?? 0;
  duplicateEvents.set(key, now);
  for (const [entryKey, timestamp] of duplicateEvents.entries()) {
    if (now - timestamp > 5000) duplicateEvents.delete(entryKey);
  }
  return now - previous < windowMs;
}

export function cinematicEffectMatch(actor, item) {
  const api = cinematicApi();
  if (typeof api?.getActorEffect !== "function") return null;
  try {
    return api.getActorEffect(actor, item);
  } catch (error) {
    console.warn(`${MODULE_TITLE} | 特效库绑定查询失败`, { actor, item, error });
    return null;
  }
}

export function cinematicApi() {
  return game.modules.get(EFFECT_MODULE_ID)?.api ?? globalThis.PlayerCustomCinematicEffects ?? null;
}

export function shouldHandleActor(actor) {
  if (!actor) return false;
  const owners = activeNonGmOwners(actor);
  if (game.user?.isGM) return true;
  if (!actorUserCanControl(actor, game.user)) return false;
  return owners[0]?.id === game.user?.id;
}

export function activeNonGmOwners(actor) {
  return Array.from(game.users ?? [])
    .filter((user) => user.active && !user.isGM && actorUserCanControl(actor, user))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

export function actorUserCanControl(actor, user) {
  if (!actor || !user) return false;
  try {
    if (typeof actor.testUserPermission === "function") return actor.testUserPermission(user, "OWNER");
  } catch (error) {
    return false;
  }
  return Boolean(actor.isOwner);
}

export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\-_.·'’"“”()（）:：]/gu, "")
    .trim();
}

export function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

export function escapeAttribute(value) {
  return escapeHTML(value).replace(/`/g, "&#96;");
}

export function errorMessage(error) {
  return error?.message ?? String(error);
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
