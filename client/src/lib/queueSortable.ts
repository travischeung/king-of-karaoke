import Sortable from 'sortablejs';

type Options = {
  handle?: string;
  /** Called when a drag starts — freeze the rendered list so React won't reshuffle mid-drag. */
  onDragStart?: () => void;
  /** Called after DOM is reverted, whether or not order changed. */
  onDragEnd?: () => void;
  /** Emit the new uid order (from data-uid attrs) to the server. */
  onReorder: (uids: string[]) => void;
};

/**
 * Sortable wired for a React-owned queue <ol>.
 * Reads the post-drag order from data-uid (not React state indices), then reverts
 * the DOM so React remains the source of truth until the server broadcast lands.
 *
 * Touch: press-and-hold (300ms) on the grip before drag starts so scrolling still works.
 * (Native HTML5 DnD ignores delay on phones — forceFallback is required.)
 */
export function bindQueueSortable(el: HTMLElement, opts: Options) {
  const s = Sortable.create(el, {
    animation: 150,
    dataIdAttr: 'data-uid',
    // Only the dedicated grip starts a drag (rest of the row scrolls / taps normally).
    handle: opts.handle ?? '.drag-handle',
    // Ignore other buttons — but not the grip itself.
    filter: 'button:not(.drag-handle), .btns',
    preventOnFilter: false,
    // Required for delay to work on real touch devices.
    forceFallback: true,
    fallbackOnBody: true,
    fallbackClass: 'queue-drag-ghost',
    ghostClass: 'queue-drag-placeholder',
    fallbackTolerance: 6,
    delay: 300,
    delayOnTouchOnly: true,
    touchStartThreshold: 10,
    onStart: (evt) => {
      // Ghost is appended to <body>, so .queue img rules no longer apply —
      // lock it to the card's width so the YouTube thumb can't blow up.
      const ghost = document.querySelector('.queue-drag-ghost') as HTMLElement | null;
      if (ghost && evt.item) {
        const w = evt.item.getBoundingClientRect().width;
        ghost.style.width = `${w}px`;
        ghost.style.boxSizing = 'border-box';
      }
      opts.onDragStart?.();
    },
    onEnd: (evt) => {
      const { oldIndex, newIndex, item, from } = evt;
      try {
        if (oldIndex == null || newIndex == null || oldIndex === newIndex) return;
        // Visual order after the drag — reliable even if stateRef drifted mid-drag.
        const uids = s.toArray().filter(Boolean);
        // Undo Sortable's DOM mutate; React will re-render from server state.
        from.removeChild(item);
        from.insertBefore(item, from.children[oldIndex] ?? null);
        if (uids.length) opts.onReorder(uids);
      } finally {
        opts.onDragEnd?.();
      }
    },
  });
  return () => s.destroy();
}
