const ORDER_CART_KEY = 'de5thbite-cart';
const orderMoney = (amount) => `GH₵${Number(amount).toFixed(2)}`;

function orderCart() {
  try {
    const value = JSON.parse(localStorage.getItem(ORDER_CART_KEY) || '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((item) => item && typeof item.name === 'string' && Number.isInteger(item.qty) && item.qty > 0 && item.qty <= 10);
  } catch {
    return [];
  }
}

function productSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function renderSummary(target, totalTarget, cart) {
  target.replaceChildren();
  let total = 0;
  cart.forEach((item) => {
    const price = Number(item.price);
    const lineTotal = price * item.qty;
    total += lineTotal;
    const row = document.createElement('div');
    row.className = 'cart-row';
    const label = document.createElement('span');
    label.textContent = `${item.qty} × ${item.name}`;
    const line = document.createElement('strong');
    line.textContent = orderMoney(lineTotal);
    row.append(label, line);
    target.append(row);
  });
  totalTarget.textContent = orderMoney(total);
  return total;
}

function createReviewSection(order, orderNumber, phone) {
  if (order.review) {
    const section = document.createElement('section');
    section.className = 'customer-review';
    const heading = document.createElement('h3');
    heading.textContent = 'Thank you for your review';
    const rating = document.createElement('p');
    rating.className = 'review-stars';
    rating.textContent = `${'★'.repeat(order.review.rating)}${'☆'.repeat(5 - order.review.rating)} (${order.review.rating}/5)`;
    const text = document.createElement('p');
    text.textContent = order.review.text;
    section.append(heading, rating, text);
    return section;
  }
  if (!order.canReview) return null;

  const section = document.createElement('section');
  section.className = 'customer-review';
  const heading = document.createElement('h3');
  heading.textContent = 'How was your order?';
  const form = document.createElement('form');
  form.className = 'review-form';

  const ratingLabel = document.createElement('label');
  ratingLabel.textContent = 'Your rating';
  const ratingSelect = document.createElement('select');
  ratingSelect.name = 'rating';
  ratingSelect.required = true;
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Choose a rating';
  placeholder.disabled = true;
  placeholder.selected = true;
  ratingSelect.append(placeholder);
  for (let rating = 5; rating >= 1; rating -= 1) {
    const option = document.createElement('option');
    option.value = String(rating);
    option.textContent = `${'★'.repeat(rating)}${'☆'.repeat(5 - rating)} — ${rating} out of 5`;
    ratingSelect.append(option);
  }
  ratingLabel.append(ratingSelect);

  const reviewLabel = document.createElement('label');
  reviewLabel.textContent = 'Your review';
  const reviewInput = document.createElement('textarea');
  reviewInput.name = 'review';
  reviewInput.required = true;
  reviewInput.minLength = 2;
  reviewInput.maxLength = 1000;
  reviewInput.rows = 4;
  reviewInput.placeholder = 'Tell us what you thought of your order.';
  reviewLabel.append(reviewInput);

  const consentLabel = document.createElement('label');
  consentLabel.className = 'review-public-consent';
  const consentInput = document.createElement('input');
  consentInput.type = 'checkbox';
  consentInput.name = 'displayPublicly';
  const consentText = document.createElement('span');
  consentText.textContent = 'I agree to display my review and full name on the homepage. This is optional.';
  consentLabel.append(consentInput, consentText);

  const message = document.createElement('p');
  message.className = 'form-message';
  message.setAttribute('role', 'status');
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn btn-primary';
  submit.textContent = 'Submit review';
  form.append(ratingLabel, reviewLabel, consentLabel, message, submit);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = new FormData(form);
    submit.disabled = true;
    message.textContent = 'Submitting your review…';
    try {
      const response = await fetch('/api/orders/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderNumber,
          phone,
          rating: Number(values.get('rating')),
          review: values.get('review'),
          displayPublicly: values.get('displayPublicly') === 'on'
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not submit your review.');
      const thankYou = createReviewSection({ review: result.review, canReview: false }, orderNumber, phone);
      if (result.review.displayPublicly) {
        const note = document.createElement('p');
        note.textContent = 'Your review and full name may appear on the homepage.';
        thankYou.append(note);
      }
      section.replaceWith(thankYou);
    } catch (error) {
      message.textContent = error.message;
      submit.disabled = false;
    }
  });
  section.append(heading, form);
  return section;
}

document.addEventListener('DOMContentLoaded', () => {
  const reviewCarousel = document.querySelector('[data-review-carousel]');
  if (reviewCarousel) {
    const status = reviewCarousel.querySelector('[data-review-status]');
    const slideContainer = reviewCarousel.querySelector('[data-review-slides]');
    const controls = reviewCarousel.querySelector('[data-review-controls]');
    const dots = reviewCarousel.querySelector('[data-review-dots]');
    const slides = [];

    function showReview(index) {
      const active = (index + slides.length) % slides.length;
      slides.forEach((slide, slideIndex) => {
        slide.hidden = slideIndex !== active;
      });
      [...dots.children].forEach((dot, dotIndex) => {
        dot.setAttribute('aria-pressed', String(dotIndex === active));
      });
    }

    async function loadReviews() {
      try {
        const response = await fetch('/api/reviews/featured');
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not load customer reviews.');
        if (!Array.isArray(result.reviews) || !result.reviews.length) return;

        result.reviews.forEach((review, index) => {
          const slide = document.createElement('article');
          slide.className = 'home-review-slide';
          slide.setAttribute('aria-label', `Customer review ${index + 1}`);
          slide.hidden = index !== 0;
          const stars = document.createElement('p');
          stars.className = 'home-review-stars';
          stars.setAttribute('aria-label', '5 out of 5 stars');
          stars.textContent = '★★★★★';
          const text = document.createElement('blockquote');
          text.className = 'home-review-text';
          text.textContent = review.text;
          const author = document.createElement('p');
          author.className = 'home-review-author';
          author.textContent = review.name;
          slide.append(stars, text, author);
          slides.push(slide);
          slideContainer.append(slide);

          const dot = document.createElement('button');
          dot.type = 'button';
          dot.className = 'home-review-dot';
          dot.setAttribute('aria-label', `Show customer review ${index + 1}`);
          dot.setAttribute('aria-pressed', String(index === 0));
          dot.addEventListener('click', () => showReview(index));
          dots.append(dot);
        });

        status.hidden = true;
        reviewCarousel.hidden = false;
        if (slides.length < 2) {
          controls.hidden = true;
          return;
        }
        controls.hidden = false;
        let activeSlide = 0;
        let rotationTimer;
        const autoRotationAllowed = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const previous = reviewCarousel.querySelector('[data-review-previous]');
        const next = reviewCarousel.querySelector('[data-review-next]');
        const startRotation = () => {
          if (!autoRotationAllowed || rotationTimer || document.hidden) return;
          rotationTimer = window.setInterval(() => {
            activeSlide = (activeSlide + 1) % slides.length;
            showReview(activeSlide);
          }, 6000);
        };
        const stopRotation = () => {
          window.clearInterval(rotationTimer);
          rotationTimer = undefined;
        };
        previous.addEventListener('click', () => {
          activeSlide = (activeSlide + slides.length - 1) % slides.length;
          showReview(activeSlide);
        });
        next.addEventListener('click', () => {
          activeSlide = (activeSlide + 1) % slides.length;
          showReview(activeSlide);
        });
        dots.addEventListener('click', (event) => {
          const dotIndex = [...dots.children].indexOf(event.target);
          if (dotIndex >= 0) activeSlide = dotIndex;
        });
        reviewCarousel.addEventListener('mouseenter', stopRotation);
        reviewCarousel.addEventListener('mouseleave', startRotation);
        reviewCarousel.addEventListener('focusin', stopRotation);
        reviewCarousel.addEventListener('focusout', (event) => {
          if (!reviewCarousel.contains(event.relatedTarget)) startRotation();
        });
        document.addEventListener('visibilitychange', () => {
          if (document.hidden) stopRotation();
          else startRotation();
        });
        startRotation();
      } catch {
        status.textContent = 'Customer reviews are temporarily unavailable.';
        reviewCarousel.hidden = false;
      }
    }

    loadReviews();
  }

  const checkoutForm = document.querySelector('[data-checkout-form]');
  if (checkoutForm) {
    const cart = orderCart().filter((item) => item.price !== null);
    if (!cart.length) {
      window.location.replace('menu.html');
      return;
    }
    renderSummary(document.querySelector('[data-checkout-items]'), document.querySelector('[data-checkout-total]'), cart);
    checkoutForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(checkoutForm);
      const submit = checkoutForm.querySelector('[data-checkout-submit]');
      const message = document.querySelector('[data-checkout-message]');
      submit.disabled = true;
      message.textContent = 'Creating your secure Paystack checkout…';
      try {
        const response = await fetch('/api/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: formData.get('name'),
            phone: formData.get('phone'),
            items: cart.map((item) => ({ productId: item.productId || productSlug(item.name), quantity: item.qty }))
          })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not start checkout. Please try again.');
        sessionStorage.setItem('de5thbite-pending-order', result.orderNumber);
        window.location.assign(result.authorizationUrl);
      } catch (error) {
        message.textContent = error.message;
        submit.disabled = false;
      }
    });
  }

  const paymentResult = document.querySelector('[data-payment-result]');
  if (paymentResult) {
    const reference = new URLSearchParams(window.location.search).get('reference')
      || new URLSearchParams(window.location.search).get('trxref');
    if (!reference) {
      paymentResult.textContent = 'No payment reference was found. If you completed payment, track the order using the number from your SMS or contact us.';
      return;
    }
    fetch('/api/payment/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference })
    }).then(async (response) => {
      const result = await response.json();
      if (!response.ok || !result.paid) throw new Error(result.error || 'Payment is not confirmed yet.');
      localStorage.removeItem(ORDER_CART_KEY);
      sessionStorage.removeItem('de5thbite-pending-order');
      const heading = document.createElement('h2');
      heading.textContent = 'Payment confirmed';
      const detail = document.createElement('p');
      detail.textContent = `Your order number is ${result.orderNumber}. Keep it to track your order.`;
      const link = document.createElement('a');
      link.className = 'btn btn-primary';
      link.href = `orders.html?order=${encodeURIComponent(result.orderNumber)}`;
      link.textContent = 'Track your order';
      paymentResult.replaceChildren(heading, detail, link);
    }).catch((error) => {
      const message = document.createElement('p');
      message.textContent = `${error.message} If you were charged, wait a moment and try again or call 024 845 1683 / 059 527 2224.`;
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'btn btn-primary';
      retry.textContent = 'Check payment again';
      retry.addEventListener('click', () => window.location.reload());
      paymentResult.replaceChildren(message, retry);
    });
  }

  const lookupForm = document.querySelector('[data-lookup-form]');
  if (lookupForm) {
    const orderInput = lookupForm.elements.orderNumber;
    const queryOrder = new URLSearchParams(window.location.search).get('order');
    if (queryOrder) orderInput.value = queryOrder;
    lookupForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(lookupForm);
      const message = document.querySelector('[data-lookup-message]');
      const resultNode = document.querySelector('[data-order-result]');
      message.textContent = 'Looking up your order…';
      resultNode.replaceChildren();
      try {
        const response = await fetch('/api/orders/lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderNumber: formData.get('orderNumber'), phone: formData.get('phone') })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Order not found. Check your order number and phone number.');
        const title = document.createElement('h2');
        title.textContent = `Order ${result.orderNumber}`;
        const current = document.createElement('p');
        current.className = 'current-status';
        current.textContent = `Current status: ${result.statusLabel}`;
        const timeline = document.createElement('ol');
        timeline.className = 'status-timeline';
        result.statuses.forEach((status) => {
          const item = document.createElement('li');
          item.className = status.complete ? 'complete' : '';
          item.textContent = status.label;
          timeline.append(item);
        });
        const items = document.createElement('ul');
        items.className = 'order-lines';
        result.items.forEach((orderItem) => {
          const item = document.createElement('li');
          item.textContent = `${orderItem.quantity} × ${orderItem.name} — ${orderMoney(orderItem.lineTotal)}`;
          items.append(item);
        });
        const total = document.createElement('p');
        total.className = 'order-total';
        total.textContent = `Paid total: ${orderMoney(result.total)}`;
        resultNode.replaceChildren(title, current, timeline, items, total);
        const reviewSection = createReviewSection(result, result.orderNumber, formData.get('phone').toString());
        if (reviewSection) resultNode.append(reviewSection);
        message.textContent = 'Order status updated. Refresh to check again.';
      } catch (error) {
        message.textContent = error.message;
      }
    });
  }
});
