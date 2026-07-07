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
const summaryPill = document.getElementById('summaryPill');
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

function money(n) {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function gaugeFor(forecast, leadTimeDays) {
  const scaleMax = Math.max(leadTimeDays * 1.5, 21);
  const markerPct = Math.min(96, (leadTimeDays / scaleMax) * 100);
  if (forecast.daysUntilEmpty === null) {
    return `
      <div class="gauge-wrap">
        <div class="gauge-labels"><span>Days of stock</span><b>-</b></div>
        <div class="gauge"><div class="gauge-fill nodata" style="width:100%"></div><div class="gauge-marker" style="left:${markerPct}%"></div></div>
      </div>`;
  }
  const fillPct = Math.min(100, (forecast.daysUntilEmpty / scaleMax) * 100);
  const cls = forecast.atRisk ? 'risk' : 'ok';
  return `
    <div class="gauge-wrap">
      <div class="gauge-labels"><span>Days of stock</span><b>${forecast.daysUntilEmpty} day${forecast.daysUntilEmpty === 1 ? '' : 's'}</b></div>
      <div class="gauge"><div class="gauge-fill ${cls}" style="width:${fillPct}%"></div><div class="gauge-marker" style="left:${markerPct}%"></div></div>
    </div>`;
}

async function loadLots() {
  const lots = await api('/api/lots');
  const alerts = lots.filter((l) => l.forecast.atRisk);

  summaryPill.innerHTML = `
    <div class="chip"><b>${lots.length}</b> lots tracked</div>
    <div class="chip"><b>${alerts.length}</b> need reordering</div>
  `;

  if (alerts.length > 0) {
    alertsBar.classList.add('show');
    alertsTitle.innerHTML = `${alerts.length} lot${alerts.length === 1 ? '' : 's'} need reordering now`;
    alertsList.innerHTML = alerts
      .map(
        (l) => `
      <div class="alert-chip" data-id="${l.id}">
        <div class="name">${l.origin}</div>
        <div class="detail">Runs out in ${l.forecast.daysUntilEmpty}d - ${l.supplier} needs ${l.lead_time_days}d</div>
      </div>`
      )
      .join('');
    document.querySelectorAll('.alert-chip').forEach((chip) => {
      chip.addEventListener('click', () => openLotDetail(chip.dataset.id));
    });
  } else {
    alertsBar.classList.remove('show');
  }

  lotGrid.innerHTML = lots
    .map(
      (l, i) => `
    <div class="card" data-id="${l.id}" style="animation-delay:${Math.min(i * 45, 300)}ms">
      <div class="card-top">
        <h3>${l.origin}</h3>
        ${badgeFor(l.forecast)}
      </div>
      <div class="variety">${l.variety}</div>
      <div class="meta-row">${l.supplier}</div>
      <div class="meta-row">${l.lead_time_days}-day lead time - ${l.lbs_on_hand} lbs on hand</div>
      ${gaugeFor(l.forecast, l.lead_time_days)}
      <div class="card-footer">
        <div class="value">Burn: <b>${l.forecast.weeklyBurn} lbs/wk</b></div>
        <div class="value">Value: <b>${money(l.lbs_on_hand * l.cost_per_lb)}</b></div>
      </div>
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
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.5rem;">
      <h2>${lot.origin}</h2>
      ${badgeFor(lot.forecast)}
    </div>
    <div class="variety" style="margin-bottom:0.3rem;">${lot.variety}</div>
    <div class="meta-row" style="margin-bottom:0.2rem;">${lot.supplier} - <a href="mailto:${lot.supplier_contact}" style="color:var(--brand);text-decoration:none;">${lot.supplier_contact}</a></div>
    ${gaugeFor(lot.forecast, lot.lead_time_days)}
    <div class="reason">${lot.forecast.reason}</div>

    <label>Log a roast (lbs used)</label>
    <input type="number" id="lbsUsed" min="0.1" step="0.1" placeholder="e.g. 25" />
    <div class="modal-actions">
      <button class="plain" id="closeBtn">Close</button>
      <button class="danger" id="deleteBtn">Delete</button>
      <button class="primary" id="reorderBtn">Reorder note</button>
      <button class="primary" id="logBtn">Log usage</button>
    </div>

    <div style="margin-top:1rem;">
      <label style="margin-top:0;">Recent usage</label>
      ${
        lot.usage.length
          ? lot.usage
              .map((u) => `<div class="usage-log"><span>${u.lbs_used} lbs</span><span>${new Date(u.logged_at).toLocaleDateString()}</span></div>`)
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
      <h2>Reorder note</h2>
      <div class="variety" style="margin-bottom:0.7rem;">${lot.origin} - ready to paste into an email</div>
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
      <button class="primary" id="createBtn">+ Create lot</button>
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
