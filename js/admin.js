document.addEventListener('DOMContentLoaded', () => {
  const login = document.querySelector('[data-admin-login]');
  const dashboard = document.querySelector('[data-admin-dashboard]');
  const loginForm = document.querySelector('[data-admin-login-form]');
  const message = document.querySelector('[data-admin-dashboard-message]');
  const labels = {
    awaiting_restaurant: 'Awaiting confirmation',
    received: 'Received',
    preparing: 'Preparing',
    ready: 'Ready for pickup',
    completed: 'Completed'
  };
  let selected = null;
  let orders = [];
  let activeFilter = 'all';
  let activeAdminTab = 'overview';

  function activeAdminView() {
    return dashboard.querySelector(`[data-admin-view="${activeAdminTab}"]`);
  }

  function updateSummary() {
    document.querySelector('[data-admin-total]').textContent = orders.length;
    document.querySelector('[data-admin-awaiting]').textContent = orders.filter((order) => order.status === 'awaiting_restaurant').length;
    document.querySelector('[data-admin-active]').textContent = orders.filter((order) =>
      ['received', 'preparing', 'ready'].includes(order.status)
    ).length;
    document.querySelector('[data-admin-completed]').textContent = orders.filter((order) => order.status === 'completed').length;
  }

  function renderOrderList() {
    if (!['orders', 'reviews'].includes(activeAdminTab)) return;
    const view = activeAdminView();
    const orderList = view.querySelector('[data-admin-orders]');
    const searchInput = view.querySelector('[data-admin-search]');
    const query = searchInput.value.trim().toLocaleLowerCase();
    const filtered = orders.filter((order) => {
      if (activeAdminTab === 'reviews' && !order.review) return false;
      const matchesFilter = activeAdminTab === 'reviews' || activeFilter === 'all' ||
        (activeFilter === 'awaiting' && order.status === 'awaiting_restaurant') ||
        (activeFilter === 'active' && ['received', 'preparing', 'ready'].includes(order.status)) ||
        (activeFilter === 'completed' && order.status === 'completed');
      const matchesQuery = `${order.orderNumber} ${order.customerName} ${order.phone}`.toLocaleLowerCase().includes(query);
      return matchesFilter && matchesQuery;
    });
    orderList.replaceChildren();
    if (!filtered.length) {
      const empty = document.createElement('p');
      empty.className = 'admin-list-empty';
      empty.textContent = activeAdminTab === 'reviews'
        ? 'No customer reviews have been submitted yet.'
        : orders.length ? 'No orders match this filter.' : 'No paid orders yet. New orders will appear here.';
      orderList.append(empty);
      return;
    }
    filtered.forEach((order) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'admin-order-card';
      button.setAttribute('aria-current', String(selected?.orderNumber === order.orderNumber));
      const number = document.createElement('strong');
      number.textContent = order.orderNumber;
      const customer = document.createElement('span');
      customer.className = 'admin-card-customer';
      customer.textContent = `${order.customerName} · GH₵${order.total.toFixed(2)}`;
      const status = document.createElement('span');
      status.className = `status-pill status-${order.status}`;
      status.textContent = labels[order.status];
      button.append(number, customer, status);
      if (order.review) {
        const review = document.createElement('span');
        review.className = 'admin-card-review';
        review.textContent = `★ ${order.review.rating}/5 customer review`;
        button.append(review);
      }
      button.addEventListener('click', () => loadOrder(order.orderNumber));
      orderList.append(button);
    });
  }

  async function api(path, options = {}) {
    const response = await fetch(`/api/admin${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Request failed.');
    return result;
  }

  async function showDashboard(username) {
    login.hidden = true;
    dashboard.hidden = false;
    document.querySelector('[data-admin-phone]').textContent = username;
    await loadOrders();
  }

  function renderOrder(order) {
    selected = order;
    const detail = activeAdminView().querySelector('[data-admin-detail]');
    detail.replaceChildren();
    const heading = document.createElement('h2');
    heading.textContent = `Order ${order.orderNumber}`;
    const status = document.createElement('p');
    status.className = 'current-status';
    status.textContent = `${labels[order.status]} · ${new Date(order.createdAt).toLocaleString()}`;
    const customer = document.createElement('p');
    customer.className = 'admin-customer';
    const contactDetails = [order.customerName, order.phone];
    if (order.email && !order.email.endsWith('@example.com')) contactDetails.push(order.email);
    customer.textContent = contactDetails.join(' · ');
    const items = document.createElement('ul');
    items.className = 'order-lines';
    order.items.forEach((entry) => {
      const line = document.createElement('li');
      line.textContent = `${entry.quantity} × ${entry.name} — GH₵${entry.lineTotal.toFixed(2)}`;
      items.append(line);
    });
    const total = document.createElement('p');
    total.className = 'order-total';
    total.textContent = `Paid: GH₵${order.total.toFixed(2)}`;
    if (order.review) {
      const review = document.createElement('section');
      review.className = 'admin-review';
      const reviewHeading = document.createElement('h3');
      reviewHeading.textContent = `Customer review · ${order.review.rating}/5 stars`;
      const reviewText = document.createElement('p');
      reviewText.textContent = order.review.text;
      const reviewDate = document.createElement('small');
      reviewDate.textContent = `Submitted ${new Date(order.review.createdAt).toLocaleString()}`;
      review.append(reviewHeading, reviewText, reviewDate);
      detail.append(heading, status, customer, items, total, review);
    } else {
      detail.append(heading, status, customer, items, total);
    }
    const actions = document.createElement('div');
    actions.className = 'admin-actions';
    const next = {
      awaiting_restaurant: ['received', 'Mark received'],
      received: ['preparing', 'Start preparing'],
      preparing: ['ready', 'Mark ready for pickup'],
      ready: ['completed', 'Mark completed'],
      completed: null
    }[order.status];
    if (next) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-primary';
      button.textContent = next[1];
      button.addEventListener('click', () => updateStatus(next[0]));
      actions.append(button);
    }
    if (order.failedNotifications) {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'btn btn-outline';
      retry.textContent = `Retry failed SMS (${order.failedNotifications})`;
      retry.addEventListener('click', () => retrySms(order.orderNumber));
      actions.append(retry);
    }
    detail.append(actions);
  }

  function resetActiveDetail() {
    const detail = activeAdminView().querySelector('[data-admin-detail]');
    const content = document.createElement('div');
    content.className = 'admin-empty-detail';
    const icon = document.createElement('span');
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = activeAdminTab === 'reviews' ? '★' : '✦';
    const heading = document.createElement('h2');
    heading.textContent = activeAdminTab === 'reviews' ? 'Customer reviews' : 'Your order details';
    const description = document.createElement('p');
    description.textContent = activeAdminTab === 'reviews'
      ? 'Select a reviewed order to read its rating and feedback.'
      : 'Select an order to see the customer, items, payment total, and next steps.';
    content.append(icon, heading, description);
    detail.replaceChildren(content);
  }

  function setAdminTab(tabName, orderFilter = 'all') {
    activeAdminTab = tabName;
    dashboard.querySelectorAll('[data-admin-tab]').forEach((tab) => {
      const active = tab.dataset.adminTab === tabName;
      tab.classList.toggle('active', active);
      if (tab.getAttribute('role') === 'tab') tab.setAttribute('aria-selected', String(active));
    });
    dashboard.querySelectorAll('[data-admin-view]').forEach((view) => {
      view.hidden = view.dataset.adminView !== tabName;
    });
    activeFilter = tabName === 'orders' ? orderFilter : 'all';
    dashboard.querySelectorAll('[data-order-filter]').forEach((filter) => {
      const active = filter.dataset.orderFilter === activeFilter;
      filter.classList.toggle('active', active);
      filter.setAttribute('aria-pressed', String(active));
    });
    dashboard.querySelectorAll('.admin-filters').forEach((filters) => {
      filters.hidden = tabName === 'reviews';
    });
    dashboard.dispatchEvent(new CustomEvent('admin:tabchange', { detail: { tab: tabName } }));
    if (tabName === 'orders' || tabName === 'reviews') {
      const view = activeAdminView();
      const title = view.querySelector('[data-admin-list-title]');
      const description = view.querySelector('[data-admin-list-description]');
      if (title) title.textContent = tabName === 'reviews' ? 'Customer reviews' : 'Recent orders';
      if (description) description.textContent = tabName === 'reviews'
        ? 'Choose a reviewed order to read the customer’s feedback.'
        : 'Choose an order to view details and update its progress.';
      renderOrderList();
      if (selected && (tabName !== 'reviews' || selected.review)) {
        renderOrder(selected);
      } else {
        selected = null;
        resetActiveDetail();
      }
    }
  }

  async function loadOrders() {
    message.textContent = 'Loading orders…';
    try {
      const result = await api('/orders');
      orders = result.orders;
      updateSummary();
      renderOrderList();
      message.textContent = `Showing ${result.orders.length} orders.`;
      const linked = new URLSearchParams(window.location.search).get('order');
      const selectedNumber = linked || selected?.orderNumber;
      if (selectedNumber && (!selected || selected.orderNumber !== selectedNumber ||
          orders.some((order) => order.orderNumber === selectedNumber))) {
        await loadOrder(selectedNumber);
      }
    } catch (error) {
      message.textContent = error.message;
    }
  }

  async function loadOrder(number) {
    try {
      const result = await api(`/orders/${encodeURIComponent(number)}`);
      renderOrder(result.order);
      renderOrderList();
    } catch (error) {
      message.textContent = error.message;
    }
  }

  async function updateStatus(status) {
    if (!selected) return;
    message.textContent = 'Updating order…';
    try {
      const result = await api(`/orders/${encodeURIComponent(selected.orderNumber)}/status`, {
        method: 'POST',
        body: JSON.stringify({ status })
      });
      renderOrder(result.order);
      message.textContent = result.notificationSent ? 'Status updated and customer SMS sent.' : 'Status updated. SMS delivery needs attention.';
      await loadOrders();
    } catch (error) {
      message.textContent = error.message;
    }
  }

  async function retrySms(number) {
    try {
      const result = await api(`/orders/${encodeURIComponent(number)}/retry-notifications`, { method: 'POST' });
      renderOrder(result.order);
      message.textContent = result.failed ? 'Some SMS messages still failed.' : 'Pending SMS messages sent.';
      await loadOrders();
    } catch (error) {
      message.textContent = error.message;
    }
  }

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = document.querySelector('[data-admin-message]');
    const formData = new FormData(loginForm);
    const username = formData.get('username').toString();
    const accessKey = formData.get('accessKey').toString();
    status.textContent = 'Signing in…';
    loginForm.querySelector('[type="submit"]').disabled = true;
    try {
      const result = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, accessKey })
      });
      loginForm.reset();
      await showDashboard(result.username);
    } catch (error) {
      status.textContent = error.message;
    } finally {
      loginForm.querySelector('[type="submit"]').disabled = false;
    }
  });

  document.querySelector('[data-admin-refresh]').addEventListener('click', loadOrders);
  dashboard.querySelectorAll('[data-admin-search]').forEach((input) => input.addEventListener('input', renderOrderList));
  dashboard.querySelectorAll('[data-admin-tab]').forEach((tab) => {
    if (tab.tagName === 'BUTTON') tab.addEventListener('click', () => setAdminTab(tab.dataset.adminTab));
  });
  dashboard.querySelectorAll('[data-admin-stat-filter]').forEach((card) => {
    card.addEventListener('click', () => {
      selected = null;
      setAdminTab('orders', card.dataset.adminStatFilter);
    });
  });
  dashboard.querySelector('[data-open-admin-tab]').addEventListener('click', () => setAdminTab('orders'));
  document.querySelectorAll('[data-order-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      activeFilter = button.dataset.orderFilter;
      document.querySelectorAll('[data-order-filter]').forEach((filter) => {
        const active = filter === button;
        filter.classList.toggle('active', active);
        filter.setAttribute('aria-pressed', String(active));
      });
      renderOrderList();
    });
  });
  document.querySelector('[data-admin-logout]').addEventListener('click', async () => {
    try {
      await api('/auth/logout', { method: 'POST', body: '{}' });
      dashboard.hidden = true;
      login.hidden = false;
      selected = null;
      loginForm.reset();
    } catch (error) {
      message.textContent = error.message;
    }
  });
  api('/auth/session').then((result) => {
    if (result.authenticated) return showDashboard(result.username);
  }).catch((error) => {
    document.querySelector('[data-admin-message]').textContent = error.message;
  });
});
