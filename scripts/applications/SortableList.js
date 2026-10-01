/**
 * Native HTML5 drag and drop for a list. It only reports intent,
 * `onReorder(draggedId, beforeId)` with `beforeId` null for the end; the
 * caller decides whether the order is allowed. Items drag from their handle
 * only, so inputs inside a row stay selectable. Bound again after each
 * render: the elements are new every time.
 */
export default class SortableList {
  static bind(container, { itemSelector, handleSelector, onReorder }) {
    if (!container) return;
    const items = () => [...container.querySelectorAll(itemSelector)];
    const clearMarks = () => {
      for (const el of items()) el.classList.remove("svi-drop-before", "svi-drop-after");
    };
    const isAfter = (event, el) => {
      const rect = el.getBoundingClientRect();
      return event.clientY > rect.top + rect.height / 2;
    };

    for (const item of items()) {
      const handle = item.querySelector(handleSelector);
      if (!handle) continue;
      handle.addEventListener("pointerdown", () => (item.draggable = true));
      handle.addEventListener("pointerup", () => (item.draggable = false));
      item.addEventListener("dragstart", (event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", item.dataset.id);
        item.classList.add("svi-dragging");
      });
      item.addEventListener("dragend", () => {
        item.draggable = false;
        item.classList.remove("svi-dragging");
        clearMarks();
      });
    }

    container.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const over = event.target.closest(itemSelector);
      clearMarks();
      if (over) over.classList.add(isAfter(event, over) ? "svi-drop-after" : "svi-drop-before");
    });

    container.addEventListener("dragleave", (event) => {
      if (!container.contains(event.relatedTarget)) clearMarks();
    });

    container.addEventListener("drop", (event) => {
      event.preventDefault();
      const all = items();
      clearMarks();
      const draggedId = event.dataTransfer.getData("text/plain");
      if (!draggedId) return;
      const over = event.target.closest(itemSelector);
      if (over?.dataset.id === draggedId) return;
      const beforeId = over ? (isAfter(event, over) ? all[all.indexOf(over) + 1]?.dataset.id ?? null : over.dataset.id) : null;
      if (beforeId === draggedId) return;
      onReorder(draggedId, beforeId);
    });
  }
}
