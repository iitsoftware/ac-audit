const fs = require('fs');
const path = require('path');
const { stmts } = require('../db');

// EASA Form 2 — fill LBA template PDF form fields using pdf-lib
// Supports CAMO and Part-145 templates based on department regulation
async function generateEasaForm2Buffer({ cr, dept, company, accountable, qm, formData }) {
  const { PDFDocument: PDFLib } = require('pdf-lib');
  function fmtDate(isoStr) {
    if (!isoStr) return '';
    const d = isoStr.substring(0, 10).split('-');
    if (d.length !== 3) return isoStr;
    return `${d[2]}.${d[1]}.${d[0]}`;
  }

  const regAndName = ((dept.regulation || '') + ' ' + (dept.name || '')).toLowerCase();
  const is145 = regAndName.includes('145') || regAndName.includes('cao');
  const templateFile = is145 ? 'EASA_Form_2_Part145.pdf' : 'EASA_Form_2_CAMO.pdf';
  const templatePath = path.join(__dirname, '..', 'public', 'templates', templateFile);

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template ${templateFile} nicht gefunden`);
  }

  const templateBuf = fs.readFileSync(templatePath);
  const pdf = await PDFLib.load(templateBuf);
  const form = pdf.getForm();
  const addr = [company.street, [company.postal_code, company.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const amName = accountable ? `${accountable.first_name} ${accountable.last_name}`.trim() + ', Accountable Manager' : '';
  const email = qm ? (qm.email || '') : '';

  if (is145) {
    // ── Part-145 / Part-CAO template ──
    for (const field of form.getFields()) {
      if (field.constructor.name === 'PDFTextField') field.setFontSize(10);
    }

    // Antragsart
    try { form.getRadioGroup('Antragsart').select(formData.antragsart === 'erstgenehmigung' ? 'Erstgenehmigung' : '#c4nderung'); } catch {}
    // Genehmigungsart (Teil-145 vs Teil-CAO)
    try { form.getRadioGroup('Genehmigungsart').select(formData.genart === 'teil-cao' ? 'Teil-CAO' : 'Teil-145'); } catch {}
    // Genehmigungsnummer (strip prefix)
    const permNo145 = (dept.easa_permission_number || '').replace(/^DE\.145\.\s*/i, '').replace(/^DE\.CAO\.\s*/i, '');
    form.getTextField('Genehmigungsnummer').setText(permNo145);
    // Veröffentlichung
    try { form.getRadioGroup('Veröffentlichung').select(formData.einverstaendnis === 'ja' ? 'JA' : 'NEIN'); } catch {}

    form.getTextField('Name des Betriebs').setText(company.name || '');
    form.getTextField('Adresse des Betriebs').setText(addr);
    form.getTextField('Standorte').setText(formData.standorte || 'siehe oben');
    form.getTextField('Bedingungen und Umfang').setText(formData.scope_single || '');
    form.getTextField('Stellung und Name des AccM').setText(amName);
    form.getTextField('Ort der Unterschrift').setText(company.city || '');
    form.getTextField('Datum der Unterschrift').setText(fmtDate(new Date().toISOString().slice(0, 10)));
    form.getTextField('Telefonnummer').setText(formData.telefon || company.phone || '');
    form.getTextField('Faxnummer').setText(formData.fax || company.fax || '');
    form.getTextField('E-Mail').setText(email);

    // Signature for Part-145
    if (accountable) {
      const sigRow = stmts.getPersonSignature.get(accountable.id);
      if (sigRow && sigRow.signature) {
        try {
          let sigImage;
          try { sigImage = await pdf.embedPng(sigRow.signature); }
          catch { sigImage = await pdf.embedJpg(sigRow.signature); }
          // Place signature at half page width, above "Ort der Unterschrift" field
          const ortField = form.getTextField('Ort der Unterschrift');
          const widgets = ortField.acroField.getWidgets();
          if (widgets.length > 0) {
            const rect = widgets[0].getRectangle();
            const page = pdf.getPage(0);
            const pageW = page.getSize().width;
            const dims = sigImage.scaleToFit(180, 45);
            page.drawImage(sigImage, {
              x: pageW / 2, y: rect.y + rect.height + 5,
              width: dims.width, height: dims.height,
            });
          }
        } catch {}
      }
    }

  } else {
    // ── CAMO template ──
    const multilineFields = new Set([
      'beantragte Luftfahrzeugmuster', 'beantragte Privilegien',
      'beantragte organisatorische Änderungen', 'beantragte Änderungen Handbuch',
      'Adresse des Unternehmens', 'Beantragte Genehmigungsstandorte',
      'Name verantwortlicher Betriebsleiter',
    ]);
    for (const field of form.getFields()) {
      if (field.constructor.name === 'PDFTextField') {
        field.setFontSize(10);
        if (multilineFields.has(field.getName())) field.enableMultiline();
      }
    }

    form.getRadioGroup('Antragsart').select(formData.antragsart === 'erstgenehmigung' ? 'Erstgenehmigung' : 'Änderung');
    const permNo = (dept.easa_permission_number || '').replace(/^DE\.CAMO\.\s*/i, '');
    form.getTextField('Genehmigungsnummer CAMO').setText(permNo);
    form.getTextField('Name des Unternehmens').setText(company.name || '');
    form.getTextField('Adresse des Unternehmens').setText(addr);
    form.getTextField('Telefon').setText(formData.telefon || company.phone || '');
    form.getTextField('E-Mail').setText(email);
    form.getTextField('Beantragte Genehmigungsstandorte').setText(formData.standorte || 'siehe oben');

    if (formData.check_5a) form.getCheckBox('Antrag Luftfahrzeugmuster').check();
    form.getTextField('beantragte Luftfahrzeugmuster').setText(formData.scope_5a || '');
    if (formData.check_5b) form.getCheckBox('Antrag Privilegien').check();
    form.getTextField('beantragte Privilegien').setText(formData.scope_5b || '');
    if (formData.check_5c) form.getCheckBox('Antrag organisatorische Änderungen').check();
    form.getTextField('beantragte organisatorische Änderungen').setText(formData.scope_5c || '');
    if (formData.check_5d) form.getCheckBox('Antrag Änderungen Handbuch').check();
    form.getTextField('beantragte Änderungen Handbuch').setText(formData.scope_5d || '');

    form.getRadioGroup('Einverständniserklärung').select(formData.einverstaendnis === 'ja' ? 'Ja' : 'Nein');
    form.getTextField('Name verantwortlicher Betriebsleiter').setText(amName);
    form.getTextField('Datum').setText(fmtDate(new Date().toISOString().slice(0, 10)));

    // Embed signature into CAMO template
    if (accountable) {
      const sigRow = stmts.getPersonSignature.get(accountable.id);
      if (sigRow && sigRow.signature) {
        try {
          let sigImage;
          try { sigImage = await pdf.embedPng(sigRow.signature); }
          catch { sigImage = await pdf.embedJpg(sigRow.signature); }
          const sigField = form.getTextField('Unterschrift Betriebsleiter');
          const widgets = sigField.acroField.getWidgets();
          if (widgets.length > 0) {
            const rect = widgets[0].getRectangle();
            const page = pdf.getPage(1);
            const dims = sigImage.scaleToFit(rect.width, rect.height);
            page.drawImage(sigImage, {
              x: rect.x, y: rect.y + (rect.height - dims.height) / 2,
              width: dims.width, height: dims.height,
            });
          }
        } catch {}
      }
    }
  }

  // Flatten form so fields are not editable in output
  form.flatten();

  // Remove instruction pages (keep only form pages)
  const pageCount = pdf.getPageCount();
  const keepPages = is145 ? 1 : 2;
  for (let i = pageCount - 1; i >= keepPages; i--) {
    pdf.removePage(i);
  }

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}

module.exports = { generateEasaForm2Buffer };
