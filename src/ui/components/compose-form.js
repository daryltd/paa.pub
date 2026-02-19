/**
 * <paa-compose> web component — compose form.
 * Note: Currently rendered server-side in activity.js.
 */
export const composeFormTemplate = `
<template id="paa-compose-template">
  <style>
    :host { display: block; }
    textarea { width: 100%; min-height: 80px; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; font-family: inherit; resize: vertical; }
    .btn { padding: 0.5rem 1rem; background: #1a1a2e; color: #fff; border: none; border-radius: 4px; cursor: pointer; }
  </style>
  <form method="POST" action="/compose">
    <textarea name="content" placeholder="What's on your mind?" required></textarea>
    <select name="audience">
      <option value="public">Public</option>
      <option value="unlisted">Unlisted</option>
      <option value="followers">Followers Only</option>
      <option value="private">Private</option>
    </select>
    <button type="submit" class="btn">Post</button>
  </form>
</template>`;
