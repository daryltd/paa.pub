import { CPXStore } from './vendor/cpx-store/cpx-store.js';
import { persistencePlugin } from './vendor/cpx-store/plugins/persistence.js';
import { collabPlugin } from './vendor/cpx-store/plugins/collab.js';
import { SSETransport } from './sse-transport.js';

let store = null;
let sseTransport = null;
let listenersRegistered = false;

function init() {
  // --- Activity Store ---
  if (!document.getElementById('store')) return;
  if (listenersRegistered) return;
  listenersRegistered = true;

  if (!store) {
    sseTransport = new SSETransport('/activity/stream');

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
        },
          persistencePlugin({ key: 'paa-activity' }),
          collabPlugin({ transport: sseTransport }),
        );
      }
    }

    if (!customElements.get('activity-store')) {
      customElements.define('activity-store', ActivityStore);
    }
    store = document.getElementById('store');
  }

  // --- Details State Persistence ---
  document.querySelectorAll('details[id^="details-"]').forEach(function(el) {
    var key = el.id.replace('details-', '');
    if (store.state.details[key] !== undefined) {
      el.open = store.state.details[key];
    }
    el.addEventListener('toggle', function() {
      store.state.details[key] = el.open;
    });
  });

  // --- Feed Filter Persistence ---
  (function() {
    var params = new URLSearchParams(location.search);
    var feed = params.get('feed');
    if (feed) {
      store.state.feedFilter = feed;
    } else if (store.state.feedFilter && store.state.feedFilter !== 'received') {
      params.set('feed', store.state.feedFilter);
      location.replace('/activity?' + params.toString());
    }
  })();

  // --- Compose Draft Persistence ---
  (function() {
    var content = document.getElementById('compose-content');
    var audience = document.getElementById('audience');
    var summary = document.getElementById('compose-summary');
    if (!content) return;

    var draft = store.state.draft;
    if (draft.content) content.value = draft.content;
    if (draft.audience) audience.value = draft.audience;
    if (draft.summary) summary.value = draft.summary;

    content.addEventListener('input', function() { store.state.draft.content = content.value; });
    audience.addEventListener('change', function() { store.state.draft.audience = audience.value; });
    summary.addEventListener('input', function() { store.state.draft.summary = summary.value; });
  })();

  // --- DM Recipient Toggle ---
  (function() {
    var audience = document.getElementById('audience');
    var recipientGroup = document.getElementById('recipient-group');
    var recipient = document.getElementById('recipient');
    if (!audience || !recipientGroup) return;

    function toggle() {
      var isDirect = audience.value === 'direct';
      recipientGroup.classList.toggle('hidden', !isDirect);
      if (recipient) recipient.required = isDirect;
    }
    audience.addEventListener('change', toggle);
    toggle();
  })();

  // --- Reply Handler ---
  (function() {
    var inReplyToInput = document.getElementById('compose-in-reply-to');
    var replyContext = document.getElementById('reply-context');
    var replyTarget = document.getElementById('reply-context-target');
    var composeDetails = document.getElementById('details-compose');
    var cancelBtn = document.getElementById('cancel-reply');

    document.addEventListener('click', function(e) {
      var btn = e.target.closest('[data-reply-to]');
      if (!btn) return;

      var activityId = btn.getAttribute('data-reply-to');
      var actor = btn.getAttribute('data-reply-actor');
      var audience = btn.getAttribute('data-reply-audience') || 'direct';

      store.batch(function() {
        store.state.draft.inReplyTo = activityId;
        store.state.draft.replyActor = actor;
        store.state.draft.audience = audience;
        store.state.details.compose = true;
      });

      if (inReplyToInput) inReplyToInput.value = activityId;
      if (replyTarget) replyTarget.textContent = actor;
      if (replyContext) replyContext.classList.remove('hidden');
      if (composeDetails) composeDetails.open = true;

      // Set audience to match original scope
      var audienceSelect = document.getElementById('audience');
      if (audienceSelect) audienceSelect.value = audience;
      var recipientGroup = document.getElementById('recipient-group');
      if (recipientGroup) recipientGroup.classList.toggle('hidden', audience !== 'direct');
      if (audience === 'direct') {
        var recipientSelect = document.getElementById('recipient');
        if (recipientSelect) recipientSelect.value = actor;
      }

      var textarea = document.getElementById('compose-content');
      if (textarea) {
        textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
        textarea.focus();
      }
    });

    if (cancelBtn) {
      cancelBtn.addEventListener('click', function() {
        store.batch(function() {
          store.state.draft.inReplyTo = '';
          store.state.draft.replyActor = '';
        });
        if (inReplyToInput) inReplyToInput.value = '';
        if (replyContext) replyContext.classList.add('hidden');
      });
    }

    if (store.state.draft.inReplyTo && inReplyToInput) {
      inReplyToInput.value = store.state.draft.inReplyTo;
      if (replyTarget) replyTarget.textContent = store.state.draft.replyActor;
      if (replyContext) replyContext.classList.remove('hidden');
    }
  })();

  // --- Real-Time Updates via SSE (cpx-store collab) ---
  store.addEventListener('change', function(e) {
    var changes = e.detail?.changes;
    if (!changes) return;

    // Handle SSE events flowing through the collab plugin
    var activityChange = changes.activity;
    var readChange = changes.read;
    var readAllChange = changes['read-all'];

    if (activityChange?.val) {
      var event = activityChange.val;
      if (event.type === 'activity' && event.activity) {
        var feedList = document.getElementById('activity-feed-list');
        if (feedList) {
          var noAct = feedList.querySelector('.text-muted');
          if (noAct) noAct.remove();

          var card = document.createElement('div');
          card.className = 'card';
          var actor = event.activity.actor || 'unknown';
          var content = event.activity.object?.content || event.activity.content || '';
          var type = event.activity.type || 'Activity';
          card.innerHTML =
            '<div class="flex justify-between mb-05"><span class="mono text-sm">' + escapeHtml(actor) + '</span><span class="text-muted">just now</span></div>' +
            '<div class="flex gap-05 mb-05"><span class="badge badge-type">' + escapeHtml(type) + '</span><span class="badge badge-received">received</span></div>' +
            '<div>' + content + '</div>';
          feedList.prepend(card);
        }
      }
    }

    if (readChange?.val) {
      var evt = readChange.val;
      if (evt.type === 'read' && evt.data?.id) {
        var el = document.querySelector('[data-activity-id="' + CSS.escape(evt.data.id) + '"]');
        if (el) el.remove();
      }
    }

    if (readAllChange?.val) {
      var fl = document.getElementById('activity-feed-list');
      if (fl) fl.innerHTML = '<div class="card text-muted">No activities.</div>';
    }
  });

  // --- No-Refresh Form Submission ---
  var formHandler = function(e) {
    var form = e.target;
    if (!form || form.tagName !== 'FORM' || form.method.toUpperCase() !== 'POST') return;

    var action = form.getAttribute('action');
    var handlers = {
      '/compose': function(json, frm) {
        // Clear only the content — keep audience, recipient, and reply context
        // so the user can send another message in the same conversation
        var contentEl = frm.querySelector('textarea[name="content"]');
        if (contentEl) contentEl.value = '';
        store.state.draft.content = '';
      },
      '/activity/mark-read': function(json, frm) {
        var card = frm.closest('.card');
        if (card) card.remove();
      },
      '/activity/mark-all-read': function() {
        var fl = document.getElementById('activity-feed-list');
        if (fl) fl.innerHTML = '<div class="card text-muted">No activities.</div>';
      },
      '/follow': function(json, frm) { frm.reset(); },
      '/unfollow': function(json, frm) {
        var li = frm.closest('li');
        if (li) li.remove();
        // If pending outgoing list is now empty, hide the section
        var list = document.querySelector('#details-pending-outgoing .list-plain');
        if (list && list.children.length === 0) {
          var section = document.getElementById('details-pending-outgoing');
          if (section) section.remove();
        }
      },
      '/activity/clear-pending': function() {
        var section = document.getElementById('details-pending-outgoing');
        if (section) section.remove();
      },
      '/follow-requests/accept': function(json, frm) {
        var li = frm.closest('li');
        if (li) li.remove();
      },
      '/follow-requests/reject': function(json, frm) {
        var li = frm.closest('li');
        if (li) li.remove();
      },
    };

    if (!handlers[action]) return;

    e.preventDefault();
    var data = new FormData(form);
    var btn = form.querySelector('button[type="submit"]');
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
  };

  document.addEventListener('submit', formHandler);

  // --- Cleanup on SPA navigation ---
  window.addEventListener('paa:navigate', function() {
    if (sseTransport) sseTransport.disconnect();
  });
}

function escapeHtml(str) {
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Initialize on load
init();

// Re-initialize on SPA navigation
window.addEventListener('paa:page-loaded', function() {
  if (location.pathname === '/activity' || location.pathname.startsWith('/activity?')) {
    init();
  }
});
