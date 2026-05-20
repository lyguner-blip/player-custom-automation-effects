import { EFFECT_MODULE_ID, MODULE_ID, SETTINGS } from "../constants.mjs";
import {
  cinematicEffectMatch,
  escapeAttribute,
  escapeHTML,
  normalizeText,
  notify,
  recordEvent,
  refreshSharedPanel,
  setting
} from "../shared/context.mjs";
import { normalizeToken, tokenForActor } from "../shared/tokens.mjs";

const MONK_FOCUS_ITEM_IDS = new Set(["8YOLsGMuPManzLkm"]);

export const monkFocusAutomation = {
  id: "monk-focus",
  label: "武僧武功",
  registerSettings,
  isEnabled,
  isActivity: isMonkFocusActivity,
  isItem: isMonkFocusItem,
  findItem: findMonkFocusItem,
  run: runMonkFocus,
  renderPanel: renderMonkFocusPanel,
  shouldOwnAnimation,
  handleAction
};

function isEnabled() {
  return Boolean(setting(SETTINGS.monkFocusEnabled));
}

function registerSettings() {
  game.settings.register(MODULE_ID, SETTINGS.monkFocusEnabled, {
    name: game.i18n.localize("PCAE.Settings.MonkFocusEnabled.Name"),
    hint: game.i18n.localize("PCAE.Settings.MonkFocusEnabled.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
}

async function runMonkFocus(context = {}) {
  const actor = context.actor ?? context.item?.actor;
  const item = context.item ?? findMonkFocusItem(actor);
  if (!actor || !item || !actorOwnsMonkFocus(actor, item)) {
    notify("warn", "没有找到已由特效库绑定的武僧武功条目。");
    return false;
  }
  if (!canvas?.ready) {
    notify("warn", "请先进入一个已加载的场景。");
    return false;
  }

  const source = normalizeToken(context.source) ?? tokenForActor(actor);
  if (!source) {
    notify("warn", `没有找到 ${actor.name ?? "角色"} 的场景 Token。`);
    return false;
  }

  const selectedTargets = Array.from(game.user?.targets ?? [])
    .map(normalizeToken)
    .filter((target) => target && target !== source);
  const targets = selectedTargets.length ? selectedTargets : [source];
  const played = await playLinkedMonkFocusAnimation(actor, item, source, targets, context);
  recordEvent(actor, item, targets[0] ?? source, played ? "武僧武功" : "武僧武功未播放");
  refreshSharedPanel();
  return played;
}

async function playLinkedMonkFocusAnimation(actor, item, source, targets = [], context = {}) {
  const api = game.modules.get(EFFECT_MODULE_ID)?.api ?? globalThis.PlayerCustomCinematicEffects;
  if (typeof api?.playItemEffect !== "function") {
    notify("warn", "玩家定制特效库未就绪，无法播放武僧武功联动动画。");
    return false;
  }
  return api.playItemEffect({
    actor,
    item,
    source,
    targets,
    activity: context.activity,
    usageConfig: context.usageConfig,
    results: context.results,
    trigger: "automation",
    skipAutomationGuard: true,
    force: true
  });
}

function shouldOwnAnimation({ actor, item } = {}) {
  return Boolean(setting(SETTINGS.monkFocusEnabled) && actorOwnsMonkFocus(actor, item));
}

function renderMonkFocusPanel(actor, item) {
  item ??= findMonkFocusItem(actor);
  const source = tokenForActor(actor);
  const enabled = setting(SETTINGS.monkFocusEnabled);
  const canRun = Boolean(item && source);
  const status = !source ? "无Token" : "可执行";

  return `
    <div class="pcae-row">
      <div class="pcae-name">
        <strong>武僧武功</strong>
        <span>${escapeHTML(status)} · 多活动差分 · ${escapeHTML(item?.name ?? "Monk's Focus")}</span>
      </div>
      <label class="pcae-toggle">
        <input type="checkbox" data-pcae-setting="${SETTINGS.monkFocusEnabled}" ${enabled ? "checked" : ""}>
        <span>自动</span>
      </label>
      <button type="button" class="pcae-run" data-pcae-action="run-monk-focus" data-actor-id="${escapeAttribute(actor.id)}" ${canRun ? "" : "disabled"} title="执行武僧武功">
        <i class="fas fa-hand-fist"></i>
      </button>
    </div>
    <div class="pcae-mini">
      <span class="pcce-pill ${enabled && canRun ? "is-ok" : "is-bad"}">${enabled ? "自动化开" : "自动化关"}</span>
      <span class="pcce-pill is-ok">差分动画</span>
      <span class="pcce-pill">疾风连击 / 疾步如风 / 闪转腾挪</span>
    </div>
  `;
}

async function handleAction(action, actor) {
  if (action !== "run-monk-focus") return false;
  return runMonkFocus({ actor, manual: true });
}

function findMonkFocusItem(actor) {
  return Array.from(actor?.items ?? []).find((item) => actorOwnsMonkFocus(actor, item)) ?? null;
}

function isMonkFocusItem(item) {
  if (!item) return false;
  if (MONK_FOCUS_ITEM_IDS.has(String(item.id ?? item._id ?? ""))) return true;
  const name = normalizeText(`${item.name ?? ""} ${foundry.utils.getProperty(item, "flags.babele.originalName") ?? ""}`);
  return name.includes("武僧武功") || name.includes("monksfocus") || name.includes("monkfocus");
}

function isMonkFocusActivity(activity) {
  return actorOwnsMonkFocus(activity?.actor ?? activity?.item?.actor, activity?.item);
}

function actorOwnsMonkFocus(actor, item) {
  if (!actor || !item) return false;
  const match = cinematicEffectMatch(actor, item);
  return Boolean(match?.effect) && isMonkFocusItem(item);
}
