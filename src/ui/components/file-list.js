/**
 * <paa-files> web component — file listing.
 * Note: Currently rendered server-side in storage.js.
 */
export const fileListTemplate = `
<template id="paa-files-template">
  <style>
    :host { display: block; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 0.5rem; border-bottom: 1px solid #eee; }
    a { color: #1a1a2e; text-decoration: none; font-family: monospace; }
    a:hover { text-decoration: underline; }
  </style>
  <table>
    <slot></slot>
  </table>
</template>`;
