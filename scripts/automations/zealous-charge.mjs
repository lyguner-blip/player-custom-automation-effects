import { EFFECT_MODULE_ID, MODULE_ID, SETTINGS } from "../constants.mjs";
import {
  actorUserCanControl,
  cinematicEffectMatch,
  escapeAttribute,
  escapeHTML,
  normalizeText,
  notify,
  recordEvent,
  refreshSharedPanel,
  setting,
  wait
} from "../shared/context.mjs";
import {
  chargeAnimationTiming,
  findChargeDestination,
  moveToken,
  normalizeToken,
  resolveChargeTarget,
  tokenCenterFromPosition,
  tokenForActor
} from "../shared/tokens.mjs";

const ZEALOUS_CHARGE_ITEM_IDS = new Set(["D6sdL1bWPl4HdCaq"]);
const ZEALOUS_CHARGE_SOURCE_IDS = new Set(["Compendium.the-crooked-moon-2014.tcm2014-player-options.Item.HN3ch6MatqvtyZD0"]);
const ZEALOUS_CHARGE_EFFECT_IDS = new Set(["zealous-charge-gravebreaker"]);
const ZEALOUS_CHARGE_SEQUENCES = new Set(["lawrenceCharge"]);

export const zealousChargeAutomation = {
  id: "zealous-charge",
  label: "狂热冲锋",
  registerSettings,
  isEnabled,
  isActivity: isZealousChargeActivity,
  isItem: isZealousChargeItem,
  findItem: findZealousChargeItem,
  run: runZealousCharge,
  renderPanel: renderZealousChargePanel,
  shouldOwnAnimation,
  handleAction,
  handlePostRollAttack,
  handleMidiAttackRollComplete,
  suppressImmediateDamage: suppressZealousChargeImmediateDamage
};

function isEnabled() {
  return Boolean(setting(SETTINGS.zealousChargeEnabled));
}

function registerSettings() {
  game.settings.register(MODULE_ID, SETTINGS.zealousChargeEnabled, {
    name: game.i18n.localize("PCAE.Settings.ZealousChargeEnabled.Name"),
    hint: game.i18n.localize("PCAE.Settings.ZealousChargeEnabled.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, SETTINGS.zealousChargeMoveToken, {
    name: game.i18n.localize("PCAE.Settings.ZealousChargeMoveToken.Name"),
    hint: game.i18n.localize("PCAE.Settings.ZealousChargeMoveToken.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, SETTINGS.zealousChargeAnimation, {
    name: game.i18n.localize("PCAE.Settings.ZealousChargeAnimation.Name"),
    hint: game.i18n.localize("PCAE.Settings.ZealousChargeAnimation.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, SETTINGS.zealousChargeMaxDistance, {
    name: game.i18n.localize("PCAE.Settings.ZealousChargeMaxDistance.Name"),
    hint: game.i18n.localize("PCAE.Settings.ZealousChargeMaxDistance.Hint"),
    scope: "world",
    config: true,
    type: Number,
    default: 60,
    range: {
      min: 0,
      max: 120,
      step: 5
    }
  });

  game.settings.register(MODULE_ID, SETTINGS.zealousChargePendingEffect, {
    name: game.i18n.localize("PCAE.Settings.ZealousChargePendingEffect.Name"),
    hint: game.i18n.localize("PCAE.Settings.ZealousChargePendingEffect.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, SETTINGS.zealousChargeApplyDamage, {
    name: game.i18n.localize("PCAE.Settings.ZealousChargeApplyDamage.Name"),
    hint: game.i18n.localize("PCAE.Settings.ZealousChargeApplyDamage.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, SETTINGS.zealousChargePromptWeapon, {
    name: game.i18n.localize("PCAE.Settings.ZealousChargePromptWeapon.Name"),
    hint: game.i18n.localize("PCAE.Settings.ZealousChargePromptWeapon.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
}

async function runZealousCharge(context = {}) {
  const actor = context.actor ?? context.item?.actor;
  const item = context.item ?? findZealousChargeItem(actor);
  if (!actor || !item || !actorOwnsZealousCharge(actor, item)) {
    notify("warn", "没有找到已由特效库绑定的狂热冲锋条目。");
    return false;
  }
  if (!canvas?.ready) {
    notify("warn", "请先进入一个已加载的场景。");
    return false;
  }

  const source = normalizeToken(context.source) ?? tokenForActor(actor);
  const target = resolveChargeTarget(context, source);
  if (!source) {
    notify("warn", `没有找到 ${actor.name ?? "角色"} 的场景 Token。`);
    return false;
  }
  if (!target) {
    notify("warn", "请先为狂热冲锋指定一个目标。");
    return false;
  }

  const maxDistance = chargeMaxDistance(actor);
  const destination = findChargeDestination(source, target, maxDistance);
  const chargeTiming = chargeAnimationTiming(source, destination);
  const moveDestination = destination ? { ...destination, settleMs: chargeTiming.moveDuration + 240 } : null;
  const shouldMove = Boolean(setting(SETTINGS.zealousChargeMoveToken) && moveDestination);
  let moved = false;
  const animationPromise = setting(SETTINGS.zealousChargeAnimation)
    ? playLinkedChargeAnimation(actor, item, source, target, {
      destination: moveDestination,
      destinationCenter: moveDestination ? tokenCenterFromPosition(source, moveDestination) : null,
      moveDelay: chargeTiming.moveDelay,
      moveDuration: chargeTiming.moveDuration,
      maxDistance
    })
    : Promise.resolve(false);

  if (shouldMove) {
    await wait(chargeTiming.moveDelay);
    moved = await moveToken(source, moveDestination);
    if (!moved) {
      notify("error", "已找到狂热冲锋落点，但 Token 移动失败。请查看控制台中的移动回退日志。");
    }
  } else if (setting(SETTINGS.zealousChargeMoveToken)) {
    notify("warn", `没有找到 ${maxDistance} 尺内可用的相邻落点，只播放冲锋效果。`);
  }

  await animationPromise.catch((error) => {
    console.warn("定制自动化效果 | 狂热冲锋联动动画失败", error);
    return false;
  });

  if (setting(SETTINGS.zealousChargePendingEffect)) {
    await createPendingChargeEffect(actor, item, target);
  }

  recordEvent(actor, item, target, moved ? "已冲锋" : "仅动画");
  refreshSharedPanel();
  if (moved || context.manual) {
    await promptZealousChargeWeaponAttack(actor, target, source);
  }
  return true;
}

async function handleMidiAttackRollComplete(workflow) {
  try {
    if (!shouldApplyPendingChargeDamage(workflow?.actor, workflow?.item, { workflow })) return false;
    const effect = findPendingChargeEffect(workflow.actor);
    if (!effect) return false;
    const target = await resolvePendingDamageTarget(workflow, effect);
    if (!target) {
      notify("warn", "狂热冲锋已经待触发，但这次攻击没有找到有效目标。");
      return false;
    }

    const source = normalizeToken(workflow.token) ?? tokenForActor(workflow.actor);
    await applyPendingChargeDamage({
      actor: workflow.actor,
      item: workflow.item,
      source,
      target,
      effect,
      workflow
    });
    await consumePendingChargeEffect(workflow.actor, effect);
    recordEvent(workflow.actor, workflow.item, target, "下一击+2d6光耀");
    refreshSharedPanel();
    return true;
  } catch (error) {
    console.warn("定制自动化效果 | 狂热冲锋下一击伤害处理失败", error);
    notify("error", "狂热冲锋下一击伤害处理失败，详情请查看控制台。");
    return false;
  }
}

async function handlePostRollAttack(rolls, data) {
  const activity = data?.subject;
  const actor = activity?.actor ?? activity?.item?.actor;
  const item = activity?.item;
  try {
    if (!shouldApplyPendingChargeDamage(actor, item, { activity })) return false;
    const effect = findPendingChargeEffect(actor);
    if (!effect) return false;
    const target = await resolvePendingDamageTarget({ actor, item, activity }, effect);
    if (!target) {
      notify("warn", "狂热冲锋已经待触发，但这次攻击没有找到有效目标。");
      return false;
    }

    await applyPendingChargeDamage({
      actor,
      item,
      source: tokenForActor(actor),
      target,
      effect,
      workflow: null
    });
    await consumePendingChargeEffect(actor, effect);
    recordEvent(actor, item, target, "下一击+2d6光耀");
    refreshSharedPanel();
    return true;
  } catch (error) {
    console.warn("定制自动化效果 | 狂热冲锋 dnd5e 攻击回退处理失败", error, rolls);
    return false;
  }
}

async function suppressZealousChargeImmediateDamage(workflow) {
  if (!setting(SETTINGS.zealousChargeEnabled)) return false;
  if (!workflow?.actor || !workflow?.item) return false;
  if (!actorOwnsZealousCharge(workflow.actor, workflow.item)) return false;

  workflow.damageRolls = [];
  workflow.damageRoll = null;
  workflow.damageTotal = 0;
  workflow.healingAdjustedDamageTotal = 0;
  workflow.damageRollHTML = "";
  workflow.rawDamageDetail = [];
  workflow.damageDetail = [];
  workflow.bonusDamageRolls = undefined;
  workflow.bonusDamageTotal = 0;
  workflow.rawBonusDamageDetail = [];
  workflow.bonusDamageDetail = [];
  workflow.hitTargets = new Set();
  workflow.hitTargetsEC = new Set();
  workflow.effectTargets = new Set();
  foundry.utils.setProperty(workflow, `flags.${MODULE_ID}.suppressedImmediateDamage`, true);
  return true;
}

function shouldApplyPendingChargeDamage(actor, item, context = {}) {
  if (!setting(SETTINGS.zealousChargeEnabled)) return false;
  if (!setting(SETTINGS.zealousChargeApplyDamage)) return false;
  if (!actor || !actorHasZealousChargeAutomation(actor)) return false;
  if (item && actorOwnsZealousCharge(actor, item)) return false;
  if (context?.workflowType === "DamageOnlyWorkflow" || context?.workflow?.workflowType === "DamageOnlyWorkflow") return false;
  if (!isAttackContext(context)) return false;
  return Boolean(findPendingChargeEffect(actor));
}

function isAttackContext(context = {}) {
  const activity = context.activity ?? context.workflow?.activity;
  const actionType = activity?.actionType ?? context.workflow?.activity?.actionType;
  if (activity?.type === "attack" || activity?.hasAttack || activity?.attack) return true;
  return ["mwak", "rwak", "msak", "rsak", "mpak", "rpak"].includes(actionType);
}

async function applyPendingChargeDamage({ actor, item, source, target, effect, workflow }) {
  const flag = pendingChargeFlag(effect);
  const formula = flag.damageFormula ?? "2d6";
  const damageType = flag.damageType ?? "radiant";
  const flavor = "狂热冲锋：2d6光耀";
  const roll = await evaluateDamageRoll(formula, actor, { type: damageType, flavor });
  const DamageOnlyWorkflow = globalThis.MidiQOL?.DamageOnlyWorkflow;

  if (game.modules.get("midi-qol")?.active && globalThis.MidiQOL && typeof DamageOnlyWorkflow === "function") {
    new DamageOnlyWorkflow(actor, source, roll.total ?? 0, damageType, [target], roll, {
      flavor,
      item,
      itemCardUuid: workflow?.itemCardUuid,
      storeWorkflow: true
    });
    return true;
  }

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor, token: source }),
    flavor: `${flavor} -> ${target?.name ?? target?.document?.name ?? "目标"}`
  });
  return true;
}

async function evaluateDamageRoll(formula, actor, options = {}) {
  const DamageRoll = CONFIG.Dice?.DamageRoll ?? Roll;
  const data = actor?.getRollData?.() ?? {};
  const roll = new DamageRoll(formula, data, options);
  if (typeof roll.evaluate === "function") {
    try {
      return await roll.evaluate();
    } catch (error) {
      if (typeof roll.evaluateSync !== "function") throw error;
    }
  }
  if (typeof roll.evaluateSync === "function") return roll.evaluateSync();
  if (typeof roll.roll === "function") return roll.roll();
  return roll;
}

async function resolvePendingDamageTarget(context = {}, effect = null) {
  const workflowTargets = tokenArray(context.hitTargets).concat(tokenArray(context.targets));
  if (workflowTargets.length) return workflowTargets[0];

  const userTarget = Array.from(game.user?.targets ?? []).map(normalizeToken).find(Boolean);
  if (userTarget) return userTarget;

  const flag = pendingChargeFlag(effect);
  if (flag.targetUuid) {
    const document = await fromUuid(flag.targetUuid).catch(() => null);
    const token = normalizeToken(document);
    if (token) return token;
  }
  return null;
}

function tokenArray(value) {
  if (!value) return [];
  const list = value instanceof Set ? Array.from(value) : Array.isArray(value) ? value : [value];
  return list.map(normalizeToken).filter(Boolean);
}

function findPendingChargeEffect(actor) {
  return Array.from(actor?.effects ?? []).find((effect) =>
    foundry.utils.getProperty(effect, `flags.${MODULE_ID}.type`) === "zealousChargePending"
  ) ?? null;
}

function pendingChargeFlag(effect) {
  return foundry.utils.getProperty(effect, `flags.${MODULE_ID}`) ?? {};
}

async function consumePendingChargeEffect(actor, effect) {
  if (!actor || !effect?.id) return false;
  await actor.deleteEmbeddedDocuments("ActiveEffect", [effect.id]);
  return true;
}

function shouldOwnAnimation({ actor, item } = {}) {
  return Boolean(
    setting(SETTINGS.zealousChargeEnabled) &&
    setting(SETTINGS.zealousChargeAnimation) &&
    actorOwnsZealousCharge(actor, item)
  );
}

async function playLinkedChargeAnimation(actor, item, source, target, charge = {}) {
  const api = game.modules.get(EFFECT_MODULE_ID)?.api ?? globalThis.PlayerCustomCinematicEffects;
  if (typeof api?.playItemEffect !== "function") {
    notify("warn", "玩家定制特效库未就绪，无法播放狂热冲锋联动动画。");
    return false;
  }
  return api.playItemEffect({
    actor,
    item,
    source,
    targets: [target],
    trigger: "automation",
    skipAutomationGuard: true,
    force: true,
    charge
  });
}

async function createPendingChargeEffect(actor, item, target) {
  if (!actor?.createEmbeddedDocuments) return false;
  const existing = Array.from(actor.effects ?? []).filter((effect) =>
    foundry.utils.getProperty(effect, `flags.${MODULE_ID}.type`) === "zealousChargePending"
  );
  if (existing.length) {
    await actor.deleteEmbeddedDocuments("ActiveEffect", existing.map((effect) => effect.id));
  }

  const combat = game.combat;
  const inCombat = Boolean(combat?.started && combat.combatants?.some?.((combatant) => combatant.actor?.uuid === actor.uuid));
  const duration = inCombat
    ? { rounds: 1, turns: 1, startRound: combat.round, startTurn: combat.turn }
    : { seconds: 12, startTime: game.time.worldTime };

  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: "狂热冲锋：下一击",
    icon: item.img,
    origin: item.uuid,
    duration,
    changes: [],
    flags: {
      [MODULE_ID]: {
        type: "zealousChargePending",
        targetUuid: target?.document?.uuid ?? target?.uuid ?? "",
        damageFormula: "2d6",
        damageType: "radiant"
      }
    }
  }]);
  return true;
}

async function promptZealousChargeWeaponAttack(actor, target, source) {
  if (!setting(SETTINGS.zealousChargePromptWeapon)) return false;
  if (!actor || !target) return false;
  if (!actorUserCanControl(actor, game.user) && !game.user?.isGM) return false;

  const weapons = zealousChargeAttackWeapons(actor);
  if (!weapons.length) {
    notify("warn", "狂热冲锋完成，但没有找到可用的武器攻击。");
    return false;
  }

  await wait(180);
  const weapon = weapons.length === 1
    ? await confirmSingleWeaponAttack(weapons[0], target)
    : await chooseChargeWeaponDialog(actor, target, weapons);
  if (!weapon) return false;

  setSingleTarget(target);
  await wait(80);
  await useWeaponItem(weapon, { actor, source, target });
  recordEvent(actor, weapon, target, "冲锋后武器攻击");
  refreshSharedPanel();
  return true;
}

function zealousChargeAttackWeapons(actor) {
  return Array.from(actor?.items ?? [])
    .filter((item) => item?.type === "weapon")
    .filter((item) => Number(item.system?.quantity ?? 1) > 0)
    .filter((item) => itemAttackActivities(item).length > 0)
    .sort((a, b) => {
      const equippedDelta = Number(Boolean(b.system?.equipped)) - Number(Boolean(a.system?.equipped));
      if (equippedDelta) return equippedDelta;
      return String(a.name).localeCompare(String(b.name), "zh-Hans-CN");
    });
}

function itemAttackActivities(item) {
  const activities = item?.system?.activities;
  const list = typeof activities?.filter === "function"
    ? activities.filter((activity) => activity?.type === "attack" || activity?.hasAttack || activity?.attack)
    : Object.values(activities ?? {}).filter((activity) => activity?.type === "attack" || activity?.hasAttack || activity?.attack);
  return list.filter((activity) => activity?.canUse !== false);
}

async function confirmSingleWeaponAttack(weapon, target) {
  const title = "狂热冲锋：衔接攻击";
  const content = `<p>使用 <strong>${escapeHTML(weapon.name)}</strong> 攻击 ${escapeHTML(target?.name ?? target?.document?.name ?? "目标")}？</p>`;
  if (foundry.applications?.api?.DialogV2) {
    const result = await foundry.applications.api.DialogV2.confirm({
      window: { title },
      content,
      yes: { label: "攻击" },
      no: { label: "暂不攻击" },
      defaultYes: true
    });
    return result ? weapon : null;
  }
  if (!globalThis.Dialog) return weapon;
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    new Dialog({
      title,
      content,
      buttons: {
        attack: { label: "攻击", callback: () => finish(weapon) },
        cancel: { label: "暂不攻击", callback: () => finish(null) }
      },
      default: "attack",
      close: () => finish(null)
    }).render(true);
  });
}

async function chooseChargeWeaponDialog(actor, target, weapons) {
  const title = "狂热冲锋：选择武器";
  const targetName = target?.name ?? target?.document?.name ?? "目标";
  const content = `
    <div class="pcae-weapon-dialog">
      <p>${escapeHTML(actor?.name ?? "角色")} 已完成冲锋。选择一个武器攻击 ${escapeHTML(targetName)}。</p>
      <div class="pcae-weapon-grid">
        ${weapons.map((weapon, index) => `
          <button type="button" class="pcae-weapon-card" data-weapon-index="${index}">
            <img src="${escapeAttribute(weapon.img ?? "icons/svg/sword.svg")}" alt="">
            <span>${escapeHTML(weaponButtonLabel(weapon, index))}</span>
            ${weapon.system?.equipped ? "<em>已装备</em>" : ""}
          </button>
        `).join("")}
      </div>
    </div>
  `;

  return new Promise((resolve) => {
    let app = null;
    let resolved = false;
    const finish = (weapon) => {
      if (resolved) return;
      resolved = true;
      app?.close?.();
      resolve(weapon ?? null);
    };

    if (foundry.applications?.api?.DialogV2) {
      app = new foundry.applications.api.DialogV2({
        window: { title },
        content,
        buttons: [{ action: "cancel", label: "暂不攻击", callback: () => finish(null) }],
        render: (event, dialog) => {
          dialog.element.querySelectorAll("[data-weapon-index]").forEach((button) => {
            button.addEventListener("click", () => finish(weapons[Number(button.dataset.weaponIndex)]));
          });
        },
        close: () => finish(null)
      });
      app.render(true);
      return;
    }

    if (!globalThis.Dialog) return finish(weapons[0]);
    app = new Dialog({
      title,
      content,
      buttons: { cancel: { label: "暂不攻击", callback: () => finish(null) } },
      render: (html) => {
        const root = html?.[0] ?? html;
        root.querySelectorAll?.("[data-weapon-index]").forEach((button) => {
          button.addEventListener("click", () => finish(weapons[Number(button.dataset.weaponIndex)]));
        });
      },
      close: () => finish(null)
    }).render(true);
  });
}

function weaponButtonLabel(weapon, index) {
  return `${index + 1}. ${weapon.name ?? "武器"}`;
}

async function useWeaponItem(weapon, { actor, source, target } = {}) {
  const activities = itemAttackActivities(weapon);
  const activity = activities[0];
  if (activity?.use) {
    return activity.use({
      event: null,
      targetUuids: target?.document?.uuid ? [target.document.uuid] : undefined,
      configure: true
    });
  }

  if (weapon.use) {
    return weapon.use({
      event: null,
      targetUuids: target?.document?.uuid ? [target.document.uuid] : undefined,
      configureDialog: true,
      configure: true
    });
  }

  notify("warn", `${weapon.name} 没有可执行的攻击活动。`);
  return false;
}

function setSingleTarget(target) {
  const token = normalizeToken(target);
  if (!token) return false;
  try {
    if (typeof token.setTarget === "function") {
      token.setTarget(true, { user: game.user, releaseOthers: true, groupSelection: true });
      return true;
    }
    game.user?.updateTokenTargets?.([token.id]);
    return true;
  } catch (error) {
    return false;
  }
}

function renderZealousChargePanel(actor, item) {
  item ??= findZealousChargeItem(actor);
  const source = tokenForActor(actor);
  const target = source ? resolveChargeTarget({}, source) : null;
  const pending = findPendingChargeEffect(actor);
  const enabled = setting(SETTINGS.zealousChargeEnabled);
  const canRun = Boolean(item && source && target);
  const status = !item ? "未找到条目" : !source ? "无Token" : !target ? "未选目标" : "可执行";
  const statusClass = canRun && enabled ? "is-ok" : "is-bad";
  const maxDistance = chargeMaxDistance(actor);

  return `
    <div class="pcae-row">
      <div class="pcae-name">
        <strong>狂热冲锋</strong>
        <span>${escapeHTML(status)} · ${maxDistance}尺 · ${target ? escapeHTML(target.name ?? target.document?.name ?? "目标") : "等待目标"}</span>
      </div>
      <label class="pcae-toggle">
        <input type="checkbox" data-pcae-setting="${SETTINGS.zealousChargeEnabled}" ${enabled ? "checked" : ""}>
        <span>自动</span>
      </label>
      <button type="button" class="pcae-run" data-pcae-action="run-zealous-charge" data-actor-id="${escapeAttribute(actor.id)}" ${canRun ? "" : "disabled"} title="执行狂热冲锋">
        <i class="fas fa-person-running"></i>
      </button>
    </div>
    <div class="pcae-mini">
      <span class="pcce-pill ${statusClass}">${enabled ? "自动化开" : "自动化关"}</span>
      <span class="pcce-pill ${setting(SETTINGS.zealousChargeMoveToken) ? "is-ok" : "is-bad"}">移动${setting(SETTINGS.zealousChargeMoveToken) ? "开" : "关"}</span>
      <span class="pcce-pill ${setting(SETTINGS.zealousChargeAnimation) ? "is-ok" : "is-bad"}">动画${setting(SETTINGS.zealousChargeAnimation) ? "开" : "关"}</span>
      <span class="pcce-pill ${setting(SETTINGS.zealousChargeApplyDamage) ? "is-ok" : "is-bad"}">伤害${setting(SETTINGS.zealousChargeApplyDamage) ? "开" : "关"}</span>
      <span class="pcce-pill ${setting(SETTINGS.zealousChargePromptWeapon) ? "is-ok" : "is-bad"}">衔接攻击${setting(SETTINGS.zealousChargePromptWeapon) ? "开" : "关"}</span>
      <span class="pcce-pill ${pending ? "is-ok" : ""}">${pending ? "下一击待触发" : "无待触发"}</span>
    </div>
  `;
}

async function handleAction(action, actor) {
  if (action !== "run-zealous-charge") return false;
  return runZealousCharge({ actor, manual: true });
}

function findZealousChargeItem(actor) {
  return Array.from(actor?.items ?? []).find((item) => actorOwnsZealousCharge(actor, item)) ?? null;
}

function isZealousChargeItem(item) {
  if (!item) return false;
  if (ZEALOUS_CHARGE_ITEM_IDS.has(String(item.id ?? item._id ?? ""))) return true;
  const sourceId = String(foundry.utils.getProperty(item, "flags.dnd5e.sourceId") ?? "");
  if (ZEALOUS_CHARGE_SOURCE_IDS.has(sourceId)) return true;
  const name = normalizeText(`${item.name ?? ""} ${foundry.utils.getProperty(item, "flags.babele.originalName") ?? ""}`);
  return name.includes("狂热冲锋") || name.includes("zealouscharge");
}

function isZealousChargeActivity(activity) {
  return actorOwnsZealousCharge(activity?.actor ?? activity?.item?.actor, activity?.item);
}

function actorHasZealousChargeAutomation(actor) {
  return Boolean(findZealousChargeItem(actor));
}

function actorOwnsZealousCharge(actor, item) {
  if (!actor || !item) return false;
  const match = cinematicEffectMatch(actor, item);
  return isZealousChargeEffect(match?.effect);
}

function isZealousChargeEffect(effect) {
  if (!effect) return false;
  if (ZEALOUS_CHARGE_EFFECT_IDS.has(String(effect.id ?? ""))) return true;
  if (ZEALOUS_CHARGE_SEQUENCES.has(String(effect.sequence ?? ""))) return true;
  const key = String(effect.key ?? "");
  if (key && Array.from(ZEALOUS_CHARGE_EFFECT_IDS).some((id) => key.endsWith(`.${id}`))) return true;
  const name = normalizeText(`${effect.label ?? ""} ${(effect.itemNames ?? []).join(" ")}`);
  return name.includes("狂热冲锋") || name.includes("zealouscharge");
}

function chargeMaxDistance(actor) {
  const configured = Number(setting(SETTINGS.zealousChargeMaxDistance));
  if (Number.isFinite(configured) && configured > 0) return configured;
  const walk = Number(foundry.utils.getProperty(actor, "system.attributes.movement.walk"));
  return Number.isFinite(walk) && walk > 0 ? walk * 2 : 60;
}
