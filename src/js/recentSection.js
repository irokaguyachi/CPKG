(function (global) {
  var ARROW_ICON = '<svg class="content-heading-arrow" width="10" height="16" viewBox="0 0 10 16" fill="none" aria-hidden="true"><path d="M1.5 1.5L8 8L1.5 14.5" stroke="#000000" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // title: string, items: array of post data (see PostCard.create), href: optional link for the heading
  function createRecentSection(title, items, href) {
    var section = document.createElement('div');
    section.className = 'recent';

    var heading = href ? document.createElement('a') : document.createElement('div');
    heading.className = 'content-heading';
    if (href) heading.href = href;

    var label = document.createElement('span');
    label.textContent = title;
    heading.appendChild(label);

    var arrowHost = document.createElement('div');
    arrowHost.innerHTML = ARROW_ICON;
    heading.appendChild(arrowHost.firstElementChild);

    section.appendChild(heading);

    var list = document.createElement('div');
    list.className = 'post-list';
    window.PostCard.renderList(list, items);
    section.appendChild(list);

    return section;
  }

  global.RecentSection = {
    create: createRecentSection
  };
})(window);
