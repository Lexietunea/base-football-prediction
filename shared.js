// ═══════════════════════════════════════════════════════
// BASE FOOTBALL — SHARED JS (shared.js)
// All pages include this file for wallet + tipping + nav
// ═══════════════════════════════════════════════════════

const API           = 'http://localhost:3001';
const BASE_CHAIN_ID = '0x2105'; // Base Mainnet 8453
const BASE_EXPLORER = 'https://basescan.org';
const CONTRACT_ADDRESS = '0x0000000000000000000000000000000000000000'; // replace after deploying
const CONTRACT_ABI = [
  "function tipCreator(address payable creatorWallet, string calldata postId) external payable",
  "function registerCreator(string calldata username) external",
  "function withdraw() external",
  "function getBalance(address wallet) external view returns (uint256)",
  "event TipSent(address indexed from, address indexed to, uint256 amount, uint256 creatorAmount, uint256 platformFee, string postId)"
];

// ── STATE ──────────────────────────────────────────────
let walletAddress   = null;
let provider        = null;
let signer          = null;
let contract        = null;
let selectedTip     = '0.001';
let tipTargetWallet = null;
let tipTargetName   = null;
let currentTxHash   = null;

// ── WALLET ─────────────────────────────────────────────
function openWalletModal() {
  if (walletAddress) { showToast('Connected: ' + short(walletAddress)); return; }
  openModal('wallet-modal');
}

async function connectWallet(type) {
  closeModal('wallet-modal');
  try {
    let eth = window.ethereum;
    if (!eth) {
      showToast(type === 'metamask' ? '🦊 Install MetaMask from metamask.io' : '🔵 Install Coinbase Wallet', true);
      return;
    }
    if (window.ethereum?.providers) {
      const found = window.ethereum.providers.find(p => type === 'coinbase' ? p.isCoinbaseWallet : p.isMetaMask);
      if (found) eth = found;
    }
    showToast('Connecting…');
    const accounts = await eth.request({ method: 'eth_requestAccounts' });
    walletAddress  = accounts[0];
    await switchToBase(eth);
    provider = new ethers.BrowserProvider(eth);
    signer   = await provider.getSigner();
    if (CONTRACT_ADDRESS !== '0x0000000000000000000000000000000000000000') {
      contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
    }
    updateWalletUI();
    showToast('✅ Connected to Base Mainnet!');
    eth.on('accountsChanged', a => { walletAddress = a[0] || null; updateWalletUI(); });
    eth.on('chainChanged', () => location.reload());
  } catch (e) {
    if (e.code === 4001) showToast('Cancelled', true);
    else showToast('Failed: ' + (e.message?.slice(0, 60) || 'Error'), true);
  }
}

async function switchToBase(eth) {
  try {
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: BASE_CHAIN_ID }] });
  } catch (e) {
    if (e.code === 4902) {
      await eth.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: BASE_CHAIN_ID, chainName: 'Base',
          nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
          rpcUrls: ['https://mainnet.base.org'],
          blockExplorerUrls: [BASE_EXPLORER],
        }]
      });
    }
  }
}

function updateWalletUI() {
  const btn   = document.getElementById('wallet-btn');
  const text  = document.getElementById('wallet-text');
  const badge = document.getElementById('net-badge');
  const av    = document.getElementById('my-av');
  if (walletAddress) {
    btn.classList.add('connected');
    text.textContent = short(walletAddress);
    if (badge) badge.style.display = 'flex';
    if (av) { av.textContent = walletAddress.slice(2,4).toUpperCase(); av.style.background = 'linear-gradient(135deg,#0052ff,#00d4ff)'; }
  } else {
    btn.classList.remove('connected');
    text.textContent = 'Connect Wallet';
    if (badge) badge.style.display = 'none';
    if (av) { av.textContent = '⚽'; av.style.background = ''; }
  }
}

// ── TIPPING ────────────────────────────────────────────
function openTipModal(name, wallet, initials, gradient, event) {
  if (event) event.stopPropagation();
  if (!walletAddress) {
    showToast('Connect your wallet first!', true);
    setTimeout(openWalletModal, 700);
    return;
  }
  tipTargetName   = name;
  tipTargetWallet = wallet || null;

  const av = document.getElementById('tip-av');
  if (av) { av.textContent = initials || name.slice(0,2).toUpperCase(); if (gradient) av.style.background = gradient; }
  const tipName = document.getElementById('tip-name');
  if (tipName) tipName.textContent = name;

  selectedTip = '0.001';
  document.querySelectorAll('.tip-tile').forEach(t => t.classList.remove('sel'));
  const firstTile = document.querySelector('.tip-tile');
  if (firstTile) firstTile.classList.add('sel');
  const customRow = document.getElementById('custom-row');
  if (customRow) customRow.style.display = 'none';
  const customAmt = document.getElementById('custom-amt');
  if (customAmt) customAmt.value = '';
  const txBox = document.getElementById('tx-box');
  if (txBox) txBox.classList.remove('show');
  const sendText = document.getElementById('send-text');
  if (sendText) sendText.textContent = 'Send Tip on Base';
  const sendBtn = document.getElementById('send-btn');
  if (sendBtn) sendBtn.disabled = false;
  currentTxHash = null;

  openModal('tip-modal');
}

function selTip(el, val) {
  document.querySelectorAll('.tip-tile').forEach(t => t.classList.remove('sel'));
  el.classList.add('sel');
  selectedTip = val;
  const customRow = document.getElementById('custom-row');
  if (customRow) customRow.style.display = val === 'custom' ? 'block' : 'none';
  if (val !== 'custom') { const a = document.getElementById('custom-amt'); if (a) a.value = ''; }
}

async function confirmTip() {
  if (!walletAddress || !signer) { showToast('Connect your wallet first!', true); return; }
  let amount = selectedTip;
  if (selectedTip === 'custom') {
    amount = document.getElementById('custom-amt')?.value.trim();
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      showToast('Enter a valid ETH amount', true); return;
    }
  }
  const sendBtn  = document.getElementById('send-btn');
  const sendText = document.getElementById('send-text');
  const txBox    = document.getElementById('tx-box');
  const txMsg    = document.getElementById('tx-msg');
  if (sendBtn)  sendBtn.disabled = true;
  if (sendText) sendText.innerHTML = '<span class="spin dark"></span> Confirm in wallet…';
  if (txBox)    txBox.classList.add('show');
  if (txMsg)    txMsg.textContent = '⏳ Waiting for wallet confirmation…';
  try {
    const amountWei = ethers.parseEther(amount);
    if (contract && CONTRACT_ADDRESS !== '0x0000000000000000000000000000000000000000' && tipTargetWallet) {
      const tx = await contract.tipCreator(tipTargetWallet, `tip_${Date.now()}`, { value: amountWei });
      currentTxHash = tx.hash;
      if (txMsg) txMsg.textContent = '⏳ Transaction sent! Confirming on Base…';
      const hashRow = document.getElementById('tx-hash-row');
      const hashEl  = document.getElementById('tx-hash');
      if (hashRow) hashRow.style.display = 'block';
      if (hashEl)  hashEl.textContent = short(tx.hash);
      const receipt = await tx.wait();
      if (txMsg) txMsg.textContent = `✅ Confirmed in block #${receipt.blockNumber}`;
      if (sendText) sendText.textContent = '✅ Tip Sent!';
      showToast(`✅ ${amount} ETH tipped to ${tipTargetName} on Base!`);
      setTimeout(() => closeModal('tip-modal'), 2500);
    } else {
      if (txMsg) txMsg.textContent = '⚠️ Deploy BaseFootball.sol on Base Mainnet first.';
      if (sendText) sendText.textContent = 'Contract not deployed';
      showToast('Deploy contract to enable live tips!', true);
    }
  } catch (e) {
    if (txBox) txBox.classList.remove('show');
    if (e.code === 4001 || e.code === 'ACTION_REJECTED') showToast('Transaction cancelled', true);
    else showToast('Tip failed: ' + (e.message?.slice(0,80) || 'Error'), true);
    if (sendText) sendText.textContent = 'Send Tip on Base';
    if (sendBtn)  sendBtn.disabled = false;
  }
}

function openExplorer() {
  if (currentTxHash) window.open(`${BASE_EXPLORER}/tx/${currentTxHash}`, '_blank');
}

// ── MODAL HELPERS ──────────────────────────────────────
function openModal(id)  { const el = document.getElementById(id); if (el) el.classList.add('open'); }
function closeModal(id) { const el = document.getElementById(id); if (el) el.classList.remove('open'); }
function overlayClose(e, id) { if (e.target === document.getElementById(id)) closeModal(id); }

// ── TOAST ──────────────────────────────────────────────
let _tt;
function showToast(msg, isErr = false) {
  clearTimeout(_tt);
  const el = document.getElementById('toast');
  if (!el) return;
  document.getElementById('toast-ico').textContent = isErr ? '❌' : '✅';
  document.getElementById('toast-msg').textContent = msg;
  el.classList.toggle('err', isErr);
  el.classList.add('show');
  _tt = setTimeout(() => el.classList.remove('show'), 4500);
}

// ── UTILS ──────────────────────────────────────────────
function short(addr) { return addr ? `${addr.slice(0,6)}…${addr.slice(-4)}` : ''; }
function escHtml(s)  { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function timeAgo(d)  {
  if (!d) return '';
  const s = Math.floor((Date.now() - new Date(d)) / 1000);
  if (s < 60) return `${s}s ago`; if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`; return `${Math.floor(s/86400)}d ago`;
}
function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-GB', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
}
function fmtKickoff(d) {
  if (!d) return '';
  const dt = new Date(d), now = new Date(), diff = dt - now;
  if (diff < 0) return fmtDate(d);
  if (diff < 3600000) return `In ${Math.floor(diff/60000)}m`;
  if (diff < 86400000) return `Today ${dt.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}`;
  return dt.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
}

// ── SHARED NAV HTML ─────────────────────────────────────
// Call this in each page's <aside class="sidebar-l"> to build the nav
function buildNav(activePage) {
  const pages = [
    { href:'index.html',    icon:'home',    label:'Home Feed' },
    { href:'creators.html', icon:'star',    label:'Top Creators' },
    { href:'matches.html',  icon:'clock',   label:'Live Matches' },
    { href:'earnings.html', icon:'dollar',  label:'Earnings' },
  ];
  const icons = {
    home:   `<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>`,
    star:   `<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>`,
    clock:  `<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>`,
    dollar: `<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>`,
  };
  const leagues = [
    { label:'All Leagues',      color:'#e8ecf4', val:'all' },
    { label:'Champions League', color:'#3B82F6', val:'Champions League' },
    { label:'Premier League',   color:'#7C3AED', val:'Premier League' },
    { label:'La Liga',          color:'#EF4444', val:'La Liga' },
    { label:'Serie A',          color:'#22C55E', val:'Serie A' },
    { label:'Bundesliga',       color:'#F59E0B', val:'Bundesliga' },
    { label:'Ligue 1',          color:'#0EA5E9', val:'Ligue 1' },
  ];
  return `
    <div class="s-label">Navigation</div>
    ${pages.map(p => `
      <a href="${p.href}" class="nav-item ${activePage === p.href ? 'active' : ''}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${icons[p.icon]}</svg>
        ${p.label}
      </a>`).join('')}
    <div class="s-label" style="margin-top:8px">Leagues</div>
    ${leagues.map(l => `
      <div class="league-item" onclick="leagueClick(this,'${l.val}')">
        <div class="l-dot" style="background:${l.color}"></div>${l.label}
      </div>`).join('')}`;
}

// ── SHARED MODALS HTML ──────────────────────────────────
function walletModalHTML() {
  return `
  <div class="overlay" id="wallet-modal" onclick="overlayClose(event,'wallet-modal')">
    <div class="modal">
      <div class="modal-title">Connect Wallet</div>
      <div class="modal-sub">Connect to post, tip creators and earn on <strong style="color:var(--blue)">Base Mainnet</strong>.</div>
      <div class="wallet-opt" onclick="connectWallet('metamask')">
        <div class="wallet-ico" style="background:rgba(246,133,27,.12)">🦊</div>
        <div><div class="wallet-opt-name">MetaMask</div><div class="wallet-opt-desc">Connect with MetaMask</div></div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
      <div class="wallet-opt" onclick="connectWallet('coinbase')">
        <div class="wallet-ico" style="background:rgba(0,82,255,.12)">🔵</div>
        <div><div class="wallet-opt-name">Coinbase Wallet</div><div class="wallet-opt-desc">Connect with Coinbase Wallet</div></div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
      <p style="text-align:center;margin-top:16px;font-size:11px;color:var(--muted)">
        No wallet? <a href="https://metamask.io" target="_blank" style="color:var(--blue)">Get MetaMask</a> · <a href="https://www.coinbase.com/wallet" target="_blank" style="color:var(--blue)">Coinbase Wallet</a>
      </p>
    </div>
  </div>`;
}

function tipModalHTML() {
  return `
  <div class="overlay" id="tip-modal" onclick="overlayClose(event,'tip-modal')">
    <div class="modal">
      <div class="modal-title">Tip Creator ⬡</div>
      <div class="tip-creator-card">
        <div class="tip-cr-av" id="tip-av">⚽</div>
        <div><div class="tip-cr-name" id="tip-name">Creator</div><div class="tip-cr-sub">Base Football Creator</div></div>
      </div>
      <div class="tip-section-label">Choose tip amount</div>
      <div class="tip-grid">
        <div class="tip-tile sel" onclick="selTip(this,'0.001')"><div class="tip-tile-eth">0.001 ETH</div><div class="tip-tile-usd">≈ $2.50</div></div>
        <div class="tip-tile" onclick="selTip(this,'0.005')"><div class="tip-tile-eth">0.005 ETH</div><div class="tip-tile-usd">≈ $12.50</div></div>
        <div class="tip-tile" onclick="selTip(this,'0.01')"><div class="tip-tile-eth">0.01 ETH</div><div class="tip-tile-usd">≈ $25</div></div>
        <div class="tip-tile" onclick="selTip(this,'0.05')"><div class="tip-tile-eth">0.05 ETH</div><div class="tip-tile-usd">≈ $125</div></div>
        <div class="tip-tile" onclick="selTip(this,'0.1')"><div class="tip-tile-eth">0.10 ETH</div><div class="tip-tile-usd">≈ $250</div></div>
        <div class="tip-tile" onclick="selTip(this,'custom')"><div class="tip-tile-eth">Custom</div><div class="tip-tile-usd">Any amount</div></div>
      </div>
      <div id="custom-row" style="display:none">
        <div class="tip-divider">Enter amount</div>
        <div class="custom-wrap">
          <input type="number" id="custom-amt" placeholder="0.000" step="0.001" min="0.001"/>
          <span class="custom-unit">ETH</span>
        </div>
      </div>
      <div class="gas-note">⛽ Tips sent <strong>on Base Mainnet</strong> via smart contract. Gas ≈ $0.01–$0.05. Platform fee: <strong>2.5%</strong>.</div>
      <div class="tx-box" id="tx-box">
        <div id="tx-msg">Waiting…</div>
        <div id="tx-hash-row" style="display:none;margin-top:6px">
          <span style="color:var(--muted)">Tx: </span>
          <span class="tx-link" id="tx-hash" onclick="openExplorer()"></span>
        </div>
      </div>
      <div class="modal-btns">
        <button class="btn-outline" onclick="closeModal('tip-modal')">Cancel</button>
        <button class="btn-green" id="send-btn" onclick="confirmTip()">
          <span id="send-text">Send Tip on Base</span>
        </button>
      </div>
    </div>
  </div>`;
}

function toastHTML() {
  return `<div class="toast" id="toast"><span id="toast-ico">✅</span><span id="toast-msg"></span></div>`;
}

function leagueClick(el, league) {
  document.querySelectorAll('.league-item').forEach(i => i.classList.remove('active'));
  el.classList.add('active');
  if (typeof onLeagueFilter === 'function') onLeagueFilter(league);
  else showToast(league === 'all' ? 'Showing all leagues' : `Filtering: ${league}`);
}
