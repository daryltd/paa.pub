/* Accessible confirm/alert dialogs using <dialog> elements. */

function paaAlert(message) {
  return new Promise(function(resolve) {
    var dialog = document.createElement('dialog');
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'Alert');
    dialog.innerHTML =
      '<p>' + escapeDialogHtml(message) + '</p>' +
      '<div class="dialog-actions">' +
        '<button type="button" class="btn" data-dialog-ok>OK</button>' +
      '</div>';
    document.body.appendChild(dialog);
    var okBtn = dialog.querySelector('[data-dialog-ok]');
    okBtn.addEventListener('click', function() { dialog.close(); });
    dialog.addEventListener('close', function() {
      dialog.remove();
      resolve();
    });
    dialog.addEventListener('cancel', function() { dialog.close(); });
    dialog.showModal();
    okBtn.focus();
  });
}

function paaConfirm(message) {
  return new Promise(function(resolve) {
    var dialog = document.createElement('dialog');
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'Confirm action');
    dialog.innerHTML =
      '<p>' + escapeDialogHtml(message) + '</p>' +
      '<div class="dialog-actions">' +
        '<button type="button" class="btn btn-secondary" data-dialog-cancel>Cancel</button>' +
        '<button type="button" class="btn btn-danger" data-dialog-ok>Confirm</button>' +
      '</div>';
    document.body.appendChild(dialog);
    var confirmed = false;
    var cancelBtn = dialog.querySelector('[data-dialog-cancel]');
    var okBtn = dialog.querySelector('[data-dialog-ok]');
    cancelBtn.addEventListener('click', function() { dialog.close(); });
    okBtn.addEventListener('click', function() { confirmed = true; dialog.close(); });
    dialog.addEventListener('close', function() {
      dialog.remove();
      resolve(confirmed);
    });
    dialog.addEventListener('cancel', function(e) {
      e.preventDefault();
      dialog.close();
    });
    dialog.showModal();
    cancelBtn.focus();
  });
}

function escapeDialogHtml(str) {
  var d = document.createElement('div');
  d.appendChild(document.createTextNode(str));
  return d.innerHTML;
}

function paaPrompt(message, defaultValue) {
  return new Promise(function(resolve) {
    var dialog = document.createElement('dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'Prompt');
    dialog.innerHTML =
      '<p>' + escapeDialogHtml(message) + '</p>' +
      '<div class="form-group">' +
        '<input type="text" class="prompt-input" value="' + escapeDialogHtml(defaultValue || '') + '">' +
      '</div>' +
      '<div class="dialog-actions">' +
        '<button type="button" class="btn btn-secondary" data-dialog-cancel>Cancel</button>' +
        '<button type="button" class="btn" data-dialog-ok>OK</button>' +
      '</div>';
    document.body.appendChild(dialog);
    var result = null;
    var input = dialog.querySelector('.prompt-input');
    var cancelBtn = dialog.querySelector('[data-dialog-cancel]');
    var okBtn = dialog.querySelector('[data-dialog-ok]');
    cancelBtn.addEventListener('click', function() { dialog.close(); });
    okBtn.addEventListener('click', function() { result = input.value; dialog.close(); });
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { result = input.value; dialog.close(); }
    });
    dialog.addEventListener('close', function() {
      dialog.remove();
      resolve(result);
    });
    dialog.addEventListener('cancel', function(e) {
      e.preventDefault();
      dialog.close();
    });
    dialog.showModal();
    input.focus();
    input.select();
  });
}

/* Auto-bind [data-confirm] on forms and buttons */
document.addEventListener('click', function(e) {
  var el = e.target.closest('[data-confirm]');
  if (!el) return;
  var msg = el.getAttribute('data-confirm');
  var form = el.closest('form');
  if (el.tagName === 'BUTTON' && form) {
    e.preventDefault();
    paaConfirm(msg).then(function(ok) {
      if (ok) {
        /* Remove data-confirm so re-submission skips the dialog */
        el.removeAttribute('data-confirm');
        el.click();
      }
    });
  }
});

/* Auto-bind [data-prompt] on form buttons */
document.addEventListener('click', function(e) {
  var el = e.target.closest('[data-prompt]');
  if (!el) return;
  var msg = el.getAttribute('data-prompt');
  var defaultVal = el.getAttribute('data-prompt-default') || '';
  var form = el.closest('form');
  if (el.tagName === 'BUTTON' && form) {
    e.preventDefault();
    paaPrompt(msg, defaultVal).then(function(value) {
      if (value !== null) {
        var dest = form.querySelector('input[name="destination"]');
        if (dest) dest.value = value;
        el.removeAttribute('data-prompt');
        el.click();
      }
    });
  }
});
