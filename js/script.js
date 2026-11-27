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

// Give menu items stable links so home-page search can open a specific dish.
document.querySelectorAll('.menu-panel .product-card').forEach((card) => {
  const name = card.querySelector('h3')?.textContent.trim();
  if (name && !card.id) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    card.id = `product-${slug}`;
  }
});

if (tabs.length && window.location.hash) {
  const target = document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
  const targetPanel = target?.matches('.menu-panel') ? target : target?.closest('.menu-panel');
  const targetTab = [...tabs].find((tab) => tab.dataset.target === targetPanel?.id);
  if (targetTab) {
    targetTab.click();
    requestAnimationFrame(() => target.scrollIntoView({ block: target.matches('.menu-panel') ? 'start' : 'center' }));
  }
}

function productCategoryName(category) {
  return { shawarma: 'Shawarma', fries: 'Loaded Fries', cakes: 'Cakes', 'wedding-cakes': 'Wedding Cakes' }[category] || category;
}

function createProductCard(product) {
  const card = document.createElement('article');
  card.className = 'product-card';
  card.id = `product-${product.id}`;
  const photo = document.createElement('div');
  photo.className = 'product-photo';
  const image = document.createElement('img');
  image.src = product.imageUrl || '/images/Logo.png';
  image.alt = product.name;
  const placeholder = document.createElement('span');
  placeholder.className = 'ph-label';
  photo.append(image, placeholder);

  const body = document.createElement('div');
  body.className = 'product-body';
  const heading = document.createElement('h3');
  heading.textContent = product.name;
  const price = document.createElement('span');
  price.className = 'product-price';
  if (product.previousPriceLabel) {
    const previous = document.createElement('del');
    previous.textContent = product.previousPriceLabel;
    price.append(previous);
  }
  const current = document.createElement('span');
  current.textContent = product.priceLabel;
  price.append(current);
  body.append(heading, price);

  if (product.description) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'details-toggle';
    toggle.setAttribute('aria-expanded', 'false');
    const toggleText = document.createElement('span');
    toggleText.className = 'toggle-label';
    toggleText.textContent = product.category === 'cakes' ? 'Number of people' : 'Ingredients';
    toggle.append(toggleText);
    const description = document.createElement('div');
    description.className = 'product-desc-wrap';
    const descriptionInner = document.createElement('div');
    descriptionInner.className = 'product-desc-inner';
    const text = document.createElement('p');
    text.className = 'product-desc';
    text.textContent = product.description;
    descriptionInner.append(text);
    description.append(descriptionInner);
    body.append(toggle, description);
  }

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'btn btn-outline btn-block btn-cart';
  add.dataset.cartName = product.name;
  add.dataset.cartDisplay = product.priceLabel;
  add.dataset.cartProductId = product.id;
  add.textContent = 'Add to Cart';
  if (product.onlineOrderable) add.dataset.cartPrice = String(product.checkoutPrice);
  else add.dataset.cartRange = 'true';
  body.append(add);
  if (!product.onlineOrderable) {
    const orderLink = document.createElement('a');
    orderLink.className = 'btn btn-whatsapp btn-block';
    orderLink.dataset.waItem = product.name;
    orderLink.dataset.waPrice = product.priceLabel;
    orderLink.href = buildWhatsAppLink(product.name, product.priceLabel);
    orderLink.target = '_blank';
    orderLink.rel = 'noopener';
    orderLink.textContent = 'Click to Order';
    body.append(orderLink);
  }
  card.append(photo, body);
  return card;
}

async function loadManagedMenu() {
  const grids = document.querySelectorAll('[data-product-list]');
  if (!grids.length) return;
  try {
    const response = await fetch('/api/menu');
    const result = await response.json();
    if (!response.ok || !Array.isArray(result.products)) throw new Error(result.error || 'Could not load the current menu.');
    grids.forEach((grid) => grid.replaceChildren());
    result.products.forEach((product) => {
      const grid = document.querySelector(`[data-product-list="${CSS.escape(product.category)}"]`);
      if (grid) grid.append(createProductCard(product));
    });
    grids.forEach((grid) => {
      if (grid.children.length) return;
      const empty = document.createElement('p');
      empty.className = 'menu-empty';
      empty.textContent = 'No items are available in this category right now.';
      grid.append(empty);
    });
    const cakesPanel = document.querySelector('#panel-cakes');
    const weddingHeading = cakesPanel?.querySelector('.panel-subhead');
    if (weddingHeading) weddingHeading.hidden = !document.querySelector('[data-product-list="wedding-cakes"]')?.children.length;
    renderCart();
  } catch (error) {
    console.error('Managed menu could not be loaded.', error);
    const menu = document.querySelector('.menu-page-head');
    if (menu) {
      const notice = document.createElement('p');
      notice.className = 'form-message';
      notice.setAttribute('role', 'status');
      notice.textContent = 'The menu could not be refreshed right now. Please try again later.';
      menu.append(notice);
    }
  }
}
loadManagedMenu();

// Search the menu page itself so home search stays in sync with menu content.
const homeSearchInput = document.querySelector('[data-menu-search]');
if (homeSearchInput) {
  const results = document.getElementById('home-search-results');
  const status = results.querySelector('.home-search-status');
  const resultList = results.querySelector('ul');
  const searchForm = homeSearchInput.closest('form');
  let menuItemsPromise;
  let searchVersion = 0;

  function loadMenuItems() {
    if (!menuItemsPromise) {
      menuItemsPromise = fetch('/api/menu')
        .then((response) => {
          if (!response.ok) throw new Error(`Menu request failed: ${response.status}`);
          return response.json();
        })
        .then((result) => {
          if (!Array.isArray(result.products)) throw new Error('The menu response is invalid.');
          return result.products.map((product) => ({
            ...product,
            category: productCategoryName(product.category),
            oldPrice: product.previousPriceLabel,
            currentPrice: product.priceLabel,
            id: `product-${product.id}`
          }));
        })
        .catch((error) => {
          menuItemsPromise = undefined;
          throw error;
        });
    }
    return menuItemsPromise;
  }

  function addPrice(parent, oldPrice, currentPrice) {
    if (oldPrice) {
      const old = document.createElement('del');
      old.textContent = oldPrice;
      parent.append(old);
    }
    const current = document.createElement('span');
    current.textContent = currentPrice;
    parent.append(current);
  }

  homeSearchInput.addEventListener('input', async () => {
    const version = ++searchVersion;
    const query = homeSearchInput.value.trim().toLocaleLowerCase();
    resultList.replaceChildren();
    if (!query) {
      results.hidden = true;
      homeSearchInput.setAttribute('aria-expanded', 'false');
      return;
    }

    results.hidden = false;
    homeSearchInput.setAttribute('aria-expanded', 'true');
    status.textContent = 'Searching the menu…';
    try {
      const items = await loadMenuItems();
      if (version !== searchVersion) return;
      const matches = items.filter((item) =>
        `${item.name} ${item.category} ${item.description}`.toLocaleLowerCase().includes(query)
      );
      status.textContent = matches.length ? `${matches.length} dish${matches.length === 1 ? '' : 'es'} found` : 'No dishes found. Try another search.';
      matches.slice(0, 8).forEach((item) => {
        const link = document.createElement('a');
        link.href = `menu.html#${item.id}`;
        const name = document.createElement('span');
        name.className = 'home-search-result-name';
        name.textContent = item.name;
        const category = document.createElement('span');
        category.className = 'home-search-result-category';
        category.textContent = item.category;
        name.append(category);
        link.append(name);
        if (item.currentPrice) {
          const price = document.createElement('span');
          price.className = 'home-search-result-price';
          addPrice(price, item.oldPrice, item.currentPrice);
          link.append(price);
        }
        const entry = document.createElement('li');
        entry.append(link);
        resultList.append(entry);
      });
    } catch (error) {
      if (version !== searchVersion) return;
      console.error('Menu search failed to load menu.html.', error);
      status.textContent = 'Could not search the menu right now.';
      const entry = document.createElement('li');
      const link = document.createElement('a');
      link.href = 'menu.html';
      link.textContent = 'Browse the full menu';
      entry.append(link);
      resultList.append(entry);
    }
  });

  homeSearchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      results.hidden = true;
      homeSearchInput.setAttribute('aria-expanded', 'false');
    }
  });

  searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const firstResult = resultList.querySelector('a');
    if (firstResult && !results.hidden) window.location.href = firstResult.href;
  });
}

// Ingredient controls use delegation so menu cards loaded from the API also work.
document.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const toggle = target.closest('.details-toggle');
  if (toggle) {
    const card = toggle.closest('.product-card');
    const label = toggle.querySelector('.toggle-label');
    const closedText = toggle.dataset.closedLabel || label?.textContent || 'Ingredients';
    toggle.dataset.closedLabel = closedText;
    const open = !card.classList.contains('open');
    card.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
    if (label) label.textContent = open ? 'Hide' : closedText;
    return;
  }
  const card = target.closest('.product-card');
  if (card && !target.closest('a[data-wa-item], button')) {
    const toggleButton = card.querySelector('.details-toggle');
    if (!toggleButton) return;
    const label = toggleButton.querySelector('.toggle-label');
    const closedText = toggleButton.dataset.closedLabel || label?.textContent || 'Ingredients';
    toggleButton.dataset.closedLabel = closedText;
    const open = !card.classList.contains('open');
    card.classList.toggle('open', open);
    toggleButton.setAttribute('aria-expanded', String(open));
    if (label) label.textContent = open ? 'Hide' : closedText;
  }
});

// ---- Cart ----
const CART_KEY = 'de5thbite-cart';

function getCart() {
  try {
    const value = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((item) =>
      item &&
      typeof item.name === 'string' &&
      typeof item.display === 'string' &&
      (item.price === null || (typeof item.price === 'number' && Number.isFinite(item.price) && item.price >= 0)) &&
      Number.isInteger(item.qty) &&
      item.qty > 0
    );
  } catch (e) {
    return [];
  }
}

function saveCart(cart) {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  } catch (e) {
    // localStorage unavailable — cart just won't persist across reloads.
  }
  renderCart();
}

function money(n) {
  return 'GH₵' + n.toLocaleString('en-GH');
}

function addToCart({ name, display, price, isRange, productId }) {
  const cart = getCart();
  const existing = cart.find((item) => item.name === name);
  if (existing) {
    if (existing.qty >= 10) return false;
    existing.qty += 1;
  } else {
    cart.push({ name, display, price: isRange ? null : Number(price), productId, qty: 1 });
  }
  saveCart(cart);
  return true;
}

function changeQty(name, delta) {
  const cart = getCart();
  const item = cart.find((i) => i.name === name);
  if (!item) return;
  item.qty += delta;
  const next = item.qty > 0 ? cart : cart.filter((i) => i.name !== name);
  saveCart(next);
}

function removeFromCart(name) {
  saveCart(getCart().filter((i) => i.name !== name));
}

function renderCart() {
  const cart = getCart();
  const itemsEl = document.querySelector('[data-cart-items]');
  const subtotalEl = document.querySelector('[data-cart-subtotal]');
  const cakeNoteEl = document.querySelector('[data-cart-cake-note]');
  const badges = document.querySelectorAll('[data-cart-count]');

  const totalQty = cart.reduce((sum, i) => sum + i.qty, 0);
  badges.forEach((badge) => {
    badge.textContent = String(totalQty);
    badge.hidden = totalQty === 0;
  });

  document.querySelectorAll('.btn-cart').forEach((button) => {
    const name = button.getAttribute('data-cart-name');
    const item = cart.find((entry) => entry.name === name);
    let state = button.parentElement.querySelector('.product-cart-state');
    if (!state) {
      state = document.createElement('div');
      state.className = 'product-cart-state';
      state.hidden = true;
      const confirmation = document.createElement('span');
      confirmation.className = 'product-cart-confirmation';
      confirmation.textContent = 'Added to cart';
      const controls = document.createElement('div');
      controls.className = 'product-qty-controls';
      const decrease = document.createElement('button');
      decrease.type = 'button';
      decrease.className = 'product-qty-btn';
      decrease.dataset.productQtyDown = '';
      decrease.setAttribute('aria-label', `Remove one ${name}`);
      decrease.textContent = '−';
      const quantity = document.createElement('span');
      quantity.className = 'product-qty-number';
      quantity.setAttribute('aria-live', 'polite');
      const increase = document.createElement('button');
      increase.type = 'button';
      increase.className = 'product-qty-btn';
      increase.dataset.productQtyUp = '';
      increase.setAttribute('aria-label', `Add one ${name}`);
      increase.textContent = '+';
      controls.append(decrease, quantity, increase);
      state.append(confirmation, controls);
      button.insertAdjacentElement('afterend', state);
    }
    const quantity = state.querySelector('.product-qty-number');
    const confirmation = state.querySelector('.product-cart-confirmation');
    const decrease = state.querySelector('[data-product-qty-down]');
    const increase = state.querySelector('[data-product-qty-up]');
    if (!name || !quantity || !confirmation || !decrease || !increase) return;
    button.hidden = Boolean(item);
    state.hidden = !item;
    quantity.textContent = item ? String(item.qty) : '';
    confirmation.textContent = item ? 'Added to cart' : '';
    increase.disabled = item?.qty >= 10;
    decrease.setAttribute('aria-label', `Remove one ${name}`);
    increase.setAttribute('aria-label', `Add one ${name}`);
  });

  if (!itemsEl) return; // cart drawer markup not on this page

  if (cart.length === 0) {
    itemsEl.innerHTML = '<p class="cart-empty">Your cart is empty.</p>';
  } else {
    const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[character]));
    itemsEl.innerHTML = cart.map((item) => `
      <div class="cart-line">
        <div class="cart-line-info">
          <div class="cart-line-name">${escapeHtml(item.name)}</div>
          <div class="cart-line-price">${escapeHtml(item.display)}${item.price === null ? ' · price confirmed on WhatsApp' : ''}</div>
          <div class="cart-line-qty">
            <button type="button" class="cart-qty-btn" data-cart-qty-down="${escapeHtml(item.name)}" aria-label="Decrease quantity">−</button>
            <span class="cart-line-qty-num">${item.qty}</span>
            <button type="button" class="cart-qty-btn" data-cart-qty-up="${escapeHtml(item.name)}" aria-label="Increase quantity">+</button>
          </div>
        </div>
        <button type="button" class="cart-line-remove" data-cart-remove="${escapeHtml(item.name)}">Remove</button>
      </div>
    `).join('');
  }

  const subtotal = cart.reduce((sum, i) => sum + (i.price === null ? 0 : i.price * i.qty), 0);
  if (subtotalEl) subtotalEl.textContent = money(subtotal);
  const cakesInCart = cart.filter((item) => item.price === null);
  const foodInCart = cart.some((item) => item.price !== null);
  if (cakeNoteEl) cakeNoteEl.hidden = cakesInCart.length === 0;
  const checkout = document.querySelector('[data-cart-checkout]');
  if (checkout) {
    checkout.textContent = foodInCart ? 'Checkout' : 'Add food items to checkout';
    checkout.classList.toggle('is-disabled', !foodInCart);
    checkout.setAttribute('aria-disabled', String(!foodInCart));
  }
  const cakeCheckout = document.querySelector('[data-cart-cake-checkout]');
  if (cakeCheckout) cakeCheckout.hidden = cakesInCart.length === 0;
}

// Add-to-cart and inline product quantity controls.
document.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const addButton = target.closest('.btn-cart');
  const productUp = target.closest('[data-product-qty-up]');
  const productDown = target.closest('[data-product-qty-down]');

  if (addButton) {
    event.preventDefault();
    event.stopPropagation();
    const added = addToCart({
      name: addButton.getAttribute('data-cart-name'),
      display: addButton.getAttribute('data-cart-display'),
      price: addButton.getAttribute('data-cart-price'),
      isRange: addButton.hasAttribute('data-cart-range'),
      productId: addButton.getAttribute('data-cart-product-id'),
    });
    if (!added) {
      const state = addButton.parentElement.querySelector('.product-cart-state');
      const confirmation = state?.querySelector('.product-cart-confirmation');
      if (confirmation) confirmation.textContent = 'Maximum quantity reached';
    }
    return;
  }

  const quantityControl = productUp || productDown;
  if (quantityControl) {
    event.preventDefault();
    event.stopPropagation();
    const name = quantityControl.closest('.product-body')?.querySelector('.btn-cart')?.getAttribute('data-cart-name');
    if (name) changeQty(name, productUp ? 1 : -1);
  }
});

// Qty +/- and remove (event delegation, since lines are re-rendered)
const cartItemsContainer = document.querySelector('[data-cart-items]');
if (cartItemsContainer) {
  cartItemsContainer.addEventListener('click', (e) => {
    const up = e.target.closest('[data-cart-qty-up]');
    const down = e.target.closest('[data-cart-qty-down]');
    const remove = e.target.closest('[data-cart-remove]');
    if (up) changeQty(up.getAttribute('data-cart-qty-up'), 1);
    if (down) changeQty(down.getAttribute('data-cart-qty-down'), -1);
    if (remove) removeFromCart(remove.getAttribute('data-cart-remove'));
  });
}

// Drawer open/close
const cartBtn = document.querySelector('.cart-btn');
const cartDrawer = document.querySelector('.cart-drawer');
const cartOverlay = document.querySelector('.cart-overlay');
const cartClose = document.querySelector('.cart-close');

function openCartDrawer() {
  if (!cartDrawer) return;
  cartDrawer.classList.add('open');
  cartOverlay.classList.add('open');
  cartDrawer.setAttribute('aria-hidden', 'false');
}
function closeCartDrawer() {
  if (!cartDrawer) return;
  cartDrawer.classList.remove('open');
  cartOverlay.classList.remove('open');
  cartDrawer.setAttribute('aria-hidden', 'true');
}
if (cartBtn) cartBtn.addEventListener('click', openCartDrawer);
if (cartClose) cartClose.addEventListener('click', closeCartDrawer);
if (cartOverlay) cartOverlay.addEventListener('click', closeCartDrawer);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeCartDrawer();
});

// Fixed-price food uses online checkout; cake enquiries remain on WhatsApp.
const cartCheckoutBtn = document.querySelector('[data-cart-checkout]');
if (cartCheckoutBtn) {
  cartCheckoutBtn.addEventListener('click', (e) => {
    const cart = getCart();
    if (!cart.some((item) => item.price !== null)) e.preventDefault();
  });
}

const cakeCheckoutBtn = document.querySelector('[data-cart-cake-checkout]');
if (cakeCheckoutBtn) {
  cakeCheckoutBtn.addEventListener('click', (event) => {
    event.preventDefault();
    const cakes = getCart().filter((item) => item.price === null);
    if (!cakes.length) return;
    const lines = cakes.map((item) => `${item.qty}x ${item.name} (${item.display})`);
    const text = `Hi De 5th Bite, I'd like to enquire about these cakes (at least 3 days' notice):\n${lines.join('\n')}`;
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  });
}

renderCart();

// ---- WhatsApp order links ----
// Update WHATSAPP_NUMBER if the number ever changes (international format, no + or spaces).
let WHATSAPP_NUMBER = '233248451683';

function buildWhatsAppLink(itemName, price) {
  const text = `Hi De 5th Bite, I'd like to order: ${itemName} (${price}).`;
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
}

function refreshWhatsAppLinks() {
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
}
refreshWhatsAppLinks();

function setLastText(element, value) {
  const textNode = [...element.childNodes].reverse().find((node) => node.nodeType === Node.TEXT_NODE);
  if (textNode) textNode.textContent = value;
  else element.append(document.createTextNode(value));
}

fetch('/api/site-settings')
  .then(async (response) => {
    const result = await response.json();
    if (!response.ok || !result.settings) throw new Error(result.error || 'Could not load site details.');
    const settings = result.settings;
    const headline = document.querySelector('[data-site-headline]');
    const tagline = document.querySelector('[data-site-tagline]');
    if (headline && settings.homepage_headline) headline.textContent = settings.homepage_headline;
    if (tagline && settings.homepage_tagline) tagline.textContent = settings.homepage_tagline;
    document.querySelectorAll('.footer-hours').forEach((element) => {
      if (settings.business_hours) element.textContent = settings.business_hours;
    });
    if (settings.whatsapp_phone) {
      WHATSAPP_NUMBER = settings.whatsapp_phone;
      refreshWhatsAppLinks();
      const localWhatsapp = settings.whatsapp_phone.startsWith('233') ? `0${settings.whatsapp_phone.slice(3)}` : settings.whatsapp_phone;
      document.querySelectorAll('[data-wa-general]:not(.wa-float)').forEach((element) => {
        const lastText = [...element.childNodes].reverse().find((node) => node.nodeType === Node.TEXT_NODE)?.textContent || '';
        if (/\d/.test(lastText)) setLastText(element, lastText.includes(':') ? `WhatsApp: ${localWhatsapp}` : localWhatsapp);
      });
    }
    if (settings.contact_phone) {
      const localPhone = settings.contact_phone.startsWith('233') ? `0${settings.contact_phone.slice(3)}` : settings.contact_phone;
      const dialablePhone = settings.contact_phone.replace(/\D/g, '');
      document.querySelectorAll('a[href^="tel:"]').forEach((element) => {
        element.setAttribute('href', `tel:${dialablePhone}`);
        setLastText(element, element.closest('.contact-block') ? localPhone : `Phone: ${localPhone}`);
      });
    }
    if (settings.contact_email) {
      document.querySelectorAll('a[href^="mailto:"]').forEach((element) => {
        element.setAttribute('href', `mailto:${settings.contact_email}`);
        setLastText(element, settings.contact_email);
      });
    }
    if (settings.business_location) {
      document.querySelectorAll('.footer-details p.contact-icon-link').forEach((element) => {
        setLastText(element, settings.business_location);
      });
    }
    document.querySelectorAll('.contact-block').forEach((block) => {
      const heading = block.querySelector('h3')?.textContent.trim().toLocaleLowerCase();
      const content = block.querySelector('p');
      if (!content) return;
      if (heading === 'location' && settings.business_location) content.textContent = settings.business_location;
      if (heading === 'hours' && settings.business_hours) content.textContent = settings.business_hours;
    });
    const map = document.querySelector('[data-site-map]');
    if (map && settings.business_location) {
      map.setAttribute('title', `Map to ${settings.business_location}`);
      map.setAttribute('src', `https://maps.google.com/maps?q=${encodeURIComponent(settings.business_location)}&output=embed`);
    }
  })
  .catch((error) => console.error('Public site details could not be loaded.', error));

const publicNewsList = document.querySelector('[data-public-news]');
if (publicNewsList) {
  fetch('/api/news')
    .then(async (response) => {
      const result = await response.json();
      if (!response.ok || !Array.isArray(result.posts)) throw new Error(result.error || 'Could not load news posts.');
      publicNewsList.replaceChildren();
      if (!result.posts.length) {
        const empty = document.createElement('p');
        empty.className = 'news-empty';
        empty.textContent = 'There are no news updates right now. Please check back soon.';
        publicNewsList.append(empty);
        return;
      }
      result.posts.forEach((post) => {
        const article = document.createElement('article');
        article.className = 'news-item';
        if (post.imageUrl) {
          const thumbnail = document.createElement('div');
          thumbnail.className = 'news-thumb';
          const link = document.createElement('a');
          link.href = post.imageUrl;
          link.dataset.newsImage = '';
          link.setAttribute('aria-label', `View full-size image for ${post.title}`);
          const image = document.createElement('img');
          image.src = post.imageUrl;
          image.alt = post.title;
          link.append(image);
          thumbnail.append(link);
          article.append(thumbnail);
        }
        const copy = document.createElement('div');
        const date = document.createElement('div');
        date.className = 'news-date';
        date.textContent = new Date(post.publishAt).toLocaleDateString('en-GH', { day: 'numeric', month: 'long', year: 'numeric' });
        const title = document.createElement('h3');
        title.textContent = post.title;
        const body = document.createElement('p');
        body.textContent = post.body;
        copy.append(date, title, body);
        if (!post.imageUrl) copy.style.gridColumn = '1 / -1';
        article.append(copy);
        publicNewsList.append(article);
      });
    })
    .catch((error) => {
      console.error('Public news could not be loaded.', error);
      publicNewsList.replaceChildren();
      const notice = document.createElement('p');
      notice.className = 'news-empty';
      notice.setAttribute('role', 'status');
      notice.textContent = 'News updates are temporarily unavailable. Please try again later.';
      publicNewsList.append(notice);
    });
}

const newsImageDialog = document.querySelector('[data-news-image-dialog]');
if (newsImageDialog instanceof HTMLDialogElement) {
  const imageView = newsImageDialog.querySelector('[data-news-image-view]');
  const closeButton = newsImageDialog.querySelector('[data-news-image-close]');
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const link = target.closest('[data-news-image]');
    if (!link) return;
    event.preventDefault();
    const thumbnail = link.querySelector('img');
    imageView.src = link.href;
    imageView.alt = thumbnail?.alt || 'Full-size news image';
    newsImageDialog.showModal();
    closeButton.focus();
  });
  closeButton.addEventListener('click', () => newsImageDialog.close());
  newsImageDialog.addEventListener('click', (event) => {
    if (event.target === newsImageDialog) newsImageDialog.close();
  });
}

// ---- Home featured carousel ----
let homeSlides = [...document.querySelectorAll('[data-home-slide]')];
const homeDots = document.querySelector('[data-home-dots]');
if (homeSlides.length && homeDots) {
  let activeSlide = 0;
  let rotationTimer;
  const showcase = document.querySelector('.home-showcase');
  const autoRotationAllowed = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function showHomeSlide(index) {
    activeSlide = (index + homeSlides.length) % homeSlides.length;
    homeSlides.forEach((slide, slideIndex) => {
      slide.hidden = slideIndex !== activeSlide;
    });
    [...homeDots.children].forEach((dot, dotIndex) => {
      dot.setAttribute('aria-pressed', String(dotIndex === activeSlide));
    });
  }

  function renderHomeDots() {
    homeDots.replaceChildren();
    homeSlides.forEach((slide, index) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'home-slide-dot';
      dot.setAttribute('aria-label', `Show featured item ${index + 1}`);
      dot.addEventListener('click', () => showHomeSlide(index));
      homeDots.append(dot);
    });
  }

  document.querySelector('[data-home-previous]').addEventListener('click', () => showHomeSlide(activeSlide - 1));
  document.querySelector('[data-home-next]').addEventListener('click', () => showHomeSlide(activeSlide + 1));
  renderHomeDots();
  showHomeSlide(0);

  fetch('/api/news/featured')
    .then(async (response) => {
      const result = await response.json();
      if (!response.ok || !Array.isArray(result.posts)) throw new Error(result.error || 'Could not load homepage news slides.');
      result.posts.forEach((post) => {
        const slide = document.createElement('article');
        slide.className = 'home-slide';
        slide.dataset.homeSlide = '';
        slide.setAttribute('aria-label', post.title);
        const image = document.createElement('img');
        image.src = post.imageUrl;
        image.alt = post.title;
        const caption = document.createElement('div');
        caption.className = 'home-slide-caption';
        const label = document.createElement('span');
        label.textContent = 'News update';
        const title = document.createElement('h2');
        title.textContent = post.title;
        const link = document.createElement('a');
        link.className = 'btn btn-primary';
        link.href = 'news.html';
        link.textContent = 'Read the news';
        caption.append(label, title, link);
        slide.append(image, caption);
        document.querySelector('[data-home-slides]').append(slide);
      });
      homeSlides = [...document.querySelectorAll('[data-home-slide]')];
      renderHomeDots();
      showHomeSlide(activeSlide);
    })
    .catch((error) => console.error('Homepage news slides could not be loaded.', error));

  function startRotation() {
    if (!autoRotationAllowed || rotationTimer || document.hidden) return;
    rotationTimer = window.setInterval(() => showHomeSlide(activeSlide + 1), 6000);
  }

  function stopRotation() {
    window.clearInterval(rotationTimer);
    rotationTimer = undefined;
  }

  showcase.addEventListener('mouseenter', stopRotation);
  showcase.addEventListener('mouseleave', startRotation);
  showcase.addEventListener('focusin', stopRotation);
  showcase.addEventListener('focusout', (event) => {
    if (!showcase.contains(event.relatedTarget)) startRotation();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopRotation();
    else startRotation();
  });
  startRotation();
}
