const STORAGE_KEY = "libris-library-data";
const seed = {
  books: [
    { id: "B-1001", title: "Clean Code", author: "Robert C. Martin", isbn: "9780132350884", year: 2008, available: true },
    { id: "B-1003", title: "Designing Data-Intensive Applications", author: "Martin Kleppmann", isbn: "9781449373320", year: 2017, available: true },
    { id: "B-1002", title: "The Pragmatic Programmer", author: "David Thomas", isbn: "9780135957059", year: 2019, available: true }
  ],
  members: [
    { id: "M-1001", name: "Ava Patel", email: "ava.patel@example.com", phone: "+1 555 0101" },
    { id: "M-1002", name: "Noah Williams", email: "noah.williams@example.com", phone: "+1 555 0102" }
  ],
  loans: []
};
let data = loadData();
let loanFilter = "all";
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function loadData() {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved ? JSON.parse(saved) : structuredClone(seed);
}
function persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
function uid(prefix) { return `${prefix}-${Math.random().toString(16).slice(2, 10).toUpperCase()}`; }
function today() { return new Date().toISOString().slice(0, 10); }
function datePlus(days) { const date = new Date(); date.setDate(date.getDate() + days); return date.toISOString().slice(0, 10); }
function prettyDate(value) { if (!value) return "-"; return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`)); }
function bookById(id) { return data.books.find((book) => book.id === id); }
function memberById(id) { return data.members.find((member) => member.id === id); }
function activeLoan(bookId) { return data.loans.find((loan) => loan.bookId === bookId && !loan.returnDate); }
function isOverdue(loan) { return !loan.returnDate && loan.dueDate < today(); }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char])); }
function coverClass(index) { return ["", "blue", "sage", "coral"][index % 4]; }
function notify(message) { $("#toastMessage").textContent = message; $("#toast").classList.add("show"); setTimeout(() => $("#toast").classList.remove("show"), 2600); }

function render() {
  const available = data.books.filter((book) => book.available).length;
  const active = data.loans.filter((loan) => !loan.returnDate).length;
  const overdue = data.loans.filter(isOverdue).length;
  $("#totalBooks").textContent = data.books.length; $("#availableBooks").textContent = available;
  $("#totalMembers").textContent = data.members.length; $("#activeLoans").textContent = active; $("#overdueLoans").textContent = overdue;
  $("#loanNavCount").textContent = active; $("#availableLegend").textContent = available; $("#loanLegend").textContent = active; $("#totalLegend").textContent = data.books.length;
  const percentage = data.books.length ? Math.round((available / data.books.length) * 100) : 0;
  $("#donutPercent").textContent = `${percentage}%`; $("#donutChart").style.setProperty("--percent", `${percentage}%`);
  renderActivity(); renderCatalog(); renderMembers(); renderLoans();
}
function renderActivity() {
  const recent = [...data.loans].sort((a, b) => b.checkoutDate.localeCompare(a.checkoutDate)).slice(0, 4);
  $("#recentActivity").innerHTML = recent.length ? recent.map((loan, index) => {
    const book = bookById(loan.bookId); const member = memberById(loan.memberId);
    return `<div class="activity-row"><span class="book-cover cover-${coverClass(index)}"></span><div class="activity-copy"><strong>${escapeHtml(book?.title || "Removed book")}</strong><small>${loan.returnDate ? "Returned by" : "Checked out by"} ${escapeHtml(member?.name || "Unknown member")}</small></div><span class="activity-date">${prettyDate(loan.returnDate || loan.checkoutDate)}</span></div>`;
  }).join("") : `<p class="empty-state">No loan activity yet. Check out a book to see it here.</p>`;
}
function renderCatalog() {
  const query = $("#catalogSearch")?.value.toLowerCase().trim() || ""; const filter = $("#catalogFilter")?.value || "all";
  const books = data.books.filter((book) => { const matches = [book.id, book.title, book.author, book.isbn].some((value) => value.toLowerCase().includes(query)); return matches && (filter === "all" || filter === "available" && book.available || filter === "loaned" && !book.available); }).sort((a, b) => a.title.localeCompare(b.title));
  $("#catalogTable").innerHTML = books.length ? books.map((book, index) => `<tr><td><span class="book-name"><i class="mini-cover ${coverClass(index)}"></i>${escapeHtml(book.title)}</span></td><td>${escapeHtml(book.author)}</td><td>${escapeHtml(book.isbn)}</td><td>${book.year}</td><td><span class="badge ${book.available ? "badge-available" : "badge-loan"}">${book.available ? "Available" : "On loan"}</span></td><td><button class="row-action" data-remove-book="${book.id}" title="Remove book">...</button></td></tr>`).join("") : `<tr><td colspan="6"><p class="empty-state">No books match your search.</p></td></tr>`;
}
function renderMembers() {
  const query = $("#memberSearch")?.value.toLowerCase().trim() || ""; const members = data.members.filter((member) => [member.id, member.name, member.email, member.phone].some((value) => value.toLowerCase().includes(query))).sort((a, b) => a.name.localeCompare(b.name));
  $("#memberResultNote").textContent = `${members.length} member${members.length === 1 ? "" : "s"}`;
  $("#membersTable").innerHTML = members.length ? members.map((member, index) => `<tr><td><span class="book-name"><span class="avatar ${index % 2 ? "avatar-sage" : "avatar-ink"}">${member.name.split(" ").map((part) => part[0]).join("")}</span>${escapeHtml(member.name)}</span></td><td>${escapeHtml(member.email)}</td><td>${escapeHtml(member.phone)}</td><td>${member.id}</td><td><button class="row-action" data-remove-member="${member.id}" title="Remove member">...</button></td></tr>`).join("") : `<tr><td colspan="5"><p class="empty-state">No members match your search.</p></td></tr>`;
}
function renderLoans() {
  const loans = [...data.loans].sort((a, b) => b.checkoutDate.localeCompare(a.checkoutDate)).filter((loan) => loanFilter === "all" || loanFilter === "active" && !loan.returnDate || loanFilter === "overdue" && isOverdue(loan) || loanFilter === "returned" && loan.returnDate);
  $("#loansTable").innerHTML = loans.length ? loans.map((loan) => { const book = bookById(loan.bookId); const member = memberById(loan.memberId); const status = loan.returnDate ? "Returned" : isOverdue(loan) ? "Overdue" : "Active"; const badge = status === "Returned" ? "badge-returned" : status === "Overdue" ? "badge-overdue" : "badge-loan"; return `<tr><td>${escapeHtml(book?.title || "Removed book")}</td><td>${escapeHtml(member?.name || "Unknown member")}</td><td>${prettyDate(loan.checkoutDate)}</td><td>${prettyDate(loan.dueDate)}</td><td><span class="badge ${badge}">${status}</span></td><td>${loan.returnDate ? "" : `<button class="text-button" data-return-book="${loan.bookId}">Return</button>`}</td></tr>`; }).join("") : `<tr><td colspan="6"><p class="empty-state">No loans in this view.</p></td></tr>`;
}

function showView(view) {
  $$(".view").forEach((item) => item.classList.remove("active-view")); $(`#${view}View`).classList.add("active-view");
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  const label = { dashboard: "Overview", catalog: "Catalog", members: "Members", loans: "Loans" }[view]; $("#breadcrumbCurrent").textContent = label; $("#sidebar").classList.remove("open"); window.scrollTo({ top: 0, behavior: "smooth" });
}
function field(label, name, type = "text", required = true, extra = "") { return `<div class="field ${extra}"><label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" ${required ? "required" : ""}></div>`; }
function openModal(type, presetBook = "") {
  const modal = $("#modalBackdrop"); const fields = $("#formFields"); let title = "", copy = "", content = "", submit = "Save";
  if (type === "book") { title = "Add a book"; copy = "Add a title to your collection."; content = `<div class="form-grid">${field("Title", "title", "text", true, "full")}${field("Author", "author")}${field("ISBN", "isbn")}${field("Publication year", "year", "number")}</div>`; }
  if (type === "member") { title = "Register a member"; copy = "Create a reader profile for the library."; content = `<div class="form-grid">${field("Full name", "name", "text", true, "full")}${field("Email", "email", "email")}${field("Phone", "phone")}</div>`; }
  if (type === "checkout") { title = "Check out a book"; copy = "Choose an available book and member. The loan period is 14 days."; const availableBooks = data.books.filter((book) => book.available); content = `<div class="form-grid"><div class="field full"><label for="bookId">Available book</label><select id="bookId" name="bookId" required><option value="">Select a book</option>${availableBooks.map((book) => `<option value="${book.id}" ${book.id === presetBook ? "selected" : ""}>${escapeHtml(book.title)} (${book.id})</option>`).join("")}</select></div><div class="field full"><label for="memberId">Member</label><select id="memberId" name="memberId" required><option value="">Select a member</option>${data.members.map((member) => `<option value="${member.id}">${escapeHtml(member.name)} (${member.id})</option>`).join("")}</select></div></div>`; submit = "Check out"; }
  $("#modalTitle").textContent = title; $("#modalCopy").textContent = copy; $("#formFields").innerHTML = content; $("#submitModal").textContent = submit; modal.dataset.type = type; modal.classList.add("open"); setTimeout(() => modal.querySelector("input, select")?.focus(), 50);
}
function closeModal() { $("#modalBackdrop").classList.remove("open"); }
function submitModal(event) {
  event.preventDefault(); const form = new FormData(event.target); const type = $("#modalBackdrop").dataset.type;
  if (type === "book") data.books.push({ id: uid("B"), title: form.get("title").trim(), author: form.get("author").trim(), isbn: form.get("isbn").trim(), year: Number(form.get("year")), available: true });
  if (type === "member") data.members.push({ id: uid("M"), name: form.get("name").trim(), email: form.get("email").trim(), phone: form.get("phone").trim() });
  if (type === "checkout") { const book = bookById(form.get("bookId")); book.available = false; data.loans.push({ id: uid("L"), bookId: form.get("bookId"), memberId: form.get("memberId"), checkoutDate: today(), dueDate: datePlus(14), returnDate: null }); }
  persist(); closeModal(); render(); notify(type === "book" ? "Book added to the collection." : type === "member" ? "Member registered successfully." : "Book checked out successfully.");
}
function returnBook(bookId) { const loan = activeLoan(bookId); if (!loan) return; loan.returnDate = today(); const book = bookById(bookId); if (book) book.available = true; persist(); render(); notify("Book returned to the collection."); }
function removeBook(id) { if (data.loans.some((loan) => loan.bookId === id)) return notify("Books with loan history cannot be removed."); data.books = data.books.filter((book) => book.id !== id); persist(); render(); notify("Book removed from the catalog."); }
function removeMember(id) { if (data.loans.some((loan) => loan.memberId === id && !loan.returnDate)) return notify("Members with active loans cannot be removed."); data.members = data.members.filter((member) => member.id !== id); persist(); render(); notify("Member removed."); }

$$("[data-view]").forEach((element) => element.addEventListener("click", () => showView(element.dataset.view)));
$$("[data-action]").forEach((element) => element.addEventListener("click", () => { const action = element.dataset.action; if (action === "add-book") openModal("book"); if (action === "add-member") openModal("member"); if (action === "checkout") openModal("checkout"); }));
$("#catalogSearch").addEventListener("input", renderCatalog); $("#catalogFilter").addEventListener("change", renderCatalog); $("#memberSearch").addEventListener("input", renderMembers);
$("#loanTabs").addEventListener("click", (event) => { const button = event.target.closest("button"); if (!button) return; loanFilter = button.dataset.loanFilter; $$("#loanTabs button").forEach((item) => item.classList.toggle("active", item === button)); renderLoans(); });
document.addEventListener("click", (event) => { const removeBookButton = event.target.closest("[data-remove-book]"); const removeMemberButton = event.target.closest("[data-remove-member]"); const returnButton = event.target.closest("[data-return-book]"); if (removeBookButton) removeBook(removeBookButton.dataset.removeBook); if (removeMemberButton) removeMember(removeMemberButton.dataset.removeMember); if (returnButton) returnBook(returnButton.dataset.returnBook); });
$("#modalForm").addEventListener("submit", submitModal); $("#closeModal").addEventListener("click", closeModal); $("#cancelModal").addEventListener("click", closeModal); $("#modalBackdrop").addEventListener("click", (event) => { if (event.target.id === "modalBackdrop") closeModal(); }); $("#mobileMenu").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
$("#resetData").addEventListener("click", () => { if (confirm("Reset the browser app to the original sample data?")) { data = structuredClone(seed); persist(); render(); notify("Demo data reset."); } });
render();
