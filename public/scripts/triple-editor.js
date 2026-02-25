/**
 * Triple Editor Widget — reusable RDF triple editing component.
 *
 * Self-initializes on DOMContentLoaded by finding all `.triple-editor` containers.
 * Supports read-only display, array-based form submission, and N-Triples serialization.
 * Includes OLS ontology search for predicate discovery.
 *
 * Configuration via data-* attributes on .triple-editor container:
 *   data-subject        — subject IRI
 *   data-output         — "arrays" | "ntriples" | "none" (read-only)
 *   data-predicate-name — form field name for predicates
 *   data-object-name    — form field name for objects
 *   data-ntriples-name  — hidden textarea name for N-Triples output
 *   data-show-template-key — if present, shows Mustache template key
 *   data-prefixes       — JSON prefix map
 */
var TripleEditor = (function () {
  var _debounceTimers = {};

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
      // Update template key if shown
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
      // Don't collapse if clicking the search button or OLS panel
      var related = e.relatedTarget;
      if (related && (related.classList.contains('te-search-btn') ||
          related.closest('.te-ols-panel'))) return;
      setTimeout(function () { collapse(); }, 150);
    });

    // Search button
    if (searchBtn) {
      searchBtn.addEventListener('click', function () {
        toggleOlsPanel(row, predInput, prefixes, container);
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

  function toggleOlsPanel(row, predInput, prefixes, container) {
    var existing = row.querySelector('.te-ols-panel');
    if (existing) { existing.remove(); return; }

    var predCell = row.querySelector('.te-pred-cell');
    var panel = document.createElement('div');
    panel.className = 'te-ols-panel';
    panel.innerHTML = '<input type="text" class="te-ols-query" placeholder="Search ontology properties...">' +
      '<div class="te-ols-results"></div>';
    predCell.appendChild(panel);

    var queryInput = panel.querySelector('.te-ols-query');
    var resultsDiv = panel.querySelector('.te-ols-results');
    var panelId = 'ols-' + Date.now();

    queryInput.addEventListener('input', function () {
      var q = queryInput.value.trim();
      if (!q) { resultsDiv.innerHTML = ''; return; }
      clearTimeout(_debounceTimers[panelId]);
      _debounceTimers[panelId] = setTimeout(function () {
        olsSearch(q, function (results) {
          renderOlsResults(resultsDiv, results, predInput, prefixes, panel, container);
        });
      }, 400);
    });

    queryInput.focus();

    // Close panel on outside click
    function outsideClick(e) {
      if (!panel.contains(e.target) && e.target !== predInput) {
        panel.remove();
        document.removeEventListener('mousedown', outsideClick);
      }
    }
    setTimeout(function () {
      document.addEventListener('mousedown', outsideClick);
    }, 0);
  }

  function olsSearch(query, callback) {
    var url = 'https://www.ebi.ac.uk/ols4/api/search?q=' + encodeURIComponent(query) + '&type=property&rows=10';
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.onload = function () {
      if (xhr.status === 200) {
        try {
          var data = JSON.parse(xhr.responseText);
          var docs = (data.response && data.response.docs) || [];
          var results = docs.map(function (d) {
            return {
              iri: d.iri || '',
              label: d.label || d.short_form || '',
              ontology: d.ontology_name || '',
              description: (d.description && d.description[0]) || ''
            };
          });
          callback(results);
        } catch (e) { callback([]); }
      } else { callback([]); }
    };
    xhr.onerror = function () { callback([]); };
    xhr.send();
  }

  function renderOlsResults(resultsDiv, results, predInput, prefixes, panel, container) {
    if (results.length === 0) {
      resultsDiv.innerHTML = '<div class="te-ols-result text-muted text-sm">No results found.</div>';
      return;
    }
    resultsDiv.innerHTML = '';
    for (var i = 0; i < results.length; i++) {
      (function (r) {
        var div = document.createElement('div');
        div.className = 'te-ols-result';
        div.setAttribute('data-iri', r.iri);
        var labelDiv = document.createElement('div');
        labelDiv.className = 'font-medium';
        labelDiv.textContent = r.label;
        var metaDiv = document.createElement('div');
        metaDiv.className = 'text-muted text-sm';
        metaDiv.textContent = r.ontology + ' \u00B7 ' + r.iri;
        div.appendChild(labelDiv);
        div.appendChild(metaDiv);
        if (r.description) {
          var descDiv = document.createElement('div');
          descDiv.className = 'text-muted text-xs';
          descDiv.textContent = r.description;
          div.appendChild(descDiv);
        }
        div.addEventListener('click', function () {
          predInput.value = r.iri;
          // Update the display span
          var row = predInput.closest('.te-row');
          var predDisplay = row.querySelector('.te-pred-display');
          predDisplay.textContent = shortenIri(r.iri, prefixes);
          predDisplay.classList.remove('hidden');
          predInput.classList.add('hidden');
          var searchBtn = row.querySelector('.te-search-btn');
          if (searchBtn) searchBtn.classList.add('hidden');
          updateTemplateKey(row, r.iri, prefixes);
          panel.remove();
        });
        resultsDiv.appendChild(div);
      })(results[i]);
    }
  }

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
    searchBtn.textContent = 'Search';

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

  function init() {
    var containers = document.querySelectorAll('.triple-editor');
    for (var i = 0; i < containers.length; i++) {
      setup(containers[i]);
    }
  }

  document.addEventListener('DOMContentLoaded', init);

  return {
    init: init,
    setup: setup,
    addRow: addRow,
    shortenIri: shortenIri,
    predicateToKey: predicateToKey,
    olsSearch: olsSearch
  };
})();
