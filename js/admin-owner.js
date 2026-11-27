document.addEventListener('DOMContentLoaded', () => {
  const dashboard = document.querySelector('[data-admin-dashboard]');
  if (!dashboard) return;

  const menuForm = dashboard.querySelector('[data-menu-form]');
  const newsForm = dashboard.querySelector('[data-news-form]');
  const settingsForm = dashboard.querySelector('[data-settings-form]');
  let products = [];
  let posts = [];
  let orphanedSlides = [];
  let activeMenuCategory = 'shawarma';

  async function request(path, options = {}) {
    const response = await fetch(`/api/admin${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'The request could not be completed.');
    return result;
  }

  function setMessage(selector, text, isError = false) {
    const target = dashboard.querySelector(selector);
    target.textContent = text;
    target.classList.toggle('is-success', Boolean(text) && !isError);
  }

  function categoryLabel(category) {
    return {
      shawarma: 'Shawarma',
      fries: 'Loaded fries',
      cakes: 'Cakes',
      'wedding-cakes': 'Wedding cakes'
    }[category] || category;
  }

  function renderProducts() {
    const list = dashboard.querySelector('[data-menu-list]');
    const query = dashboard.querySelector('[data-menu-search]').value.trim().toLocaleLowerCase();
    const categories = activeMenuCategory === 'cakes' ? ['cakes', 'wedding-cakes'] : [activeMenuCategory];
    const visible = products.filter((product) => categories.includes(product.category) &&
      `${product.name} ${product.category}`.toLocaleLowerCase().includes(query));
    dashboard.querySelectorAll('[data-menu-category-tab]').forEach((tab) => {
      const active = tab.dataset.menuCategoryTab === activeMenuCategory;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    list.setAttribute('aria-label', `${categoryLabel(activeMenuCategory)} menu items`);
    dashboard.querySelector('[data-menu-active-count]').textContent = String(products.filter((item) => item.active).length);
    dashboard.querySelector('[data-menu-inactive-count]').textContent = String(products.filter((item) => !item.active).length);
    dashboard.querySelector('[data-menu-online-count]').textContent = String(products.filter((item) => item.active && item.onlineOrderable).length);
    list.replaceChildren();
    if (!visible.length) {
      const empty = document.createElement('p');
      empty.className = 'admin-list-empty';
      empty.textContent = query
        ? 'No menu items in this category match your search.'
        : products.length
          ? `No ${categoryLabel(activeMenuCategory).toLocaleLowerCase()} items yet.`
          : 'No menu items yet. Add your first item to get started.';
      list.append(empty);
      return;
    }
    visible.forEach((product) => {
      const card = document.createElement('article');
      card.className = 'owner-record-card';
      const image = document.createElement('img');
      image.className = 'owner-record-image';
      image.src = product.imageUrl || '/images/Logo.png';
      image.alt = '';
      const copy = document.createElement('div');
      copy.className = 'owner-record-copy';
      const title = document.createElement('h4');
      title.textContent = product.name;
      const details = document.createElement('p');
      details.textContent = `${categoryLabel(product.category)} · ${product.priceLabel}${product.onlineOrderable ? ' · Online checkout' : ' · WhatsApp order'}`;
      const state = document.createElement('span');
      state.className = `owner-status ${product.active ? 'owner-status-live' : 'owner-status-muted'}`;
      state.textContent = product.active ? 'Available' : 'Archived';
      copy.append(title, details, state);
      const actions = document.createElement('div');
      actions.className = 'owner-record-actions';
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'btn btn-outline';
      edit.textContent = 'Edit';
      edit.addEventListener('click', () => editProduct(product));
      actions.append(edit);
      if (product.active) {
        const archive = document.createElement('button');
        archive.type = 'button';
        archive.className = 'btn btn-outline';
        archive.textContent = 'Mark unavailable';
        archive.addEventListener('click', () => archiveProduct(product));
        actions.append(archive);
      } else {
        const restore = document.createElement('button');
        restore.type = 'button';
        restore.className = 'btn btn-outline';
        restore.textContent = 'Restore';
        restore.addEventListener('click', () => restoreProduct(product));
        actions.append(restore);
      }
      card.append(image, copy, actions);
      list.append(card);
    });
  }

  async function loadProducts() {
    setMessage('[data-menu-form-message]', 'Loading menu items…');
    const result = await request('/products');
    products = result.products;
    renderProducts();
    setMessage('[data-menu-form-message]', '');
  }

  function resetProductForm() {
    menuForm.reset();
    menuForm.elements.id.value = '';
    menuForm.elements.category.value = activeMenuCategory === 'cakes' ? 'cakes' : activeMenuCategory;
    menuForm.elements.sortOrder.value = '100';
    menuForm.elements.active.checked = true;
    menuForm.querySelector('[data-menu-image-preview]').hidden = true;
    menuForm.querySelector('[data-menu-image-preview]').removeAttribute('src');
    dashboard.querySelector('[data-menu-form-title]').textContent = 'Add a menu item';
    menuForm.querySelector('[type="submit"]').textContent = 'Save menu item';
    setMessage('[data-menu-form-message]', '');
    updatePriceFields();
  }

  function updatePriceFields() {
    const online = menuForm.elements.onlineOrderable.checked;
    menuForm.querySelector('[data-checkout-price-field]').hidden = !online;
    menuForm.elements.checkoutPrice.required = online;
    menuForm.elements.priceLabel.required = !online;
  }

  function editProduct(product) {
    activeMenuCategory = product.category === 'wedding-cakes' ? 'cakes' : product.category;
    dashboard.querySelector('[data-menu-search]').value = '';
    renderProducts();
    menuForm.elements.id.value = product.id;
    menuForm.elements.name.value = product.name;
    menuForm.elements.category.value = product.category;
    menuForm.elements.description.value = product.description;
    menuForm.elements.priceLabel.value = product.onlineOrderable ? '' : product.priceLabel;
    menuForm.elements.previousPriceLabel.value = product.previousPriceLabel;
    menuForm.elements.onlineOrderable.checked = product.onlineOrderable;
    menuForm.elements.checkoutPrice.value = product.checkoutPrice ?? '';
    menuForm.elements.sortOrder.value = String(product.sortOrder);
    menuForm.elements.imageUrl.value = product.imageUrl;
    menuForm.elements.active.checked = product.active;
    const preview = menuForm.querySelector('[data-menu-image-preview]');
    preview.src = product.imageUrl || '/images/Logo.png';
    preview.hidden = false;
    dashboard.querySelector('[data-menu-form-title]').textContent = `Editing ${product.name}`;
    menuForm.querySelector('[type="submit"]').textContent = 'Save changes';
    setMessage('[data-menu-form-message]', '');
    updatePriceFields();
    menuForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function productPayload() {
    return {
      name: menuForm.elements.name.value,
      category: menuForm.elements.category.value,
      description: menuForm.elements.description.value,
      priceLabel: menuForm.elements.priceLabel.value,
      previousPriceLabel: menuForm.elements.previousPriceLabel.value,
      onlineOrderable: menuForm.elements.onlineOrderable.checked,
      checkoutPrice: menuForm.elements.checkoutPrice.value,
      sortOrder: menuForm.elements.sortOrder.value,
      imageUrl: menuForm.elements.imageUrl.value,
      active: menuForm.elements.active.checked
    };
  }

  async function archiveProduct(product) {
    if (!window.confirm(`Mark “${product.name}” unavailable? Past order records will remain intact.`)) return;
    try {
      await request(`/products/${encodeURIComponent(product.id)}`, { method: 'DELETE' });
      await loadProducts();
      setMessage('[data-menu-form-message]', `${product.name} is now unavailable.`);
    } catch (error) {
      setMessage('[data-menu-form-message]', error.message, true);
    }
  }

  async function restoreProduct(product) {
    try {
      await request(`/products/${encodeURIComponent(product.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ ...productPayloadFor(product), active: true })
      });
      await loadProducts();
      setMessage('[data-menu-form-message]', `${product.name} is back on the customer menu.`);
    } catch (error) {
      setMessage('[data-menu-form-message]', error.message, true);
    }
  }

  function productPayloadFor(product) {
    return {
      name: product.name,
      category: product.category,
      description: product.description,
      priceLabel: product.onlineOrderable ? '' : product.priceLabel,
      previousPriceLabel: product.previousPriceLabel,
      onlineOrderable: product.onlineOrderable,
      checkoutPrice: product.checkoutPrice ?? '',
      sortOrder: product.sortOrder,
      imageUrl: product.imageUrl,
      active: product.active
    };
  }

  function postStatus(post) {
    if (!post.publishAt) return 'Draft';
    return new Date(post.publishAt) > new Date() ? 'Scheduled' : 'Published';
  }

  function renderPosts() {
    const list = dashboard.querySelector('[data-news-list]');
    const query = dashboard.querySelector('[data-news-search]').value.trim().toLocaleLowerCase();
    const visible = posts.filter((post) => `${post.title} ${post.body}`.toLocaleLowerCase().includes(query));
    const counts = { Published: 0, Scheduled: 0, Draft: 0 };
    posts.forEach((post) => { counts[postStatus(post)] += 1; });
    dashboard.querySelector('[data-news-published-count]').textContent = String(counts.Published);
    dashboard.querySelector('[data-news-scheduled-count]').textContent = String(counts.Scheduled);
    dashboard.querySelector('[data-news-draft-count]').textContent = String(counts.Draft);
    list.replaceChildren();
    if (!visible.length && !orphanedSlides.length) {
      const empty = document.createElement('p');
      empty.className = 'admin-list-empty';
      empty.textContent = posts.length ? 'No posts match your search.' : 'No news posts yet. Create a draft or schedule your first update.';
      list.append(empty);
      return;
    }
    if (!visible.length) {
      const empty = document.createElement('p');
      empty.className = 'admin-list-empty';
      empty.textContent = 'No posts match your search.';
      list.append(empty);
    }
    visible.forEach((post) => {
      const card = document.createElement('article');
      card.className = 'owner-record-card';
      const image = document.createElement('img');
      image.className = 'owner-record-image';
      image.src = post.imageUrl || '/images/Logo.png';
      image.alt = '';
      const copy = document.createElement('div');
      copy.className = 'owner-record-copy';
      const title = document.createElement('h4');
      title.textContent = post.title;
      const body = document.createElement('p');
      body.textContent = post.body;
      const state = document.createElement('span');
      state.className = `owner-status owner-status-${postStatus(post).toLowerCase()}`;
      state.textContent = postStatus(post);
      copy.append(title, body, state);
      const actions = document.createElement('div');
      actions.className = 'owner-record-actions';
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'btn btn-outline';
      edit.textContent = 'Edit';
      edit.addEventListener('click', () => editPost(post));
      const publish = document.createElement('button');
      publish.type = 'button';
      publish.className = 'btn btn-outline';
      publish.textContent = postStatus(post) === 'Published' ? 'Unpublish' : 'Publish now';
      publish.addEventListener('click', () => setPostPublication(post, postStatus(post) === 'Published' ? null : new Date().toISOString()));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn-outline';
      remove.textContent = 'Delete';
      remove.addEventListener('click', () => deletePost(post));
      actions.append(edit, publish, remove);
      card.append(image, copy, actions);
      list.append(card);
    });
    orphanedSlides.forEach((slide) => {
      const card = document.createElement('article');
      card.className = 'owner-record-card';
      const image = document.createElement('img');
      image.className = 'owner-record-image';
      image.src = slide.imageUrl;
      image.alt = '';
      const copy = document.createElement('div');
      copy.className = 'owner-record-copy';
      const title = document.createElement('h4');
      title.textContent = slide.title;
      const note = document.createElement('p');
      note.textContent = 'Retained in the homepage banner; the news post has been deleted.';
      copy.append(title, note);
      const actions = document.createElement('div');
      actions.className = 'owner-record-actions';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn-outline';
      remove.textContent = 'Remove from banner';
      remove.addEventListener('click', () => removeOrphanedSlide(slide));
      actions.append(remove);
      card.append(image, copy, actions);
      list.append(card);
    });
  }

  async function loadPosts() {
    setMessage('[data-news-form-message]', 'Loading news posts…');
    const result = await request('/news');
    posts = result.posts;
    orphanedSlides = result.orphanedSlides || [];
    renderPosts();
    setMessage('[data-news-form-message]', '');
  }

  function resetNewsForm() {
    newsForm.reset();
    newsForm.elements.id.value = '';
    newsForm.elements.imageUrl.value = '';
    newsForm.elements.showOnHomepage.checked = false;
    const preview = newsForm.querySelector('[data-news-image-preview]');
    preview.hidden = true;
    preview.removeAttribute('src');
    dashboard.querySelector('[data-news-form-title]').textContent = 'Create a news post';
    newsForm.querySelector('[type="submit"]').textContent = 'Save post';
    setMessage('[data-news-form-message]', '');
  }

  function editPost(post) {
    newsForm.elements.id.value = post.id;
    newsForm.elements.title.value = post.title;
    newsForm.elements.body.value = post.body;
    newsForm.elements.publishAt.value = post.publishAt
      ? new Date(new Date(post.publishAt).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)
      : '';
    newsForm.elements.imageUrl.value = post.imageUrl;
    newsForm.elements.showOnHomepage.checked = post.showOnHomepage;
    const preview = newsForm.querySelector('[data-news-image-preview]');
    preview.src = post.imageUrl || '/images/Logo.png';
    preview.hidden = false;
    dashboard.querySelector('[data-news-form-title]').textContent = `Editing ${post.title}`;
    newsForm.querySelector('[type="submit"]').textContent = 'Save changes';
    setMessage('[data-news-form-message]', '');
    newsForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function deletePost(post) {
    if (!window.confirm(`Delete “${post.title}”? This cannot be undone.`)) return;
    try {
      await request(`/news/${encodeURIComponent(post.id)}`, { method: 'DELETE' });
      await loadPosts();
      setMessage('[data-news-form-message]', 'News post deleted.');
    } catch (error) {
      setMessage('[data-news-form-message]', error.message, true);
    }
  }

  async function removeOrphanedSlide(slide) {
    if (!window.confirm(`Remove “${slide.title}” from the homepage banner?`)) return;
    try {
      await request(`/news-slides/${encodeURIComponent(slide.id)}`, { method: 'DELETE' });
      await loadPosts();
      setMessage('[data-news-form-message]', 'Homepage slide removed.');
    } catch (error) {
      setMessage('[data-news-form-message]', error.message, true);
    }
  }

  async function setPostPublication(post, publishAt) {
    try {
      await request(`/news/${encodeURIComponent(post.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ ...post, publishAt })
      });
      await loadPosts();
      setMessage('[data-news-form-message]', publishAt ? 'News post is now published.' : 'News post moved back to drafts.');
    } catch (error) {
      setMessage('[data-news-form-message]', error.message, true);
    }
  }

  async function loadSettings() {
    setMessage('[data-settings-message]', 'Loading site details…');
    const result = await request('/site-settings');
    Object.entries(result.settings).forEach(([key, value]) => {
      if (settingsForm.elements[key]) {
        const localPhone = ['whatsapp_phone', 'contact_phone'].includes(key) && value.startsWith('233')
          ? `0${value.slice(3)}`
          : value;
        settingsForm.elements[key].value = localPhone;
      }
    });
    setMessage('[data-settings-message]', '');
  }

  async function uploadImage(file, form, previewSelector, messageSelector) {
    if (file.size > 5 * 1024 * 1024) throw new Error('Choose an image that is 5 MB or smaller.');
    const data = new FormData();
    data.append('file', file);
    const response = await fetch('/api/admin/media', { method: 'POST', body: data });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not upload this image.');
    form.elements.imageUrl.value = result.imageUrl;
    const preview = form.querySelector(previewSelector);
    preview.src = result.imageUrl;
    preview.hidden = false;
    setMessage(messageSelector, 'Photo uploaded. Save the form to apply it.');
  }

  menuForm.elements.onlineOrderable.addEventListener('change', updatePriceFields);
  menuForm.elements.checkoutPrice.addEventListener('input', () => {
    if (menuForm.elements.onlineOrderable.checked && menuForm.elements.checkoutPrice.value) {
      menuForm.elements.priceLabel.value = `GH₵${Number(menuForm.elements.checkoutPrice.value).toFixed(2).replace(/\.00$/, '')}`;
    }
  });
  dashboard.querySelector('[data-menu-add]').addEventListener('click', () => {
    resetProductForm();
    menuForm.elements.category.value = activeMenuCategory === 'cakes' ? 'cakes' : activeMenuCategory;
    menuForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  dashboard.querySelector('[data-menu-cancel]').addEventListener('click', resetProductForm);
  dashboard.querySelector('[data-menu-search]').addEventListener('input', renderProducts);
  dashboard.querySelectorAll('[data-menu-category-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      activeMenuCategory = tab.dataset.menuCategoryTab;
      dashboard.querySelector('[data-menu-search]').value = '';
      renderProducts();
    });
  });
  menuForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const id = menuForm.elements.id.value;
    const savedCategory = menuForm.elements.category.value;
    const button = menuForm.querySelector('[type="submit"]');
    button.disabled = true;
    setMessage('[data-menu-form-message]', 'Saving menu item…');
    try {
      await request(id ? `/products/${encodeURIComponent(id)}` : '/products', {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(productPayload())
      });
      activeMenuCategory = savedCategory === 'wedding-cakes' ? 'cakes' : savedCategory;
      resetProductForm();
      await loadProducts();
      setMessage('[data-menu-form-message]', 'Menu item saved.');
    } catch (error) {
      setMessage('[data-menu-form-message]', error.message, true);
    } finally {
      button.disabled = false;
    }
  });
  menuForm.querySelector('[data-owner-image-file]').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      setMessage('[data-menu-form-message]', 'Uploading photo…');
      await uploadImage(file, menuForm, '[data-menu-image-preview]', '[data-menu-form-message]');
    } catch (error) {
      setMessage('[data-menu-form-message]', error.message, true);
    }
  });

  dashboard.querySelector('[data-news-add]').addEventListener('click', () => {
    resetNewsForm();
    newsForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  dashboard.querySelector('[data-news-cancel]').addEventListener('click', resetNewsForm);
  dashboard.querySelector('[data-news-search]').addEventListener('input', renderPosts);
  newsForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const id = newsForm.elements.id.value;
    const button = newsForm.querySelector('[type="submit"]');
    const publishValue = newsForm.elements.publishAt.value;
    button.disabled = true;
    setMessage('[data-news-form-message]', 'Saving news post…');
    try {
      await request(id ? `/news/${encodeURIComponent(id)}` : '/news', {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify({
          title: newsForm.elements.title.value,
          body: newsForm.elements.body.value,
          imageUrl: newsForm.elements.imageUrl.value,
          publishAt: publishValue ? new Date(publishValue).toISOString() : null,
          showOnHomepage: newsForm.elements.showOnHomepage.checked
        })
      });
      resetNewsForm();
      await loadPosts();
      setMessage('[data-news-form-message]', 'News post saved.');
    } catch (error) {
      setMessage('[data-news-form-message]', error.message, true);
    } finally {
      button.disabled = false;
    }
  });
  newsForm.querySelector('[data-owner-image-file]').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      setMessage('[data-news-form-message]', 'Uploading photo…');
      await uploadImage(file, newsForm, '[data-news-image-preview]', '[data-news-form-message]');
    } catch (error) {
      setMessage('[data-news-form-message]', error.message, true);
    }
  });

  settingsForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = settingsForm.querySelector('[type="submit"]');
    button.disabled = true;
    setMessage('[data-settings-message]', 'Saving site details…');
    const payload = Object.fromEntries(new FormData(settingsForm).entries());
    try {
      await request('/site-settings', { method: 'PUT', body: JSON.stringify(payload) });
      setMessage('[data-settings-message]', 'Site details saved.');
    } catch (error) {
      setMessage('[data-settings-message]', error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  dashboard.addEventListener('admin:tabchange', async (event) => {
    const tab = event.detail.tab;
    try {
      if (tab === 'menu') await loadProducts();
      if (tab === 'news') await loadPosts();
      if (tab === 'settings') await loadSettings();
    } catch (error) {
      const selector = tab === 'menu' ? '[data-menu-form-message]' : tab === 'news' ? '[data-news-form-message]' : '[data-settings-message]';
      setMessage(selector, error.message, true);
    }
  });

  updatePriceFields();
});
