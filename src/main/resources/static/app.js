const app = document.querySelector("#app");
const themeToggle = document.querySelector("#themeToggle");
const themeToggleLabel = document.querySelector("#themeToggleLabel");
const navLinks = [...document.querySelectorAll(".primary-nav a")];

const MUTUAL_FUNDS_STORAGE_KEY = "veswa009-mutual-funds-v3";
const FIREBASE_CONFIG = {
    apiKey: "",
    authDomain: "veswa009portfolio.firebaseapp.com",
    projectId: "veswa009portfolio",
    storageBucket: "veswa009portfolio.appspot.com",
    messagingSenderId: "",
    appId: ""
};
let firestore = null;
const USE_REMOTE_STORAGE = false;
const BACKUP_VERSION = "1.0";
const MUTUAL_FUND_SORTABLE_FIELDS = ["type", "year", "navDate", "amount"];
const DEFAULT_MUTUAL_FUND_SORT = { field: "navDate", direction: "asc" };

const moneyFormatter = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
});
const dateFormatter = new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "2-digit"
});
const timeFormatter = new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
});

const state = {
    route: routeFromLocation(),
    mutualFunds: loadMutualFunds(),
    expandedFundId: null,
    editingEntryId: null,
    mutualFundSort: { ...DEFAULT_MUTUAL_FUND_SORT },
    unsavedChanges: false,
    editingBondId: null,
    bonds: loadBonds()
};

const PAGE_PIN = "009009";

initTheme();
initFirebase();
bindNavigation();
bindManualInputs();
startClock();
render();

function initTheme() {
    const theme = document.documentElement.dataset.theme || "dark";
    updateThemeButton(theme);

    themeToggle.addEventListener("click", () => {
        const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
        const next = current === "dark" ? "light" : "dark";
        document.documentElement.dataset.theme = next;
        localStorage.setItem("portfolio-theme", next);
        updateThemeButton(next);
    });
}


function updateThemeButton(theme) {
    themeToggleLabel.textContent = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
    themeToggle.setAttribute("aria-pressed", String(theme === "dark"));
}

function initFirebase() {
    if (!FIREBASE_CONFIG.apiKey || !FIREBASE_CONFIG.appId) {
        console.warn("Firebase configuration is incomplete. Remote storage disabled.");
        return;
    }

    try {
        firebase.initializeApp(FIREBASE_CONFIG);
        firestore = firebase.firestore();

        loadRemoteMutualFunds().then((remoteData) => {
            if (remoteData && Array.isArray(remoteData.funds)) {
                state.mutualFunds = normalizePortfolioData(remoteData);
                render();
            }
        }).catch((error) => {
            console.warn("Failed to load remote portfolio data:", error);
        });
    } catch (error) {
        console.warn("Firebase initialization failed:", error);
    }
}

async function loadRemoteMutualFunds() {
    if (!firestore) {
        return null;
    }

    try {
        const doc = await firestore.collection("portfolios").doc("default").get();
        if (!doc.exists) {
            return null;
        }
        return doc.data()?.mutualFunds || null;
    } catch (error) {
        console.warn("Failed to fetch remote portfolio data:", error);
        return null;
    }
}

function bindNavigation() {
    document.addEventListener("click", (event) => {
        const link = event.target.closest("a[data-link]");
        if (!link || link.origin !== window.location.origin) {
            return;
        }

        event.preventDefault();

        if (link.hash.startsWith("#/")) {
            window.location.hash = link.hash;
            state.route = routeFromLocation();
            render();
            window.scrollTo({ top: 0, behavior: "smooth" });
            return;
        }

        window.history.pushState({}, "", link.pathname);
        state.route = routeFromLocation();
        render();
        window.scrollTo({ top: 0, behavior: "smooth" });
    });

    window.addEventListener("hashchange", () => {
        state.route = routeFromLocation();
        render();
    });

    window.addEventListener("popstate", () => {
        state.route = routeFromLocation();
        render();
    });
}

function bindManualInputs() {
    document.addEventListener("input", (event) => {
        const mfInput = event.target.closest("[data-mf-input]");
        const bondInput = event.target.closest("[data-bond-input]");
        if (mfInput) {
            const input = mfInput;
            const fund = findFund(input.dataset.fundId);
            const entry = fund?.entries.find((item) => item.id === input.dataset.entryId);
            if (!entry || !["year", "navDate", "amount", "notes"].includes(input.dataset.field)) {
                return;
            }

            let value = input.value;
            if (input.dataset.field === "amount") {
                value = value.replace(/[^0-9.]/g, "");
                const parts = value.split(".").slice(0, 2);
                value = parts[0] + (parts[1] ? "." + parts[1].slice(0, 2) : "");
                input.value = value;
            }

            entry[input.dataset.field] = value;
            state.unsavedChanges = true;
            renderInlineTotals(fund);
            updateMutualFundSaveState("Unsaved changes");
            return;
        }

        if (bondInput) {
            const input = bondInput;
            const id = input.dataset.entryId;
            const entry = state.bonds.entries.find((e) => e.id === id);
            if (!entry) return;
            if (state.editingBondId !== id) return;
            const field = input.dataset.field;
            let value = input.value;
            if (field === "units" || field === "months") {
                value = value.replace(/[^0-9]/g, "");
                input.value = value;
            } else if (["interest", "yield", "price"].includes(field)) {
                value = value.replace(/[^0-9.]/g, '');
                const parts = value.split('.').slice(0,2);
                value = parts[0] + (parts[1] ? '.' + parts[1].slice(0,2) : '');
                input.value = value;
            }
            entry[field] = value;
            entry.amount = (Number(entry.units || 0) * Number(entry.price || 0)) || 0;
            renderBondInlineTotals(entry);
            return;
        }
    });

    document.addEventListener("focusin", (event) => {
        const bondInput = event.target.closest("[data-bond-input]");
        if (!bondInput) return;
        const field = bondInput.dataset.field;
        if (field === 'interest' || field === 'yield') {
            bondInput.value = String(bondInput.value || "").replace(/%/g, '');
        }
    });

    document.addEventListener("focusout", (event) => {
        const bondInput = event.target.closest("[data-bond-input]");
        if (!bondInput) return;
        const field = bondInput.dataset.field;
        let value = String(bondInput.value || "").trim();

        if (field === 'interest' || field === 'yield') {
            const numeric = value.replace(/[^0-9.]/g, '');
            const parsed = Number(numeric);
            if (Number.isFinite(parsed)) {
                bondInput.value = Number.isInteger(parsed) ? `${parsed}%` : `${parsed.toFixed(2).replace(/\.00$/, '')}%`;
            } else {
                bondInput.value = '';
            }
        }

        if (field === 'units') {
            const numeric = value.replace(/[^0-9]/g, '');
            bondInput.value = numeric;
            const entry = state.bonds.entries.find((e) => e.id === bondInput.dataset.entryId);
            if (entry && state.editingBondId === entry.id) {
                entry.units = numeric;
                entry.amount = (Number(entry.units || 0) * Number(entry.price || 0)) || 0;
                renderBondInlineTotals(entry);
            }
        }

        if (field === 'price') {
            const numeric = value.replace(/[^0-9.]/g, '');
            const parsed = Number(numeric);
            bondInput.value = Number.isFinite(parsed) ? parsed.toFixed(2) : '';
            const entry = state.bonds.entries.find((e) => e.id === bondInput.dataset.entryId);
            if (entry && state.editingBondId === entry.id) {
                entry.price = bondInput.value;
                entry.amount = (Number(entry.units || 0) * Number(entry.price || 0)) || 0;
                renderBondInlineTotals(entry);
            }
        }
    });

    document.addEventListener("click", (event) => {
        const action = event.target.closest("[data-action]");
        if (!action) {
            return;
        }

        if (action.dataset.action === "sort-mf") {
            setMutualFundSort(action.dataset.field);
            return;
        }

        if (action.dataset.action === "toggle-fund") {
            state.expandedFundId = state.expandedFundId === action.dataset.fundId ? null : action.dataset.fundId;
            renderMutualFunds();
            return;
        }

        if (action.dataset.action === "edit-fund") {
            const entryId = action.dataset.entryId;
            if (!entryId) return;
            const isEditing = state.editingEntryId === entryId;
            if (!isEditing) {
                state.editingEntryId = entryId;
            } else {
                state.editingEntryId = null;
                state.unsavedChanges = false;
                saveMutualFunds();
                updateMutualFundSaveState("Saved");
            }
            renderMutualFunds();
            return;
        }

        if (action.dataset.action === "add-sip" || action.dataset.action === "add-lumpsum") {
            const fund = findFund(action.dataset.fundId);
            if (!fund) {
                return;
            }

            const blockingEntry = findBlockingMutualFundEntry();
            if (blockingEntry) {
                state.expandedFundId = blockingEntry.fund.id;
                state.editingEntryId = blockingEntry.entry.id;
                renderMutualFunds();
                showConfirmDialog("Please complete and save your progress before adding another SIP or Lumpsum.");
                return;
            }

            const type = action.dataset.action === "add-sip" ? "sip" : "lumpsum";
            const entry = createEntry(type);
            fund.entries.push(entry);
            state.expandedFundId = fund.id;
            state.editingEntryId = entry.id;
            state.unsavedChanges = true;
            renderMutualFunds();
            updateMutualFundSaveState("Unsaved changes");
            return;
        }

        if (action.dataset.action === "remove-entry") {
            removeFundEntry(action.dataset.fundId, action.dataset.entryId);
            return;
        }

        if (action.dataset.action === "add-mutual-fund") {
            addMutualFundFromInput();
            return;
        }

        if (action.dataset.action === "remove-fund") {
            removeMutualFund(action.dataset.fundId);
            return;
        }

        if (action.dataset.action === "edit-bond") {
            const entryId = action.dataset.entryId;
            if (!entryId) return;
            const isEditing = state.editingBondId === entryId;
            if (isEditing) {
                state.editingBondId = null;
                saveBonds();
            } else {
                state.editingBondId = entryId;
            }
            renderBonds();
            return;
        }

        if (action.dataset.action === "add-bond") {
            addBondEntryFromInput();
            return;
        }

        if (action.dataset.action === "remove-bond") {
            removeBondEntry(action.dataset.entryId);
            return;
        }
    });

    document.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || !["newFundName", "newBondName"].includes(event.target.id)) {
            return;
        }

        event.preventDefault();
        if (event.target.id === "newFundName") {
            addMutualFundFromInput();
            return;
        }
        addBondEntryFromInput();
    });
}

function render() {
    updateActiveNav();

    if (state.route === "/mutual-funds") {
        renderMutualFunds();
    } else if (state.route === "/bonds") {
        renderBonds();
    } else if (state.route === "/nps") {
        renderPlaceholderRoute("NPS");
    } else if (state.route === "/ppf") {
        renderPlaceholderRoute("PPF");
    } else if (state.route === "/gold") {
        renderPlaceholderRoute("GOLD");
    } else if (state.route === "/" || state.route === "") {
        renderDashboard();
    } else {
        renderNotFound();
    }

    updateClock();
}

function updateActiveNav() {
    navLinks.forEach((link) => {
        const isCurrent = normalizePath(linkRoute(link)) === normalizePath(state.route);
        link.setAttribute("aria-current", isCurrent ? "page" : "false");
    });
}

function renderDashboard() {
    const summary = mutualFundSummary();

    app.innerHTML = `
        <section class="page-title-bar simple-title">
            <div>
                <h1>Dashboard</h1>
            </div>
        </section>

        <section class="metric-grid" aria-label="Portfolio summary">
            ${metricCard("Overall SIP Value", money(summary.sipAmount), `${summary.sipAmountEntries} entries`)}
            ${metricCard("Overall Lumpsum Value", money(summary.lumpsumAmount), `${summary.lumpsumAmountEntries} entries`)}
            ${metricCard("Funds", String(summary.fundCount), "Mutual funds added")}
            ${metricCard("Total Value", money(summary.totalAmount), "SIP plus lumpsum")}
        </section>

        <section class="content-grid">
            <article class="panel">
                <div class="panel-header">
                    <div>
                        <h2 class="panel-title">Pages</h2>
                    </div>
                </div>
                <div class="page-card-grid">
                    ${pageCard("Mutual Funds", "#/mutual-funds", `${summary.fundCount} funds`)}
                    ${pageCard("Bonds", "#/bonds", "Ready")}
                </div>
            </article>

            <article class="panel">
                <div class="panel-header">
                    <div>
                        <h2 class="panel-title">Mutual Funds Snapshot</h2>
                    </div>
                </div>
                ${renderMutualFundPreview()}
            </article>
        </section>
    `;
}

function renderMutualFunds() {
    const summary = mutualFundSummary();

    app.innerHTML = `
        <section class="page-title-bar simple-title">
            <div>
                <h1>Mutual Funds</h1>
            </div>
        </section>

        <section class="metric-grid" aria-label="Mutual funds summary">
            ${metricCard("Overall SIP Value", money(summary.sipAmount), `${summary.sipAmountEntries} filled rows`)}
            ${metricCard("Overall Lumpsum Value", money(summary.lumpsumAmount), `${summary.lumpsumAmountEntries} filled rows`)}
            ${metricCard("Funds", String(summary.fundCount), "Active list")}
            ${metricCard("Total Value", money(summary.totalAmount), "All rows")}
        </section>

        <section class="panel">
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">Fund List</h2>
                    <p class="subtle" id="mfSaveState">${state.unsavedChanges ? "Unsaved changes" : "Saved locally"}</p>
                </div>
            </div>
            <div class="fund-list">
                ${renderFundListHeader()}
                ${state.mutualFunds.funds.map(renderFundItem).join("")}
                ${renderAddFundItem()}
            </div>
        </section>
    `;
}

function renderBonds() {
    const total = (state.bonds?.entries || []).reduce((s, e) => s + (Number(e.amount)||0), 0);
    const entries = state.bonds.entries || [];
    app.innerHTML = `
        <section class="page-title-bar simple-title">
            <div>
                <h1>Bonds</h1>
            </div>
        </section>

        <section class="metric-grid" aria-label="Bonds summary">
            ${metricCard("Overall Bonds", formatNumberNoCurrency(total), `${state.bonds.entries.length} entries`)}
            ${metricCard("Total Invested", formatNumberNoCurrency(total), "All bonds")}
            ${metricCard("Entries", String(state.bonds.entries.length), "Manual page ready")}
            ${metricCard("Status", "Ready", "Bonds")}
        </section>

        <section class="panel">
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">Bonds</h2>
                    <p class="subtle">Saved locally</p>
                </div>
            </div>
            <div class="fund-list bond-list">
                ${entries.length ? renderBondTable(entries, total) : ""}
                ${renderAddBondItem()}
            </div>
        </section>
    `;
}

function renderBondTable(entries, total) {
    return `
        <div class="fund-table-wrap bond-table-wrap">
            <table class="fund-table bond-table">
                <thead>
                    <tr>
                        <th>Bond Issuer</th>
                        <th>Interest (%)</th>
                        <th>Months</th>
                        <th>Payout</th>
                        <th>Rating</th>
                        <th>Risk</th>
                        <th>Yield (%)</th>
                        <th>Units</th>
                        <th>Price</th>
                        <th>Overall</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>
                    ${entries.map((entry) => renderBondEntryRow(entry)).join("")}
                </tbody>
                <tfoot>
                    <tr>
                        <th colspan="9">Total</th>
                        <td>
                            <div class="total-amount-box bond-overall-box" data-bond-total>${formatNumberNoCurrency(total)}</div>
                        </td>
                        <td></td>
                    </tr>
                </tfoot>
            </table>
        </div>
    `;
}

function renderBondEntryRow(entry) {
    const isEditingThisEntry = state.editingBondId === entry.id;
    const isDisabled = !isEditingThisEntry ? "disabled" : "";

    return `
        <tr data-bond-row="${escapeAttribute(entry.id)}">
            <td><input class="manual-input" type="text" data-bond-input data-entry-id="${escapeAttribute(entry.id)}" data-field="issuer" value="${escapeAttribute(entry.issuer||'')}" ${isDisabled}></td>
            <td><input class="manual-input" type="text" data-bond-input data-entry-id="${escapeAttribute(entry.id)}" data-field="interest" value="${escapeAttribute(formatPercentForInput(entry.interest))}" ${isDisabled}></td>
            <td><input class="manual-input centered-input" type="text" data-bond-input data-entry-id="${escapeAttribute(entry.id)}" data-field="months" value="${escapeAttribute(entry.months||'')}" ${isDisabled}></td>
            <td><input class="manual-input" type="text" data-bond-input data-entry-id="${escapeAttribute(entry.id)}" data-field="payout" value="${escapeAttribute(entry.payout||'')}" ${isDisabled}></td>
            <td><input class="manual-input centered-input" type="text" data-bond-input data-entry-id="${escapeAttribute(entry.id)}" data-field="rating" value="${escapeAttribute(entry.rating||'')}" ${isDisabled}></td>
            <td><input class="manual-input centered-input" type="text" data-bond-input data-entry-id="${escapeAttribute(entry.id)}" data-field="risk" value="${escapeAttribute(entry.risk||'')}" ${isDisabled}></td>
            <td><input class="manual-input" type="text" data-bond-input data-entry-id="${escapeAttribute(entry.id)}" data-field="yield" value="${escapeAttribute(formatPercentForInput(entry.yield))}" ${isDisabled}></td>
            <td><input class="manual-input centered-input units-input" type="text" data-bond-input data-entry-id="${escapeAttribute(entry.id)}" data-field="units" value="${escapeAttribute(formatUnitsForInput(entry.units))}" ${isDisabled}></td>
            <td><input class="manual-input amount-input" type="text" data-bond-input data-entry-id="${escapeAttribute(entry.id)}" data-field="price" value="${entry.price === "" ? "" : formatAmountForInput(entry.price)}" ${isDisabled}></td>
            <td>
                <div class="total-amount-box bond-overall-box" data-bond-overall="${escapeAttribute(entry.id)}">${formatNumberNoCurrency(entry.amount || 0)}</div>
            </td>
            <td>
                <div class="action-box bond-action-box">
                    <button class="secondary-button edit-button" type="button" data-action="edit-bond" data-entry-id="${escapeAttribute(entry.id)}">${isEditingThisEntry ? "Save" : "Edit"}</button>
                    <button class="remove-button" type="button" data-action="remove-bond" data-entry-id="${escapeAttribute(entry.id)}">Remove</button>
                </div>
            </td>
        </tr>
    `;
}

function renderNotFound() {
    app.innerHTML = `
        <section class="empty-panel">
            <h1>Page not found</h1>
            <a class="back-link" href="#/" data-link>Back to dashboard</a>
        </section>
    `;
}

function renderPlaceholderRoute(title) {
    app.innerHTML = `
        <section class="page-title-bar simple-title">
            <div>
                <h1>${escapeHtml(title)}</h1>
            </div>
        </section>
        <section class="panel">
            <p class="subtle">This section is ready for ${escapeHtml(title)} content.</p>
        </section>
    `;
}

function renderFundListHeader() {
    if (!state.mutualFunds.funds.length) {
        return "";
    }

    return `
        <div class="fund-list-header" aria-hidden="true">
            <span>Mutual Fund Name</span>
            <span>SIP Value</span>
            <span>LUMPSUM Value</span>
            <span>Total Value</span>
        </div>
    `;
}

function renderFundItem(fund) {
    const isExpanded = state.expandedFundId === fund.id;
    const totals = fundSummary(fund);

    return `
        <article class="fund-item" data-fund-card="${escapeAttribute(fund.id)}">
            <div class="fund-row">
                <button class="fund-toggle" type="button" data-action="toggle-fund" data-fund-id="${escapeAttribute(fund.id)}" aria-expanded="${isExpanded}">
                    <span class="fund-name">${escapeHtml(fund.name)}</span>
                    <span class="fund-value" data-fund-sip-value="${escapeAttribute(fund.id)}">${money(totals.sipAmount)}</span>
                    <span class="fund-value" data-fund-lumpsum-value="${escapeAttribute(fund.id)}">${money(totals.lumpsumAmount)}</span>
                    <span class="fund-value" data-fund-total-value="${escapeAttribute(fund.id)}">${money(totals.totalAmount)}</span>
                    <span class="fund-chevron" aria-hidden="true">${isExpanded ? "-" : "+"}</span>
                </button>
                <button class="remove-button fund-remove-button" type="button" data-action="remove-fund" data-fund-id="${escapeAttribute(fund.id)}">Remove</button>
            </div>
            ${isExpanded ? renderFundDetails(fund) : ""}
        </article>
    `;
}

function renderFundDetails(fund) {
    const hasEntries = fund.entries && fund.entries.length > 0;
    const sortedEntries = getSortedFundEntries(fund.entries || []);
    return `
        <div class="fund-details">
            <div class="fund-actions">
                <div class="row-action-buttons">
                    <button class="secondary-button sip-action" type="button" data-action="add-sip" data-fund-id="${escapeAttribute(fund.id)}">+ SIP</button>
                    <button class="secondary-button lumpsum-action" type="button" data-action="add-lumpsum" data-fund-id="${escapeAttribute(fund.id)}">+ Lumpsum</button>
                </div>
            </div>
            <div class="fund-table-wrap">
                <table class="fund-table">
                    <thead>
                        <tr>
                            ${renderFundSortHeader("type", "Type")}
                            ${renderFundSortHeader("year", "Year")}
                            ${renderFundSortHeader("navDate", "NAV Date")}
                            ${renderFundSortHeader("amount", "Amount")}
                            <th scope="col">Notes</th>
                            <th scope="col">Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${sortedEntries.map((entry) => renderFundEntryRow(fund, entry)).join("")}
                    </tbody>
                    ${hasEntries ? `
                    <tfoot>
                        <tr>
                            <th scope="row" colspan="3">Total</th>
                            <td>
                                <div class="total-amount-box" data-fund-entry-total="${escapeAttribute(fund.id)}">${formatNumberNoCurrency(fundSummary(fund).totalAmount)}</div>
                            </td>
                            <td colspan="2"></td>
                        </tr>
                    </tfoot>
                    ` : ""}
                </table>
            </div>
        </div>
    `;
}

function renderFundSortHeader(field, label) {
    const sort = currentMutualFundSort();
    const isActive = sort.field === field;
    const directionMarker = isActive ? (sort.direction === "asc" ? "&#9650;" : "&#9660;") : "";
    const ariaSort = isActive ? (sort.direction === "asc" ? "ascending" : "descending") : "none";
    const nextDirection = isActive && sort.direction === "asc" ? "descending" : "ascending";

    return `
        <th scope="col" aria-sort="${ariaSort}">
            <button
                class="sort-header"
                type="button"
                data-action="sort-mf"
                data-field="${escapeAttribute(field)}"
                aria-label="Sort by ${escapeAttribute(label)} ${nextDirection}"
            >
                <span>${escapeHtml(label)}</span>
                <span class="sort-indicator" aria-hidden="true">${directionMarker}</span>
            </button>
        </th>
    `;
}

function renderFundEntryRow(fund, entry) {
    const rowClass = entry.type === "lumpsum" ? "lumpsum-row" : "sip-row";
    const isEditingThisEntry = state.editingEntryId === entry.id;
    const isDisabled = !isEditingThisEntry ? "disabled" : "";

    return `
        <tr class="fund-entry-row ${rowClass}">
            <td>
                <span class="entry-type-pill ${entry.type === "lumpsum" ? "lumpsum-type" : "sip-type"}">${fundEntryTypeLabel(entry)}</span>
            </td>
            <td>
                <input
                    class="manual-input"
                    type="text"
                    inputmode="numeric"
                    maxlength="4"
                    value="${escapeAttribute(entry.year)}"
                    placeholder="YYYY"
                    aria-label="Year for ${escapeAttribute(fund.name)}"
                    data-mf-input
                    data-fund-id="${escapeAttribute(fund.id)}"
                    data-entry-id="${escapeAttribute(entry.id)}"
                    data-field="year"
                    ${isDisabled}
                >
            </td>
            <td>
                <input
                    class="manual-input"
                    type="date"
                    value="${escapeAttribute(entry.navDate)}"
                    aria-label="NAV date for ${escapeAttribute(fund.name)}"
                    data-mf-input
                    data-fund-id="${escapeAttribute(fund.id)}"
                    data-entry-id="${escapeAttribute(entry.id)}"
                    data-field="navDate"
                    ${isDisabled}
                >
            </td>
            <td>
                <input
                    class="manual-input amount-input"
                    type="text"
                    inputmode="decimal"
                    pattern="[0-9]*[.,]?[0-9]*"
                    value="${entry.amount === "" ? "" : formatAmountForInput(entry.amount)}"
                    placeholder="0.00"
                    aria-label="Amount for ${escapeAttribute(fund.name)}"
                    data-mf-input
                    data-fund-id="${escapeAttribute(fund.id)}"
                    data-entry-id="${escapeAttribute(entry.id)}"
                    data-field="amount"
                    ${isDisabled}
                >
            </td>
            <td>
                <input
                    class="manual-input short-input"
                    type="text"
                    value="${escapeAttribute(entry.notes || "")}"
                    placeholder="Notes"
                    aria-label="Notes for ${escapeAttribute(fund.name)}"
                    data-mf-input
                    data-fund-id="${escapeAttribute(fund.id)}"
                    data-entry-id="${escapeAttribute(entry.id)}"
                    data-field="notes"
                    ${isDisabled}
                >
            </td>
            <td>
                <div class="action-box">
                    <button class="secondary-button edit-button" type="button" data-action="edit-fund" data-entry-id="${escapeAttribute(entry.id)}">${isEditingThisEntry ? "Save" : "Edit"}</button>
                    <button class="remove-button" type="button" data-action="remove-entry" data-fund-id="${escapeAttribute(fund.id)}" data-entry-id="${escapeAttribute(entry.id)}">Remove</button>
                </div>
            </td>
        </tr>
    `;
}

function renderAddFundItem() {
    return `
        <article class="fund-item add-fund-item">
            <div class="add-fund-form">
                <div>
                    <strong>Add Mutual Fund</strong>
                </div>
                <input class="manual-input add-fund-input" id="newFundName" type="text" placeholder="New mutual fund name" aria-label="New mutual fund name">
                <button class="secondary-button" type="button" data-action="add-mutual-fund">Add</button>
            </div>
        </article>
    `;
}

function renderMutualFundPreview() {
    if (!state.mutualFunds.funds.length) {
        return `<p class="subtle">No mutual funds added yet.</p>`;
    }

    const rows = state.mutualFunds.funds.map((fund) => {
        const totals = fundSummary(fund);
        return `
            <tr>
                <td>${escapeHtml(fund.name)}</td>
                <td>${money(totals.sipAmount)}</td>
                <td>${money(totals.lumpsumAmount)}</td>
                <td>${money(totals.totalAmount)}</td>
            </tr>
        `;
    });

    return `
        <div class="table-wrap">
            <table class="portfolio-table compact-table">
                <thead>
                    <tr>
                        <th>Fund</th>
                        <th>SIP Value</th>
                        <th>Lumpsum Value</th>
                        <th>Total</th>
                    </tr>
                </thead>
                <tbody>${rows.join("")}</tbody>
            </table>
        </div>
    `;
}

function metricCard(label, value, detail) {
    return `
        <article class="metric-card">
            <span class="metric-label">${label}</span>
            <strong class="metric-value">${value}</strong>
            <span class="metric-detail">${detail}</span>
        </article>
    `;
}

function pageCard(title, href, detail) {
    return `
        <a class="page-card" href="${href}" data-link>
            <strong>${escapeHtml(title)}</strong>
            <span>${escapeHtml(detail)}</span>
        </a>
    `;
}

function addMutualFundFromInput() {
    const input = document.querySelector("#newFundName");
    const name = input?.value.trim() || "";

    if (!name) {
        updateMutualFundSaveState("Enter a fund name");
        input?.focus();
        return;
    }

    const duplicate = state.mutualFunds.funds.some((fund) => normalizeName(fund.name) === normalizeName(name));
    if (duplicate) {
        updateMutualFundSaveState("Fund already exists");
        input.focus();
        return;
    }

    const fund = createFund(name, new Set(state.mutualFunds.funds.map((item) => item.id)));
    state.mutualFunds.funds.push(fund);
    state.expandedFundId = fund.id;
    saveMutualFunds();
    renderMutualFunds();
}

function removeMutualFund(fundId) {
    const fund = findFund(fundId);
    if (!fund) {
        return;
    }

    showConfirmDialog(`Remove ${escapeHtml(fund.name)}?`).then((ok) => {
        if (!ok) return;
        state.mutualFunds.funds = state.mutualFunds.funds.filter((item) => item.id !== fundId);
        if (state.expandedFundId === fundId) {
            state.expandedFundId = null;
        }
        saveMutualFunds();
        renderMutualFunds();
    });
}

function removeFundEntry(fundId, entryId) {
    const fund = findFund(fundId);
    if (!fund) {
        return;
    }

    const entry = fund.entries.find((item) => item.id === entryId);
    if (!entry) {
        return;
    }

    showConfirmDialog("Are you sure you want to remove this mutual fund row?").then((ok) => {
        if (!ok) return;
        fund.entries = fund.entries.filter((item) => item.id !== entryId);
        if (state.editingEntryId === entryId) {
            state.editingEntryId = null;
            state.unsavedChanges = false;
        }
        saveMutualFunds();
        renderMutualFunds();
    });
}

function renderInlineTotals(fund) {
    const totals = fundSummary(fund);
    const totalTarget = document.querySelector(`[data-fund-entry-total="${cssEscape(fund.id)}"]`);
    const sipTarget = document.querySelector(`[data-fund-sip-value="${cssEscape(fund.id)}"]`);
    const lumpsumTarget = document.querySelector(`[data-fund-lumpsum-value="${cssEscape(fund.id)}"]`);
    const summaryTotalTarget = document.querySelector(`[data-fund-total-value="${cssEscape(fund.id)}"]`);

    if (totalTarget) {
        totalTarget.textContent = formatNumberNoCurrency(totals.totalAmount);
    }
    if (sipTarget) {
        sipTarget.textContent = money(totals.sipAmount);
    }
    if (lumpsumTarget) {
        lumpsumTarget.textContent = money(totals.lumpsumAmount);
    }
    if (summaryTotalTarget) {
        summaryTotalTarget.textContent = money(totals.totalAmount);
    }
}

function mutualFundSummary() {
    return state.mutualFunds.funds.reduce((summary, fund) => {
        const totals = fundSummary(fund);
        summary.fundCount += 1;
        summary.sipAmount += totals.sipAmount;
        summary.lumpsumAmount += totals.lumpsumAmount;
        summary.totalAmount += totals.totalAmount;
        summary.sipAmountEntries += totals.sipAmountEntries;
        summary.lumpsumAmountEntries += totals.lumpsumAmountEntries;
        return summary;
    }, {
        fundCount: 0,
        sipAmount: 0,
        lumpsumAmount: 0,
        totalAmount: 0,
        sipAmountEntries: 0,
        lumpsumAmountEntries: 0
    });
}

function fundSummary(fund) {
    return fund.entries.reduce((summary, entry) => {
        const amount = parseAmount(entry.amount);
        const hasAmount = amount > 0;

        if (entry.type === "lumpsum") {
            summary.lumpsumAmount += amount;
            summary.lumpsumAmountEntries += hasAmount ? 1 : 0;
        } else {
            summary.sipAmount += amount;
            summary.sipAmountEntries += hasAmount ? 1 : 0;
        }

        summary.totalAmount += amount;
        return summary;
    }, {
        sipAmount: 0,
        lumpsumAmount: 0,
        totalAmount: 0,
        sipAmountEntries: 0,
        lumpsumAmountEntries: 0
    });
}

function loadMutualFunds() {
    try {
        const savedData = JSON.parse(localStorage.getItem(MUTUAL_FUNDS_STORAGE_KEY) || "{}");
        return normalizePortfolioData(savedData);
    } catch {
        return { funds: [] };
    }
}

function normalizePortfolioData(data) {
    const savedFunds = Array.isArray(data?.funds) ? data.funds : [];
    const usedIds = new Set();
    const funds = savedFunds
        .filter((fund) => String(fund?.name || "").trim())
        .map((fund) => normalizeFund(fund, usedIds));

    return { funds };
}

function normalizeFund(savedFund, usedIds) {
    const name = String(savedFund?.name || "").trim();
    const id = uniqueId(savedFund?.id || slugify(name), usedIds);
    usedIds.add(id);

    return {
        id,
        name,
        entries: Array.isArray(savedFund?.entries)
            ? savedFund.entries.map((entry) => normalizeEntry(entry))
            : []
    };
}

function normalizeEntry(entry) {
    const type = entry?.type === "lumpsum" ? "lumpsum" : "sip";
    return {
        id: String(entry?.id || createEntry(type).id),
        type,
        year: String(entry?.year || ""),
        navDate: normalizeDateValue(entry?.navDate),
        amount: String(entry?.amount || ""),
        notes: String(entry?.notes || "")
    };
}

function setMutualFundSort(field) {
    if (!MUTUAL_FUND_SORTABLE_FIELDS.includes(field)) {
        return;
    }

    const current = currentMutualFundSort();
    state.mutualFundSort = {
        field,
        direction: current.field === field && current.direction === "asc" ? "desc" : "asc"
    };
    renderMutualFunds();
}

function currentMutualFundSort() {
    const sort = state.mutualFundSort || DEFAULT_MUTUAL_FUND_SORT;
    return {
        field: MUTUAL_FUND_SORTABLE_FIELDS.includes(sort.field) ? sort.field : DEFAULT_MUTUAL_FUND_SORT.field,
        direction: sort.direction === "desc" ? "desc" : "asc"
    };
}

function getSortedFundEntries(entries) {
    const sort = currentMutualFundSort();
    return [...entries]
        .map((entry, index) => ({ entry, index }))
        .sort((left, right) => {
            const result = compareFundEntries(left.entry, right.entry, sort.field, sort.direction);
            return result || left.index - right.index;
        })
        .map((item) => item.entry);
}

function compareFundEntries(left, right, field, direction) {
    const leftValue = mutualFundSortValue(left, field);
    const rightValue = mutualFundSortValue(right, field);
    const leftEmpty = leftValue === "";
    const rightEmpty = rightValue === "";

    if (leftEmpty && rightEmpty) {
        return 0;
    }
    if (leftEmpty) {
        return 1;
    }
    if (rightEmpty) {
        return -1;
    }

    let result;
    if (field === "amount") {
        result = parseAmount(leftValue) - parseAmount(rightValue);
    } else if (field === "year") {
        result = Number(leftValue) - Number(rightValue);
    } else {
        result = String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true, sensitivity: "base" });
    }

    return direction === "desc" ? -result : result;
}

function mutualFundSortValue(entry, field) {
    if (field === "type") {
        return fundEntryTypeLabel(entry);
    }
    if (field === "year") {
        return String(entry?.year || "").trim();
    }
    if (field === "amount") {
        return String(entry?.amount || "").trim();
    }
    return normalizeDateValue(entry?.navDate);
}

function fundEntryTypeLabel(entry) {
    return entry?.type === "lumpsum" ? "LUMPSUM" : "SIP";
}

function findBlockingMutualFundEntry() {
    if (state.editingEntryId) {
        const editingEntry = findMutualFundEntry(state.editingEntryId);
        if (editingEntry) {
            return editingEntry;
        }
    }

    for (const fund of state.mutualFunds.funds) {
        const entry = (fund.entries || []).find((item) => !isMutualFundEntryComplete(item));
        if (entry) {
            return { fund, entry };
        }
    }

    return null;
}

function findMutualFundEntry(entryId) {
    for (const fund of state.mutualFunds.funds) {
        const entry = (fund.entries || []).find((item) => item.id === entryId);
        if (entry) {
            return { fund, entry };
        }
    }
    return null;
}

function isMutualFundEntryComplete(entry) {
    return /^\d{4}$/.test(String(entry?.year || "").trim())
        && Boolean(normalizeDateValue(entry?.navDate))
        && parseAmount(entry?.amount) > 0;
}

function createFund(name, usedIds = new Set()) {
    const id = uniqueId(slugify(name), usedIds);
    return {
        id,
        name,
        entries: []
    };
}

function createEntry(type) {
    return {
        id: `${type}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        type,
        year: "",
        navDate: "",
        amount: "",
        notes: ""
    };
}

function saveMutualFunds() {
    localStorage.setItem(MUTUAL_FUNDS_STORAGE_KEY, JSON.stringify(state.mutualFunds));
    if (USE_REMOTE_STORAGE) {
        saveMutualFundsRemote(state.mutualFunds);
    }
}

function saveMutualFundsRemote(data) {
    if (!firestore) {
        return;
    }

    try {
        firestore.collection("portfolios").doc("veswa009portfolio").set({ mutualFunds: data, updatedAt: new Date().toISOString() });
    } catch (error) {
        console.warn("Failed to save portfolio remotely:", error);
    }
}

function exportBackupFile() {
    const backup = {
        app: "Personal Portfolio",
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        mutualFunds: state.mutualFunds
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);

    link.href = url;
    link.download = `veswa009-portfolio-backup-${stamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    updateMutualFundSaveState("Backup exported");
}

function importBackupFile(file) {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
        try {
            const parsed = JSON.parse(String(reader.result || "{}"));
            const imported = parsed?.mutualFunds ? parsed.mutualFunds : parsed;
            state.mutualFunds = normalizePortfolioData(imported);
            state.expandedFundId = null;
            saveMutualFunds();
            renderMutualFunds();
        } catch {
            updateMutualFundSaveState("Backup import failed");
        }
    });
    reader.readAsText(file);
}

function updateMutualFundSaveState(text) {
    const target = document.querySelector("#mfSaveState");
    if (!target) {
        return;
    }
    target.textContent = text;
}

function findFund(fundId) {
    return state.mutualFunds.funds.find((fund) => fund.id === fundId);
}

function startClock() {
    updateClock();
    window.setInterval(updateClock, 1000);
}

function updateClock() {
    const now = new Date();
    document.querySelectorAll("[data-current-date]").forEach((target) => {
        target.textContent = dateFormatter.format(now);
    });
    document.querySelectorAll("[data-current-time]").forEach((target) => {
        target.textContent = timeFormatter.format(now);
    });
}

function routeFromLocation() {
    if (window.location.hash.startsWith("#/")) {
        return normalizePath(window.location.hash.slice(1));
    }

    const path = normalizePath(window.location.pathname);
    if (path.endsWith("/mutual-funds")) {
        return "/mutual-funds";
    }
    if (path.endsWith("/bonds")) {
        return "/bonds";
    }
    if (path.endsWith("/nps")) {
        return "/nps";
    }
    if (path.endsWith("/ppf")) {
        return "/ppf";
    }
    if (path.endsWith("/gold")) {
        return "/gold";
    }
    return "/";
}

function linkRoute(link) {
    if (link.hash.startsWith("#/")) {
        return link.hash.slice(1);
    }
    return link.pathname;
}

function normalizePath(path) {
    return path === "" ? "/" : path.replace(/\/$/, "") || "/";
}

function normalizeName(name) {
    return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function slugify(value) {
    return String(value || "fund")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "") || "fund";
}

function uniqueId(seed, usedIds) {
    const base = slugify(seed);
    let candidate = base;
    let suffix = 2;

    while (usedIds.has(candidate)) {
        candidate = `${base}-${suffix}`;
        suffix += 1;
    }

    return candidate;
}

function normalizeDateValue(value) {
    const text = String(value || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        return text;
    }

    const match = text.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (match) {
        return `${match[3]}-${match[2]}-${match[1]}`;
    }

    return "";
}

function parseAmount(value) {
    const cleaned = String(value || "").replace(/,/g, "").replace(/[^0-9.-]/g, "");
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
}

function money(value) {
    return moneyFormatter.format(Number(value) || 0);
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
    return escapeHtml(value).replaceAll("`", "&#096;");
}

function formatAmountForInput(value) {
    const num = Number(String(value || "").replace(/,/g, ""));
    if (!Number.isFinite(num)) return "";
    return num.toFixed(2);
}

function formatNumberNoCurrency(value) {
    const num = Number(value || 0) || 0;
    return num.toFixed(2);
}

function loadBonds() {
    try {
        const saved = JSON.parse(localStorage.getItem('veswa009-bonds') || '[]');
        return { entries: Array.isArray(saved) ? saved.map((entry) => normalizeBondEntry(entry)) : [] };
    } catch {
        return { entries: [] };
    }
}

function saveBonds() {
    try {
        localStorage.setItem('veswa009-bonds', JSON.stringify(state.bonds.entries || []));
    } catch {}
}

function addBondEntryFromInput() {
    const input = document.querySelector("#newBondName");
    const issuer = String(input?.value || "").trim();
    if (!issuer) {
        input?.focus();
        return;
    }

    const entry = createBondEntry(issuer);
    state.bonds.entries.push(entry);
    state.editingBondId = entry.id;
    if (input) {
        input.value = "";
    }
    renderBonds();
}

function removeBondEntry(entryId) {
    showConfirmDialog("Are you sure you want to remove this bond?").then((ok) => {
        if (!ok) return;
        state.bonds.entries = state.bonds.entries.filter((e) => e.id !== entryId);
        if (state.editingBondId === entryId) {
            state.editingBondId = null;
        }
        saveBonds();
        renderBonds();
    });
}

function renderAddBondItem() {
    return `
        <article class="fund-item add-fund-item">
            <div class="add-fund-form">
                <div>
                    <strong>Add Bond</strong>
                </div>
                <input class="manual-input add-fund-input" id="newBondName" type="text" placeholder="New bond name" aria-label="New bond name">
                <button class="secondary-button" type="button" data-action="add-bond">Add</button>
            </div>
        </article>
    `;
}

function createBondEntry(issuer = "") {
    return {
        id: `bond-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        issuer,
        interest: "",
        tenure: "",
        months: "",
        payout: "",
        rating: "",
        risk: "",
        yield: "",
        units: "",
        price: "",
        amount: 0
    };
}

function normalizeBondEntry(entry) {
    const normalized = {
        ...createBondEntry(),
        ...entry,
        id: String(entry?.id || createBondEntry().id),
        issuer: String(entry?.issuer || ""),
        interest: String(entry?.interest || "").replace(/%/g, ""),
        tenure: String(entry?.tenure || ""),
        months: String(entry?.months || ""),
        payout: String(entry?.payout || ""),
        rating: String(entry?.rating || ""),
        risk: String(entry?.risk || ""),
        yield: String(entry?.yield || "").replace(/%/g, ""),
        units: formatUnitsForInput(entry?.units),
        price: isBlankValue(entry?.price) ? "" : formatAmountForInput(entry?.price)
    };
    normalized.amount = (Number(normalized.units || 0) * Number(normalized.price || 0)) || 0;
    return normalized;
}

function renderBondInlineTotals(entry) {
    const rowTarget = document.querySelector(`[data-bond-overall="${cssEscape(entry.id)}"]`);
    const totalTarget = document.querySelector("[data-bond-total]");
    if (rowTarget) {
        rowTarget.textContent = formatNumberNoCurrency(entry.amount || 0);
    }
    if (totalTarget) {
        totalTarget.textContent = formatNumberNoCurrency(bondTotal());
    }
}

function bondTotal() {
    return (state.bonds?.entries || []).reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
}

function formatPercentForInput(value) {
    const text = String(value || "").replace(/%/g, "").trim();
    return text ? `${text}%` : "";
}

function formatUnitsForInput(value) {
    const numeric = String(value || "").replace(/[^0-9]/g, "");
    return numeric ? String(Number(numeric)) : "";
}

function isBlankValue(value) {
    return value === undefined || value === null || String(value).trim() === "";
}

function showConfirmDialog(message) {
    return new Promise((resolve) => {
        const overlay = document.querySelector('#confirmOverlay');
        const msg = document.querySelector('#confirmMessage');
        const ok = document.querySelector('#confirmOk');
        const cancel = document.querySelector('#confirmCancel');
        if (!overlay || !msg || !ok || !cancel) {
            resolve(window.confirm(message));
            return;
        }

        msg.textContent = message;
        overlay.classList.remove('hidden');
        overlay.setAttribute('aria-hidden', 'false');

        const cleanup = () => {
            overlay.classList.add('hidden');
            overlay.setAttribute('aria-hidden', 'true');
            ok.removeEventListener('click', onOk);
            cancel.removeEventListener('click', onCancel);
        };

        const onOk = () => { cleanup(); resolve(true); };
        const onCancel = () => { cleanup(); resolve(false); };

        ok.addEventListener('click', onOk);
        cancel.addEventListener('click', onCancel);
    });
}

function initPinGate() {
    const unlocked = sessionStorage.getItem('portfolio-unlocked') === 'true';
    if (unlocked) {
        render();
        return;
    }

    showPinOverlay();

    const pinInput = document.querySelector('#pinInput');
    const pinSubmit = document.querySelector('#pinSubmit');
    const pinMessage = document.querySelector('#pinMessage');

    if (pinInput) pinInput.value = '';
    if (pinMessage) pinMessage.textContent = '';

    const tryUnlock = () => {
        const v = (pinInput?.value || '').trim();
        if (v === PAGE_PIN) {
            sessionStorage.setItem('portfolio-unlocked', 'true');
            if (pinMessage) { pinMessage.textContent = 'Unlocked'; }
            hidePinOverlay();
            render();
            return;
        }
        if (pinMessage) { pinMessage.textContent = 'Incorrect PIN'; }
        if (pinInput) { pinInput.value = ''; pinInput.focus(); }
    };

    pinSubmit?.addEventListener('click', tryUnlock);
    pinInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryUnlock(); });
}

function showPinOverlay() {
    const overlay = document.querySelector('#pinOverlay');
    if (!overlay) return;
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
}

function hidePinOverlay() {
    const overlay = document.querySelector('#pinOverlay');
    if (!overlay) return;
    overlay.classList.add('hidden');
    overlay.setAttribute('aria-hidden', 'true');
}

function cssEscape(value) {
    if (window.CSS?.escape) {
        return CSS.escape(value);
    }
    return String(value).replaceAll('"', '\\"');
}
