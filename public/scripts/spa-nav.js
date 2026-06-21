(function() {
  'use strict';

  var useNavigationAPI = typeof navigation !== 'undefined' && typeof navigation.navigate !== 'undefined';

  function shouldIntercept(url) {
    if (url.origin !== location.origin) return false;
    var p = url.pathname;
    if (p.startsWith('/css/') || p.startsWith('/scripts/') || p.startsWith('/media/') ||
        p.startsWith('/.well-known/') || p.endsWith('.json') || p.endsWith('.ttl') ||
        p.endsWith('.wasm') || p.startsWith('/jwks') || p.startsWith('/token') ||
        p.startsWith('/register') || p.startsWith('/authorize')) return false;
    return true;
  }

  if (useNavigationAPI) {
    navigation.addEventListener('navigate', function(event) {
      if (!event.canIntercept) return;
      if (event.formData) return;
      if (event.downloadRequest) return;
      if (event.hashChange) return;

      var url = new URL(event.destination.url);
      if (!shouldIntercept(url)) return;

      event.intercept({
        handler: function() { return navigateToFragment(url); }
      });
    });
  } else if (window.history && window.history.pushState) {
    document.addEventListener('click', function(e) {
      var link = e.target.closest('a[href]');
      if (!link) return;
      if (link.target === '_blank') return;
      if (link.hasAttribute('download')) return;
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;

      var url;
      try { url = new URL(link.href); } catch (_) { return; }
      if (!shouldIntercept(url)) return;

      e.preventDefault();
      history.pushState(null, '', url.href);
      navigateToFragment(url);
    });

    window.addEventListener('popstate', function() {
      navigateToFragment(new URL(location.href));
    });
  }

  async function navigateToFragment(url) {
    var main = document.querySelector('main');
    if (!main) { location.href = url.href; return; }

    window.dispatchEvent(new CustomEvent('paa:navigate'));

    try {
      var response = await fetch(url.href, {
        headers: { 'X-Paa-Nav': 'fragment', 'Accept': 'application/json' },
        credentials: 'same-origin',
      });

      if (response.redirected) { location.href = response.url; return; }
      if (!response.ok || response.headers.get('X-Paa-Nav') !== 'fragment') {
        location.href = url.href;
        return;
      }

      var data = await response.json();
      main.innerHTML = data.body;
      document.title = data.title;
      updateActiveNav(url.pathname);
      window.scrollTo(0, 0);
      reinitScripts();
      window.dispatchEvent(new CustomEvent('paa:page-loaded'));
    } catch (e) {
      location.href = url.href;
    }
  }

  function updateActiveNav(pathname) {
    document.querySelectorAll('nav a').forEach(function(link) {
      var linkPath = new URL(link.href, location.origin).pathname;
      if (pathname === linkPath || (linkPath !== '/' && pathname.startsWith(linkPath))) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });
  }

  function reinitScripts() {
    var main = document.querySelector('main');
    if (!main) return;
    main.querySelectorAll('script').forEach(function(old) {
      var s = document.createElement('script');
      if (old.src) { s.src = old.src; s.type = old.type || ''; }
      else { s.textContent = old.textContent; }
      old.replaceWith(s);
    });
  }
})();
