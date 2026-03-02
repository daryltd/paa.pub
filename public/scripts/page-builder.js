/**
 * Page Builder — client-side tree editor for profile page layout JSON.
 *
 * Self-initializing IIFE. Finds #page-builder on DOMContentLoaded.
 * Renders layout as a tree, provides an editor panel for selected nodes,
 * and syncs changes to the hidden #layout-json input.
 */
(function() {
  'use strict';

  document.addEventListener('DOMContentLoaded', function() {
    var container = document.getElementById('page-builder');
    if (!container) return;

    var layout;
    try {
      layout = JSON.parse(container.getAttribute('data-layout'));
    } catch (e) {
      console.error('Page builder: invalid layout JSON');
      return;
    }

    var profileFields;
    try {
      profileFields = JSON.parse(container.getAttribute('data-profile-fields') || '[]');
    } catch (e) {
      profileFields = [];
    }

    var availablePrefixes;
    try {
      availablePrefixes = JSON.parse(container.getAttribute('data-prefixes') || '{}');
    } catch (e) {
      availablePrefixes = {};
    }

    var treeEl = document.getElementById('pb-tree');
    var editorEl = document.getElementById('pb-editor');
    var hiddenInput = document.getElementById('layout-json');
    var selectedId = null;

    // --- Tag categories ---
    var HEAD_TAGS = ['link', 'meta', 'style', 'script'];
    var STRUCTURE_TAGS = ['header', 'nav', 'main', 'footer', 'section', 'article', 'aside', 'div'];
    var CONTENT_TAGS = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'a', 'pre', 'code', 'blockquote', 'strong', 'em', 'small'];
    var VOID_TAGS = ['img', 'br', 'hr'];
    var LIST_TABLE_TAGS = ['ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'details', 'summary'];
    var VOID_SET = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
    var RAW_TAGS = new Set(['script', 'style']);

    // --- Helpers ---
    function uid() {
      return 'n_' + Math.random().toString(36).slice(2, 10);
    }

    function syncToHidden() {
      hiddenInput.value = JSON.stringify(layout);
    }

    function findNodeById(id, nodes) {
      if (!nodes) return null;
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].id === id) return nodes[i];
        if (nodes[i].children) {
          var found = findNodeById(id, nodes[i].children);
          if (found) return found;
        }
      }
      return null;
    }

    function findParentArray(id, nodes) {
      if (!nodes) return null;
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].id === id) return { arr: nodes, idx: i };
        if (nodes[i].children) {
          var found = findParentArray(id, nodes[i].children);
          if (found) return found;
        }
      }
      return null;
    }

    function getSelectedNode() {
      if (!selectedId) return null;
      return findNodeById(selectedId, layout.head) || findNodeById(selectedId, layout.body);
    }

    function nodeCanHaveChildren(tag) {
      if (!tag) return false;
      var t = tag.toLowerCase();
      if (VOID_SET.has(t)) return false;
      if (RAW_TAGS.has(t)) return false;
      return true;
    }

    function abbreviateAttrs(node) {
      var parts = [];
      if (node.attrs) {
        if (node.attrs.class) parts.push('.' + node.attrs.class.split(' ')[0]);
        if (node.attrs.id) parts.push('#' + node.attrs.id);
        if (node.attrs.href) parts.push('href');
        if (node.attrs.src) parts.push('src');
        if (node.attrs.rel) parts.push(node.attrs.rel);
      }
      if (node.rdfa) {
        if (node.rdfa.property) parts.push(node.rdfa.property);
        if (node.rdfa.rel) parts.push(node.rdfa.rel);
        if (node.rdfa.typeof) parts.push(node.rdfa.typeof);
      }
      if (node.content) {
        var c = node.content;
        if (c.length > 20) c = c.slice(0, 20) + '...';
        parts.push('"' + c + '"');
      }
      if (node.conditional) parts.push('if:' + node.conditional);
      if (node.repeat) parts.push('each:' + node.repeat);
      return parts.join(' ');
    }

    // --- Tree rendering ---
    function renderTree() {
      var html = '';
      html += '<div class="pb-tree-section pb-deselect" title="Click to show page settings">HEAD</div>';
      if (layout.head) {
        for (var i = 0; i < layout.head.length; i++) {
          html += renderTreeNode(layout.head[i], 0, 'head');
        }
      }
      html += '<div class="pb-tree-section pb-deselect" title="Click to show page settings">BODY</div>';
      if (layout.body) {
        for (var i = 0; i < layout.body.length; i++) {
          html += renderTreeNode(layout.body[i], 0, 'body');
        }
      }
      treeEl.innerHTML = html;

      // Section headers deselect
      var sectionHeaders = treeEl.querySelectorAll('.pb-deselect');
      for (var i = 0; i < sectionHeaders.length; i++) {
        sectionHeaders[i].addEventListener('click', function() {
          selectedId = null;
          renderTree();
          renderEditor();
        });
      }

      // Attach event listeners
      var rows = treeEl.querySelectorAll('.pb-tree-row');
      for (var i = 0; i < rows.length; i++) {
        (function(row) {
          row.addEventListener('click', function(e) {
            if (e.target.tagName === 'BUTTON') return;
            selectedId = row.getAttribute('data-id');
            renderTree();
            renderEditor();
          });
        })(rows[i]);
      }

      // Control buttons
      var btns = treeEl.querySelectorAll('[data-action]');
      for (var i = 0; i < btns.length; i++) {
        (function(btn) {
          btn.addEventListener('click', function(e) {
            e.stopPropagation();
            var id = btn.getAttribute('data-target');
            var action = btn.getAttribute('data-action');
            handleTreeAction(id, action);
          });
        })(btns[i]);
      }
    }

    function renderTreeNode(node, depth, section) {
      if (!node) return '';
      var sel = node.id === selectedId ? ' pb-selected' : '';
      var indentClass = depth <= 5 ? 'pb-indent-' + depth : 'pb-indent-5';
      var info = abbreviateAttrs(node);

      var html = '<div class="pb-tree-row ' + indentClass + sel + '" data-id="' + node.id + '">';
      html += '<span class="pb-tree-tag">&lt;' + escHtml(node.tag) + '&gt;</span>';
      if (info) html += '<span class="pb-tree-info">' + escHtml(info) + '</span>';
      html += '<span class="pb-tree-controls">';
      html += '<button data-action="up" data-target="' + node.id + '" title="Move up">&uarr;</button>';
      html += '<button data-action="down" data-target="' + node.id + '" title="Move down">&darr;</button>';
      html += '<button data-action="delete" data-target="' + node.id + '" title="Delete">&times;</button>';
      html += '</span>';
      html += '</div>';

      if (node.children) {
        for (var i = 0; i < node.children.length; i++) {
          html += renderTreeNode(node.children[i], depth + 1, section);
        }
      }
      return html;
    }

    function escHtml(s) {
      if (!s) return '';
      return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // --- Tree actions ---
    function handleTreeAction(id, action) {
      var loc = findParentArray(id, layout.head) || findParentArray(id, layout.body);
      if (!loc) return;
      var arr = loc.arr;
      var idx = loc.idx;

      if (action === 'up' && idx > 0) {
        var tmp = arr[idx];
        arr[idx] = arr[idx - 1];
        arr[idx - 1] = tmp;
      } else if (action === 'down' && idx < arr.length - 1) {
        var tmp = arr[idx];
        arr[idx] = arr[idx + 1];
        arr[idx + 1] = tmp;
      } else if (action === 'delete') {
        if (selectedId === id) selectedId = null;
        arr.splice(idx, 1);
      }

      syncToHidden();
      renderTree();
      renderEditor();
    }

    // --- Tag picker ---
    function showTagPicker(target, section, parentNode) {
      closeAllPickers();
      var picker = document.createElement('div');
      picker.className = 'pb-tag-picker';
      picker.id = 'pb-active-picker';

      var groups;
      if (section === 'head') {
        groups = [{ label: 'Head', tags: HEAD_TAGS }];
      } else {
        groups = [
          { label: 'Structure', tags: STRUCTURE_TAGS },
          { label: 'Content', tags: CONTENT_TAGS },
          { label: 'Void', tags: VOID_TAGS },
          { label: 'List / Table', tags: LIST_TABLE_TAGS },
        ];
      }

      var html = '';
      for (var g = 0; g < groups.length; g++) {
        html += '<div class="pb-tag-group-label">' + groups[g].label + '</div>';
        for (var t = 0; t < groups[g].tags.length; t++) {
          html += '<div class="pb-tag-option" data-tag="' + groups[g].tags[t] + '">' + groups[g].tags[t] + '</div>';
        }
      }

      // Custom element input
      html += '<div class="pb-tag-group-label">Custom Element</div>';
      html += '<div style="padding: 0.25rem 0.5rem;"><input type="text" id="pb-custom-tag-input" placeholder="my-component" style="width:100%;font-size:0.85rem;padding:0.3rem;"><button type="button" class="btn btn-secondary btn-xs mt-025" id="pb-custom-tag-add">Add</button></div>';

      picker.innerHTML = html;
      target.style.position = 'relative';
      target.appendChild(picker);

      // Tag option click
      var options = picker.querySelectorAll('.pb-tag-option');
      for (var i = 0; i < options.length; i++) {
        (function(opt) {
          opt.addEventListener('click', function() {
            addNode(opt.getAttribute('data-tag'), section, parentNode);
            closeAllPickers();
          });
        })(options[i]);
      }

      // Custom tag add
      var customAddBtn = picker.querySelector('#pb-custom-tag-add');
      var customInput = picker.querySelector('#pb-custom-tag-input');
      if (customAddBtn && customInput) {
        customAddBtn.addEventListener('click', function() {
          var tag = customInput.value.trim().toLowerCase();
          if (tag && tag.includes('-') && /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(tag)) {
            addNode(tag, section, parentNode);
            closeAllPickers();
          } else if (tag) {
            customInput.style.borderColor = '#dc3545';
          }
        });
      }

      // Close on outside click
      setTimeout(function() {
        document.addEventListener('click', closePicker);
      }, 0);

      function closePicker(e) {
        if (!picker.contains(e.target) && e.target !== target) {
          closeAllPickers();
          document.removeEventListener('click', closePicker);
        }
      }
    }

    function closeAllPickers() {
      var existing = document.getElementById('pb-active-picker');
      if (existing) existing.remove();
      var menus = document.querySelectorAll('.pb-bind-menu');
      for (var i = 0; i < menus.length; i++) menus[i].remove();
    }

    function addNode(tag, section, parentNode) {
      var node = {
        id: uid(),
        tag: tag,
        attrs: null,
        rdfa: null,
        content: null,
        conditional: null,
        repeat: null,
        children: nodeCanHaveChildren(tag) ? [] : null,
      };

      if (parentNode && nodeCanHaveChildren(parentNode.tag) && parentNode.children) {
        parentNode.children.push(node);
      } else if (section === 'head') {
        if (!layout.head) layout.head = [];
        layout.head.push(node);
      } else {
        if (!layout.body) layout.body = [];
        layout.body.push(node);
      }

      selectedId = node.id;
      syncToHidden();
      renderTree();
      renderEditor();
    }

    // --- Editor panel ---
    function renderEditor() {
      var node = getSelectedNode();
      if (!node) {
        editorEl.innerHTML = '<div class="text-muted text-sm" style="padding:1rem;">Select an element to edit, or use the buttons above to add elements.</div>' + renderMetaEditor();
        wireMetaEvents();
        return;
      }

      var html = '';
      html += '<div style="margin-bottom:0.5rem;"><button type="button" class="link-btn-neutral" id="pb-back-to-page" style="font-size:0.8rem;">&larr; Page Settings</button></div>';
      html += '<div class="form-group"><label>Tag</label><div class="mono" style="padding:0.35rem 0;">&lt;' + escHtml(node.tag) + '&gt;</div></div>';

      // Attributes
      html += '<div class="form-group"><label>Attributes</label>';
      var attrs = node.attrs || {};
      var attrKeys = Object.keys(attrs);
      for (var i = 0; i < attrKeys.length; i++) {
        html += renderAttrRow(attrKeys[i], attrs[attrKeys[i]], 'attr');
      }
      html += '<button type="button" class="btn btn-secondary btn-xs" id="pb-add-attr">+ Attribute</button>';
      html += '</div>';

      // RDFa
      html += '<div class="form-group"><label>RDFa</label>';
      var rdfaKeys = ['about', 'typeof', 'property', 'rel', 'resource', 'prefix'];
      var rdfa = node.rdfa || {};
      for (var i = 0; i < rdfaKeys.length; i++) {
        html += '<div class="pb-attr-row">';
        html += '<input type="text" value="' + escHtml(rdfaKeys[i]) + '" readonly style="width:80px;background:#f5f5f5;flex:none;">';
        html += '<input type="text" class="pb-rdfa-val" data-key="' + rdfaKeys[i] + '" value="' + escHtml(rdfa[rdfaKeys[i]] || '') + '" placeholder="' + rdfaKeys[i] + '">';
        html += bindButton();
        html += '</div>';
      }
      html += '</div>';

      // Content
      if (!VOID_SET.has(node.tag.toLowerCase())) {
        html += '<div class="form-group"><label>Content</label>';
        html += '<div style="position:relative;">';
        html += '<textarea class="pb-content-input" rows="3">' + escHtml(node.content || '') + '</textarea>';
        html += '<div style="margin-top:0.25rem;">' + bindButton() + '</div>';
        html += '</div></div>';
      }

      // Conditional
      html += '<div class="form-group"><label>Conditional (show if truthy)</label>';
      html += '<input type="text" class="pb-conditional-input" value="' + escHtml(node.conditional || '') + '" placeholder="e.g. has_foaf_knows, bio, img">';
      html += '</div>';

      // Repeat
      html += '<div class="form-group"><label>Repeat (iterate list)</label>';
      html += '<input type="text" class="pb-repeat-input" value="' + escHtml(node.repeat || '') + '" placeholder="e.g. foaf_knows_list">';
      html += '</div>';

      // Add child button (if applicable)
      if (nodeCanHaveChildren(node.tag)) {
        html += '<div class="form-group"><button type="button" class="btn btn-secondary btn-xs" id="pb-add-child">+ Add Child</button></div>';
      }

      editorEl.innerHTML = html;
      wireEditorEvents(node);
    }

    function renderAttrRow(key, value, type) {
      var html = '<div class="pb-attr-row">';
      html += '<input type="text" class="pb-attr-key" value="' + escHtml(key) + '" placeholder="name" style="width:80px;flex:none;">';
      html += '<input type="text" class="pb-attr-val" value="' + escHtml(value || '') + '" placeholder="value">';
      html += bindButton();
      html += '<button type="button" class="pb-attr-remove" style="border:none;background:none;cursor:pointer;color:#dc3545;font-size:1rem;" title="Remove">&times;</button>';
      html += '</div>';
      return html;
    }

    function bindButton() {
      return '<button type="button" class="pb-bind-btn" title="Insert template variable">{{...}}</button>';
    }

    // --- Prefix helpers ---

    /** Parse RDFa prefix string "foaf: http://... vcard: http://..." into [{name, iri}] */
    function parsePrefixString(str) {
      if (!str) return [];
      var pairs = [];
      var re = /(\w+):\s+(https?:\/\/\S+)/g;
      var m;
      while ((m = re.exec(str)) !== null) {
        pairs.push({ name: m[1], iri: m[2] });
      }
      return pairs;
    }

    /** Serialize [{name, iri}] back to RDFa prefix string */
    function serializePrefixList(pairs) {
      return pairs.map(function(p) { return p.name + ': ' + p.iri; }).join(' ');
    }

    function renderMetaEditor() {
      var meta = layout.meta || {};
      var html = '<div class="form-group mt-075"><label>Page Title</label>';
      html += '<input type="text" id="pb-meta-title" value="' + escHtml(meta.title || '') + '" placeholder="{{name}} - {{domain}}">';
      html += '</div>';
      html += '<div class="form-group"><label>Language</label>';
      html += '<input type="text" id="pb-meta-lang" value="' + escHtml(meta.lang || 'en') + '" placeholder="en" style="width:60px;">';
      html += '</div>';

      // RDFa prefix list
      var activePrefixes = parsePrefixString(meta.prefix);
      html += '<div class="form-group"><label>RDFa Prefixes</label>';
      html += '<div id="pb-prefix-list">';
      if (activePrefixes.length === 0) {
        html += '<div class="text-muted text-sm" style="padding:0.25rem 0;">No prefixes declared.</div>';
      }
      for (var i = 0; i < activePrefixes.length; i++) {
        html += '<div class="pb-prefix-row flex items-center gap-025 mb-025">';
        html += '<span class="mono text-sm" style="min-width:60px;font-weight:600;">' + escHtml(activePrefixes[i].name) + ':</span>';
        html += '<span class="mono text-xs text-muted flex-1 truncate">' + escHtml(activePrefixes[i].iri) + '</span>';
        html += '<button type="button" class="pb-prefix-remove link-btn" data-prefix="' + escHtml(activePrefixes[i].name) + '" title="Remove">&times;</button>';
        html += '</div>';
      }
      html += '</div>';
      html += '<button type="button" class="btn btn-secondary btn-xs mt-025" id="pb-prefix-add">+ Add Prefix</button>';
      html += '</div>';

      return html;
    }

    function wireEditorEvents(node) {
      // Back to page settings
      var backBtn = editorEl.querySelector('#pb-back-to-page');
      if (backBtn) {
        backBtn.addEventListener('click', function() {
          selectedId = null;
          renderTree();
          renderEditor();
        });
      }

      // Attribute key/value changes
      var attrRows = editorEl.querySelectorAll('.pb-attr-row');
      for (var i = 0; i < attrRows.length; i++) {
        (function(row) {
          var keyInput = row.querySelector('.pb-attr-key');
          var valInput = row.querySelector('.pb-attr-val');
          var removeBtn = row.querySelector('.pb-attr-remove');

          if (keyInput && valInput) {
            function syncAttrs() {
              if (!node.attrs) node.attrs = {};
              // Rebuild attrs from all rows
              var newAttrs = {};
              var rows = editorEl.querySelectorAll('.pb-attr-row');
              for (var j = 0; j < rows.length; j++) {
                var k = rows[j].querySelector('.pb-attr-key');
                var v = rows[j].querySelector('.pb-attr-val');
                if (k && v && k.value.trim()) {
                  newAttrs[k.value.trim()] = v.value;
                }
              }
              node.attrs = Object.keys(newAttrs).length > 0 ? newAttrs : null;
              syncToHidden();
              renderTree();
            }
            keyInput.addEventListener('change', syncAttrs);
            valInput.addEventListener('change', syncAttrs);
          }

          if (removeBtn) {
            removeBtn.addEventListener('click', function() {
              row.remove();
              // Rebuild attrs
              if (!node.attrs) node.attrs = {};
              var newAttrs = {};
              var rows = editorEl.querySelectorAll('.pb-attr-row');
              for (var j = 0; j < rows.length; j++) {
                var k = rows[j].querySelector('.pb-attr-key');
                var v = rows[j].querySelector('.pb-attr-val');
                if (k && v && k.value.trim()) {
                  newAttrs[k.value.trim()] = v.value;
                }
              }
              node.attrs = Object.keys(newAttrs).length > 0 ? newAttrs : null;
              syncToHidden();
              renderTree();
            });
          }
        })(attrRows[i]);
      }

      // Add attribute button
      var addAttrBtn = editorEl.querySelector('#pb-add-attr');
      if (addAttrBtn) {
        addAttrBtn.addEventListener('click', function() {
          if (!node.attrs) node.attrs = {};
          node.attrs[''] = '';
          syncToHidden();
          renderEditor();
        });
      }

      // RDFa value changes
      var rdfaInputs = editorEl.querySelectorAll('.pb-rdfa-val');
      for (var i = 0; i < rdfaInputs.length; i++) {
        (function(input) {
          input.addEventListener('change', function() {
            var key = input.getAttribute('data-key');
            if (!node.rdfa) node.rdfa = {};
            if (input.value.trim()) {
              node.rdfa[key] = input.value;
            } else {
              delete node.rdfa[key];
              if (Object.keys(node.rdfa).length === 0) node.rdfa = null;
            }
            syncToHidden();
            renderTree();
          });
        })(rdfaInputs[i]);
      }

      // Content change
      var contentInput = editorEl.querySelector('.pb-content-input');
      if (contentInput) {
        contentInput.addEventListener('change', function() {
          node.content = contentInput.value || null;
          syncToHidden();
          renderTree();
        });
      }

      // Conditional
      var condInput = editorEl.querySelector('.pb-conditional-input');
      if (condInput) {
        condInput.addEventListener('change', function() {
          node.conditional = condInput.value.trim() || null;
          syncToHidden();
          renderTree();
        });
      }

      // Repeat
      var repeatInput = editorEl.querySelector('.pb-repeat-input');
      if (repeatInput) {
        repeatInput.addEventListener('change', function() {
          node.repeat = repeatInput.value.trim() || null;
          syncToHidden();
          renderTree();
        });
      }

      // Add child
      var addChildBtn = editorEl.querySelector('#pb-add-child');
      if (addChildBtn) {
        addChildBtn.addEventListener('click', function() {
          showTagPicker(addChildBtn.parentNode, 'body', node);
        });
      }

      // Bind buttons
      var bindBtns = editorEl.querySelectorAll('.pb-bind-btn');
      for (var i = 0; i < bindBtns.length; i++) {
        (function(btn) {
          btn.addEventListener('click', function(e) {
            e.stopPropagation();
            showBindMenu(btn);
          });
        })(bindBtns[i]);
      }

    }

    function wireMetaEvents() {
      var metaTitle = editorEl.querySelector('#pb-meta-title');
      var metaLang = editorEl.querySelector('#pb-meta-lang');
      if (metaTitle) {
        metaTitle.addEventListener('change', function() {
          if (!layout.meta) layout.meta = {};
          layout.meta.title = metaTitle.value;
          syncToHidden();
        });
      }
      if (metaLang) {
        metaLang.addEventListener('change', function() {
          if (!layout.meta) layout.meta = {};
          layout.meta.lang = metaLang.value;
          syncToHidden();
        });
      }

      // Prefix remove buttons
      var removeBtns = editorEl.querySelectorAll('.pb-prefix-remove');
      for (var i = 0; i < removeBtns.length; i++) {
        (function(btn) {
          btn.addEventListener('click', function() {
            var name = btn.getAttribute('data-prefix');
            if (!layout.meta) layout.meta = {};
            var pairs = parsePrefixString(layout.meta.prefix);
            pairs = pairs.filter(function(p) { return p.name !== name; });
            layout.meta.prefix = serializePrefixList(pairs);
            syncToHidden();
            renderEditor();
          });
        })(removeBtns[i]);
      }

      // Prefix add button
      var addBtn = editorEl.querySelector('#pb-prefix-add');
      if (addBtn) {
        addBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          showPrefixPicker(addBtn);
        });
      }
    }

    function showPrefixPicker(anchorBtn) {
      closeAllPickers();
      // Determine which prefixes are already active
      if (!layout.meta) layout.meta = {};
      var activePairs = parsePrefixString(layout.meta.prefix);
      var activeNames = {};
      for (var i = 0; i < activePairs.length; i++) {
        activeNames[activePairs[i].name] = true;
      }

      // Build list of available but not-yet-added prefixes
      var candidates = [];
      for (var name in availablePrefixes) {
        if (!activeNames[name]) {
          candidates.push({ name: name, iri: availablePrefixes[name] });
        }
      }
      candidates.sort(function(a, b) { return a.name.localeCompare(b.name); });

      var menu = document.createElement('div');
      menu.className = 'pb-bind-menu';

      if (candidates.length === 0) {
        menu.innerHTML = '<div class="text-muted text-sm" style="padding:0.5rem;">All available prefixes are already added.</div>';
      } else {
        var html = '';
        for (var i = 0; i < candidates.length; i++) {
          html += '<div class="pb-bind-menu-item pb-prefix-pick" data-name="' + escHtml(candidates[i].name) + '" data-iri="' + escHtml(candidates[i].iri) + '">';
          html += '<span class="mono" style="font-weight:600;">' + escHtml(candidates[i].name) + ':</span> ';
          html += '<span class="text-muted text-xs">' + escHtml(candidates[i].iri) + '</span>';
          html += '</div>';
        }
        menu.innerHTML = html;
      }

      anchorBtn.parentNode.style.position = 'relative';
      anchorBtn.parentNode.appendChild(menu);

      // Pick handler
      var items = menu.querySelectorAll('.pb-prefix-pick');
      for (var i = 0; i < items.length; i++) {
        (function(item) {
          item.addEventListener('click', function() {
            var name = item.getAttribute('data-name');
            var iri = item.getAttribute('data-iri');
            var pairs = parsePrefixString(layout.meta.prefix);
            pairs.push({ name: name, iri: iri });
            layout.meta.prefix = serializePrefixList(pairs);
            syncToHidden();
            menu.remove();
            renderEditor();
          });
        })(items[i]);
      }

      // Close on outside click
      setTimeout(function() {
        document.addEventListener('click', function closeMenu(e) {
          if (!menu.contains(e.target) && e.target !== anchorBtn) {
            menu.remove();
            document.removeEventListener('click', closeMenu);
          }
        });
      }, 0);
    }

    function showBindMenu(btn) {
      closeAllPickers();
      var menu = document.createElement('div');
      menu.className = 'pb-bind-menu';

      var html = '';
      for (var i = 0; i < profileFields.length; i++) {
        html += '<div class="pb-bind-menu-item" data-key="' + profileFields[i].key + '">';
        html += '<span class="mono">' + escHtml(profileFields[i].key) + '</span> ';
        html += '<span class="text-muted text-xs">' + escHtml(profileFields[i].label) + '</span>';
        html += '</div>';
      }
      menu.innerHTML = html;

      btn.style.position = 'relative';
      btn.parentNode.style.position = 'relative';
      btn.parentNode.appendChild(menu);

      var items = menu.querySelectorAll('.pb-bind-menu-item');
      for (var i = 0; i < items.length; i++) {
        (function(item) {
          item.addEventListener('click', function() {
            var key = item.getAttribute('data-key');
            var varStr = '{{' + key + '}}';
            // Find the nearest input or textarea sibling
            var parent = btn.parentNode;
            var input = parent.querySelector('textarea') || parent.querySelector('input[type="text"]:not([readonly])');
            if (!input) {
              // Try previous sibling
              input = parent.previousElementSibling;
              if (input && input.tagName !== 'INPUT' && input.tagName !== 'TEXTAREA') {
                input = parent.parentNode.querySelector('textarea') || parent.parentNode.querySelector('.pb-attr-val');
              }
            }
            if (input && (input.tagName === 'INPUT' || input.tagName === 'TEXTAREA')) {
              var start = input.selectionStart || input.value.length;
              input.value = input.value.slice(0, start) + varStr + input.value.slice(start);
              input.dispatchEvent(new Event('change'));
              input.focus();
            }
            menu.remove();
          });
        })(items[i]);
      }

      // Close on outside click
      setTimeout(function() {
        document.addEventListener('click', function closeMenu(e) {
          if (!menu.contains(e.target)) {
            menu.remove();
            document.removeEventListener('click', closeMenu);
          }
        });
      }, 0);
    }

    // --- Button handlers ---
    var addHeadBtn = document.getElementById('pb-add-head');
    var addBodyBtn = document.getElementById('pb-add-body');
    var previewBtn = document.getElementById('pb-preview');
    var importBtn = document.getElementById('pb-import-component');

    if (addHeadBtn) {
      addHeadBtn.addEventListener('click', function() {
        showTagPicker(addHeadBtn.parentNode, 'head', null);
      });
    }

    if (addBodyBtn) {
      addBodyBtn.addEventListener('click', function() {
        var sel = getSelectedNode();
        if (sel && nodeCanHaveChildren(sel.tag)) {
          showTagPicker(addBodyBtn.parentNode, 'body', sel);
        } else {
          showTagPicker(addBodyBtn.parentNode, 'body', null);
        }
      });
    }

    if (previewBtn) {
      previewBtn.addEventListener('click', function() {
        var form = document.createElement('form');
        form.method = 'POST';
        form.action = '/profile/preview-layout';
        form.target = '_blank';
        var input = document.createElement('input');
        input.type = 'hidden';
        input.name = 'layout_json';
        input.value = JSON.stringify(layout);
        form.appendChild(input);
        document.body.appendChild(form);
        form.submit();
        form.remove();
      });
    }

    if (importBtn) {
      importBtn.addEventListener('click', function() {
        var url = prompt('Enter the URL of the component JS file:');
        if (!url) return;
        var fd = new FormData();
        fd.append('url', url);
        fetch('/profile/import-component', { method: 'POST', body: fd })
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (data.error) {
              alert('Import failed: ' + data.error);
              return;
            }
            // Add script tag to head
            var scriptNode = {
              id: uid(),
              tag: 'script',
              attrs: { src: data.file },
              content: null,
              children: null,
            };
            if (!layout.head) layout.head = [];
            layout.head.push(scriptNode);
            syncToHidden();
            renderTree();
            alert('Imported ' + data.name + '. Script tag added to head.');
          })
          .catch(function(e) {
            alert('Import failed: ' + e.message);
          });
      });
    }

    // Initial render
    renderTree();
    renderEditor();
  });
})();
