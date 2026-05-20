import { MODULE_ID, MODULE_TITLE, SETTINGS } from "./constants.mjs";
import { monkFocusAutomation } from "./automations/monk-focus.mjs";
import { zealousChargeAutomation } from "./automations/zealous-charge.mjs";
import {
  getRecentEvents,
  isDuplicateEvent,
  isMidiActive,
  refreshSharedPanel,
  shouldHandleActor
} from "./shared/context.mjs";
import { onSocketMessage } from "./shared/tokens.mjs";

const automations = [
  zealousChargeAutomation,
  monkFocusAutomation
];

Hooks.once("init", () => {
  for (const automation of automations) automation.registerSettings?.();
});

Hooks.once("ready", () => {
  const api = {
    runZealousCharge: (...args) => zealousChargeAutomation.run(...args),
    runMonkFocus: (...args) => monkFocusAutomation.run(...args),
    shouldOwnAnimation,
    isZealousChargeItem: zealousChargeAutomation.isItem,
    isMonkFocusItem: monkFocusAutomation.isItem,
    renderPanelSection,
    getRecentEvents
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
  const automation = matchingAutomationForActivity(activity);
  if (!automation) return undefined;

  const item = activity?.item;
  const actor = activity?.actor ?? item?.actor;
  if (!actor || !item || !shouldHandleActor(actor)) return undefined;

  const key = `${automation.id}|${actor.uuid ?? actor.id}|${item.id}|${activity?._id ?? activity?.id ?? ""}`;
  if (isDuplicateEvent(key, 1600)) return false;

  window.setTimeout(() => {
    Promise.resolve(automation.run({ actor, item, activity, usageConfig, results, manual: false }))
      .catch((error) => console.warn(`${MODULE_TITLE} | 自动化执行失败`, { automation: automation.id, actor, item, error }));
  }, 80);
  return false;
});

Hooks.on("dnd5e.postRollAttack", (rolls, data) => {
  if (isMidiActive()) return undefined;
  window.setTimeout(() => {
    for (const automation of automations) {
      if (automation.isEnabled?.() === false) continue;
      Promise.resolve(automation.handlePostRollAttack?.(rolls, data))
        .catch((error) => console.warn(`${MODULE_TITLE} | 攻击回退处理失败`, { automation: automation.id, error }));
    }
  }, 80);
  return undefined;
});

Hooks.on("midi-qol.AttackRollComplete", async (workflow) => {
  for (const automation of automations) {
    if (automation.isEnabled?.() === false) continue;
    await Promise.resolve(automation.handleMidiAttackRollComplete?.(workflow))
      .catch((error) => console.warn(`${MODULE_TITLE} | Midi 攻击处理失败`, { automation: automation.id, error }));
  }
});

Hooks.on("midi-qol.DamageRollComplete", async (workflow) => {
  for (const automation of automations) {
    if (automation.isEnabled?.() === false) continue;
    await Promise.resolve(automation.suppressImmediateDamage?.(workflow))
      .catch((error) => console.warn(`${MODULE_TITLE} | Midi 伤害处理失败`, { automation: automation.id, error }));
  }
});

Hooks.on("pcce.renderPanelSections", (sections, context) => {
  const html = renderPanelSection(context?.actor);
  if (html) sections.push(html);
});

function matchingAutomationForActivity(activity) {
  return automations.find((automation) => {
    if (automation.isEnabled?.() === false) return false;
    return Boolean(automation.isActivity?.(activity));
  }) ?? null;
}

function renderPanelSection(actor) {
  if (!actor) return "";

  const rows = automations.flatMap((automation) => {
    try {
      const item = automation.findItem?.(actor);
      if (!item) return [];
      const html = automation.renderPanel?.(actor, item);
      return html ? [html] : [];
    } catch (error) {
      console.warn(`${MODULE_TITLE} | 自动化面板渲染失败`, { automation: automation.id, actor, error });
      return [];
    }
  });
  if (!rows.length) return "";

  return `
    <section class="pcae-panel-section">
      <div class="pcce-section-title">定制自动化</div>
      ${rows.join("")}
    </section>
  `;
}

function shouldOwnAnimation(context = {}) {
  return automations.some((automation) => {
    try {
      if (automation.isEnabled?.() === false) return false;
      return Boolean(automation.shouldOwnAnimation?.(context));
    } catch (error) {
      console.warn(`${MODULE_TITLE} | 动画接管判断失败`, { automation: automation.id, context, error });
      return false;
    }
  });
}

async function onDocumentClick(event) {
  const button = event.target?.closest?.("[data-pcae-action]");
  if (!button) return;

  const action = button.dataset.pcaeAction;
  const actor = game.actors?.get(button.dataset.actorId);
  if (!actor) return;

  for (const automation of automations) {
    if (typeof automation.handleAction !== "function") continue;
    const handled = await automation.handleAction(action, actor);
    if (handled) {
      event.preventDefault();
      return;
    }
  }
}

async function onDocumentChange(event) {
  const input = event.target?.closest?.("[data-pcae-setting]");
  if (!input) return;

  const key = input.dataset.pcaeSetting;
  if (!Object.values(SETTINGS).includes(key)) return;

  const value = input.type === "checkbox"
    ? input.checked
    : input.type === "number"
      ? Number(input.value)
      : input.value;

  await game.settings.set(MODULE_ID, key, value);
  refreshSharedPanel();
}

export {
  automations,
  renderPanelSection,
  shouldOwnAnimation
};
