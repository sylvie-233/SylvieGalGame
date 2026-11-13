/**
 * 键盘事件目标的通用判断。
 *
 * 播放器在 window 上监听全局快捷键，但输入框、备注弹窗和按钮有自己的键行为；
 * 这些判断集中在一处，避免全局监听与控件互相抢键。
 */

/** 目标是否处于文本输入状态（输入框 / 文本域 / contentEditable）。 */
export function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
  );
}

/**
 * 目标是否是可点击控件。
 * 对按钮 / 链接按空格或回车时，应让控件自身触发，而不是被全局“推进对话”截走。
 */
export function isButtonLikeTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest('button, a[href], [role="button"], [role="menuitem"], [role="tab"]') !== null
  );
}
