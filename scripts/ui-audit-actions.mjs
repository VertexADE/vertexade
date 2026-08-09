export function interactionSteps(route) {
  if (route.actionSelectors?.length) return route.actionSelectors.map((selector) => ({ kind: 'selector', value: selector }))
  const labels = route.clickTexts || (route.clickText ? [route.clickText] : [])
  return labels.map((label) => ({ kind: 'label', value: label }))
}

export function auditActionCandidateStatus(candidates) {
  const visible = candidates.filter((candidate) => candidate.visible)
  if (!visible.length) return { ok: false, reason: 'Action was not rendered' }
  if (visible.length > 1) return { ok: false, reason: `Action matched ${visible.length} visible controls` }
  if (visible[0].disabled) return { ok: false, reason: 'Action was disabled' }
  return { ok: true, label: visible[0].label }
}

export function interactionExpression(route) {
  const steps = interactionSteps(route)
  return `(async () => {
    const steps = ${JSON.stringify(steps)};
    const readySelector = ${JSON.stringify(route.interactionReadySelector || '')};
    const actions = [];
    const visible = (element) => {
      const style = getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      return element.getAttribute('aria-hidden') !== 'true'
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && bounds.width > 0
        && bounds.height > 0;
    };
    const label = (element) => element.innerText.trim() || element.getAttribute('aria-label') || '';
    for (const step of steps) {
      let matches;
      if (step.kind === 'selector') {
        matches = [...document.querySelectorAll(step.value)].filter(visible);
      } else {
        const candidates = [...document.querySelectorAll('button, [role="button"], [role="menuitem"], [role="tab"]')].filter(visible);
        matches = candidates.filter((element) => label(element) === step.value);
        if (!matches.length) matches = candidates.filter((element) => label(element).includes(step.value));
      }
      if (!matches.length) return { clicked: false, actions, failedAction: step, reason: 'Action was not rendered' };
      if (matches.length > 1) return { clicked: false, actions, failedAction: step, reason: 'Action matched ' + matches.length + ' visible controls' };
      const target = matches[0];
      if (target.matches(':disabled, [aria-disabled="true"]')) {
        return { clicked: false, actions, failedAction: step, reason: 'Action was disabled' };
      }
      actions.push({ ...step, label: label(target) });
      target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, buttons: 1, pointerType: 'mouse', isPrimary: true }));
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, buttons: 1 }));
      target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, buttons: 0, pointerType: 'mouse', isPrimary: true }));
      target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, buttons: 0 }));
      target.click();
      await new Promise((resolve) => setTimeout(resolve, 500));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
    const deadline = Date.now() + 30000;
    while (readySelector && !document.querySelector(readySelector) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const ready = !readySelector || Boolean(document.querySelector(readySelector));
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const surfaces = [...document.querySelectorAll('[data-slot="sheet-content"], [data-slot="dialog-content"]')];
    const surface = surfaces.findLast((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0;
    });
    return { clicked: true, ready, actions, surfaceText: surface?.innerText.slice(0, 500) || '' };
  })()`
}
