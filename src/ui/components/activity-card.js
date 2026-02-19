/**
 * <paa-activity> web component — renders a single activity.
 * Note: Currently rendered server-side in activity.js.
 * This component is available for client-side rendering if needed.
 */
export const activityCardTemplate = `
<template id="paa-activity-template">
  <style>
    :host { display: block; margin-bottom: 1rem; }
    .card { background: #fff; border-radius: 8px; padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .header { display: flex; justify-content: space-between; margin-bottom: 0.5rem; }
    .actor { font-family: monospace; font-size: 0.8rem; }
    .time { color: #666; font-size: 0.85rem; }
    .type { background: #e8e8e8; padding: 0.1rem 0.4rem; border-radius: 3px; font-size: 0.75rem; }
  </style>
  <div class="card">
    <div class="header">
      <span class="actor"><slot name="actor"></slot></span>
      <span class="time"><slot name="time"></slot></span>
    </div>
    <span class="type"><slot name="type"></slot></span>
    <div><slot name="content"></slot></div>
  </div>
</template>`;
