const authScreen = document.querySelector("#auth-screen");
const appShell = document.querySelector("#app-shell");
const authForm = document.querySelector("#auth-form");
const authMessage = document.querySelector("#auth-message");
const loginTab = document.querySelector("#login-tab");
const signupTab = document.querySelector("#signup-tab");
const feedList = document.querySelector("#feed-list");
const toast = document.querySelector("#toast");

let currentUser = null;
let authMode = "login";
let toastTimer;
let engagementServices = [];
let walletCurrency = "NGN";
let adminUsersPage = 1;
let adminOrdersPage = 1;
let adminTicketsPage = 1;

async function api(url, options = {}) {
  const response = await fetch(`/api${url}`, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2800);
}

function setAuthMode(mode) {
  const adminLogin = location.pathname.startsWith("/admin");
  if (adminLogin && mode === "signup") return;
  authMode = mode;
  const signup = mode === "signup";
  if (!adminLogin) {
    const path = signup ? "/signup" : "/login";
    if (location.pathname !== path) history.replaceState(null, "", path);
  }
  loginTab.classList.toggle("active", !signup);
  signupTab.classList.toggle("active", signup);
  loginTab.setAttribute("aria-selected", String(!signup));
  signupTab.setAttribute("aria-selected", String(signup));
  document.querySelector("#auth-tabs").hidden = adminLogin;
  signupTab.hidden = adminLogin;
  authScreen.classList.toggle("admin-auth", adminLogin);
  document.querySelector("#name-field").hidden = !signup;
  document.querySelector("#username-field").hidden = !signup;
  document.querySelector('[name="name"]').required = signup;
  document.querySelector('[name="username"]').required = signup;
  document.querySelector('[name="password"]').autocomplete = signup
    ? "new-password"
    : "current-password";
  document.querySelector("#auth-eyebrow").textContent = adminLogin
    ? "SECURE ADMINISTRATOR ACCESS"
    : signup
      ? "START YOUR SOCIAL GROWTH"
      : "YOUR SOCIAL GROWTH WORKSPACE";
  document.querySelector("#auth-title").textContent = adminLogin
    ? "Admin sign in."
    : signup
      ? "Create your account."
      : "Welcome back.";
  document.querySelector("#auth-subtitle").textContent = adminLogin
    ? "Sign in with your administrator email and password."
    : signup
      ? "Create your account and start your first campaign."
      : "Sign in to manage your campaigns and wallet.";
  document.querySelector("#auth-submit").innerHTML = adminLogin
    ? "Sign in to admin <span>→</span>"
    : signup
      ? "Create my account <span>→</span>"
      : "Sign in <span>→</span>";
  document.querySelector("#auth-route-prompt").textContent = adminLogin
    ? "Looking for your account?"
    : "Manage the platform?";
  const routeLink = document.querySelector("#auth-route-link");
  routeLink.href = adminLogin ? "/login" : "/admin/login";
  routeLink.textContent = adminLogin ? "Customer sign in" : "Administrator sign in";
  document.querySelector("#auth-art-eyebrow").textContent = adminLogin
    ? "SOCIALX OPERATIONS"
    : "SOCIAL GROWTH, MADE SIMPLE";
  document.querySelector("#auth-art-title").innerHTML = adminLogin
    ? "Your platform,<br>under control."
    : "Give good content<br>the reach it deserves.";
  document.querySelector("#auth-art-copy").textContent = adminLogin
    ? "Review paid engagement, monitor delivery, support customers and keep the operation running smoothly."
    : "Launch engagement campaigns across your favorite platforms, then track delivery and spend from one clear dashboard.";
  document.querySelector("#auth-art-footer").textContent = adminLogin
    ? "Authorized administrators only."
    : "One dashboard for every social boost.";
  document.title = adminLogin
    ? "Admin sign in — SocialX"
    : "SocialX — social growth, made simple";
  authMessage.textContent = "";
}

function initials(name) {
  return (name || "?").trim().charAt(0).toUpperCase();
}

function safeDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function enterApp(user) {
  currentUser = user;
  history.replaceState(
    null,
    "",
    `${user.isAdmin ? "/admin/dashboard" : "/dashboard"}${location.search}`,
  );
  authScreen.hidden = true;
  appShell.hidden = false;
  appShell.classList.toggle("admin-shell", user.isAdmin);
  document.querySelector("#app-shell .sidebar .brand").dataset.nav =
    user.isAdmin ? "admin" : "dashboard";
  document.querySelector("#sidebar-name").textContent = user.name;
  document.querySelector("#sidebar-username").textContent = `@${user.username}`;
  document.querySelector("#sidebar-avatar").textContent = initials(user.name);
  document.querySelector("#composer-avatar").textContent = initials(user.name);
  document.querySelector("#topbar-name").textContent = `Welcome back, ${user.name.split(" ")[0]}`;
  document.querySelector("#dashboard-name").textContent = user.name.split(" ")[0];
  document.querySelector("#admin-nav-group").hidden = !user.isAdmin;
  if (user.isAdmin) {
    document.querySelector("#admin-nav").click();
  } else {
    await Promise.all([
      loadFeed(),
      loadDiscover(),
      loadDashboard(),
      loadBilling(),
      loadWallet(),
    ]);
  }
  if (new URLSearchParams(location.search).get("payment") === "return") {
    await verifyPayment();
  }
}

function showAuth(adminLogin = location.pathname.startsWith("/admin")) {
  appShell.hidden = true;
  authScreen.hidden = false;
  currentUser = null;
  appShell.classList.remove("admin-shell");
  const signup = !adminLogin && location.pathname === "/signup";
  const path = adminLogin ? "/admin/login" : signup ? "/signup" : "/login";
  history.replaceState(null, "", path);
  setAuthMode(signup ? "signup" : "login");
}

async function loadFeed() {
  feedList.replaceChildren(element("div", "empty-state", "Loading your feed…"));
  try {
    const { posts } = await api("/feed");
    feedList.replaceChildren();
    if (!posts.length) {
      const empty = element("div", "empty-state");
      empty.append(element("b", "", "No posts yet"));
      empty.append(element("span", "", "Be the first to share an update with your community."));
      feedList.append(empty);
      return;
    }
    posts.forEach((post) => feedList.append(renderPost(post)));
  } catch (error) {
    feedList.replaceChildren(element("div", "empty-state", error.message));
  }
}

function renderPost(post) {
  const article = element("article", "panel post-card");
  article.dataset.postId = post.id;
  const head = element("div", "post-head");
  head.append(element("div", "avatar", initials(post.author.name)));
  const author = element("div", "post-author");
  const authorLine = element("div", "post-author-line");
  authorLine.append(element("b", "", post.author.name));
  if (post.author.isPro) authorLine.append(element("span", "post-pro", "PRO"));
  author.append(authorLine);
  const metadata = element("div");
  metadata.append(element("span", "post-username", `@${post.author.username}`));
  metadata.append(element("span", "post-time", ` · ${safeDate(post.createdAt)}`));
  author.append(metadata);
  head.append(author);
  article.append(head);
  article.append(element("p", "post-body", post.body));

  const actions = element("div", "post-actions");
  const like = element("button", `post-action${post.liked ? " liked" : ""}`);
  like.type = "button";
  like.dataset.action = "like";
  like.setAttribute("aria-pressed", String(post.liked));
  like.append(element("span", "", post.liked ? "♥" : "♡"));
  like.append(element("span", "like-count", `${post.likeCount} likes`));
  actions.append(like);
  const commentsButton = element("button", "post-action", `◌  ${post.commentCount} comments`);
  commentsButton.type = "button";
  commentsButton.dataset.action = "comments";
  actions.append(commentsButton);
  if (String(post.author.id) !== String(currentUser.id)) {
    const follow = element("button", "post-action follow-button", "Follow");
    follow.type = "button";
    follow.dataset.action = "follow";
    follow.dataset.userId = post.author.id;
    actions.append(follow);
  }
  article.append(actions);
  return article;
}

async function loadComments(postCard) {
  const postId = postCard.dataset.postId;
  let box = postCard.querySelector(".comment-box");
  if (box) {
    box.remove();
    return;
  }
  box = element("div", "comment-box");
  box.append(element("p", "muted-copy", "Loading replies…"));
  postCard.append(box);
  try {
    const { comments } = await api(`/posts/${encodeURIComponent(postId)}/comments`);
    box.replaceChildren();
    if (comments.length) {
      const list = element("div", "comment-list");
      comments.forEach((comment) => {
        const row = element("div", "comment-item");
        row.append(element("b", "", `@${comment.author.username}`));
        row.append(document.createTextNode(comment.body));
        list.append(row);
      });
      box.append(list);
    } else {
      box.append(element("p", "muted-copy", "Be the first to reply."));
    }
    const form = element("form", "comment-form");
    const input = document.createElement("input");
    input.name = "body";
    input.maxLength = 500;
    input.required = true;
    input.placeholder = "Add something kind…";
    input.setAttribute("aria-label", "Write a comment");
    const button = element("button", "", "Reply →");
    button.type = "submit";
    form.append(input, button);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      button.disabled = true;
      try {
        const result = await api(`/posts/${encodeURIComponent(postId)}/comments`, {
          method: "POST",
          body: JSON.stringify({ body: input.value }),
        });
        const listNode = box.querySelector(".comment-list") || element("div", "comment-list");
        const row = element("div", "comment-item");
        row.append(element("b", "", `@${result.comment.author.username}`));
        row.append(document.createTextNode(result.comment.body));
        listNode.append(row);
        if (!listNode.parentElement) box.prepend(listNode);
        const commentAction = postCard.querySelector('[data-action="comments"]');
        const count = Number.parseInt(commentAction.textContent.match(/\d+/)?.[0] || "0", 10) + 1;
        commentAction.textContent = `◌  ${count} comments`;
        input.value = "";
      } catch (error) {
        showToast(error.message);
      } finally {
        button.disabled = false;
      }
    });
    box.append(form);
  } catch (error) {
    box.replaceChildren(element("p", "muted-copy", error.message));
  }
}

async function loadDashboard() {
  try {
    const { orders, summary } = await api("/engagement/orders");
    document.querySelector("#stat-orders").textContent = Number(summary.total).toLocaleString();
    document.querySelector("#stat-active-orders").textContent = Number(summary.active).toLocaleString();
    document.querySelector("#stat-completed-orders").textContent = Number(summary.completed).toLocaleString();
    document.querySelector("#stat-spend").textContent = formatMoney(summary.spendMinor);
    const recent = document.querySelector("#dashboard-recent-orders");
    recent.replaceChildren();
    if (!orders.length) {
      recent.append(element("p", "muted-copy", "Your first boost will appear here once you place an order."));
    } else {
      orders.slice(0, 4).forEach((order) => {
        const item = element("div", "recent-post dashboard-order");
        const orderInfo = element("div", "dashboard-order-info");
        orderInfo.append(element("b", "", order.serviceName));
        orderInfo.append(element("span", "", `${Number(order.quantity).toLocaleString()} requested · ${safeDate(order.createdAt)}`));
        item.append(orderInfo);
        item.append(element("span", `order-status status-${order.status}`, order.status.replaceAll("_", " ")));
        recent.append(item);
      });
    }
  } catch (error) {
    showToast(error.message);
  }
}

async function loadDiscover() {
  const list = document.querySelector("#discover-list");
  try {
    const { users } = await api("/discover");
    list.replaceChildren();
    if (!users.length) {
      list.append(element("p", "muted-copy", "You’re all caught up. Invite someone new!"));
      return;
    }
    users.forEach((user) => {
      const row = element("div", "discover-person");
      row.append(element("div", "avatar", initials(user.name)));
      const info = element("div", "discover-info");
      info.append(element("b", "", user.name));
      info.append(element("span", "", `@${user.username}`));
      row.append(info);
      const button = element("button", "follow-button", "Follow");
      button.type = "button";
      button.dataset.action = "follow";
      button.dataset.userId = user.id;
      row.append(button);
      list.append(row);
    });
  } catch (error) {
    list.replaceChildren(element("p", "muted-copy", error.message));
  }
}

async function loadBilling() {
  try {
    const config = await api("/billing/config");
    const walletTopupAmount = document.querySelector("#wallet-topup-amount");
    const walletDivisor = 10 ** currencyDigits(config.currency);
    walletTopupAmount.min = String(config.walletMinimum / walletDivisor);
    walletTopupAmount.max = String(config.walletMaximum / walletDivisor);
    walletTopupAmount.step = String(1 / walletDivisor);
    document.querySelector("#wallet-topup-button").disabled = !config.paymentsEnabled;
  } catch (error) {
    document.querySelector("#wallet-topup-button").disabled = true;
    showToast(error.message);
  }
}

function formatMoney(minor, currency = walletCurrency) {
  const formatter = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  });
  const digits = formatter.resolvedOptions().maximumFractionDigits;
  return formatter.format(Number(minor) / 10 ** digits);
}

function currencyDigits(currency) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).resolvedOptions().maximumFractionDigits;
}

async function loadWallet() {
  try {
    const wallet = await api("/billing/wallet");
    walletCurrency = wallet.currency;
    document.querySelector("#wallet-currency").textContent = wallet.currency;
    document.querySelectorAll("#wallet-balance, #dashboard-balance").forEach((balance) => {
      balance.textContent = formatMoney(wallet.balanceMinor, wallet.currency);
    });
    document.querySelectorAll(".currency-copy").forEach((currency) => {
      currency.textContent = wallet.currency;
    });
    const transactions = document.querySelector("#wallet-transactions");
    transactions.replaceChildren();
    if (!wallet.transactions.length) {
      transactions.append(element("p", "muted-copy", "No wallet transactions yet."));
    }
    wallet.transactions.forEach((transaction) => {
      const row = element("div", "wallet-transaction");
      const direction = transaction.kind === "topup" || transaction.kind === "order_refund"
        ? "+"
        : "−";
      const label = transaction.kind.replaceAll("_", " ");
      row.append(element("span", "", `${label} · ${safeDate(transaction.createdAt)}`));
      row.append(element("b", direction === "+" ? "transaction-credit" : "transaction-debit",
        `${direction}${formatMoney(Math.abs(transaction.amountMinor), transaction.currency)}`));
      transactions.append(row);
    });
  } catch (error) {
    document.querySelectorAll("#wallet-balance, #dashboard-balance").forEach((balance) => {
      balance.textContent = "Unavailable";
    });
    document.querySelector("#wallet-message").textContent = error.message;
  }
}

function selectedEngagementService() {
  const serviceId = document.querySelector("#engagement-service").value;
  return engagementServices.find((service) => service.id === serviceId);
}

function updateEngagementForm() {
  const service = selectedEngagementService();
  const submit = document.querySelector("#engagement-submit");
  const quantity = document.querySelector("#engagement-quantity");
  const dripfeedFields = document.querySelector("#dripfeed-fields");
  const runs = document.querySelector("#engagement-runs");
  const interval = document.querySelector("#engagement-interval");
  dripfeedFields.hidden = !service?.dripfeed;
  runs.required = false;
  interval.required = false;
  if (service) {
    quantity.min = service.min;
    quantity.max = service.max;
  } else {
    quantity.removeAttribute("min");
    quantity.removeAttribute("max");
  }
  const count = Number(quantity.value);
  if (
    !service ||
    !Number.isSafeInteger(count) ||
    count < service.min ||
    count > service.max ||
    service.pricePerThousandMinor === null
  ) {
    document.querySelector("#engagement-estimate").textContent = "—";
    submit.disabled = !service || service.pricePerThousandMinor === null;
    return;
  }
  const estimatedMinor = Math.ceil(service.pricePerThousandMinor * count / 1000);
  document.querySelector("#engagement-estimate").textContent =
    formatMoney(estimatedMinor, walletCurrency);
  submit.disabled = false;
}

async function loadServices() {
  const select = document.querySelector("#engagement-service");
  select.replaceChildren(new Option("Loading services…", ""));
  try {
    const result = await api("/engagement/services");
    engagementServices = result.services;
    walletCurrency = result.currency;
    select.replaceChildren(new Option("Choose a service", ""));
    result.services.forEach((service) => {
      const price = service.pricePerThousandMinor === null
        ? ""
        : ` · ${formatMoney(service.pricePerThousandMinor, result.currency)}/1,000`;
      select.append(new Option(`${service.name}${price}`, service.id));
    });
    document.querySelector("#engagement-submit").disabled = !result.pricingEnabled;
    document.querySelector("#engagement-message").textContent = result.pricingEnabled
      ? ""
      : "Order pricing is not configured by the administrator yet.";
    updateEngagementForm();
  } catch (error) {
    engagementServices = [];
    select.replaceChildren(new Option("Services unavailable", ""));
    document.querySelector("#engagement-submit").disabled = true;
    document.querySelector("#engagement-message").textContent = error.message;
  }
}

function renderEngagementOrders(orders) {
  const container = document.querySelector("#engagement-orders");
  container.replaceChildren();
  if (!orders.length) {
    container.append(element("p", "muted-copy", "No orders yet."));
    return;
  }
  orders.forEach((order) => {
    const card = element("article", "engagement-order");
    const detail = document.createElement("div");
    detail.append(element("strong", "", order.serviceName));
    detail.append(element("div", "order-meta", `${order.quantity} requested · ${formatMoney(order.chargeMinor, order.currency)} · ${order.status.replace("_", " ")}`));
    detail.append(element("div", "order-meta", order.link));
    if (order.remains !== null) {
      detail.append(element("div", "order-meta", `Remaining: ${order.remains} · Started at: ${order.startCount ?? "—"}`));
    }
    if (order.refillId) {
      detail.append(element("div", "order-meta", `Refill: ${order.refillStatus || "Pending"}`));
    }
    card.append(detail);
    const actions = element("div", "order-actions");
    if (order.providerOrderId) {
      const refresh = element("button", "", "Check status");
      refresh.type = "button";
      refresh.dataset.orderAction = "refresh";
      refresh.dataset.orderId = order.id;
      actions.append(refresh);
    }
    if (["pending", "in_progress"].includes(order.status)) {
      const cancel = element("button", "", "Cancel");
      cancel.type = "button";
      cancel.dataset.orderAction = "cancel";
      cancel.dataset.orderId = order.id;
      actions.append(cancel);
    }
    if (order.refillAvailable && order.status === "completed" && !order.refillId) {
      const refill = element("button", "", "Request refill");
      refill.type = "button";
      refill.dataset.orderAction = "refill";
      refill.dataset.orderId = order.id;
      actions.append(refill);
    }
    if (order.refillId) {
      const refillStatus = element("button", "", "Check refill");
      refillStatus.type = "button";
      refillStatus.dataset.orderAction = "refill-status";
      refillStatus.dataset.orderId = order.id;
      actions.append(refillStatus);
    }
    card.append(actions);
    container.append(card);
  });
}

async function loadEngagementOrders() {
  try {
    const { orders } = await api("/engagement/orders");
    renderEngagementOrders(orders);
  } catch (error) {
    document.querySelector("#engagement-orders").replaceChildren(
      element("p", "muted-copy", error.message),
    );
  }
}

function ticketStatusLabel(status) {
  return {
    open: "Open",
    in_progress: "In progress",
    resolved: "Resolved",
  }[status] || status;
}

function renderSupportTicket(ticket, adminView = false) {
  const card = element("article", `support-ticket${adminView ? " admin-support-ticket" : ""}`);
  const heading = element("div", "support-ticket-heading");
  const title = document.createElement("div");
  title.append(element("h3", "", ticket.subject));
  const details = [
    ticket.category.replaceAll("_", " "),
    `Updated ${safeDate(ticket.updatedAt)}`,
  ];
  if (ticket.user) details.unshift(`${ticket.user.name} · ${ticket.user.email}`);
  title.append(element("p", "ticket-metadata", details.join(" · ")));
  heading.append(title);
  heading.append(element("span", `ticket-status status-${ticket.status}`, ticketStatusLabel(ticket.status)));
  card.append(heading);

  const messages = element("div", "ticket-messages");
  ticket.messages.forEach((message) => {
    const bubble = element("div", `ticket-message${message.isAdmin ? " staff-message" : ""}`);
    const messageHeader = element("div", "ticket-message-heading");
    messageHeader.append(element(
      "b",
      "",
      message.isAdmin ? "SocialX support" : message.authorName,
    ));
    messageHeader.append(element("time", "", safeDate(message.createdAt)));
    bubble.append(messageHeader, element("p", "", message.body));
    messages.append(bubble);
  });
  card.append(messages);

  const form = element("form", "ticket-reply-form");
  form.dataset.ticketId = ticket.id;
  const input = document.createElement("textarea");
  input.name = "message";
  input.rows = 2;
  input.maxLength = 4000;
  input.required = true;
  input.placeholder = adminView ? "Write a reply to the customer…" : "Reply to this ticket…";
  input.setAttribute("aria-label", input.placeholder);
  const submit = element(
    "button",
    "button button-primary",
    "Send reply",
  );
  submit.type = "submit";
  form.append(input, submit);
  card.append(form);

  if (adminView) {
    const statusButton = element(
      "button",
      "ticket-status-action",
      ticket.status === "resolved" ? "Reopen ticket" : "Mark resolved",
    );
    statusButton.type = "button";
    statusButton.dataset.ticketStatus = ticket.status === "resolved" ? "open" : "resolved";
    statusButton.dataset.ticketId = ticket.id;
    card.append(statusButton);
  }
  return card;
}

async function loadSupportTickets() {
  const list = document.querySelector("#support-tickets");
  list.replaceChildren(element("p", "muted-copy", "Loading your support requests…"));
  try {
    const { tickets } = await api("/support/tickets");
    list.replaceChildren();
    if (!tickets.length) {
      list.append(element("div", "ticket-empty-state", "You haven’t opened a support ticket yet."));
      return;
    }
    tickets.forEach((ticket) => list.append(renderSupportTicket(ticket)));
  } catch (error) {
    list.replaceChildren(element("p", "muted-copy", error.message));
  }
}

async function refreshEngagementOrder(orderId, action = "refresh") {
  const suffix = action === "refresh"
    ? ""
    : action === "refill-status"
      ? "/refill"
      : `/${action}`;
  const route = `/engagement/orders/${encodeURIComponent(orderId)}${suffix}`;
  const options = action === "refresh" || action === "refill-status"
    ? {}
    : { method: "POST" };
  await api(route, options);
  await Promise.all([loadEngagementOrders(), loadWallet(), loadDashboard()]);
}

async function loadAdminUsers() {
  const tbody = document.querySelector("#admin-users");
  try {
    const { users, total } = await api(`/admin/users?page=${adminUsersPage}`);
    tbody.replaceChildren();
    users.forEach((user) => {
      const row = document.createElement("tr");
      [
        `${user.name} (@${user.username})`,
        user.email,
        formatMoney(user.walletBalanceMinor || 0, walletCurrency),
        safeDate(user.createdAt),
      ].forEach((value) => row.append(element("td", "", value)));
      tbody.append(row);
    });
    if (!users.length) {
      const row = document.createElement("tr");
      row.append(element("td", "", "No customers found."));
      tbody.append(row);
    }
    const lastPage = Math.max(1, Math.ceil(total / 50));
    document.querySelector("#admin-users-page").textContent =
      `Page ${adminUsersPage} of ${lastPage}`;
    document.querySelector("#admin-users-previous").disabled = adminUsersPage <= 1;
    document.querySelector("#admin-users-next").disabled = adminUsersPage >= lastPage;
  } catch (error) {
    const row = document.createElement("tr");
    row.append(element("td", "", error.message));
    tbody.replaceChildren(row);
  }
}

async function loadAdminOverview() {
  try {
    const overview = await api("/admin/overview");
    document.querySelector("#admin-stat-users").textContent =
      Number(overview.totalUsers).toLocaleString();
    document.querySelector("#admin-stat-orders").textContent =
      Number(overview.totalOrders).toLocaleString();
    document.querySelector("#admin-stat-active").textContent =
      Number(overview.activeOrders).toLocaleString();
    document.querySelector("#admin-stat-tickets").textContent =
      Number(overview.openTickets).toLocaleString();

    const statusList = document.querySelector("#admin-status-breakdown");
    statusList.replaceChildren();
    const statusTotal = Math.max(1, overview.totalOrders);
    if (!overview.statuses.length) {
      statusList.append(element("p", "muted-copy", "Paid campaigns will appear here."));
    } else {
      overview.statuses.forEach(({ status, count }) => {
        const row = element("div", "admin-breakdown-row");
        const label = element("span", "admin-breakdown-label");
        label.append(element("b", "", status.replaceAll("_", " ")));
        label.append(element("small", "", Number(count).toLocaleString()));
        const track = element("span", "admin-breakdown-track");
        const bar = element("span", "admin-breakdown-bar");
        bar.style.width = `${Math.max(4, (count / statusTotal) * 100)}%`;
        track.append(bar);
        row.append(label, track);
        statusList.append(row);
      });
    }

    const servicesList = document.querySelector("#admin-service-breakdown");
    servicesList.replaceChildren();
    if (!overview.topServices.length) {
      servicesList.append(element("p", "muted-copy", "No engagement orders yet."));
    } else {
      const maxCount = Math.max(...overview.topServices.map((service) => service.count));
      overview.topServices.forEach((service) => {
        const row = element("div", "admin-breakdown-row");
        const label = element("span", "admin-breakdown-label");
        label.append(element("b", "", service.serviceName));
        label.append(element("small", "", Number(service.count).toLocaleString()));
        const track = element("span", "admin-breakdown-track");
        const bar = element("span", "admin-breakdown-bar service-breakdown-bar");
        bar.style.width = `${Math.max(4, (service.count / maxCount) * 100)}%`;
        track.append(bar);
        row.append(label, track);
        servicesList.append(row);
      });
    }

    const recentOrders = document.querySelector("#admin-recent-orders");
    recentOrders.replaceChildren();
    if (!overview.recentOrders.length) {
      const row = document.createElement("tr");
      const cell = element("td", "muted-copy", "No paid engagement orders yet.");
      cell.colSpan = 5;
      row.append(cell);
      recentOrders.append(row);
    } else {
      overview.recentOrders.forEach((order) => {
        const row = document.createElement("tr");
        const customer = order.user ? `${order.user.name} · ${order.user.email}` : "Deleted account";
        const service = document.createElement("td");
        service.append(element("b", "", order.serviceName));
        service.append(element("div", "order-meta", order.link));
        row.append(
          element("td", "", customer),
          service,
          element("td", "", Number(order.quantity).toLocaleString()),
        );
        const statusCell = document.createElement("td");
        statusCell.append(element("span", `order-status status-${order.status}`, order.status.replaceAll("_", " ")));
        row.append(statusCell, element("td", "", formatMoney(order.chargeMinor, order.currency)));
        recentOrders.append(row);
      });
    }

    const ticketPreview = document.querySelector("#admin-overview-tickets");
    const [open, inProgress] = await Promise.all([
      api("/admin/tickets?page=1&status=open"),
      api("/admin/tickets?page=1&status=in_progress"),
    ]);
    const priorityTickets = [...open.tickets, ...inProgress.tickets]
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      .slice(0, 3);
    ticketPreview.replaceChildren();
    if (!priorityTickets.length) {
      ticketPreview.append(element("div", "ticket-empty-state", "No open customer support tickets."));
    } else {
      priorityTickets.forEach((ticket) => {
        ticketPreview.append(renderSupportTicket(ticket, true));
      });
    }
  } catch (error) {
    showToast(`Could not load admin overview: ${error.message}`);
  }
}

async function loadAdminOrders() {
  const tbody = document.querySelector("#admin-orders");
  try {
    const { orders, total } = await api(`/admin/orders?page=${adminOrdersPage}`);
    tbody.replaceChildren();
    orders.forEach((order) => {
      const row = document.createElement("tr");
      const user = order.user ? `${order.user.name} (${order.user.email})` : "Deleted account";
      const service = document.createElement("td");
      service.append(element("b", "", order.serviceName));
      service.append(element("div", "order-meta", order.link));
      const status = document.createElement("td");
      status.append(element("span", "", `${order.status.replace("_", " ")}${order.providerStatus ? ` · ${order.providerStatus}` : ""}`));
      if (order.providerOrderId && !["completed", "canceled", "failed"].includes(order.status)) {
        const refresh = element("button", "admin-order-refresh", "Refresh status");
        refresh.type = "button";
        refresh.dataset.adminRefreshOrder = order.id;
        status.append(document.createElement("br"), refresh);
      }
      row.append(element("td", "", user));
      row.append(service);
      row.append(element("td", "", String(order.quantity)));
      row.append(status);
      row.append(element("td", "", `${formatMoney(order.chargeMinor, order.currency)} / ${formatMoney(order.refundedMinor, order.currency)} refunded`));
      row.append(element("td", "", safeDate(order.createdAt)));
      tbody.append(row);
    });
    if (!orders.length) {
      const row = document.createElement("tr");
      row.append(element("td", "", "No orders found."));
      tbody.append(row);
    }
    const lastPage = Math.max(1, Math.ceil(total / 50));
    document.querySelector("#admin-orders-page").textContent =
      `Page ${adminOrdersPage} of ${lastPage}`;
    document.querySelector("#admin-orders-previous").disabled = adminOrdersPage <= 1;
    document.querySelector("#admin-orders-next").disabled = adminOrdersPage >= lastPage;
  } catch (error) {
    const row = document.createElement("tr");
    row.append(element("td", "", error.message));
    tbody.replaceChildren(row);
  }
}

async function loadAdminTickets() {
  const list = document.querySelector("#admin-tickets");
  const filter = document.querySelector("#admin-ticket-filter").value;
  list.replaceChildren(element("p", "muted-copy", "Loading support tickets…"));
  try {
    const query = new URLSearchParams({
      page: String(adminTicketsPage),
      status: filter,
    });
    const { tickets, total } = await api(`/admin/tickets?${query}`);
    list.replaceChildren();
    if (!tickets.length) {
      list.append(element("div", "ticket-empty-state", "No tickets match this view."));
    } else {
      tickets.forEach((ticket) => list.append(renderSupportTicket(ticket, true)));
    }
    const lastPage = Math.max(1, Math.ceil(total / 50));
    document.querySelector("#admin-tickets-page").textContent =
      `Page ${adminTicketsPage} of ${lastPage}`;
    document.querySelector("#admin-tickets-previous").disabled = adminTicketsPage <= 1;
    document.querySelector("#admin-tickets-next").disabled = adminTicketsPage >= lastPage;
  } catch (error) {
    list.replaceChildren(element("p", "muted-copy", error.message));
  }
}

async function loadProviderBalance() {
  const balanceElement = document.querySelector("#provider-balance");
  try {
    const balance = await api("/admin/provider-balance");
    balanceElement.textContent = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: balance.currency,
    }).format(balance.balance);
  } catch (error) {
    balanceElement.textContent = error.message;
  }
}

async function verifyPayment() {
  const reference = localStorage.getItem("socialx_payment_reference");
  const message = document.querySelector("#payment-message");
  if (!reference) {
    message.textContent = "We couldn’t find your payment reference. Please contact support if you were charged.";
    return;
  }
  message.textContent = "Checking your payment securely…";
  try {
    const result = await api("/billing/verify", {
      method: "POST",
      body: JSON.stringify({ reference }),
    });
    if (result.status === "success") {
      localStorage.removeItem("socialx_payment_reference");
      message.textContent = "";
      if (result.purpose === "wallet") {
        showToast("Your wallet top-up is confirmed.");
        await loadWallet();
      } else {
        currentUser.isPro = true;
        showToast("You’re SocialX Pro. Thanks for your support!");
        await loadBilling();
      }
    } else {
      message.textContent = "Payment is not confirmed yet. You can try again in a moment.";
    }
  } catch (error) {
    message.textContent = error.message;
  }
}

loginTab.addEventListener("click", () => setAuthMode("login"));
signupTab.addEventListener("click", () => setAuthMode("signup"));

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authMessage.textContent = "";
  const data = Object.fromEntries(new FormData(authForm).entries());
  const button = document.querySelector("#auth-submit");
  button.disabled = true;
  try {
    const result = await api(`/auth/${authMode}`, {
      method: "POST",
      body: JSON.stringify(data),
    });
    if (location.pathname.startsWith("/admin") && !result.user.isAdmin) {
      await api("/auth/logout", { method: "POST" });
      throw new Error("This account does not have administrator access.");
    }
    await enterApp(result.user);
  } catch (error) {
    authMessage.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  const wasAdmin = Boolean(currentUser?.isAdmin);
  try {
    await api("/auth/logout", { method: "POST" });
    showAuth(wasAdmin);
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#wallet-topup-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = document.querySelector("#wallet-topup-button");
  const message = document.querySelector("#wallet-message");
  const amount = Number(document.querySelector("#wallet-topup-amount").value);
  const amountMinor = Math.round(amount * 10 ** currencyDigits(walletCurrency));
  message.textContent = "";
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 1) {
    message.textContent = "Enter a valid top-up amount.";
    return;
  }
  button.disabled = true;
  try {
    const checkout = await api("/billing/wallet/checkout", {
      method: "POST",
      body: JSON.stringify({ amount: amountMinor }),
    });
    localStorage.setItem("socialx_payment_reference", checkout.reference);
    location.assign(checkout.checkoutUrl);
  } catch (error) {
    message.textContent = error.message;
    button.disabled = false;
  }
});

document.querySelector("#engagement-service").addEventListener("change", updateEngagementForm);
document.querySelector("#engagement-quantity").addEventListener("input", updateEngagementForm);

document.querySelector("#engagement-order-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = document.querySelector("#engagement-submit");
  const message = document.querySelector("#engagement-message");
  const service = selectedEngagementService();
  if (!service) {
    message.textContent = "Choose a service first.";
    return;
  }
  const body = {
    serviceId: service.id,
    link: document.querySelector("#engagement-link").value.trim(),
    quantity: Number(document.querySelector("#engagement-quantity").value),
  };
  const runs = document.querySelector("#engagement-runs").value;
  const interval = document.querySelector("#engagement-interval").value;
  if (runs || interval) {
    if (!runs || !interval || !service.dripfeed) {
      message.textContent = "For drip-feed, provide both runs and interval on an eligible service.";
      return;
    }
    body.runs = Number(document.querySelector("#engagement-runs").value);
    body.interval = Number(document.querySelector("#engagement-interval").value);
  }
  button.disabled = true;
  message.textContent = "";
  try {
    await api("/engagement/orders", {
      method: "POST",
      body: JSON.stringify(body),
    });
    message.textContent = "Order submitted. You can track its status below.";
    await Promise.all([loadWallet(), loadEngagementOrders(), loadDashboard()]);
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = !service.pricePerThousandMinor;
  }
});

document.querySelector("#engagement-orders").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-order-action]");
  if (!button) return;
  const action = button.dataset.orderAction;
  if (action === "cancel" && !window.confirm("Cancel this order? The provider must accept the request before any refund is confirmed.")) return;
  button.disabled = true;
  try {
    await refreshEngagementOrder(button.dataset.orderId, action);
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#support-ticket-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = document.querySelector("#support-submit");
  const message = document.querySelector("#support-form-message");
  button.disabled = true;
  message.textContent = "";
  try {
    await api("/support/tickets", {
      method: "POST",
      body: JSON.stringify({
        category: document.querySelector("#support-category").value,
        subject: document.querySelector("#support-subject").value,
        message: document.querySelector("#support-message").value,
      }),
    });
    form.reset();
    message.textContent = "Ticket submitted. You can follow replies below.";
    await loadSupportTickets();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

async function submitTicketReply(form, adminView) {
  const ticketId = form.dataset.ticketId;
  const button = form.querySelector("button");
  const input = form.elements.message;
  button.disabled = true;
  try {
    await api(
      `${adminView ? "/admin" : "/support"}/tickets/${encodeURIComponent(ticketId)}/messages`,
      {
        method: "POST",
        body: JSON.stringify({ message: input.value }),
      },
    );
    if (adminView) await Promise.all([loadAdminTickets(), loadAdminOverview()]);
    else await loadSupportTickets();
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
}

document.querySelector("#support-tickets").addEventListener("submit", async (event) => {
  const form = event.target.closest(".ticket-reply-form");
  if (!form) return;
  event.preventDefault();
  await submitTicketReply(form, false);
});

document.querySelector("#admin-tickets").addEventListener("submit", async (event) => {
  const form = event.target.closest(".ticket-reply-form");
  if (!form) return;
  event.preventDefault();
  await submitTicketReply(form, true);
});

document.querySelector("#admin-tickets").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-ticket-status]");
  if (!button) return;
  button.disabled = true;
  try {
    await api(`/admin/tickets/${encodeURIComponent(button.dataset.ticketId)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: button.dataset.ticketStatus }),
    });
    await Promise.all([loadAdminTickets(), loadAdminOverview()]);
  } catch (error) {
    showToast(error.message);
    button.disabled = false;
  }
});

document.querySelector("#reload-services").addEventListener("click", loadServices);
document.querySelector("#reload-orders").addEventListener("click", loadEngagementOrders);
document.querySelector("#reload-support-tickets").addEventListener("click", loadSupportTickets);
document.querySelector("#reload-admin-users").addEventListener("click", loadAdminUsers);
document.querySelector("#reload-admin-orders").addEventListener("click", loadAdminOrders);
document.querySelector("#reload-admin-tickets").addEventListener("click", loadAdminTickets);
document.querySelector("#reload-provider-balance").addEventListener("click", loadProviderBalance);
document.querySelector("#admin-ticket-filter").addEventListener("change", () => {
  adminTicketsPage = 1;
  loadAdminTickets();
});
document.querySelector("#admin-orders").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-admin-refresh-order]");
  if (!button) return;
  button.disabled = true;
  try {
    await api(`/admin/orders/${encodeURIComponent(button.dataset.adminRefreshOrder)}/refresh`, {
      method: "POST",
    });
    await Promise.all([loadAdminOrders(), loadAdminUsers()]);
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
});
document.querySelector("#admin-users-previous").addEventListener("click", () => {
  adminUsersPage = Math.max(1, adminUsersPage - 1);
  loadAdminUsers();
});
document.querySelector("#admin-users-next").addEventListener("click", () => {
  adminUsersPage += 1;
  loadAdminUsers();
});
document.querySelector("#admin-orders-previous").addEventListener("click", () => {
  adminOrdersPage = Math.max(1, adminOrdersPage - 1);
  loadAdminOrders();
});
document.querySelector("#admin-orders-next").addEventListener("click", () => {
  adminOrdersPage += 1;
  loadAdminOrders();
});
document.querySelector("#admin-tickets-previous").addEventListener("click", () => {
  adminTicketsPage = Math.max(1, adminTicketsPage - 1);
  loadAdminTickets();
});
document.querySelector("#admin-tickets-next").addEventListener("click", () => {
  adminTicketsPage += 1;
  loadAdminTickets();
});

document.querySelector("#post-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const textarea = form.elements.body;
  const button = form.querySelector("button");
  if (!textarea.value.trim()) return;
  button.disabled = true;
  try {
    const { post } = await api("/posts", {
      method: "POST",
      body: JSON.stringify({ body: textarea.value }),
    });
    textarea.value = "";
    feedList.prepend(renderPost(post));
    showToast("Your thought is out there.");
    await loadDashboard();
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
});

feedList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const postCard = button.closest(".post-card");
  try {
    if (button.dataset.action === "like") {
      button.disabled = true;
      const liked = button.getAttribute("aria-pressed") !== "true";
      const result = await api(`/posts/${encodeURIComponent(postCard.dataset.postId)}/like`, {
        method: "PUT",
        body: JSON.stringify({ liked }),
      });
      button.classList.toggle("liked", result.liked);
      button.setAttribute("aria-pressed", String(result.liked));
      button.querySelector("span").textContent = result.liked ? "♥" : "♡";
      button.querySelector(".like-count").textContent = `${result.likeCount} likes`;
      await loadDashboard();
    } else if (button.dataset.action === "comments") {
      await loadComments(postCard);
    } else if (button.dataset.action === "follow") {
      await api(`/users/${encodeURIComponent(button.dataset.userId)}/follow`, {
        method: "PUT",
        body: JSON.stringify({ following: true }),
      });
      button.remove();
      showToast("You’re following someone new.");
      await Promise.all([loadDiscover(), loadDashboard()]);
    }
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#discover-list").addEventListener("click", async (event) => {
  const button = event.target.closest('[data-action="follow"]');
  if (!button) return;
  button.disabled = true;
  try {
    await api(`/users/${encodeURIComponent(button.dataset.userId)}/follow`, {
      method: "PUT",
      body: JSON.stringify({ following: true }),
    });
    await Promise.all([loadDiscover(), loadDashboard()]);
    showToast("You’re following someone new.");
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
});

document.querySelectorAll("[data-nav]").forEach((button) => {
  button.addEventListener("click", (event) => {
    event.preventDefault();
    const destination = button.dataset.nav;
    const adminDestination = destination.startsWith("admin");
    if (currentUser?.isAdmin && !adminDestination) return;
    if (adminDestination && !currentUser?.isAdmin) return;
    const views = {
      feed: ["#feed-view", "Home feed", "COMMUNITY"],
      dashboard: ["#dashboard-view", "Overview", "ACCOUNT"],
      wallet: ["#wallet-view", "Wallet & payments", "ACCOUNT FINANCES"],
      orders: ["#orders-view", "My orders", "ORDER MANAGEMENT"],
      marketplace: ["#marketplace-view", "Services", "SERVICE CATALOG"],
      support: ["#support-view", "Support tickets", "CUSTOMER CARE"],
      admin: ["#admin-view", "Business overview", "SOCIALX OPERATIONS"],
      "admin-orders": ["#admin-view", "Engagement orders", "FULFILLMENT"],
      "admin-support": ["#admin-view", "Support inbox", "CUSTOMER CARE"],
      "admin-users": ["#admin-view", "Customers", "ACCOUNT DIRECTORY"],
    };
    if (!views[destination]) return;
    document.querySelectorAll(".primary-column[id]").forEach((view) => {
      view.hidden = view.id !== views[destination][0].slice(1);
    });
    document.querySelector("#page-title").textContent = views[destination][1];
    document.querySelector("#page-context").textContent = views[destination][2];
    document.querySelector("#admin-heading").textContent = views[destination][1];
    document.querySelector("#admin-subheading").textContent = destination === "admin"
      ? "Monitor customers, paid engagement and support from one place."
      : destination === "admin-orders"
        ? "Review every paid service, delivery status and customer target."
        : destination === "admin-support"
          ? "Reply to customer questions and resolve order complaints."
          : destination === "admin-users"
            ? "Review registered accounts and their moneybox balances."
            : "";
    document.querySelectorAll(".admin-section").forEach((section) => {
      section.hidden = section.id !== `admin-${destination.replace("admin-", "")}-section` &&
        !(destination === "admin" && section.id === "admin-overview-section");
    });
    document.querySelector("#community-sidebar").hidden = destination !== "feed";
    document.querySelectorAll(".nav-item").forEach((item) => {
      item.classList.toggle(
        "active",
        item.dataset.nav === destination ||
          (destination === "dashboard" && item.dataset.nav === "dashboard"),
      );
    });
    if (destination === "dashboard") Promise.all([loadDashboard(), loadWallet()]);
    if (destination === "wallet") loadWallet();
    if (destination === "orders") loadEngagementOrders();
    if (destination === "marketplace") loadServices();
    if (destination === "support") loadSupportTickets();
    if (destination === "admin") {
      Promise.all([loadAdminOverview(), loadProviderBalance()]);
    }
    if (destination === "admin-orders") {
      Promise.all([loadAdminOrders(), loadAdminOverview()]);
    }
    if (destination === "admin-support") {
      Promise.all([loadAdminTickets(), loadAdminOverview()]);
    }
    if (destination === "admin-users") {
      Promise.all([loadAdminUsers(), loadAdminOverview()]);
    }
  });
});

async function initialize() {
  try {
    const { user } = await api("/auth/me");
    if (location.pathname.startsWith("/admin") && !user.isAdmin) {
      try {
        await api("/auth/logout", { method: "POST" });
      } catch (error) {
        showAuth(true);
        authMessage.textContent = `Please sign in with an administrator account. ${error.message}`;
        return;
      }
      showAuth(true);
      authMessage.textContent = "This account does not have administrator access.";
      return;
    }
    await enterApp(user);
  } catch {
    showAuth();
  }
}

initialize();
