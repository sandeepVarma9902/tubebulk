// TubeBulk popup logic
const $ = (id) => document.getElementById(id);
const EXTPAY_EXTENSION_ID = 'tubebulk'; // must match background.js (owner's ExtensionPay id)
const extpay = ExtPay(EXTPAY_EXTENSION_ID);

let videos = [];
let selected = new Set();
let currentOp = 'replace';
let lastPreview = null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const send = (msg) => chrome.runtime.sendMessage(msg);

function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  $(id).classList.add('active');
}

async function refreshBadge() {
  try {
    const r = await send({ type: 'BG_GET_USAGE' });
    const badge = $('planBadge');
    if (r.usage.tb_paid) { badge.textContent = 'PRO'; badge.classList.add('pro'); }
    else {
      const left = Math.max(0, r.freeLimit - r.usage.tb_free_used);
      badge.textContent = `Free: ${left}/${r.freeLimit}`;
      badge.classList.remove('pro');
    }
  } catch (_) { /* ignore */ }
}

// ---------- auth / loading ----------
$('connectBtn').addEventListener('click', async () => {
  $('authError').classList.add('hidden');
  show('screen-loading');
  $('loadingText').textContent = 'Connecting to YouTube…';
  try {
    await send({ type: 'BG_LIST_VIDEOS' });
    const { tb_videos = [] } = await chrome.storage.session.get('tb_videos');
    videos = tb_videos;
    selected = new Set(videos.map((v) => v.id));
    renderList();
    show('screen-videos');
  } catch (e) {
    $('authError').textContent = 'Could not connect: ' + (e.message || e);
    $('authError').classList.remove('hidden');
    show('screen-auth');
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'BG_PROGRESS') {
    if ($('screen-loading').classList.contains('active') && msg.loaded != null) {
      $('loadingText').textContent = `Loading your videos… (${msg.loaded} found)`;
    }
    if ($('screen-progress').classList.contains('active') && msg.done != null) {
      $('progressText').textContent = `Updating ${msg.done} of ${msg.total}…`;
      $('progressFill').style.width = Math.round((msg.done / msg.total) * 100) + '%';
    }
  }
});

$('signoutBtn').addEventListener('click', async () => {
  await send({ type: 'BG_SIGNOUT' }).catch(() => {});
  videos = []; selected = new Set();
  show('screen-auth');
  refreshBadge();
});

// ---------- video list ----------
function renderList() {
  const q = $('searchBox').value.toLowerCase();
  const list = $('videoList');
  list.innerHTML = '';
  let shown = 0;
  for (const v of videos) {
    if (q && !v.title.toLowerCase().includes(q) && !v.description.toLowerCase().includes(q)) continue;
    shown++;
    const row = document.createElement('label');
    row.className = 'vrow';
    row.innerHTML = `<input type="checkbox" ${selected.has(v.id) ? 'checked' : ''}>
      <span><span class="vtitle">${esc(v.title)}</span><br>
      <span class="vmeta">${esc(new Date(v.publishedAt).toLocaleDateString())} · ${esc(v.privacy)} · ${v.description.length} chars</span></span>`;
    row.querySelector('input').addEventListener('change', (e) => {
      e.target.checked ? selected.add(v.id) : selected.delete(v.id);
      updateCount();
    });
    list.appendChild(row);
  }
  $('videoCount').textContent = `${shown} videos · ${selected.size} selected`;
  updateCount();
}

function updateCount() {
  $('videoCount').textContent = `${$('videoList').children.length} shown · ${selected.size} selected`;
  $('toEditBtn').disabled = selected.size === 0;
}

$('searchBox').addEventListener('input', renderList);
$('selectAllBtn').addEventListener('click', () => { videos.forEach((v) => selected.add(v.id)); renderList(); });
$('selectNoneBtn').addEventListener('click', () => { selected.clear(); renderList(); });
$('toEditBtn').addEventListener('click', () => { $('editError').classList.add('hidden'); show('screen-edit'); });

// ---------- edit ----------
document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    currentOp = t.dataset.op;
    document.querySelectorAll('.op-panel').forEach((p) => p.classList.add('hidden'));
    $('panel-' + currentOp).classList.remove('hidden');
  });
});

$('backToVideosBtn').addEventListener('click', () => show('screen-videos'));

function gatherOp() {
  if (currentOp === 'replace') {
    const find = $('findText').value;
    if (!find) return { error: 'Enter the text to find.' };
    return { op: { type: 'replace', find, replace: $('replaceText').value || '' } };
  }
  const text = currentOp === 'prepend' ? $('prependText').value : $('appendText').value;
  if (!text.trim()) return { error: 'Enter the text to add.' };
  return { op: { type: currentOp, text } };
}

$('previewBtn').addEventListener('click', async () => {
  const g = gatherOp();
  if (g.error) { $('editError').textContent = g.error; $('editError').classList.remove('hidden'); return; }
  $('editError').classList.add('hidden');
  $('previewBtn').disabled = true;
  try {
    const r = await send({ type: 'BG_PREVIEW', ids: [...selected], op: g.op });
    if (!r.ok) throw new Error(r.error);
    lastPreview = { op: g.op, changeCount: r.changeCount, total: r.total, items: r.preview };
    renderPreview();
    show('screen-preview');
  } catch (e) {
    $('editError').textContent = 'Preview failed: ' + e.message;
    $('editError').classList.remove('hidden');
  }
  $('previewBtn').disabled = false;
});

function renderPreview() {
  const p = lastPreview;
  $('previewTitle').textContent = `${p.changeCount} of ${p.total} selected videos will change`;
  $('applyBtn').textContent = `Apply to ${p.changeCount} video${p.changeCount === 1 ? '' : 's'}`;
  $('applyBtn').disabled = p.changeCount === 0;
  const list = $('previewList');
  list.innerHTML = '';
  for (const it of p.items) {
    const div = document.createElement('div');
    div.className = 'prow';
    div.innerHTML = `<div class="pt">${esc(it.title)}</div>` +
      (it.changed
        ? `<div class="diff"><span class="before">− ${esc(it.before)}${it.before.length >= 220 ? '…' : ''}</span>\n<span class="after">+ ${esc(it.after)}${it.after.length >= 220 ? '…' : ''}</span></div>`
        : `<div class="nochange">No change</div>`);
    list.appendChild(div);
  }
  if (p.total > p.items.length) {
    const more = document.createElement('div');
    more.className = 'nochange';
    more.textContent = `…and ${p.total - p.items.length} more (showing first ${p.items.length})`;
    list.appendChild(more);
  }
}

$('backToEditBtn').addEventListener('click', () => show('screen-edit'));

// ---------- apply ----------
$('applyBtn').addEventListener('click', async () => {
  $('applyError').classList.add('hidden');
  show('screen-progress');
  $('progressText').textContent = 'Updating…';
  $('progressFill').style.width = '0%';
  try {
    const r = await send({ type: 'BG_APPLY', ids: [...selected], op: lastPreview.op });
    if (!r.ok && r.needsPayment) { show('screen-pay'); return; }
    if (!r.ok) throw new Error(r.error);
    renderDone(r.results);
    // refresh cached list descriptions
    const { tb_videos = [] } = await chrome.storage.session.get('tb_videos');
    videos = tb_videos;
    renderList();
    refreshBadge();
    show('screen-done');
  } catch (e) {
    $('applyError').textContent = 'Update failed: ' + e.message;
    $('applyError').classList.remove('hidden');
    show('screen-preview');
  }
});

function renderDone(res) {
  $('doneSummary').innerHTML =
    `<div>✅ Updated: <b>${res.updated}</b></div>` +
    `<div>⏭️ Skipped (no change): <b>${res.skipped}</b></div>` +
    `<div>❌ Failed: <b>${res.failed.length}</b></div>`;
  const fl = $('doneFailed');
  fl.innerHTML = '';
  for (const f of res.failed) {
    const div = document.createElement('div');
    div.className = 'prow';
    div.innerHTML = `<div class="pt">${esc(f.title)}</div><div class="diff"><span class="before">${esc(f.error)}</span></div>`;
    fl.appendChild(div);
  }
}

$('startOverBtn').addEventListener('click', () => show('screen-videos'));

// ---------- paywall ----------
$('payBtn').addEventListener('click', () => extpay.openPaymentPage());
$('paidCheckBtn').addEventListener('click', async () => {
  await refreshBadge();
  const r = await send({ type: 'BG_GET_USAGE' }).catch(() => null);
  if (r?.usage.tb_paid) {
    if (lastPreview) { renderPreview(); show('screen-preview'); }
    else show('screen-videos');
  } else {
    $('paidCheckBtn').textContent = 'Payment not detected yet — try again in a moment';
    setTimeout(() => { $('paidCheckBtn').textContent = "I've paid — check again"; }, 2500);
  }
});

// ---------- init ----------
refreshBadge();
