/**
 * <paa-nav> web component — navigation bar.
 * Note: Currently rendered server-side in shell.js.
 * This component is available for client-side rendering if needed.
 */
export const navBarTemplate = `
<template id="paa-nav-template">
  <style>
    :host { display: block; }
    nav { display: flex; align-items: center; gap: 1rem; padding: 0.75rem 1.5rem; background: #1a1a2e; color: #fff; }
    a { color: #ccc; text-decoration: none; font-size: 0.9rem; }
    a:hover, a.active { color: #fff; }
    .brand { font-weight: 700; font-size: 1.1rem; color: #fff; margin-right: 1rem; }
    .spacer { flex: 1; }
  </style>
  <nav>
    <a href="/dashboard" class="brand">paa.pub</a>
    <a href="/dashboard">Dashboard</a>
    <a href="/activity">Activity</a>
    <a href="/storage/">Storage</a>
    <span class="spacer"></span>
    <slot name="user"></slot>
    <slot name="actions"></slot>
  </nav>
</template>`;
