import { CPXStore } from './vendor/cpx-store/cpx-store.js';
import { persistencePlugin } from './vendor/cpx-store/plugins/persistence.js';

// --- Activity Store ---
class ActivityStore extends CPXStore {
  constructor() {
    super({
      details: {
        compose: false,
        feed: true,
        follow: false,
        following: false,
        followers: false,
        'pending-requests': false,
        'pending-outgoing': true,
      },
      feedFilter: 'received',
      draft: { content: '', audience: 'public', summary: '', inReplyTo: '', replyActor: '' },
    }, persistencePlugin({ key: 'paa-activity' }));
  }
}
customElements.define('activity-store', ActivityStore);

const store = document.getElementById('store');

// --- Details State Persistence ---
document.querySelectorAll('details[id^="details-"]').forEach(function(el) {
  const key = el.id.replace('details-', '');
  if (store.state.details[key] !== undefined) {
    el.open = store.state.details[key];
  }
  el.addEventListener('toggle', function() {
    store.state.details[key] = el.open;
  });
});

// --- Feed Filter Persistence ---
(function() {
  const params = new URLSearchParams(location.search);
  const feed = params.get('feed');
  if (feed) {
    store.state.feedFilter = feed;
  } else if (store.state.feedFilter && store.state.feedFilter !== 'received') {
    params.set('feed', store.state.feedFilter);
    location.replace('/activity?' + params.toString());
  }
})();

// --- Compose Draft Persistence ---
(function() {
  const content = document.getElementById('compose-content');
  const audience = document.getElementById('audience');
  const summary = document.getElementById('compose-summary');
  if (!content) return;

  // Restore draft
  const draft = store.state.draft;
  if (draft.content) content.value = draft.content;
  if (draft.audience) audience.value = draft.audience;
  if (draft.summary) summary.value = draft.summary;

  // Save on input
  content.addEventListener('input', () => { store.state.draft.content = content.value; });
  audience.addEventListener('change', () => { store.state.draft.audience = audience.value; });
  summary.addEventListener('input', () => { store.state.draft.summary = summary.value; });
})();

// --- DM Recipient Toggle ---
(function() {
  const audience = document.getElementById('audience');
  const recipientGroup = document.getElementById('recipient-group');
  const recipient = document.getElementById('recipient');
  if (!audience || !recipientGroup) return;

  function toggle() {
    const isDirect = audience.value === 'direct';
    recipientGroup.classList.toggle('hidden', !isDirect);
    if (recipient) recipient.required = isDirect;
  }
  audience.addEventListener('change', toggle);
  toggle();
})();

// --- Reply Handler ---
(function() {
  const inReplyToInput = document.getElementById('compose-in-reply-to');
  const replyContext = document.getElementById('reply-context');
  const replyTarget = document.getElementById('reply-context-target');
  const composeDetails = document.getElementById('details-compose');
  const cancelBtn = document.getElementById('cancel-reply');

  document.addEventListener('click', function(e) {
    const btn = e.target.closest('[data-reply-to]');
    if (!btn) return;

    const activityId = btn.getAttribute('data-reply-to');
    const actor = btn.getAttribute('data-reply-actor');

    store.batch(() => {
      store.state.draft.inReplyTo = activityId;
      store.state.draft.replyActor = actor;
      store.state.details.compose = true;
    });

    if (inReplyToInput) inReplyToInput.value = activityId;
    if (replyTarget) replyTarget.textContent = actor;
    if (replyContext) replyContext.classList.remove('hidden');
    if (composeDetails) composeDetails.open = true;

    const textarea = document.getElementById('compose-content');
    if (textarea) {
      textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
      textarea.focus();
    }
  });

  if (cancelBtn) {
    cancelBtn.addEventListener('click', function() {
      store.batch(() => {
        store.state.draft.inReplyTo = '';
        store.state.draft.replyActor = '';
      });
      if (inReplyToInput) inReplyToInput.value = '';
      if (replyContext) replyContext.classList.add('hidden');
    });
  }

  // Restore reply state from store
  if (store.state.draft.inReplyTo && inReplyToInput) {
    inReplyToInput.value = store.state.draft.inReplyTo;
    if (replyTarget) replyTarget.textContent = store.state.draft.replyActor;
    if (replyContext) replyContext.classList.remove('hidden');
  }
})();

// --- No-Refresh Form Submission ---
(function() {
  const handlers = {
    '/compose': function(json, form) {
      form.reset();
      store.batch(() => {
        store.state.draft.content = '';
        store.state.draft.audience = 'public';
        store.state.draft.summary = '';
        store.state.draft.inReplyTo = '';
        store.state.draft.replyActor = '';
      });
      const replyContext = document.getElementById('reply-context');
      if (replyContext) replyContext.classList.add('hidden');
      const inReplyToInput = document.getElementById('compose-in-reply-to');
      if (inReplyToInput) inReplyToInput.value = '';
      // Prepend new activity indicator or reload feed
      const feedList = document.getElementById('activity-feed-list');
      if (feedList && json.activity) {
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = '<div class="flex justify-between mb-05"><span class="mono text-sm">You</span><span class="text-muted">just now</span></div><div>' + escapeHtml(json.activity.content || '') + '</div>';
        feedList.prepend(card);
      }
    },
    '/activity/mark-read': function(json, form) {
      const card = form.closest('.card');
      if (card) card.remove();
    },
    '/activity/mark-all-read': function() {
      const feedList = document.getElementById('activity-feed-list');
      if (feedList) feedList.innerHTML = '<div class="card text-muted">No activities.</div>';
    },
    '/follow': function() { location.reload(); },
    '/unfollow': function(json, form) {
      const li = form.closest('li');
      if (li) li.remove();
    },
    '/follow-requests/accept': function(json, form) {
      const li = form.closest('li');
      if (li) li.remove();
    },
    '/follow-requests/reject': function(json, form) {
      const li = form.closest('li');
      if (li) li.remove();
    },
  };

  document.addEventListener('submit', function(e) {
    const form = e.target;
    if (!form || form.tagName !== 'FORM' || form.method.toUpperCase() !== 'POST') return;

    const action = form.getAttribute('action');
    if (!handlers[action]) return;

    e.preventDefault();
    const data = new FormData(form);
    const btn = form.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;

    fetch(action, {
      method: 'POST',
      body: data,
      headers: { 'Accept': 'application/json' },
    })
    .then(function(res) { return res.json(); })
    .then(function(json) {
      if (json.ok) handlers[action](json, form);
      else location.reload();
    })
    .catch(function() { location.reload(); })
    .finally(function() { if (btn) btn.disabled = false; });
  });

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();
