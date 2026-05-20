const MODULE_ID = "player-custom-automation-effects";
const MODULE_TITLE = "定制自动化效果";
const EFFECT_MODULE_ID = "player-custom-cinematic-effects";

const SETTINGS = {
  zealousChargeEnabled: "zealousChargeEnabled",
  zealousChargeMoveToken: "zealousChargeMoveToken",
  zealousChargeAnimation: "zealousChargeAnimation",
  zealousChargeMaxDistance: "zealousChargeMaxDistance",
  zealousChargePendingEffect: "zealousChargePendingEffect",
  zealousChargeApplyDamage: "zealousChargeApplyDamage",
  zealousChargePromptWeapon: "zealousChargePromptWeapon"
};

const ZEALOUS_CHARGE_ITEM_IDS = new Set(["D6sdL1bWPl4HdCaq"]);
const ZEALOUS_CHARGE_SOURCE_IDS = new Set(["Compendium.the-crooked-moon-2014.tcm2014-player-options.Item.HN3ch6MatqvtyZD0"]);
const ZEALOUS_CHARGE_EFFECT_IDS = new Set(["zealous-charge-gravebreaker"]);
const ZEALOUS_CHARGE_SEQUENCES = new Set(["lawrenceCharge"]);
const recentEvents = [];
const duplicateEvents = new Map();
const pendingSocketRequests = new Map();

Hooks.once("init", () => {
  registerSettings();
});

Hooks.once("ready", () => {
  const api = {
    runZealousCharge,
    shouldOwnAnimation,
    isZealousChargeItem,
    renderPanelSection,
    getRecentEvents: () => foundry.utils.deepClone(recentEvents)
  };
  const module = game.modules.get(MODULE_ID);
  if (module) module.api = api;
  globalThis.PlayerCustomAutomationEffects = api;

  game.socket?.on?.(`module.${MODULE_ID}`, onSocketMessage);
  document.addEventListener("click", onDocumentClick);
  document.addEventListener("change", onDocumentChange);
  refreshSharedPanel();
});

Hooks.on("dnd5e.postUseActivity", (activity, usageConfig, results) => {
  if (!isZealousChargeActivity(activity)) return undefined;
  window.setTimeout(() => handleDnd5ePostUseActivity(activity, usageConfig, results), 80);
  return false;
});

Hooks.on("dnd5e.postRollAttack", (rolls, data) => {
  if (isMidiActive()) return undefined;
  window.setTimeout(() => handleDnd5ePostRollAttack(rolls, data), 80);
  return undefined;
});

Hooks.on("midi-qol.AttackRollComplete", async (workflow) => {
  await handleMidiAttackRollComplete(workflow);
});

Hooks.on("midi-qol.DamageRollComplete", async (workflow) => {
  await suppressZealousChargeImmediateDamage(workflow);
});

Hooks.on("pcce.renderPanelSections", (sections, context) => {
  const html = renderPanelSection(context?.actor);
  if (html) sections.push(html);
});

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

async function handleDnd5ePostUseActivity(activity, usageConfig, results) {
  const item = activity?.item;
  const actor = item?.actor ?? activity?.actor;
  if (!actor || !item) return false;
  if (!setting(SETTINGS.zealousChargeEnabled)) return false;
  if (!actorOwnsZealousCharge(actor, item)) return false;
  if (!shouldHandleActor(actor)) return false;

  const key = `${actor.uuid ?? actor.id}|${item.id}|${activity?._id ?? activity?.id ?? ""}`;
  if (isDuplicateEvent(key, 1600)) return false;

  return runZealousCharge({ actor, item, activity, usageConfig, results, manual: false });
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
  const shouldMove = Boolean(setting(SETTINGS.zealousChargeMoveToken) && destination);
  const chargeTiming = chargeAnimationTiming(source, destination);
  let moved = false;
  const animationPromise = setting(SETTINGS.zealousChargeAnimation)
    ? playLinkedChargeAnimation(actor, item, source, target, {
      destination,
      destinationCenter: destination ? tokenCenterFromPosition(source, destination) : null,
      moveDelay: chargeTiming.moveDelay,
      moveDuration: chargeTiming.moveDuration,
      maxDistance
    })
    : Promise.resolve(false);

  if (shouldMove) {
    await wait(chargeTiming.moveDelay);
    moved = await moveToken(source, destination);
    if (!moved) {
      notify("error", "已找到狂热冲锋落点，但 Token 移动失败。请查看控制台中的移动回退日志。");
    }
  } else if (setting(SETTINGS.zealousChargeMoveToken)) {
    notify("warn", `没有找到 ${maxDistance} 尺内可用的相邻落点，只播放冲锋效果。`);
  }

  await animationPromise.catch((error) => {
    console.warn(`${MODULE_TITLE} | 狂热冲锋联动动画失败`, error);
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
    console.warn(`${MODULE_TITLE} | 狂热冲锋下一击伤害处理失败`, error);
    notify("error", "狂热冲锋下一击伤害处理失败，详情请查看控制台。");
    return false;
  }
}

async function handleDnd5ePostRollAttack(rolls, data) {
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
    console.warn(`${MODULE_TITLE} | 狂热冲锋 dnd5e 攻击回退处理失败`, error, rolls);
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
  if (!shouldHandleActor(actor)) return false;
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

  if (isMidiActive() && typeof DamageOnlyWorkflow === "function") {
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
      <p>${escapeHTML(actor?.name ?? "角色")} 已完成冲锋。选择要立刻衔接攻击 ${escapeHTML(targetName)} 的武器。</p>
      <div class="pcae-weapon-grid">
        ${weapons.map((weapon) => `
          <div class="pcae-weapon-card" data-pcae-weapon-id="${escapeAttribute(weapon.id)}">
            <img src="${escapeAttribute(weapon.img ?? actor.img ?? "")}" alt="">
            <span>${escapeHTML(weapon.name)}</span>
            ${weapon.system?.equipped ? "<em>已装备</em>" : ""}
          </div>
        `).join("")}
      </div>
    </div>
  `;

  if (foundry.applications?.api?.DialogV2) {
    return foundry.applications.api.DialogV2.wait({
      window: { title },
      content,
      rejectClose: false,
      close: () => null,
      buttons: [
        ...weapons.map((weapon, index) => ({
          action: `weapon-${index}`,
          label: weaponButtonLabel(weapon, index),
          default: index === 0,
          callback: () => weapon
        })),
        { action: "cancel", label: "暂不攻击", callback: () => null }
      ]
    });
  }

  if (!globalThis.Dialog) return weapons[0] ?? null;
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    const buttons = Object.fromEntries(weapons.map((weapon, index) => [
      `weapon${index}`,
      {
        label: weaponButtonLabel(weapon, index),
        callback: () => finish(weapon)
      }
    ]));
    buttons.cancel = { label: "暂不攻击", callback: () => finish(null) };
    new Dialog({
      title,
      content,
      buttons,
      default: "weapon0",
      close: () => finish(null)
    }).render(true);
  });
}

function weaponButtonLabel(weapon, index) {
  return `${index + 1}. ${weapon?.name ?? "武器"}`;
}

async function useWeaponItem(weapon, { actor, source, target } = {}) {
  if (!weapon) return false;
  try {
    if (typeof weapon.use === "function") {
      return await weapon.use({
        chooseActivity: itemAttackActivities(weapon).length > 1,
        event: null
      });
    }
    const activity = itemAttackActivities(weapon)[0];
    if (typeof activity?.use === "function") return await activity.use({ event: null });
  } catch (error) {
    console.warn(`${MODULE_TITLE} | 冲锋后武器攻击启动失败`, { weapon, actor, source, target, error });
    notify("error", `${weapon.name} 攻击启动失败，详情请查看控制台。`);
    return false;
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

function renderPanelSection(actor) {
  if (!actor) return "";
  const item = findZealousChargeItem(actor);
  if (!item) return "";
  const source = tokenForActor(actor);
  const target = source ? resolveChargeTarget({}, source) : null;
  const pending = findPendingChargeEffect(actor);
  const enabled = setting(SETTINGS.zealousChargeEnabled);
  const canRun = Boolean(item && source && target);
  const status = !item ? "未找到条目" : !source ? "无Token" : !target ? "未选目标" : "可执行";
  const statusClass = canRun && enabled ? "is-ok" : "is-bad";
  const maxDistance = chargeMaxDistance(actor);

  return `
    <section class="pcae-panel-section">
      <div class="pcce-section-title">定制自动化</div>
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
    </section>
  `;
}

async function onDocumentClick(event) {
  const button = event.target?.closest?.("[data-pcae-action]");
  if (!button) return;
  const action = button.dataset.pcaeAction;
  if (action !== "run-zealous-charge") return;
  event.preventDefault();
  const actor = game.actors?.get(button.dataset.actorId);
  await runZealousCharge({ actor, manual: true });
}

async function onDocumentChange(event) {
  const input = event.target?.closest?.("[data-pcae-setting]");
  if (!input) return;
  const key = input.dataset.pcaeSetting;
  if (!Object.values(SETTINGS).includes(key)) return;
  const value = input.type === "checkbox" ? input.checked : input.value;
  await game.settings.set(MODULE_ID, key, value);
  refreshSharedPanel();
}

async function onSocketMessage(message) {
  if (!message || message.moduleId !== MODULE_ID) return;

  if (message.type === "move-token-response") {
    const pending = pendingSocketRequests.get(message.requestId);
    if (!pending || message.requesterId !== game.user?.id) return;
    window.clearTimeout(pending.timeout);
    pendingSocketRequests.delete(message.requestId);
    pending.resolve({
      success: Boolean(message.success),
      attempts: Array.isArray(message.attempts) ? message.attempts : [],
      errors: Array.isArray(message.errors) ? message.errors : []
    });
    return;
  }

  if (message.type !== "move-token-request" || !isPrimaryGm()) return;

  const response = {
    moduleId: MODULE_ID,
    type: "move-token-response",
    requestId: message.requestId,
    requesterId: message.requesterId,
    success: false,
    attempts: [],
    errors: []
  };

  try {
    const document = await fromUuid(message.tokenUuid);
    if (!document) throw new Error(`Token not found: ${message.tokenUuid}`);
    const token = document.object ?? { document };
    const result = await moveTokenLocally(token, message.destination);
    response.success = result.success;
    response.attempts = result.attempts;
    response.errors = result.errors.map(errorMessage);
  } catch (error) {
    response.errors.push(errorMessage(error));
  }

  game.socket?.emit?.(`module.${MODULE_ID}`, response);
}

async function requestGmTokenMove(token, destination) {
  const gm = primaryGmUser();
  if (!gm) {
    return {
      success: false,
      attempts: [{ method: "gm-socket", skipped: "no-active-gm" }],
      errors: ["没有在线 GM 可以代为移动 Token。"]
    };
  }

  const document = tokenDocument(token);
  const requestId = foundry.utils.randomID();
  const payload = {
    moduleId: MODULE_ID,
    type: "move-token-request",
    requestId,
    requesterId: game.user?.id,
    tokenUuid: document.uuid,
    destination: {
      x: destination.x,
      y: destination.y,
      ignoreCollision: Boolean(destination.ignoreCollision)
    }
  };

  const response = new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      pendingSocketRequests.delete(requestId);
      resolve({
        success: false,
        attempts: [{ method: "gm-socket", gm: gm.name, timeout: true }],
        errors: ["等待 GM 客户端移动 Token 超时。"]
      });
    }, 5000);
    pendingSocketRequests.set(requestId, { resolve, timeout });
  });

  game.socket?.emit?.(`module.${MODULE_ID}`, payload);
  return response;
}

function primaryGmUser() {
  return Array.from(game.users ?? [])
    .filter((user) => user.active && user.isGM)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))[0] ?? null;
}

function isPrimaryGm() {
  return Boolean(game.user?.isGM && primaryGmUser()?.id === game.user.id);
}

function findChargeDestination(source, target, maxDistanceFeet) {
  const strict = bestChargeDestination(source, target, maxDistanceFeet);
  if (strict) return strict;

  const collisionFallback = bestChargeDestination(source, target, maxDistanceFeet, { ignoreCollision: true });
  if (collisionFallback) {
    collisionFallback.ignoreCollision = true;
    return collisionFallback;
  }

  return null;
}

function bestChargeDestination(source, target, maxDistanceFeet, options = {}) {
  const ignoreCollision = Boolean(options.ignoreCollision);
  const gridSize = canvas.grid?.size ?? canvas.dimensions?.size ?? 100;
  const gridDistance = canvas.dimensions?.distance ?? canvas.scene?.grid?.distance ?? 5;
  const sourceDoc = source.document;
  const targetDoc = target.document;
  const sw = Math.max(1, Number(sourceDoc.width ?? 1));
  const sh = Math.max(1, Number(sourceDoc.height ?? 1));
  const tw = Math.max(1, Number(targetDoc.width ?? 1));
  const th = Math.max(1, Number(targetDoc.height ?? 1));
  const candidates = [];

  for (let gx = -sw; gx <= tw; gx += 1) {
    for (let gy = -sh; gy <= th; gy += 1) {
      if (rectsOverlap(gx, gy, sw, sh, 0, 0, tw, th)) continue;
      const raw = snapPosition(targetDoc.x + gx * gridSize, targetDoc.y + gy * gridSize);
      const center = {
        x: raw.x + (sw * gridSize) / 2,
        y: raw.y + (sh * gridSize) / 2
      };
      const distanceFeet = pixelDistance(tokenCenter(source), center) * gridDistance / gridSize;
      if (distanceFeet > maxDistanceFeet + 0.01) continue;
      if (!ignoreCollision && hasMovementCollision(tokenCenter(source), center)) continue;
      candidates.push({
        x: raw.x,
        y: raw.y,
        distanceFeet,
        occupied: destinationOccupied(raw, source, target),
        score: distanceFeet,
        ignoreCollision
      });
    }
  }

  const clear = candidates.filter((candidate) => !candidate.occupied);
  const pool = clear.length ? clear : candidates;
  pool.sort((a, b) => a.score - b.score);
  return pool[0] ?? null;
}

function chargeAnimationTiming(source, destination) {
  const gridSize = canvas.grid?.size ?? canvas.dimensions?.size ?? 100;
  const gridDistance = canvas.dimensions?.distance ?? canvas.scene?.grid?.distance ?? 5;
  const from = tokenCenter(source);
  const to = destination ? tokenCenterFromPosition(source, destination) : null;
  const feet = to ? pixelDistance(from, to) * gridDistance / gridSize : 30;
  return {
    moveDelay: 340,
    moveDuration: clamp(Math.round(feet * 14), 560, 980)
  };
}

async function moveToken(token, destination) {
  if (!token?.document || !destination) return false;
  if (tokenAtDestination(token, destination)) return true;
  const actorName = token.actor?.name ?? token.document?.actor?.name ?? token.document?.name ?? "角色";

  const local = await moveTokenLocally(token, destination);
  if (local.success) return true;

  if (!game.user?.isGM) {
    const gm = await requestGmTokenMove(token, destination);
    if (gm.success) return true;
    local.errors.push(...gm.errors);
    local.attempts.push(...gm.attempts);
  }

  console.warn(`${MODULE_TITLE} | ${actorName} 狂热冲锋 Token 移动失败`, { token, destination, attempts: local.attempts, errors: local.errors });
  return false;
}

async function moveTokenLocally(token, destination) {
  const document = tokenDocument(token);
  if (!document || !destination) return { success: false, attempts: [], errors: [] };
  if (tokenAtDestination(token, destination)) return { success: true, attempts: [{ method: "already-at-destination" }], errors: [] };

  const center = tokenCenterFromPosition(token, destination);
  const ignoreWalls = Boolean(destination.ignoreCollision);
  const errors = [];
  const attempts = [];
  const objectToken = document.object ?? (token?.actor ? token : null);

  if (objectToken?.document && typeof globalThis.MidiQOL?.moveToken === "function") {
    try {
      await globalThis.MidiQOL.moveToken(objectToken, center, {
        animate: true,
        ignoreWalls,
        ignoreTokens: true
      });
      await wait(120);
      attempts.push(movementAttempt("MidiQOL.moveToken", token, destination));
      if (tokenAtDestination(token, destination)) return { success: true, attempts, errors };
    } catch (error) {
      errors.push(error);
      attempts.push({ method: "MidiQOL.moveToken", error: errorMessage(error) });
    }
  }

  if (typeof document.move === "function") {
    try {
      const snappedCenter = canvas.grid?.getSnappedPoint
        ? canvas.grid.getSnappedPoint(center, { mode: CONST.GRID_SNAPPING_MODES.CENTER })
        : center;
      const waypoint = {
        x: snappedCenter.x - tokenPixelWidth(token) / 2,
        y: snappedCenter.y - tokenPixelHeight(token) / 2,
        action: CONFIG.Token?.movement?.defaultAction ?? "walk",
        forced: true,
        snapped: true
      };
      await document.move(waypoint, {
        constrainOptions: {
          ignoreWalls,
          ignoreCost: true,
          ignoreTokens: true
        },
        autoRotate: true,
        animate: true
      });
      await wait(120);
      attempts.push(movementAttempt("TokenDocument.move", token, destination));
      if (tokenAtDestination(token, destination)) return { success: true, attempts, errors };
    } catch (error) {
      errors.push(error);
      attempts.push({ method: "TokenDocument.move", error: errorMessage(error) });
    }
  }

  try {
    const updated = await updateTokenDocumentPosition(document, destination, { animate: true });
    await wait(120);
    attempts.push(movementAttempt("Scene.updateEmbeddedDocuments.animate", token, destination, updated));
    if (tokenAtDestination(token, destination) || updatedAtDestination(updated, destination)) return { success: true, attempts, errors };
  } catch (error) {
    errors.push(error);
    attempts.push({ method: "Scene.updateEmbeddedDocuments.animate", error: errorMessage(error) });
  }

  try {
    const updated = await updateTokenDocumentPosition(document, destination);
    await wait(120);
    attempts.push(movementAttempt("Scene.updateEmbeddedDocuments", token, destination, updated));
    if (tokenAtDestination(token, destination) || updatedAtDestination(updated, destination)) return { success: true, attempts, errors };
  } catch (error) {
    errors.push(error);
    attempts.push({ method: "Scene.updateEmbeddedDocuments", error: errorMessage(error) });
  }

  return { success: false, attempts, errors };
}

function tokenAtDestination(token, destination) {
  const document = tokenDocument(token);
  const dx = Math.abs((document?.x ?? token?.x ?? 0) - destination.x);
  const dy = Math.abs((document?.y ?? token?.y ?? 0) - destination.y);
  return dx < 1 && dy < 1;
}

function tokenCenterFromPosition(token, position) {
  const gridSize = canvas.grid?.size ?? canvas.dimensions?.size ?? 100;
  const document = tokenDocument(token);
  return {
    x: (position?.x ?? document?.x ?? 0) + Math.max(1, Number(document?.width ?? 1)) * gridSize / 2,
    y: (position?.y ?? document?.y ?? 0) + Math.max(1, Number(document?.height ?? 1)) * gridSize / 2
  };
}

function tokenDocument(token) {
  return token?.document ?? token ?? null;
}

function tokenPixelWidth(token) {
  const document = tokenDocument(token);
  return token?.w ?? Math.max(1, Number(document?.width ?? 1)) * (canvas.grid?.size ?? canvas.dimensions?.size ?? 100);
}

function tokenPixelHeight(token) {
  const document = tokenDocument(token);
  return token?.h ?? Math.max(1, Number(document?.height ?? 1)) * (canvas.grid?.size ?? canvas.dimensions?.size ?? 100);
}

async function updateTokenDocumentPosition(document, destination, options = {}) {
  const update = { _id: document.id, x: destination.x, y: destination.y };
  if (document.parent && typeof document.parent.updateEmbeddedDocuments === "function") {
    return document.parent.updateEmbeddedDocuments("Token", [update], options);
  }
  return document.update({ x: destination.x, y: destination.y }, options);
}

function updatedAtDestination(updated, destination) {
  const documents = Array.isArray(updated) ? updated : [updated];
  return documents.some((document) => {
    if (!document) return false;
    const dx = Math.abs((document.x ?? 0) - destination.x);
    const dy = Math.abs((document.y ?? 0) - destination.y);
    return dx < 1 && dy < 1;
  });
}

function movementAttempt(method, token, destination, updated = null) {
  const document = tokenDocument(token);
  const result = {
    method,
    current: { x: document?.x, y: document?.y },
    target: { x: destination.x, y: destination.y }
  };
  if (Array.isArray(updated)) result.updated = updated.map((doc) => ({ id: doc?.id, x: doc?.x, y: doc?.y }));
  else if (updated) result.updated = { id: updated.id, x: updated.x, y: updated.y };
  return result;
}

function errorMessage(error) {
  return error?.message ?? String(error);
}

function destinationOccupied(destination, source, target) {
  const gridSize = canvas.grid?.size ?? canvas.dimensions?.size ?? 100;
  const sw = Math.max(1, Number(source.document?.width ?? 1));
  const sh = Math.max(1, Number(source.document?.height ?? 1));
  return Array.from(canvas.tokens?.placeables ?? []).some((token) => {
    if (!token?.document || token === source || token === target) return false;
    return rectsOverlap(
      destination.x,
      destination.y,
      sw * gridSize,
      sh * gridSize,
      token.document.x,
      token.document.y,
      Math.max(1, Number(token.document.width ?? 1)) * gridSize,
      Math.max(1, Number(token.document.height ?? 1)) * gridSize
    );
  });
}

function hasMovementCollision(from, to) {
  try {
    const backend = CONFIG.Canvas?.polygonBackends?.move;
    if (backend?.testCollision) return Boolean(backend.testCollision(from, to, { type: "move", mode: "any" }));
    if (canvas.walls?.checkCollision) return Boolean(canvas.walls.checkCollision(new Ray(from, to), { type: "move", mode: "any" }));
  } catch (error) {
    return false;
  }
  return false;
}

function resolveChargeTarget(context = {}, source = null) {
  const explicit = (context.targets ?? []).map(normalizeToken).find(Boolean);
  if (explicit && explicit !== source) return explicit;
  return Array.from(game.user?.targets ?? []).map(normalizeToken).find((target) => target && target !== source) ?? null;
}

function tokenForActor(actor) {
  if (!actor || !canvas?.tokens) return null;
  const controlled = canvas.tokens.controlled?.find((token) => token.actor?.uuid === actor.uuid || token.actor?.id === actor.id);
  if (controlled) return controlled;
  return Array.from(canvas.tokens.placeables ?? []).find((token) => token.actor?.uuid === actor.uuid || token.actor?.id === actor.id) ?? null;
}

function normalizeToken(value) {
  if (!value) return null;
  if (value.document?.object) return value.document.object;
  if (value.object) return value.object;
  if (value.actor && value.document) return value;
  return null;
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

function cinematicEffectMatch(actor, item) {
  const api = cinematicApi();
  if (typeof api?.getActorEffect !== "function") return null;
  try {
    return api.getActorEffect(actor, item);
  } catch (error) {
    console.warn(`${MODULE_TITLE} | 特效库绑定查询失败`, { actor, item, error });
    return null;
  }
}

function cinematicApi() {
  return game.modules.get(EFFECT_MODULE_ID)?.api ?? globalThis.PlayerCustomCinematicEffects ?? null;
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

function shouldHandleActor(actor) {
  if (!actor) return false;
  const owners = activeNonGmOwners(actor);
  if (game.user?.isGM) return true;
  if (!actorUserCanControl(actor, game.user)) return false;
  return owners[0]?.id === game.user?.id;
}

function activeNonGmOwners(actor) {
  return Array.from(game.users ?? [])
    .filter((user) => user.active && !user.isGM && actorUserCanControl(actor, user))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function actorUserCanControl(actor, user) {
  if (!actor || !user) return false;
  try {
    if (typeof actor.testUserPermission === "function") return actor.testUserPermission(user, "OWNER");
  } catch (error) {
    return false;
  }
  return Boolean(actor.isOwner);
}

function snapPosition(x, y) {
  try {
    if (typeof canvas.grid?.getSnappedPoint === "function") {
      const point = canvas.grid.getSnappedPoint({ x, y });
      return { x: point.x, y: point.y };
    }
    if (typeof canvas.grid?.getSnappedPosition === "function") return canvas.grid.getSnappedPosition(x, y, 1);
  } catch (error) {
    // Fall through to simple grid snapping.
  }
  const gridSize = canvas.grid?.size ?? canvas.dimensions?.size ?? 100;
  return {
    x: Math.round(x / gridSize) * gridSize,
    y: Math.round(y / gridSize) * gridSize
  };
}

function tokenCenter(token) {
  const gridSize = canvas.grid?.size ?? canvas.dimensions?.size ?? 100;
  return {
    x: (token.document?.x ?? token.x ?? 0) + Math.max(1, Number(token.document?.width ?? 1)) * gridSize / 2,
    y: (token.document?.y ?? token.y ?? 0) + Math.max(1, Number(token.document?.height ?? 1)) * gridSize / 2
  };
}

function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function pixelDistance(a, b) {
  return Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.y ?? 0) - (b?.y ?? 0));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function isDuplicateEvent(key, windowMs = 1400) {
  const now = Date.now();
  const previous = duplicateEvents.get(key) ?? 0;
  duplicateEvents.set(key, now);
  for (const [entryKey, timestamp] of duplicateEvents.entries()) {
    if (now - timestamp > 5000) duplicateEvents.delete(entryKey);
  }
  return now - previous < windowMs;
}

function recordEvent(actor, item, target, state) {
  recentEvents.unshift({
    at: Date.now(),
    actorName: actor?.name ?? "未知角色",
    itemName: item?.name ?? "狂热冲锋",
    targetName: target?.name ?? target?.document?.name ?? "未知目标",
    state
  });
  recentEvents.splice(8);
}

function refreshSharedPanel() {
  const api = game.modules.get(EFFECT_MODULE_ID)?.api ?? globalThis.PlayerCustomCinematicEffects;
  api?.refreshPanel?.({ rerender: true, preserveScroll: true });
}

function setting(key) {
  return game.settings.get(MODULE_ID, key);
}

function isMidiActive() {
  return Boolean(game.modules.get("midi-qol")?.active && globalThis.MidiQOL);
}

function notify(type, message) {
  ui.notifications?.[type]?.(`${MODULE_TITLE} | ${message}`);
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\-_.·'’"“”()（）:：]/gu, "")
    .trim();
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function escapeAttribute(value) {
  return escapeHTML(value).replace(/`/g, "&#96;");
}
