async function api(path, opts) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (res.status === 401) {
    window.location.href = '/login.html';
    throw new Error('Not authenticated');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Request failed');
  }
  return res.json();
}

const lotGrid = document.getElementById('lotGrid');
const alertsBar = document.getElementById('alertsBar');
const alertsTitle = document.getElementById('alertsTitle');
const alertsList = document.getElementById('alertsList');
const modalOverlay = document.getElementById('lotModalOverlay');
const modal = document.getElementById('lotModal');

function closeModal() {
  modalOverlay.classList.remove('show');
  modal.innerHTML = '';
}
modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) closeModal();
});

function badgeFor(forecast) {
  if (forecast.daysUntilEmpty === null) return `<span class="badge nodata">No usage data</span>`;
  if (forecast.atRisk) return `<span class="badge risk">Reorder now</span>`;
  return `<span class="badge ok">On track</span>`;
}

async function loadLots() {
  const lots = await api('/api/lots');
  const alerts = lots.filter((l) => l.forecast.atRisk);

  if (alerts.length > 0) {
    alertsBar.classList.add('show');
    alertsTitle.textContent = `⚠ ${alerts.length} lot(s) need reordering now`;
    alertsList.innerHTML = alerts
      .map((l) => `<li><b>${l.origin}</b> — runs out in ${l.forecast.daysUntilEmpty} day(s), ${l.supplier} needs ${l.lead_time_days} days lead time</li>`)
      .join('');
  } else {
    alertsBar.classList.remove('show');
  }

  lotGrid.innerHTML = lots
    .map(
      (l) => `
    <div class="card ${l.forecast.atRisk ? 'risk' : ''}" data-id="${l.id}">
      <h3>${l.origin}</h3>
      <div class="variety">${l.variety} · ${l.supplier}</div>
      <div class="stat-row"><span>On hand</span><b>${l.lbs_on_hand} lbs</b></div>
      <div class="stat-row"><span>Burn rate</span><b>${l.forecast.weeklyBurn} lbs/wk</b></div>
      <div class="stat-row"><span>Lead time</span><b>${l.lead_time_days} days</b></div>
      ${badgeFor(l.forecast)}
    </div>`
    )
    .join('');

  document.querySelectorAll('.card').forEach((card) => {
    card.addEventListener('click', () => openLotDetail(card.dataset.id));
  });
}

async function openLotDetail(id) {
  const lot = await api(`/api/lots/${id}`);
  modal.innerHTML = `
    <h2>${lot.origin}</h2>
    <div class="variety" style="margin-bottom:0.5rem;color:#7a6a58;font-size:0.85rem;">${lot.variety} · ${lot.supplier} (${lot.supplier_contact})</div>
    <div class="reason">${lot.forecast.reason}</div>

    <label>Log a roast (lbs used)</label>
    <input type="number" id="lbsUsed" min="0.1" step="0.1" placeholder="e.g. 25" />
    <div class="modal-actions">
      <button class="plain" id="closeBtn">Close</button>
      <button class="danger" id="deleteBtn">Delete lot</button>
      <button class="primary" id="reorderBtn">Reorder note</button>
      <button class="primary" id="logBtn">Log usage</button>
    </div>

    <div style="margin-top:1rem;">
      <label style="margin-top:0;">Recent usage</label>
      ${
        lot.usage.length
          ? lot.usage
              .map((u) => `<div class="usage-log">${u.lbs_used} lbs — ${new Date(u.logged_at).toLocaleDateString()}</div>`)
              .join('')
          : '<div class="usage-log">No usage logged yet.</div>'
      }
    </div>
  `;
  modalOverlay.classList.add('show');

  document.getElementById('closeBtn').addEventListener('click', closeModal);

  document.getElementById('logBtn').addEventListener('click', async () => {
    const lbs = parseFloat(document.getElementById('lbsUsed').value);
    if (!lbs || lbs <= 0) return alert('Enter a positive number of lbs.');
    await api(`/api/lots/${id}/usage`, { method: 'POST', body: JSON.stringify({ lbs_used: lbs }) });
    closeModal();
    loadLots();
  });

  document.getElementById('deleteBtn').addEventListener('click', async () => {
    if (!confirm(`Delete ${lot.origin}? This removes its usage history too.`)) return;
    await api(`/api/lots/${id}`, { method: 'DELETE' });
    closeModal();
    loadLots();
  });

  document.getElementById('reorderBtn').addEventListener('click', async () => {
    const { note } = await api(`/api/lots/${id}/reorder-note`);
    modal.innerHTML = `
      <h2>Reorder note — ${lot.origin}</h2>
      <textarea readonly>${note}</textarea>
      <div class="modal-actions">
        <button class="plain" id="backBtn">Back</button>
        <button class="primary" id="copyBtn">Copy to clipboard</button>
      </div>
    `;
    document.getElementById('backBtn').addEventListener('click', () => openLotDetail(id));
    document.getElementById('copyBtn').addEventListener('click', () => {
      navigator.clipboard.writeText(note);
      document.getElementById('copyBtn').textContent = 'Copied!';
    });
  });
}

document.getElementById('newLotBtn').addEventListener('click', () => {
  modal.innerHTML = `
    <h2>New lot</h2>
    <label>Origin</label><input id="f_origin" placeholder="e.g. Rwanda Nyamasheke" />
    <label>Variety / process</label><input id="f_variety" placeholder="e.g. Bourbon, washed" />
    <label>Supplier</label><input id="f_supplier" placeholder="e.g. Royal Coffee" />
    <label>Supplier email</label><input id="f_contact" placeholder="orders@supplier.com" />
    <label>Lead time (days)</label><input id="f_lead" type="number" value="21" />
    <label>Lbs on hand</label><input id="f_lbs" type="number" step="0.1" value="100" />
    <label>Cost per lb ($)</label><input id="f_cost" type="number" step="0.01" value="5.50" />
    <label>Reorder buffer (weeks)</label><input id="f_buffer" type="number" step="0.5" value="3" />
    <div class="modal-actions">
      <button class="plain" id="cancelBtn">Cancel</button>
      <button class="primary" id="createBtn">Create</button>
    </div>
  `;
  modalOverlay.classList.add('show');
  document.getElementById('cancelBtn').addEventListener('click', closeModal);
  document.getElementById('createBtn').addEventListener('click', async () => {
    const body = {
      origin: document.getElementById('f_origin').value,
      variety: document.getElementById('f_variety').value,
      supplier: document.getElementById('f_supplier').value,
      supplier_contact: document.getElementById('f_contact').value,
      lead_time_days: parseInt(document.getElementById('f_lead').value, 10),
      lbs_on_hand: parseFloat(document.getElementById('f_lbs').value),
      cost_per_lb: parseFloat(document.getElementById('f_cost').value),
      buffer_weeks: parseFloat(document.getElementById('f_buffer').value),
    };
    if (!body.origin || !body.variety || !body.supplier || !body.supplier_contact) {
      return alert('Fill in all fields.');
    }
    await api('/api/lots', { method: 'POST', body: JSON.stringify(body) });
    closeModal();
    loadLots();
  });
});

document.getElementById('resetBtn').addEventListener('click', async () => {
  if (!confirm('Reset all demo data? This wipes current lots and usage logs.')) return;
  await api('/api/reset', { method: 'POST' });
  loadLots();
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

loadLots();
