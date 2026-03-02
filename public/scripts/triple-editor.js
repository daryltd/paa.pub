/**
 * Triple Editor Widget — reusable RDF triple editing component.
 *
 * Self-initializes on DOMContentLoaded by finding all `.triple-editor` containers.
 * Supports read-only display, array-based form submission, and N-Triples serialization.
 * Includes a two-level namespace/predicate browser for predicate discovery.
 *
 * Configuration via data-* attributes on .triple-editor container:
 *   data-subject        — subject IRI
 *   data-output         — "arrays" | "ntriples" | "none" (read-only)
 *   data-predicate-name — form field name for predicates
 *   data-object-name    — form field name for objects
 *   data-ntriples-name  — hidden textarea name for N-Triples output
 *   data-show-template-key — if present, shows Mustache template key
 *   data-prefixes       — JSON prefix map
 *   data-ns-catalog     — JSON namespace predicate catalog
 */
var TripleEditor = (function () {

  function shortenIri(iriVal, prefixes) {
    if (!prefixes) return iriVal;
    var entries = Object.entries(prefixes);
    for (var i = 0; i < entries.length; i++) {
      var prefix = entries[i][0], ns = entries[i][1];
      if (iriVal.indexOf(ns) === 0) return prefix + ':' + iriVal.slice(ns.length);
    }
    return iriVal;
  }

  function predicateToKey(iriVal, prefixes) {
    if (prefixes) {
      var entries = Object.entries(prefixes);
      for (var i = 0; i < entries.length; i++) {
        var prefix = entries[i][0], ns = entries[i][1];
        if (iriVal.indexOf(ns) === 0) return prefix + '_' + iriVal.slice(ns.length);
      }
    }
    var pos = Math.max(iriVal.lastIndexOf('#'), iriVal.lastIndexOf('/'));
    return pos >= 0 ? iriVal.slice(pos + 1) : iriVal;
  }

  function setup(container) {
    var output = container.getAttribute('data-output') || 'none';
    var prefixes = null;
    try { prefixes = JSON.parse(container.getAttribute('data-prefixes')); } catch (e) {}

    // Wire up existing rows
    var rows = container.querySelectorAll('.te-row');
    for (var i = 0; i < rows.length; i++) {
      wireRow(rows[i], prefixes, output, container);
    }

    // Add button area
    if (output !== 'none') {
      var addArea = container.querySelector('.te-add-area');
      if (addArea) {
        var addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'btn btn-secondary mt-05';
        addBtn.textContent = 'Add Triple';
        addBtn.addEventListener('click', function () { addRow(container); });
        addArea.appendChild(addBtn);
      }
    }

    // N-Triples serialization on form submit
    if (output === 'ntriples') {
      var form = container.closest('form');
      if (form) {
        var ntName = container.getAttribute('data-ntriples-name') || 'metadata';
        var hiddenTa = document.createElement('textarea');
        hiddenTa.name = ntName;
        hiddenTa.className = 'hidden';
        container.appendChild(hiddenTa);

        form.addEventListener('submit', function () {
          var subject = container.getAttribute('data-subject');
          var editableRows = container.querySelectorAll('.te-row:not([data-readonly])');
          var lines = [];
          for (var j = 0; j < editableRows.length; j++) {
            var predInput = editableRows[j].querySelector('.te-pred-input');
            var objInput = editableRows[j].querySelector('.te-obj-input');
            if (!predInput || !objInput) continue;
            var pred = predInput.value.trim();
            var obj = objInput.value.trim();
            if (!pred || !obj) continue;
            var objPart = (obj.indexOf('http://') === 0 || obj.indexOf('https://') === 0)
              ? '<' + obj + '>'
              : '"' + obj.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
            lines.push('<' + subject + '> <' + pred + '> ' + objPart + ' .');
          }
          hiddenTa.value = lines.join('\n');
        });
      }
    }
  }

  function wireRow(row, prefixes, output, container) {
    var isReadonly = row.hasAttribute('data-readonly');
    var predDisplay = row.querySelector('.te-pred-display');
    var predInput = row.querySelector('.te-pred-input');
    var searchBtn = row.querySelector('.te-search-btn');
    var predIriHidden = row.querySelector('.te-pred-iri');

    if (isReadonly && predDisplay) {
      // Read-only: toggle full IRI on click
      var fullIriSpan = null;
      predDisplay.addEventListener('click', function () {
        if (fullIriSpan) {
          fullIriSpan.remove();
          fullIriSpan = null;
          return;
        }
        var iriValue = predIriHidden ? predIriHidden.value : predDisplay.textContent;
        fullIriSpan = document.createElement('div');
        fullIriSpan.className = 'mono text-sm text-muted break-all';
        fullIriSpan.textContent = iriValue;
        predDisplay.parentNode.appendChild(fullIriSpan);
      });
      predDisplay.classList.add('cursor-pointer');
      return;
    }

    if (!predDisplay || !predInput) return;

    // Editable row: expand/collapse predicate
    var expanded = !predInput.value.trim();

    function collapse() {
      var val = predInput.value.trim();
      if (!val) return;
      predDisplay.textContent = shortenIri(val, prefixes);
      predDisplay.classList.remove('hidden');
      predInput.classList.add('hidden');
      if (searchBtn) searchBtn.classList.add('hidden');
      expanded = false;
      updateTemplateKey(row, val, prefixes);
    }

    function expand() {
      predDisplay.classList.add('hidden');
      predInput.classList.remove('hidden');
      if (searchBtn) searchBtn.classList.remove('hidden');
      expanded = true;
      predInput.focus();
    }

    if (expanded) {
      predDisplay.classList.add('hidden');
      predInput.classList.remove('hidden');
      if (searchBtn) searchBtn.classList.remove('hidden');
    }

    predDisplay.addEventListener('click', expand);
    predInput.addEventListener('blur', function (e) {
      var related = e.relatedTarget;
      if (related && (related.classList.contains('te-search-btn') ||
          related.closest('.te-ols-panel'))) return;
      setTimeout(function () { collapse(); }, 150);
    });

    // Browse button
    if (searchBtn) {
      searchBtn.addEventListener('click', function () {
        toggleBrowsePanel(row, predInput, prefixes, container);
      });
    }

    // Remove button
    var removeBtn = row.querySelector('.te-remove');
    if (removeBtn) {
      removeBtn.addEventListener('click', function () { row.remove(); });
    }
  }

  function updateTemplateKey(row, iriVal, prefixes) {
    var keySpan = row.querySelector('.te-template-key');
    if (keySpan) {
      keySpan.textContent = predicateToKey(iriVal, prefixes);
    }
  }

  // --- Two-level browse panel ---

  function getCatalog(container) {
    try {
      return JSON.parse(container.getAttribute('data-ns-catalog')) || {};
    } catch (e) {
      return {};
    }
  }

  function toggleBrowsePanel(row, predInput, prefixes, container) {
    var existing = row.querySelector('.te-ols-panel');
    if (existing) { existing.remove(); return; }

    var predCell = row.querySelector('.te-pred-cell');
    var panel = document.createElement('div');
    panel.className = 'te-ols-panel';
    predCell.appendChild(panel);

    var catalog = getCatalog(container);
    showNamespaceList(panel, row, predInput, prefixes, container, catalog);

    // Close panel on outside click
    function outsideClick(e) {
      if (!panel.contains(e.target) && e.target !== predInput &&
          !(e.target.classList && e.target.classList.contains('te-search-btn'))) {
        panel.remove();
        document.removeEventListener('mousedown', outsideClick);
      }
    }
    setTimeout(function () {
      document.addEventListener('mousedown', outsideClick);
    }, 0);
  }

  /** Level 1: Show list of namespaces to pick from. */
  function showNamespaceList(panel, row, predInput, prefixes, container, catalog) {
    panel.innerHTML = '';

    var filterInput = document.createElement('input');
    filterInput.type = 'text';
    filterInput.className = 'te-ns-filter';
    filterInput.placeholder = 'Filter namespaces...';
    panel.appendChild(filterInput);

    var listDiv = document.createElement('div');
    listDiv.className = 'te-ns-list';
    panel.appendChild(listDiv);

    // Build namespace entries from catalog (which includes both built-in and custom)
    var entries = Object.entries(catalog);
    var nsItems = [];

    for (var i = 0; i < entries.length; i++) {
      (function (nsIri, info) {
        var item = document.createElement('div');
        item.className = 'te-ols-result te-ns-item';
        item.setAttribute('data-ns', nsIri);

        var prefixDiv = document.createElement('div');
        prefixDiv.className = 'font-medium';
        prefixDiv.textContent = info.prefix + ':';
        item.appendChild(prefixDiv);

        var nsDiv = document.createElement('div');
        nsDiv.className = 'text-muted text-sm break-all';
        nsDiv.textContent = nsIri;
        item.appendChild(nsDiv);

        var countDiv = document.createElement('div');
        countDiv.className = 'text-muted text-xs';
        var predCount = info.predicates ? info.predicates.length : 0;
        countDiv.textContent = predCount + ' predicate' + (predCount !== 1 ? 's' : '');
        item.appendChild(countDiv);

        item.addEventListener('click', function () {
          showPredicateList(panel, row, predInput, prefixes, container, catalog, nsIri, info);
        });

        listDiv.appendChild(item);
        nsItems.push(item);
      })(entries[i][0], entries[i][1]);
    }

    // If no catalog entries, fall back to showing prefixes without predicate counts
    if (entries.length === 0 && prefixes) {
      var prefixEntries = Object.entries(prefixes);
      for (var j = 0; j < prefixEntries.length; j++) {
        (function (prefix, nsIri) {
          var item = document.createElement('div');
          item.className = 'te-ols-result te-ns-item';
          item.setAttribute('data-ns', nsIri);

          var prefixDiv = document.createElement('div');
          prefixDiv.className = 'font-medium';
          prefixDiv.textContent = prefix + ':';
          item.appendChild(prefixDiv);

          var nsDiv = document.createElement('div');
          nsDiv.className = 'text-muted text-sm break-all';
          nsDiv.textContent = nsIri;
          item.appendChild(nsDiv);

          item.addEventListener('click', function () {
            // No catalog — just set namespace IRI for manual typing
            predInput.value = nsIri;
            var predDisplay = row.querySelector('.te-pred-display');
            if (predDisplay) predDisplay.classList.add('hidden');
            predInput.classList.remove('hidden');
            predInput.focus();
            predInput.setSelectionRange(nsIri.length, nsIri.length);
            panel.remove();
          });

          listDiv.appendChild(item);
          nsItems.push(item);
        })(prefixEntries[j][0], prefixEntries[j][1]);
      }
    }

    // Filter
    filterInput.addEventListener('input', function () {
      var q = filterInput.value.trim().toLowerCase();
      for (var k = 0; k < nsItems.length; k++) {
        var text = nsItems[k].textContent.toLowerCase();
        nsItems[k].style.display = (!q || text.indexOf(q) >= 0) ? '' : 'none';
      }
    });

    filterInput.focus();
  }

  /** Level 2: Show predicates for a selected namespace. */
  function showPredicateList(panel, row, predInput, prefixes, container, catalog, nsIri, info) {
    panel.innerHTML = '';

    // Back button
    var backBtn = document.createElement('div');
    backBtn.className = 'te-ns-back';
    backBtn.innerHTML = '&larr; Back to namespaces';
    backBtn.addEventListener('click', function () {
      showNamespaceList(panel, row, predInput, prefixes, container, catalog);
    });
    panel.appendChild(backBtn);

    // Header
    var header = document.createElement('div');
    header.className = 'font-medium mb-025';
    header.textContent = info.prefix + ': predicates';
    panel.appendChild(header);

    var predicates = info.predicates || [];

    if (predicates.length === 0) {
      var emptyMsg = document.createElement('div');
      emptyMsg.className = 'text-muted text-sm';
      emptyMsg.textContent = 'No predicates discovered yet.';
      panel.appendChild(emptyMsg);

      var btnRow = document.createElement('div');
      btnRow.className = 'flex gap-05 mt-05 flex-wrap';

      // Discover button — try to fetch predicates from the namespace
      var discoverBtn = document.createElement('button');
      discoverBtn.type = 'button';
      discoverBtn.className = 'btn btn-xs';
      discoverBtn.textContent = 'Discover predicates';
      discoverBtn.addEventListener('click', function () {
        discoverBtn.disabled = true;
        discoverBtn.textContent = 'Discovering...';
        emptyMsg.textContent = 'Fetching namespace definition...';

        var fd = new FormData();
        fd.append('ns_iri', nsIri);
        fetch('/profile/discover-ns', { method: 'POST', body: fd })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data.predicates && data.predicates.length > 0) {
              // Update the catalog in memory and on the container attribute
              info.predicates = data.predicates;
              catalog[nsIri] = info;
              container.setAttribute('data-ns-catalog', JSON.stringify(catalog));
              // Re-render predicate list
              showPredicateList(panel, row, predInput, prefixes, container, catalog, nsIri, info);
            } else {
              emptyMsg.textContent = data.error
                ? 'Discovery failed: ' + data.error
                : 'No predicates found. You can type the property name manually.';
              discoverBtn.textContent = 'Retry';
              discoverBtn.disabled = false;
            }
          })
          .catch(function () {
            emptyMsg.textContent = 'Discovery request failed. Try again later.';
            discoverBtn.textContent = 'Retry';
            discoverBtn.disabled = false;
          });
      });
      btnRow.appendChild(discoverBtn);

      // Pre-fill namespace IRI for manual entry
      var useBtn = document.createElement('button');
      useBtn.type = 'button';
      useBtn.className = 'btn btn-secondary btn-xs';
      useBtn.textContent = 'Use this namespace';
      useBtn.addEventListener('click', function () {
        predInput.value = nsIri;
        var predDisplay = row.querySelector('.te-pred-display');
        if (predDisplay) predDisplay.classList.add('hidden');
        predInput.classList.remove('hidden');
        predInput.focus();
        predInput.setSelectionRange(nsIri.length, nsIri.length);
        panel.remove();
      });
      btnRow.appendChild(useBtn);

      panel.appendChild(btnRow);
      return;
    }

    // Filter input
    var filterInput = document.createElement('input');
    filterInput.type = 'text';
    filterInput.className = 'te-ns-filter';
    filterInput.placeholder = 'Filter predicates...';
    panel.appendChild(filterInput);

    // Predicate list
    var listDiv = document.createElement('div');
    listDiv.className = 'te-ns-list';
    panel.appendChild(listDiv);

    var predItems = [];

    for (var i = 0; i < predicates.length; i++) {
      (function (pred) {
        var item = document.createElement('div');
        item.className = 'te-ols-result';
        item.setAttribute('data-iri', pred.iri);

        var labelDiv = document.createElement('div');
        labelDiv.className = 'font-medium';
        labelDiv.textContent = pred.label;
        item.appendChild(labelDiv);

        var iriDiv = document.createElement('div');
        iriDiv.className = 'text-muted text-sm break-all';
        iriDiv.textContent = pred.iri;
        item.appendChild(iriDiv);

        item.addEventListener('click', function () {
          predInput.value = pred.iri;
          var predDisplay = row.querySelector('.te-pred-display');
          predDisplay.textContent = shortenIri(pred.iri, prefixes);
          predDisplay.classList.remove('hidden');
          predInput.classList.add('hidden');
          var sBtn = row.querySelector('.te-search-btn');
          if (sBtn) sBtn.classList.add('hidden');
          updateTemplateKey(row, pred.iri, prefixes);
          panel.remove();
        });

        listDiv.appendChild(item);
        predItems.push(item);
      })(predicates[i]);
    }

    // Filter predicates
    filterInput.addEventListener('input', function () {
      var q = filterInput.value.trim().toLowerCase();
      for (var k = 0; k < predItems.length; k++) {
        var text = predItems[k].textContent.toLowerCase();
        predItems[k].style.display = (!q || text.indexOf(q) >= 0) ? '' : 'none';
      }
    });

    filterInput.focus();
  }

  // --- Add row ---

  function addRow(container) {
    var output = container.getAttribute('data-output') || 'none';
    var prefixes = null;
    try { prefixes = JSON.parse(container.getAttribute('data-prefixes')); } catch (e) {}
    var predName = container.getAttribute('data-predicate-name') || '';
    var objName = container.getAttribute('data-object-name') || '';
    var showKey = container.hasAttribute('data-show-template-key');

    var row = document.createElement('div');
    row.className = 'te-row';

    var predCell = document.createElement('div');
    predCell.className = 'te-pred-cell';

    var predDisplay = document.createElement('span');
    predDisplay.className = 'te-pred-display mono cursor-pointer hidden';

    var predInput = document.createElement('input');
    predInput.type = 'text';
    predInput.className = 'te-pred-input';
    predInput.placeholder = 'Predicate IRI';
    if (predName) predInput.name = predName;

    var searchBtn = document.createElement('button');
    searchBtn.type = 'button';
    searchBtn.className = 'te-search-btn btn btn-secondary btn-xs';
    searchBtn.textContent = 'Browse';

    predCell.appendChild(predDisplay);
    predCell.appendChild(predInput);
    predCell.appendChild(searchBtn);

    var objCell = document.createElement('div');
    objCell.className = 'te-obj-cell';

    var objInput = document.createElement('input');
    objInput.type = 'text';
    objInput.className = 'te-obj-input';
    objInput.placeholder = 'Object value';
    if (objName) objInput.name = objName;
    objCell.appendChild(objInput);

    row.appendChild(predCell);
    row.appendChild(objCell);

    if (showKey) {
      var keySpan = document.createElement('span');
      keySpan.className = 'te-template-key text-muted mono text-sm nowrap';
      row.appendChild(keySpan);
    }

    var removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn btn-secondary btn-compact te-remove';
    removeBtn.textContent = 'Remove';
    row.appendChild(removeBtn);

    var addArea = container.querySelector('.te-add-area');
    if (addArea) {
      container.insertBefore(row, addArea);
    } else {
      container.appendChild(row);
    }

    wireRow(row, prefixes, output, container);
    predInput.focus();
  }

  // --- Prefix Manager ---

  function initPrefixManager() {
    var manager = document.getElementById('prefix-manager');
    if (!manager) return;

    var tbody = document.getElementById('prefix-rows');
    var addBtn = document.getElementById('pm-add');
    var hiddenInput = document.getElementById('custom-prefixes-json');

    if (!tbody || !addBtn || !hiddenInput) return;

    // Wire existing remove buttons
    var removeButtons = tbody.querySelectorAll('.pm-remove');
    for (var i = 0; i < removeButtons.length; i++) {
      removeButtons[i].addEventListener('click', function () {
        this.closest('tr').remove();
        syncPrefixes();
      });
    }

    // Wire existing inputs for change events
    var inputs = tbody.querySelectorAll('input');
    for (var j = 0; j < inputs.length; j++) {
      inputs[j].addEventListener('input', syncPrefixes);
    }

    // Add Prefix button
    addBtn.addEventListener('click', function () {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td><input type="text" class="pm-prefix" value="" placeholder="ex"></td>' +
        '<td><input type="text" class="pm-ns" value="" placeholder="http://example.org/ns#"></td>' +
        '<td><button type="button" class="btn btn-secondary btn-compact pm-remove">Remove</button></td>';
      tbody.appendChild(tr);

      tr.querySelector('.pm-remove').addEventListener('click', function () {
        tr.remove();
        syncPrefixes();
      });
      var newInputs = tr.querySelectorAll('input');
      for (var k = 0; k < newInputs.length; k++) {
        newInputs[k].addEventListener('input', syncPrefixes);
      }
      tr.querySelector('.pm-prefix').focus();
    });

    function syncPrefixes() {
      var map = {};
      var rows = tbody.querySelectorAll('tr');
      for (var r = 0; r < rows.length; r++) {
        var prefix = (rows[r].querySelector('.pm-prefix').value || '').trim();
        var ns = (rows[r].querySelector('.pm-ns').value || '').trim();
        if (prefix && ns) {
          map[prefix] = ns;
        }
      }
      hiddenInput.value = JSON.stringify(map);

      // Update data-prefixes on all .triple-editor containers
      var builtinPrefixes = null;
      var editors = document.querySelectorAll('.triple-editor');
      for (var e = 0; e < editors.length; e++) {
        if (!builtinPrefixes) {
          try {
            builtinPrefixes = JSON.parse(editors[e].getAttribute('data-prefixes'));
          } catch (err) {
            builtinPrefixes = {};
          }
        }
        var merged = Object.assign({}, builtinPrefixes, map);
        editors[e].setAttribute('data-prefixes', JSON.stringify(merged));

        // Also update catalog with new custom prefix entries (empty predicate lists)
        try {
          var catalog = JSON.parse(editors[e].getAttribute('data-ns-catalog')) || {};
          for (var p in map) {
            if (!catalog[map[p]]) {
              catalog[map[p]] = { prefix: p, predicates: [] };
            }
          }
          editors[e].setAttribute('data-ns-catalog', JSON.stringify(catalog));
        } catch (err2) {}
      }
    }
  }

  function init() {
    var containers = document.querySelectorAll('.triple-editor');
    for (var i = 0; i < containers.length; i++) {
      setup(containers[i]);
    }
    initPrefixManager();
  }

  document.addEventListener('DOMContentLoaded', init);

  return {
    init: init,
    setup: setup,
    addRow: addRow,
    shortenIri: shortenIri,
    predicateToKey: predicateToKey
  };
})();
