/**
 * <paa-follow> web component — follow/unfollow button.
 * Note: Currently rendered server-side in activity.js.
 */
export const followButtonTemplate = `
<template id="paa-follow-template">
  <style>
    :host { display: inline-block; }
    form { display: inline; }
    input { padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; }
    .btn { padding: 0.5rem 1rem; background: #1a1a2e; color: #fff; border: none; border-radius: 4px; cursor: pointer; }
  </style>
  <form method="POST" action="/follow">
    <input type="text" name="target" placeholder="user@domain.com">
    <button type="submit" class="btn">Follow</button>
  </form>
</template>`;
