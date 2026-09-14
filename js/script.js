// ---- Drawer nav ----
const menuBtn = document.querySelector('.menu-btn');
const drawer = document.querySelector('.drawer');
const overlay = document.querySelector('.drawer-overlay');
const closeBtn = document.querySelector('.drawer-close');

function openDrawer() {
  drawer.classList.add('open');
  overlay.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
}
function closeDrawer() {
  drawer.classList.remove('open');
  overlay.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
}
if (menuBtn) menuBtn.addEventListener('click', openDrawer);
if (closeBtn) closeBtn.addEventListener('click', closeDrawer);
if (overlay) overlay.addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDrawer();
});

// ---- Menu tabs (menu.html) ----
const tabs = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.menu-panel');
tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((t) => t.classList.remove('active'));
    panels.forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.target).classList.add('active');
  });
});

// ---- Product card ingredient toggle ----
document.querySelectorAll('.product-card').forEach((card) => {
  const toggleBtn = card.querySelector('.details-toggle');
  if (!toggleBtn) return;
  const label = toggleBtn.querySelector('.toggle-label');
  const closedText = label ? label.textContent : '';

  function setOpen(open) {
    card.classList.toggle('open', open);
    toggleBtn.setAttribute('aria-expanded', String(open));
    if (label) label.textContent = open ? 'Hide' : closedText;
  }

  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(!card.classList.contains('open'));
  });

  // Tapping/clicking anywhere on the card (except the order link) also toggles it.
  card.addEventListener('click', (e) => {
    if (e.target.closest('a[data-wa-item]') || e.target.closest('.details-toggle')) return;
    setOpen(!card.classList.contains('open'));
  });
});

// ---- WhatsApp order links ----
// Update WHATSAPP_NUMBER if the number ever changes (international format, no + or spaces).
const WHATSAPP_NUMBER = '233248451683';

function buildWhatsAppLink(itemName, price) {
  const text = `Hi De 5th Bite, I'd like to order: ${itemName} (${price}).`;
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
}

document.querySelectorAll('[data-wa-item]').forEach((el) => {
  const name = el.getAttribute('data-wa-item');
  const price = el.getAttribute('data-wa-price') || '';
  el.setAttribute('href', buildWhatsAppLink(name, price));
  el.setAttribute('target', '_blank');
  el.setAttribute('rel', 'noopener');
});

document.querySelectorAll('.wa-float, [data-wa-general]').forEach((el) => {
  const text = "Hi De 5th Bite, I'd like to place an order.";
  el.setAttribute('href', `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`);
  el.setAttribute('target', '_blank');
  el.setAttribute('rel', 'noopener');
});
