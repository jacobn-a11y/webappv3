/**
 * Transcript Viewer — Client-side JavaScript
 *
 * Contains all client-side JavaScript for the server-rendered transcript
 * viewer page: sidebar toggle, text search with highlight navigation,
 * and keyboard shortcuts.
 */

export function getTranscriptViewerScripts(): string {
  return `
  (function() {
    'use strict';

    // ─── Sidebar Toggle ────────────────────────────────────────
    var sidebar = document.getElementById('sidebar');
    var main = document.getElementById('main');
    var toggle = document.getElementById('sidebar-toggle');

    toggle.addEventListener('click', function() {
      var isMobile = window.innerWidth <= 700;
      if (isMobile) {
        sidebar.classList.toggle('mobile-open');
      } else {
        sidebar.classList.toggle('collapsed');
        main.classList.toggle('sidebar-collapsed');
      }
    });

    // ─── Search ────────────────────────────────────────────────
    var searchInput = document.getElementById('search-input');
    var searchCount = document.getElementById('search-count');
    var searchNav = document.getElementById('search-nav');
    var prevBtn = document.getElementById('search-prev');
    var nextBtn = document.getElementById('search-next');
    var textEls = document.querySelectorAll('.seg__text');
    var originalTexts = [];
    var currentMatches = [];
    var currentIndex = -1;

    // Store original text content
    for (var i = 0; i < textEls.length; i++) {
      originalTexts.push(textEls[i].textContent);
    }

    function escapeRegex(str) {
      return str.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
    }

    function clearHighlights() {
      for (var i = 0; i < textEls.length; i++) {
        textEls[i].textContent = originalTexts[i];
      }
      currentMatches = [];
      currentIndex = -1;
      searchCount.textContent = '';
      searchNav.classList.remove('active');
    }

    function performSearch(query) {
      clearHighlights();
      if (!query || query.length < 2) return;

      var regex = new RegExp('(' + escapeRegex(query) + ')', 'gi');
      var matchId = 0;

      for (var i = 0; i < textEls.length; i++) {
        var text = originalTexts[i];
        if (regex.test(text)) {
          regex.lastIndex = 0;
          var html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          var safeRegex = new RegExp('(' + escapeRegex(query).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + ')', 'gi');
          html = html.replace(safeRegex, function(match) {
            return '<mark class="search-hit" data-match-id="' + (matchId++) + '">' + match + '</mark>';
          });
          textEls[i].innerHTML = html;
        }
      }

      currentMatches = document.querySelectorAll('mark.search-hit');
      if (currentMatches.length > 0) {
        searchNav.classList.add('active');
        currentIndex = 0;
        activateMatch(0);
        searchCount.textContent = '1/' + currentMatches.length;
      } else {
        searchCount.textContent = '0 results';
      }
    }

    function activateMatch(index) {
      // Deactivate all
      for (var i = 0; i < currentMatches.length; i++) {
        currentMatches[i].classList.remove('active');
      }
      if (index >= 0 && index < currentMatches.length) {
        currentMatches[index].classList.add('active');
        currentMatches[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
        searchCount.textContent = (index + 1) + '/' + currentMatches.length;
      }
    }

    var debounceTimer;
    searchInput.addEventListener('input', function() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function() {
        performSearch(searchInput.value.trim());
      }, 200);
    });

    searchInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (currentMatches.length > 0) {
          if (e.shiftKey) {
            currentIndex = (currentIndex - 1 + currentMatches.length) % currentMatches.length;
          } else {
            currentIndex = (currentIndex + 1) % currentMatches.length;
          }
          activateMatch(currentIndex);
        }
      }
      if (e.key === 'Escape') {
        searchInput.value = '';
        clearHighlights();
        searchInput.blur();
      }
    });

    prevBtn.addEventListener('click', function() {
      if (currentMatches.length > 0) {
        currentIndex = (currentIndex - 1 + currentMatches.length) % currentMatches.length;
        activateMatch(currentIndex);
      }
    });

    nextBtn.addEventListener('click', function() {
      if (currentMatches.length > 0) {
        currentIndex = (currentIndex + 1) % currentMatches.length;
        activateMatch(currentIndex);
      }
    });

    // Keyboard shortcut: Ctrl/Cmd + F focuses search
    document.addEventListener('keydown', function(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
      }
    });
  })();
  `;
}
