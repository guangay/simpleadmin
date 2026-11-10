function populateCheckboxes(gw_band, lte_band, nsa_nr5g_band, nr5g_band, locked_gw_bands, locked_lte_bands, locked_nsa_bands, locked_sa_bands, cellLock, emptyText) {
  var modes = [
    { mode: "GW", formId: "checkboxFormGW", bands: gw_band, lockedBands: locked_gw_bands, prefix: "B", emptyText: emptyText },
    { mode: "LTE", formId: "checkboxFormLTE", bands: lte_band, lockedBands: locked_lte_bands, prefix: "B", emptyText: emptyText },
    { mode: "NSA", formId: "checkboxFormNSA", bands: nsa_nr5g_band, lockedBands: locked_nsa_bands, prefix: "N", emptyText: emptyText },
    { mode: "SA", formId: "checkboxFormSA", bands: nr5g_band, lockedBands: locked_sa_bands, prefix: "N", emptyText: emptyText }
  ];

  modes.forEach(function (config) {
    populateModeCheckboxes(config);
  });

  addCheckboxListeners(cellLock);
}

function bandList(value) {
  if (value === null || value === undefined) return [];
  return String(value)
    .split(":")
    .map(function (band) { return band.trim(); })
    .filter(function (band) { return band !== ""; });
}

function populateModeCheckboxes(config) {
  var checkboxesForm = document.getElementById(config.formId);
  if (!checkboxesForm) return;

  var bandsArray = bandList(config.bands);
  var lockedBandsArray = bandList(config.lockedBands);
  checkboxesForm.innerHTML = "";

  if (bandsArray.length === 0) {
    var empty = document.createElement("div");
    empty.className = "sa-band-empty";
    empty.innerText = config.emptyText || "暂无可用频段";
    checkboxesForm.appendChild(empty);
    return;
  }

  bandsArray.forEach(function (band) {
    var checkboxDiv = document.createElement("div");
    checkboxDiv.className = "form-check sa-band-check";

    var checkboxInput = document.createElement("input");
    checkboxInput.className = "form-check-input checkbox-band";
    checkboxInput.type = "checkbox";
    checkboxInput.id = "inlineCheckbox" + config.mode + band;
    checkboxInput.value = band;
    checkboxInput.dataset.bandMode = config.mode;
    checkboxInput.autocomplete = "off";
    checkboxInput.checked = lockedBandsArray.includes(band);

    var checkboxLabel = document.createElement("label");
    checkboxLabel.className = "form-check-label";
    checkboxLabel.htmlFor = checkboxInput.id;
    checkboxLabel.innerText = config.prefix + band;

    checkboxDiv.appendChild(checkboxInput);
    checkboxDiv.appendChild(checkboxLabel);
    checkboxesForm.appendChild(checkboxDiv);
  });
}

(function (global) {
  if (!global.SimpleAdmin) global.SimpleAdmin = {};
  global.SimpleAdmin.BandCheckbox = global.SimpleAdmin.BandCheckbox || {};
  global.SimpleAdmin.BandCheckbox.populate = populateCheckboxes;
})(window);
