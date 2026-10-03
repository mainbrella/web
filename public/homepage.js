const tools = document.querySelector("#resource-tools");
const search = document.querySelector("#resource-search");
const count = document.querySelector("#resource-count");
const emptyState = document.querySelector("#no-results");
const rows = [...document.querySelectorAll(".resource-table tbody tr")];

if (tools && search && count && emptyState && rows.length) {
  const updateResults = () => {
    const tokens = search.value.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    let visible = 0;

    for (const row of rows) {
      const searchableText = `${row.dataset.search || ""} ${row.textContent}`.toLocaleLowerCase();
      const matches = tokens.every((token) => searchableText.includes(token));
      row.hidden = !matches;
      if (matches) visible += 1;
    }

    count.textContent = `${visible} example ${visible === 1 ? "resource" : "resources"}`;
    emptyState.hidden = visible > 0;
  };

  tools.hidden = false;
  updateResults();
  search.addEventListener("input", updateResults);
}
