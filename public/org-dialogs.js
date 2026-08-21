/* ── Firmen- und Abteilungsdialoge ───────────────────────────
 *
 * Die Verdrahtung der beiden Partials views/partials/company-dialog.ejs und
 * views/partials/dept-dialog.ejs. Eine Seite inkludiert das Partial, das sie
 * braucht, lädt dieses Skript und ruft die zugehörige Init-Funktion auf; zurück
 * kommt der Controller, an den sie ihre eigenen Buttons hängt:
 *
 *   const companyDialogs = initCompanyDialogs({ onChange: loadCompanies });
 *   companyDialogs.openDialog(null);      // Anlegen
 *   companyDialogs.openDialog(company);   // Bearbeiten
 *   companyDialogs.confirmDelete(company);
 *
 *   const deptDialogs = initDeptDialogs(companyId, { onChange: loadDepartments });
 *
 * Init ist ausdrücklich und einmalig: die Listener hängen am Dialog, nicht an
 * `document`, und die Seite entscheidet, welche ihrer Elemente sie öffnen. Was
 * nach einem Speichern oder Löschen neu geladen wird, weiß nur sie — deshalb
 * `onChange({ action, id })` statt eines Re-Renders aus diesem Modul heraus.
 *
 * Die Firmen-ID ist ein *Parameter* und keine modulweite Auswahl: sie kommt aus
 * dem Hidden-Field, das die Route der Seite setzt. Vorher hing sie an der
 * Tab-Auswahl der /organization-Seite, die es nicht mehr gibt.
 */

(function () {
  'use strict';

  function requireEl(id, partial) {
    const el = document.getElementById(id);
    // Kein stiller Fallback: ohne das Partial gäbe der Controller später
    // `null`-Fehler an Stellen zurück, die nichts mit der Ursache zu tun haben.
    if (!el) throw new Error(`#${id} fehlt — die Seite muss ${partial} inkludieren`);
    return el;
  }

  // ── Personen ────────────────────────────────────────────────
  // Je Rolle genau eine Person: firmenweit (Accountable Manager, ohne
  // department_id) oder je Abteilung (QM/CMM, Abteilungsleiter).
  function findPerson(persons, role, deptId) {
    return persons.find(p => p.role === role && (deptId ? p.department_id === deptId : !p.department_id));
  }

  async function loadPersons(companyId) {
    if (!companyId) return [];
    // Eine fehlgeschlagene Personenabfrage darf den Dialog nicht aufhalten —
    // ohne Liste legt savePerson() die Person eben neu an.
    try { return await fetchJSON(`/api/companies/${companyId}/persons`); }
    catch { return []; }
  }

  // Legt die Person an oder aktualisiert sie und schreibt anschließend ihre
  // Signatur fort. Ohne vorhandene Person und ohne einen einzigen ausgefüllten
  // Wert passiert nichts — ein leerer Abschnitt legt keine leere Person an.
  async function savePerson({ companyId, persons, role, deptId, first, last, email, sigState }) {
    const existing = findPerson(persons, role, deptId);
    let personId;
    if (existing) {
      await fetchJSON(`/api/persons/${existing.id}`, {
        method: 'PUT',
        body: { first_name: first, last_name: last, email },
      });
      personId = existing.id;
    } else if (first || last || email) {
      const created = await fetchJSON(`/api/companies/${companyId}/persons`, {
        method: 'POST',
        body: { role, first_name: first, last_name: last, email, department_id: deptId },
      });
      personId = created.id;
    }
    if (!personId || !sigState) return;
    if (sigState.base64) {
      await fetchJSON(`/api/persons/${personId}/signature`, { method: 'PUT', body: { signature: sigState.base64 } });
    } else if (sigState.remove) {
      await fetchJSON(`/api/persons/${personId}/signature`, { method: 'PUT', body: { signature: null } });
    }
  }

  // Ein Personenblock im Markup heißt `<prefix>-firstname` / `-lastname` /
  // `-email` / `-sig…`; derselbe Präfix steht im data-sig des Entfernen-Buttons.
  function fillPersonFields(dialog, prefix, person) {
    dialog.querySelector(`#${prefix}-firstname`).value = person ? (person.first_name || '') : '';
    dialog.querySelector(`#${prefix}-lastname`).value = person ? (person.last_name || '') : '';
    dialog.querySelector(`#${prefix}-email`).value = person ? (person.email || '') : '';
  }

  function personFields(dialog, prefix) {
    return {
      first: dialog.querySelector(`#${prefix}-firstname`).value.trim(),
      last: dialog.querySelector(`#${prefix}-lastname`).value.trim(),
      email: dialog.querySelector(`#${prefix}-email`).value.trim(),
    };
  }

  // ── Signaturfelder ──────────────────────────────────────────
  // Einmal je Dialog verdrahtet, danach setzt reset() sie bei jedem Öffnen auf
  // den gespeicherten Stand der Person zurück. Der Zustand lebt im Controller,
  // nicht modulweit: Firmen- und Abteilungsdialog teilen ihn nicht.
  function createSigInputs(dialog, prefixes) {
    const states = {};
    const els = {};

    prefixes.forEach(prefix => {
      const el = {
        file: dialog.querySelector(`#${prefix}-sig`),
        row: dialog.querySelector(`#${prefix}-sig-preview-row`),
        img: dialog.querySelector(`#${prefix}-sig-preview`),
      };
      els[prefix] = el;
      el.file.addEventListener('change', () => {
        const file = el.file.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          states[prefix] = { base64: reader.result.split(',')[1] };
          el.img.src = reader.result;
          el.row.style.display = 'flex';
        };
        reader.readAsDataURL(file);
      });
    });

    dialog.querySelectorAll('.remove-logo-btn[data-sig]').forEach(btn => {
      btn.addEventListener('click', () => {
        const prefix = btn.dataset.sig;
        states[prefix] = { remove: true };
        els[prefix].row.style.display = 'none';
        els[prefix].file.value = '';
      });
    });

    return {
      state(prefix) { return states[prefix]; },
      reset(prefix, person) {
        states[prefix] = null;
        const el = els[prefix];
        el.file.value = '';
        if (person && person.has_signature) {
          el.img.src = `/api/persons/${person.id}/signature?t=${Date.now()}`;
          el.row.style.display = 'flex';
        } else {
          el.row.style.display = 'none';
        }
      },
    };
  }

  // Die Rollenbezeichnung des Abteilungsleiters wird aus Name + Regulation
  // abgeleitet — das Frontend-Zwilling von departmentLeaderLabel() in
  // pdf/common.js; wer hier eine Bezeichnung ändert, ändert sie dort mit.
  // Exportiert, weil neben dem Dialogfeld auch die Abteilungskacheln sie für
  // ihre Vollständigkeitsprüfung brauchen.
  function departmentLeaderLabel(dept) {
    const text = `${dept?.name || ''} ${dept?.regulation || ''}`.toLowerCase();
    if (text.includes('145')) return 'Maintenance Manager';
    if (text.includes('camo') || text.includes('part-m')) return 'Leiter CAMO';
    if (text.includes('ato') || text.includes('flugschule') || text.includes('training')) return 'Head of Training';
    if (text.includes('flug') || text.includes('ops') || text.includes('ore') || text.includes('965')) return 'Flugbetriebsleiter';
    return 'Abteilungsleiter';
  }

  // ── Firmendialoge ───────────────────────────────────────────
  function initCompanyDialogs(options = {}) {
    const PARTIAL = 'views/partials/company-dialog.ejs';
    const dialog = requireEl('company-dialog', PARTIAL);
    const deleteDialog = requireEl('delete-dialog', PARTIAL);
    const onChange = options.onChange || (() => {});
    const $ = id => dialog.querySelector(`#${id}`);

    const sigs = createSigInputs(dialog, ['form-acc']);
    let persons = [];
    let logoBase64 = null;
    let removeLogo = false;
    let deleteTarget = null;

    async function openDialog(company) {
      const isEdit = !!company;
      $('company-dialog-title').textContent = isEdit ? 'Firma bearbeiten' : 'Firma hinzufügen';
      $('form-id').value = isEdit ? company.id : '';
      $('form-name').value = isEdit ? company.name : '';
      $('form-street').value = isEdit ? (company.street || '') : '';
      $('form-postal').value = isEdit ? (company.postal_code || '') : '';
      $('form-city').value = isEdit ? (company.city || '') : '';
      $('form-phone').value = isEdit ? (company.phone || '') : '';
      $('form-fax').value = isEdit ? (company.fax || '') : '';
      $('form-logo').value = '';
      logoBase64 = null;
      removeLogo = false;

      const logoRow = $('logo-preview-row');
      if (isEdit && company.has_logo) {
        $('logo-preview').src = `/api/companies/${company.id}/logo?t=${Date.now()}`;
        logoRow.style.display = 'flex';
      } else {
        logoRow.style.display = 'none';
      }

      // Die Personen gehören zu der Firma, die gerade bearbeitet wird — beim
      // Anlegen gibt es noch keine. Genau deshalb wird die Liste hier gesetzt
      // und nicht einmal je Seitenauswahl: sonst fände savePerson() nach einem
      // Anlegen den Accountable Manager der zuvor bearbeiteten Firma und
      // schriebe die neuen Namen in dessen Datensatz.
      persons = isEdit ? await loadPersons(company.id) : [];
      const acc = findPerson(persons, 'ACCOUNTABLE', null);
      fillPersonFields(dialog, 'form-acc', acc);
      sigs.reset('form-acc', acc);

      dialog.showModal();
      $('form-name').focus();
    }

    $('btn-cancel').addEventListener('click', () => dialog.close());

    $('form-logo').addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        logoBase64 = reader.result.split(',')[1];
        $('logo-preview').src = reader.result;
        $('logo-preview-row').style.display = 'flex';
        removeLogo = false;
      };
      reader.readAsDataURL(file);
    });

    $('remove-logo-btn').addEventListener('click', () => {
      logoBase64 = null;
      removeLogo = true;
      $('form-logo').value = '';
      $('logo-preview-row').style.display = 'none';
    });

    $('company-form').addEventListener('submit', async e => {
      e.preventDefault();
      const id = $('form-id').value;
      const data = {
        name: $('form-name').value.trim(),
        street: $('form-street').value.trim(),
        postal_code: $('form-postal').value.trim(),
        city: $('form-city').value.trim(),
        phone: $('form-phone').value.trim(),
        fax: $('form-fax').value.trim(),
      };
      if (!data.name) { toast('Name ist erforderlich', 'error'); return; }

      const submitBtn = e.submitter || e.target.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;
      try {
        let companyId = id;
        if (id) {
          await fetchJSON(`/api/companies/${id}`, { method: 'PUT', body: data });
          if (logoBase64) {
            await fetchJSON(`/api/companies/${id}/logo`, { method: 'PUT', body: { logo: logoBase64 } });
          } else if (removeLogo) {
            await fetchJSON(`/api/companies/${id}/logo`, { method: 'PUT', body: { logo: null } });
          }
        } else {
          // Beim Anlegen reist das Logo im POST mit, es gibt noch keine Route dafür.
          if (logoBase64) data.logo = logoBase64;
          const created = await fetchJSON('/api/companies', { method: 'POST', body: data });
          companyId = created.id;
        }
        await savePerson({
          companyId, persons, role: 'ACCOUNTABLE', deptId: null,
          ...personFields(dialog, 'form-acc'),
          sigState: sigs.state('form-acc'),
        });
        toast(id ? 'Firma aktualisiert' : 'Firma erstellt');
        dialog.close();
        await onChange({ action: id ? 'update' : 'create', id: companyId });
      } catch (err) {
        toast(err?.message || 'Speichern fehlgeschlagen', 'error');
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });

    function confirmDelete(company) {
      deleteTarget = company;
      deleteDialog.querySelector('#delete-name').textContent = company.name;
      deleteDialog.showModal();
    }

    deleteDialog.querySelector('#delete-cancel').addEventListener('click', () => deleteDialog.close());
    deleteDialog.querySelector('#delete-confirm').addEventListener('click', async e => {
      if (!deleteTarget) return;
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const id = deleteTarget.id;
        await fetchJSON(`/api/companies/${id}`, { method: 'DELETE' });
        toast('Firma gelöscht');
        deleteDialog.close();
        await onChange({ action: 'delete', id });
      } catch (err) {
        toast(err?.message || 'Löschen fehlgeschlagen', 'error');
      } finally { btn.disabled = false; }
    });

    return { openDialog, confirmDelete };
  }

  // ── Abteilungsdialoge ───────────────────────────────────────
  function initDeptDialogs(companyId, options = {}) {
    const PARTIAL = 'views/partials/dept-dialog.ejs';
    // Die Firma ist der Bezug jeder Abteilung und jeder Person darin. Ohne sie
    // liefe das Anlegen ins Leere, deshalb hier und nicht erst beim Speichern.
    if (!companyId) throw new Error('initDeptDialogs(companyId): companyId fehlt — die Seite liest sie aus ihrem Hidden-Field');

    const dialog = requireEl('dept-dialog', PARTIAL);
    const deleteDialog = requireEl('dept-delete-dialog', PARTIAL);
    const onChange = options.onChange || (() => {});
    const $ = id => dialog.querySelector(`#${id}`);

    const sigs = createSigInputs(dialog, ['dept-form-qm', 'dept-form-al']);
    let persons = [];
    let deleteTarget = null;

    async function openDialog(dept) {
      const isEdit = !!dept;
      $('dept-dialog-title').textContent = isEdit ? 'Abteilung bearbeiten' : 'Abteilung hinzufügen';
      $('dept-form-id').value = isEdit ? dept.id : '';
      $('dept-form-name').value = isEdit ? dept.name : '';
      $('dept-form-easa').value = isEdit ? (dept.easa_permission_number || '') : '';
      $('dept-form-regulation').value = isEdit ? (dept.regulation || '') : '';
      $('dept-form-authority-salutation').value = isEdit ? (dept.authority_salutation || '') : '';
      $('dept-form-authority-name').value = isEdit ? (dept.authority_name || '') : '';
      $('dept-form-authority-email').value = isEdit ? (dept.authority_email || '') : '';
      $('dept-form-initial-approval-email').value = isEdit ? (dept.initial_approval_email || '') : '';

      // Eine frische Abteilung hat noch keine Personen — die Liste dient allein
      // dem Nachschlagen der vorhandenen (siehe Firmendialog).
      persons = isEdit ? await loadPersons(companyId) : [];
      const qm = isEdit ? findPerson(persons, 'QM', dept.id) : null;
      const al = isEdit ? findPerson(persons, 'ABTEILUNGSLEITER', dept.id) : null;
      fillPersonFields(dialog, 'dept-form-qm', qm);
      fillPersonFields(dialog, 'dept-form-al', al);
      sigs.reset('dept-form-qm', qm);
      sigs.reset('dept-form-al', al);

      $('dept-form-al-label').textContent = isEdit ? departmentLeaderLabel(dept) : 'Abteilungsleiter';

      dialog.showModal();
      $('dept-form-name').focus();
    }

    $('dept-btn-cancel').addEventListener('click', () => dialog.close());

    $('dept-form').addEventListener('submit', async e => {
      e.preventDefault();
      const id = $('dept-form-id').value;
      const data = {
        name: $('dept-form-name').value.trim(),
        easa_permission_number: $('dept-form-easa').value.trim(),
        regulation: $('dept-form-regulation').value.trim(),
        authority_salutation: $('dept-form-authority-salutation').value,
        authority_name: $('dept-form-authority-name').value.trim(),
        authority_email: $('dept-form-authority-email').value.trim(),
        initial_approval_email: $('dept-form-initial-approval-email').value.trim(),
      };
      if (!data.name) { toast('Name ist erforderlich', 'error'); return; }

      const submitBtn = e.submitter || e.target.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;
      try {
        let deptId = id;
        if (id) {
          await fetchJSON(`/api/departments/${id}`, { method: 'PUT', body: data });
        } else {
          const created = await fetchJSON(`/api/companies/${companyId}/departments`, { method: 'POST', body: data });
          deptId = created.id;
        }
        await savePerson({
          companyId, persons, role: 'QM', deptId,
          ...personFields(dialog, 'dept-form-qm'),
          sigState: sigs.state('dept-form-qm'),
        });
        await savePerson({
          companyId, persons, role: 'ABTEILUNGSLEITER', deptId,
          ...personFields(dialog, 'dept-form-al'),
          sigState: sigs.state('dept-form-al'),
        });
        toast(id ? 'Abteilung aktualisiert' : 'Abteilung erstellt');
        dialog.close();
        await onChange({ action: id ? 'update' : 'create', id: deptId });
      } catch (err) {
        toast(err?.message || 'Speichern fehlgeschlagen', 'error');
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });

    function confirmDelete(dept) {
      deleteTarget = dept;
      deleteDialog.querySelector('#dept-delete-name').textContent = dept.name;
      deleteDialog.showModal();
    }

    deleteDialog.querySelector('#dept-delete-cancel').addEventListener('click', () => deleteDialog.close());
    deleteDialog.querySelector('#dept-delete-confirm').addEventListener('click', async e => {
      if (!deleteTarget) return;
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const id = deleteTarget.id;
        await fetchJSON(`/api/departments/${id}`, { method: 'DELETE' });
        toast('Abteilung gelöscht');
        deleteDialog.close();
        await onChange({ action: 'delete', id });
      } catch (err) {
        toast(err?.message || 'Löschen fehlgeschlagen', 'error');
      } finally { btn.disabled = false; }
    });

    return { openDialog, confirmDelete };
  }

  window.initCompanyDialogs = initCompanyDialogs;
  window.initDeptDialogs = initDeptDialogs;
  window.departmentLeaderLabel = departmentLeaderLabel;
})();
