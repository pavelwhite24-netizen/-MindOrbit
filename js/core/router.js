(function () {
  'use strict';
  const M = window.MindOrbit;
  M.router = {
    path: '',
    init(render, before) {
      this.render = render; this.before = before;
      window.addEventListener('hashchange', () => {
        const target = location.hash.slice(1) || '/';
        history.replaceState(null,'','#' + this.path);
        this.go(target);
      });
      document.addEventListener('click', event => {
        if (event.target.closest('a[href="#main"]')) {
          event.preventDefault(); document.getElementById('main').focus(); return;
        }
        const link = event.target.closest('a[href^="#/"]');
        if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault(); this.go(link.getAttribute('href').slice(1));
      });
      let first = location.hash.slice(1) || '/';
      if (first.startsWith('/play/')) first = first.replace('/play/','/rules/');
      this.go(first,true);
    },
    async go(path, replace = false) {
      if (!/^\/(?:module\/[A-F]|(?:rules|play|interrupted)\/[A-F][1-3]|result\/[\w-]+|history|settings)?$/.test(path)) path = '/';
      if (path === this.path && !replace) return;
      if (this.before && !await this.before(path)) return;
      this.path = path;
      history[replace ? 'replaceState' : 'pushState'](null,'','#' + path);
      this.render(path); window.scrollTo({ top: 0, behavior: 'instant' });
    }
  };
})();
