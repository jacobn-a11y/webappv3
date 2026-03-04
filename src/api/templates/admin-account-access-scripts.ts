/**
 * Admin Account Access Page — Client-Side JavaScript
 *
 * Contains all client-side JavaScript for the server-rendered account access
 * management page: user loading, grant/revoke actions, modal interactions,
 * account search, CRM report selection, and toast notifications.
 */

export function getAccountAccessScripts(): string {
  return `
    const API_BASE = '/api/dashboard';
    let usersData = [];
    let currentModalUserId = null;
    let currentModalUserName = null;

    // Single account picker state
    let singleSelectedAccount = null;
    let singleSearchDebounce = null;

    // List account picker state
    let listSelectedAccounts = new Map();
    let listSearchDebounce = null;

    // CRM state
    let crmProvider = 'SALESFORCE';
    let crmReports = [];

    // ─── Load Users ──────────────────────────────────────────────

    async function loadUsers() {
      document.getElementById('app-loading').style.display = '';
      document.getElementById('app-error').style.display = 'none';
      document.getElementById('user-list').innerHTML = '';

      try {
        const res = await fetch(API_BASE + '/access');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        usersData = data.users;
        renderUsers();
      } catch (err) {
        document.getElementById('app-loading').style.display = 'none';
        document.getElementById('app-error').style.display = '';
        document.getElementById('error-message').textContent =
          'Failed to load users: ' + err.message;
      }
    }

    function renderUsers() {
      document.getElementById('app-loading').style.display = 'none';
      const container = document.getElementById('user-list');
      container.innerHTML = '';

      for (const user of usersData) {
        container.innerHTML += renderUserCard(user);
      }
    }

    function renderUserCard(user) {
      const initials = getInitials(user.user_name || user.user_email);
      const displayName = user.user_name || user.user_email.split('@')[0];
      const roleClass = 'role--' + user.role.toLowerCase();
      const isAdmin = user.role === 'OWNER' || user.role === 'ADMIN';

      let grantsHtml = '';

      if (isAdmin && user.grants.length === 0) {
        grantsHtml = '<div class="grant-row"><div class="grant-row__info">' +
          '<span class="badge badge--all">All Accounts</span>' +
          '<span class="grant-row__accounts">Implicit via ' + esc(user.role) + ' role</span>' +
          '</div></div>';
      } else if (user.grants.length === 0) {
        grantsHtml = '<div class="grants-empty">No account access granted</div>';
      } else {
        for (const grant of user.grants) {
          grantsHtml += renderGrantRow(grant, user.user_id);
        }
      }

      return '<div class="user-card" id="user-' + esc(user.user_id) + '">' +
        '<div class="user-card__header">' +
          '<div class="user-card__info">' +
            '<div class="user-card__avatar">' + esc(initials) + '</div>' +
            '<div>' +
              '<div class="user-card__name">' + esc(displayName) + '</div>' +
              '<div class="user-card__email">' + esc(user.user_email) + '</div>' +
            '</div>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:0.75rem;">' +
            '<span class="user-card__role ' + roleClass + '">' + esc(user.role) + '</span>' +
            '<div class="user-card__actions">' +
              '<button class="btn btn--primary btn--sm" onclick="openGrantModal(\\'' + esc(user.user_id) + '\\', \\'' + esc(displayName) + '\\')">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>' +
                'Grant Access' +
              '</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="user-card__grants">' + grantsHtml + '</div>' +
      '</div>';
    }

    function renderGrantRow(grant, userId) {
      let badgeHtml = '';
      let detailHtml = '';
      let actionsHtml = '';

      switch (grant.scope_type) {
        case 'ALL_ACCOUNTS':
          badgeHtml = '<span class="badge badge--all">All Accounts</span>';
          break;

        case 'SINGLE_ACCOUNT':
          badgeHtml = '<span class="badge badge--account">Single Account</span>';
          if (grant.account) {
            detailHtml = '<span class="grant-row__accounts">' +
              esc(grant.account.name) +
              (grant.account.domain ? ' <span style="color:var(--color-text-muted)">(' + esc(grant.account.domain) + ')</span>' : '') +
              '</span>';
          }
          break;

        case 'ACCOUNT_LIST':
          badgeHtml = '<span class="badge badge--list">Specific Accounts</span>';
          detailHtml = '<span class="grant-row__accounts">' +
            grant.cached_account_count + ' account' +
            (grant.cached_account_count !== 1 ? 's' : '') +
            '</span>';
          break;

        case 'CRM_REPORT':
          badgeHtml = '<span class="badge badge--crm">CRM Report</span>';
          detailHtml = '<span class="grant-row__accounts">' +
            esc(grant.crm_report_name || grant.crm_report_id || 'Unknown') +
            '</span>' +
            '<span class="crm-sync-info">' +
              (grant.crm_provider ? esc(grant.crm_provider) : '') +
              ' &middot; ' + grant.cached_account_count + ' account' +
              (grant.cached_account_count !== 1 ? 's' : '') +
              (grant.last_synced_at
                ? ' &middot; Synced ' + formatRelativeTime(grant.last_synced_at)
                : ' &middot; Never synced') +
            '</span>';
          actionsHtml += '<button class="btn btn--sync" onclick="syncGrant(\\'' + esc(grant.id) + '\\')" title="Sync Now">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>' +
            ' Sync' +
          '</button>';
          break;
      }

      actionsHtml += '<button class="btn btn--danger" onclick="revokeGrant(\\'' + esc(grant.id) + '\\', \\'' + esc(userId) + '\\')" title="Revoke">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
        ' Revoke' +
      '</button>';

      return '<div class="grant-row" id="grant-' + esc(grant.id) + '">' +
        '<div class="grant-row__info">' + badgeHtml + detailHtml + '</div>' +
        '<div style="display:flex;align-items:center;gap:0.25rem;">' + actionsHtml + '</div>' +
      '</div>';
    }

    // ─── Modal ──────────────────────────────────────────────────

    function openGrantModal(userId, userName) {
      currentModalUserId = userId;
      currentModalUserName = userName;
      document.getElementById('modal-user-label').textContent =
        'Granting access to: ' + userName;

      // Reset state
      singleSelectedAccount = null;
      listSelectedAccounts = new Map();
      document.getElementById('single-account-search').value = '';
      document.getElementById('single-search-results').innerHTML = '';
      document.getElementById('single-search-results').classList.remove('active');
      document.getElementById('single-selected').style.display = 'none';
      document.getElementById('list-account-search').value = '';
      document.getElementById('list-search-results').innerHTML = '';
      document.getElementById('list-search-results').classList.remove('active');
      document.getElementById('list-selected-accounts').innerHTML = '';
      document.getElementById('list-selected-count').textContent = '0 accounts selected';

      // Reset tabs to first
      switchTab(document.querySelector('.tab[data-tab="tab-all"]'));

      // Load CRM reports
      loadCrmReports();

      document.getElementById('grant-modal').classList.add('active');
    }

    function closeModal() {
      document.getElementById('grant-modal').classList.remove('active');
      currentModalUserId = null;
    }

    function switchTab(tabEl) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      tabEl.classList.add('active');
      document.getElementById(tabEl.dataset.tab).classList.add('active');
    }

    // ─── Single Account Search ──────────────────────────────────

    function onSingleAccountSearch(query) {
      clearTimeout(singleSearchDebounce);
      const resultsEl = document.getElementById('single-search-results');

      if (query.length < 1) {
        resultsEl.classList.remove('active');
        resultsEl.innerHTML = '';
        return;
      }

      singleSearchDebounce = setTimeout(async () => {
        try {
          const res = await fetch(API_BASE + '/accounts/search?q=' + encodeURIComponent(query));
          const data = await res.json();
          renderSingleSearchResults(data.accounts);
        } catch { /* ignore */ }
      }, 250);
    }

    function renderSingleSearchResults(accounts) {
      const el = document.getElementById('single-search-results');
      if (accounts.length === 0) {
        el.innerHTML = '<div class="search-result-item" style="color:var(--color-text-muted);cursor:default;">No accounts found</div>';
        el.classList.add('active');
        return;
      }
      el.innerHTML = accounts.map(a =>
        '<div class="search-result-item" onclick="selectSingleAccount(\\''+esc(a.id)+'\\', \\''+esc(a.name)+'\\', \\''+esc(a.domain || '')+'\\')">'+
          '<span class="search-result-item__name">' + esc(a.name) + '</span>' +
          (a.domain ? '<span class="search-result-item__domain">' + esc(a.domain) + '</span>' : '') +
        '</div>'
      ).join('');
      el.classList.add('active');
    }

    function selectSingleAccount(id, name, domain) {
      singleSelectedAccount = { id, name, domain };
      document.getElementById('single-search-results').classList.remove('active');
      document.getElementById('single-account-search').value = '';
      document.getElementById('single-selected').style.display = '';
      document.getElementById('single-selected-name').textContent =
        name + (domain ? ' (' + domain + ')' : '');
    }

    // ─── List Account Search (Multi-select) ─────────────────────

    function onListAccountSearch(query) {
      clearTimeout(listSearchDebounce);
      const resultsEl = document.getElementById('list-search-results');

      if (query.length < 1) {
        resultsEl.classList.remove('active');
        resultsEl.innerHTML = '';
        return;
      }

      listSearchDebounce = setTimeout(async () => {
        try {
          const res = await fetch(API_BASE + '/accounts/search?q=' + encodeURIComponent(query));
          const data = await res.json();
          renderListSearchResults(data.accounts);
        } catch { /* ignore */ }
      }, 250);
    }

    function renderListSearchResults(accounts) {
      const el = document.getElementById('list-search-results');
      const filtered = accounts.filter(a => !listSelectedAccounts.has(a.id));
      if (filtered.length === 0) {
        el.innerHTML = '<div class="search-result-item" style="color:var(--color-text-muted);cursor:default;">No more accounts found</div>';
        el.classList.add('active');
        return;
      }
      el.innerHTML = filtered.map(a =>
        '<div class="search-result-item" onclick="addListAccount(\\''+esc(a.id)+'\\', \\''+esc(a.name)+'\\')">'+
          '<span class="search-result-item__name">' + esc(a.name) + '</span>' +
          (a.domain ? '<span class="search-result-item__domain">' + esc(a.domain) + '</span>' : '') +
        '</div>'
      ).join('');
      el.classList.add('active');
    }

    function addListAccount(id, name) {
      listSelectedAccounts.set(id, name);
      document.getElementById('list-search-results').classList.remove('active');
      document.getElementById('list-account-search').value = '';
      renderListSelected();
    }

    function removeListAccount(id) {
      listSelectedAccounts.delete(id);
      renderListSelected();
    }

    function renderListSelected() {
      const el = document.getElementById('list-selected-accounts');
      let html = '';
      for (const [id, name] of listSelectedAccounts) {
        html += '<span class="selected-tag">' +
          esc(name) +
          '<button onclick="removeListAccount(\\'' + esc(id) + '\\')" title="Remove">&times;</button>' +
        '</span>';
      }
      el.innerHTML = html;
      document.getElementById('list-selected-count').textContent =
        listSelectedAccounts.size + ' account' + (listSelectedAccounts.size !== 1 ? 's' : '') + ' selected';
    }

    // ─── CRM Report ─────────────────────────────────────────────

    function selectProvider(btn) {
      document.querySelectorAll('.provider-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      crmProvider = btn.dataset.provider;

      const label = crmProvider === 'SALESFORCE' ? 'Select a Salesforce Report' : 'Select a HubSpot List';
      document.getElementById('crm-report-label').textContent = label;

      loadCrmReports();
    }

    async function loadCrmReports() {
      const select = document.getElementById('crm-report-select');
      const loading = document.getElementById('crm-reports-loading');
      const empty = document.getElementById('crm-reports-empty');

      select.disabled = true;
      select.innerHTML = '<option value="">Loading&hellip;</option>';
      loading.style.display = '';
      empty.style.display = 'none';

      try {
        const res = await fetch(API_BASE + '/crm-reports?provider=' + crmProvider);
        const data = await res.json();
        crmReports = data.reports || [];

        loading.style.display = 'none';

        if (crmReports.length === 0) {
          empty.style.display = '';
          select.innerHTML = '<option value="">No reports available</option>';
          return;
        }

        select.innerHTML = '<option value="">Choose a report&hellip;</option>' +
          crmReports.map(r =>
            '<option value="' + esc(r.id) + '">' + esc(r.name) + '</option>'
          ).join('');
        select.disabled = false;
      } catch {
        loading.style.display = 'none';
        select.innerHTML = '<option value="">Failed to load reports</option>';
      }
    }

    // ─── Submit Grant ──────────────────────────────────────────

    async function submitGrant() {
      const activeTab = document.querySelector('.tab-panel.active').id;
      const btn = document.getElementById('grant-submit-btn');
      btn.disabled = true;
      btn.textContent = 'Granting\u2026';

      let body = { user_id: currentModalUserId };

      switch (activeTab) {
        case 'tab-all':
          body.scope_type = 'ALL_ACCOUNTS';
          break;

        case 'tab-single':
          if (!singleSelectedAccount) {
            showToast('Please select an account first.', 'error');
            btn.disabled = false;
            btn.textContent = 'Grant Access';
            return;
          }
          body.scope_type = 'SINGLE_ACCOUNT';
          body.account_id = singleSelectedAccount.id;
          break;

        case 'tab-list':
          if (listSelectedAccounts.size === 0) {
            showToast('Please select at least one account.', 'error');
            btn.disabled = false;
            btn.textContent = 'Grant Access';
            return;
          }
          body.scope_type = 'ACCOUNT_LIST';
          body.account_ids = Array.from(listSelectedAccounts.keys());
          break;

        case 'tab-crm': {
          const reportId = document.getElementById('crm-report-select').value;
          if (!reportId) {
            showToast('Please select a CRM report.', 'error');
            btn.disabled = false;
            btn.textContent = 'Grant Access';
            return;
          }
          const report = crmReports.find(r => r.id === reportId);
          body.scope_type = 'CRM_REPORT';
          body.crm_report_id = reportId;
          body.crm_provider = crmProvider;
          body.crm_report_name = report ? report.name : reportId;
          break;
        }
      }

      try {
        const res = await fetch(API_BASE + '/access/grant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed');
        }

        showToast('Access granted to ' + currentModalUserName, 'success');
        closeModal();
        await loadUsers();
      } catch (err) {
        showToast('Failed to grant access: ' + err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Grant Access';
      }
    }

    // ─── Revoke ─────────────────────────────────────────────────

    async function revokeGrant(grantId, userId) {
      if (!confirm('Revoke this access grant?')) return;

      try {
        const res = await fetch(API_BASE + '/access/' + grantId, {
          method: 'DELETE',
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);

        showToast('Access revoked.', 'success');
        await loadUsers();
      } catch (err) {
        showToast('Failed to revoke: ' + err.message, 'error');
      }
    }

    // ─── Sync CRM Grant ─────────────────────────────────────────

    async function syncGrant(grantId) {
      try {
        const res = await fetch(API_BASE + '/access/' + grantId + '/sync', {
          method: 'POST',
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);

        const data = await res.json();
        showToast('Synced ' + data.account_count + ' accounts.', 'success');
        await loadUsers();
      } catch (err) {
        showToast('Sync failed: ' + err.message, 'error');
      }
    }

    // ─── Utilities ──────────────────────────────────────────────

    function esc(str) {
      if (!str) return '';
      const div = document.createElement('div');
      div.textContent = String(str);
      return div.innerHTML;
    }

    function getInitials(name) {
      if (!name) return '?';
      const parts = name.split(/[\\\\s@]+/);
      if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
      return parts[0].substring(0, 2).toUpperCase();
    }

    function formatRelativeTime(dateStr) {
      const d = new Date(dateStr);
      const now = new Date();
      const diffMs = now - d;
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 1) return 'just now';
      if (diffMins < 60) return diffMins + 'm ago';
      if (diffHours < 24) return diffHours + 'h ago';
      if (diffDays < 7) return diffDays + 'd ago';
      return d.toLocaleDateString();
    }

    function showToast(message, type) {
      const container = document.getElementById('toast-container');
      const toast = document.createElement('div');
      toast.className = 'toast toast--' + type;
      toast.textContent = message;
      container.appendChild(toast);
      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => toast.remove(), 300);
      }, 3500);
    }

    // Close modal on outside click
    document.getElementById('grant-modal').addEventListener('click', function(e) {
      if (e.target === this) closeModal();
    });

    // Close search results when clicking outside
    document.addEventListener('click', function(e) {
      if (!e.target.closest('#single-account-search') && !e.target.closest('#single-search-results')) {
        document.getElementById('single-search-results').classList.remove('active');
      }
      if (!e.target.closest('#list-account-search') && !e.target.closest('#list-search-results')) {
        document.getElementById('list-search-results').classList.remove('active');
      }
    });

    // ─── Initialize ─────────────────────────────────────────────

    loadUsers();
  `;
}
